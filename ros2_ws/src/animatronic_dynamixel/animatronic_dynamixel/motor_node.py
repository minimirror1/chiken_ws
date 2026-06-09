from __future__ import annotations

from dataclasses import dataclass
from math import pi
import threading
from typing import Dict, Iterable, List

import rclpy
from animatronic_interfaces.msg import (
    JointTargets,
    MotorCalibration,
    MotorDiagnostic,
    MotorDiagnosticsArray,
    MotorJointPosition,
    MotorStatus,
)
from animatronic_interfaces.srv import MotorCommand, SetMotorCalibration
from animatronic_interfaces.srv import GetMotorPositions
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import Bool
from std_srvs.srv import Trigger

try:
    from dynamixel_sdk import COMM_SUCCESS
    from dynamixel_sdk import GroupBulkRead
    from dynamixel_sdk import GroupSyncRead
    from dynamixel_sdk import GroupSyncWrite
    from dynamixel_sdk import PacketHandler
    from dynamixel_sdk import PortHandler
except ImportError:  # pragma: no cover - exercised only without SDK installed.
    COMM_SUCCESS = 0
    GroupBulkRead = None
    GroupSyncRead = None
    GroupSyncWrite = None
    PacketHandler = None
    PortHandler = None


DEFAULT_JOINT_NAMES = ("lower_yaw", "lower_pitch", "upper_yaw", "upper_pitch")
FAILURE_BLOCK_THRESHOLD = 5


@dataclass(frozen=True)
class ControlTableProfile:
    name: str
    raw_min: int
    raw_home: int
    raw_max: int
    torque_enable_addr: int
    goal_position_addr: int
    goal_position_len: int
    present_position_addr: int
    present_position_len: int
    voltage_addr: int
    voltage_len: int
    voltage_scale: float
    temperature_addr: int
    temperature_len: int
    load_addr: int
    load_len: int
    diagnostic_block_addr: int
    diagnostic_block_len: int
    load_signed: bool = False
    load_scale: float = 1.0


PROFILES = {
    "XM430-W210-T": ControlTableProfile(
        name="XM430-W210-T",
        raw_min=0,
        raw_home=2048,
        raw_max=4095,
        torque_enable_addr=64,
        goal_position_addr=116,
        goal_position_len=4,
        present_position_addr=132,
        present_position_len=4,
        voltage_addr=144,
        voltage_len=2,
        voltage_scale=0.1,
        temperature_addr=146,
        temperature_len=1,
        load_addr=126,  # Present Current. Stored in generic load field.
        load_len=2,
        diagnostic_block_addr=126,
        diagnostic_block_len=21,
        load_signed=True,
        load_scale=2.69,
    ),
    "XM430-W350-R": ControlTableProfile(
        name="XM430-W350-R",
        raw_min=0,
        raw_home=2048,
        raw_max=4095,
        torque_enable_addr=64,
        goal_position_addr=116,
        goal_position_len=4,
        present_position_addr=132,
        present_position_len=4,
        voltage_addr=144,
        voltage_len=2,
        voltage_scale=0.1,
        temperature_addr=146,
        temperature_len=1,
        load_addr=126,
        load_len=2,
        diagnostic_block_addr=126,
        diagnostic_block_len=21,
        load_signed=True,
        load_scale=2.69,
    ),
    "XL320": ControlTableProfile(
        name="XL320",
        raw_min=0,
        raw_home=512,
        raw_max=1023,
        torque_enable_addr=24,
        goal_position_addr=30,
        goal_position_len=2,
        present_position_addr=37,
        present_position_len=2,
        voltage_addr=45,
        voltage_len=1,
        voltage_scale=0.1,
        temperature_addr=46,
        temperature_len=1,
        load_addr=41,
        load_len=2,
        diagnostic_block_addr=37,
        diagnostic_block_len=10,
        load_signed=False,
        load_scale=1.0 / 1023.0,
    ),
}

DIAGNOSTIC_FIELDS = ("position", "voltage", "temperature", "load")


@dataclass(frozen=True)
class MotorConfig:
    joint_name: str
    motor_id: int
    model: str
    min_raw: int
    home_raw: int
    max_raw: int
    min_angle_deg: float
    home_angle_deg: float
    max_angle_deg: float
    profile: ControlTableProfile


@dataclass
class MotorState:
    raw_position: int
    torque_enabled: bool = False
    error_code: int = 0
    error_message: str = ""


class DynamixelBackend:
    def connect(self) -> bool:
        raise NotImplementedError

    def set_torque_enabled(self, enabled: bool) -> None:
        raise NotImplementedError

    def set_motor_torque_enabled(self, motor_id: int, enabled: bool) -> bool:
        raise NotImplementedError

    def write_joint_targets(self, targets: Dict[str, int]) -> None:
        raise NotImplementedError

    def read_diagnostics(self) -> List[MotorDiagnostic]:
        raise NotImplementedError

    def read_diagnostic_field(self, field: str) -> dict[int, float | int] | None:
        del field
        return None

    def home(self) -> None:
        raise NotImplementedError

    def stop(self) -> None:
        raise NotImplementedError

    def reboot(self, motor_id: int) -> bool:
        raise NotImplementedError

    def blocked_motor_ids(self) -> list[int]:
        return []

    def failure_counts(self) -> dict[int, int]:
        return {}

    def torque_enabled_by_id(self) -> dict[int, bool]:
        return {}

    def update_motor_configs(self, motor_configs: Iterable[MotorConfig]) -> None:
        del motor_configs


class MockDynamixelBackend(DynamixelBackend):
    def __init__(self, motor_configs: Iterable[MotorConfig]) -> None:
        self._configs = list(motor_configs)
        self._states = {
            config.joint_name: MotorState(raw_position=config.home_raw)
            for config in self._configs
        }
        self.connected = False

    def connect(self) -> bool:
        self.connected = True
        return True

    def set_torque_enabled(self, enabled: bool) -> None:
        for state in self._states.values():
            state.torque_enabled = enabled

    def set_motor_torque_enabled(self, motor_id: int, enabled: bool) -> bool:
        for config in self._configs:
            if config.motor_id == motor_id:
                self._states[config.joint_name].torque_enabled = enabled
                return True
        return False

    def write_joint_targets(self, targets: Dict[str, int]) -> None:
        for joint_name, raw_position in targets.items():
            if joint_name in self._states:
                self._states[joint_name].raw_position = raw_position

    def read_diagnostics(self) -> List[MotorDiagnostic]:
        diagnostics = []
        for config in self._configs:
            state = self._states[config.joint_name]
            diagnostic = MotorDiagnostic()
            diagnostic.id = config.motor_id
            diagnostic.joint_name = config.joint_name
            diagnostic.model = config.model
            diagnostic.raw_position = state.raw_position
            diagnostic.angle_deg = raw_to_angle_deg(state.raw_position, config)
            diagnostic.voltage_v = 12.0 if config.model.startswith("XM430") else 7.4
            diagnostic.temperature_c = 32.0
            diagnostic.load = 0.0
            diagnostic.torque_enabled = state.torque_enabled
            diagnostic.error_code = state.error_code
            diagnostic.error_message = state.error_message
            diagnostics.append(diagnostic)
        return diagnostics

    def read_diagnostic_field(self, field: str) -> dict[int, float | int] | None:
        diagnostics = self.read_diagnostics()
        if field == "position":
            return {diagnostic.id: diagnostic.raw_position for diagnostic in diagnostics}
        if field == "voltage":
            return {diagnostic.id: diagnostic.voltage_v for diagnostic in diagnostics}
        if field == "temperature":
            return {diagnostic.id: diagnostic.temperature_c for diagnostic in diagnostics}
        if field == "load":
            return {diagnostic.id: diagnostic.load for diagnostic in diagnostics}
        raise ValueError(f"Unsupported diagnostic field: {field}")

    def home(self) -> None:
        self.write_joint_targets(
            {config.joint_name: config.home_raw for config in self._configs}
        )

    def stop(self) -> None:
        self.set_torque_enabled(False)

    def reboot(self, motor_id: int) -> bool:
        return any(config.motor_id == motor_id for config in self._configs)

    def update_motor_configs(self, motor_configs: Iterable[MotorConfig]) -> None:
        self._configs = list(motor_configs)
        next_states = {}
        for config in self._configs:
            next_states[config.joint_name] = self._states.get(
                config.joint_name,
                MotorState(raw_position=config.home_raw),
            )
        self._states = next_states

    def torque_enabled_by_id(self) -> dict[int, bool]:
        return {
            config.motor_id: self._states[config.joint_name].torque_enabled
            for config in self._configs
        }


class RealDynamixelBackend(DynamixelBackend):
    def __init__(
        self,
        port: str,
        baudrate: int,
        protocol_version: float,
        motor_configs: Iterable[MotorConfig],
    ) -> None:
        if PortHandler is None or PacketHandler is None or GroupBulkRead is None:
            raise RuntimeError("dynamixel-sdk is not installed in this environment")

        self.port = port
        self.baudrate = baudrate
        self.protocol_version = protocol_version
        self._configs = list(motor_configs)
        self._config_by_joint = {config.joint_name: config for config in self._configs}
        self._config_by_id = {config.motor_id: config for config in self._configs}
        self._port_handler = PortHandler(port)
        self._packet_handler = PacketHandler(protocol_version)
        self._failure_counts = {config.motor_id: 0 for config in self._configs}
        self._last_errors = {config.motor_id: "" for config in self._configs}
        self._active_ids: set[int] = set()
        self._torque_enabled_by_id = {
            config.motor_id: False for config in self._configs
        }

    def connect(self) -> bool:
        if not self._port_handler.openPort():
            self._mark_all_failed(f"failed to open DYNAMIXEL port: {self.port}")
            return False
        if not self._port_handler.setBaudRate(self.baudrate):
            self._mark_all_failed(f"failed to set DYNAMIXEL baudrate: {self.baudrate}")
            return False

        for config in self._configs:
            self._ping(config.motor_id)
        return bool(self._active_ids)

    def set_torque_enabled(self, enabled: bool) -> None:
        for config in self._configs:
            result, error = self._packet_handler.write1ByteTxRx(
                self._port_handler,
                config.motor_id,
                config.profile.torque_enable_addr,
                1 if enabled else 0,
            )
            self._record_comm(config.motor_id, result, error, "torque enable")
            self._torque_enabled_by_id[config.motor_id] = enabled

    def set_motor_torque_enabled(self, motor_id: int, enabled: bool) -> bool:
        config = self._config_by_id.get(motor_id)
        if config is None:
            return False
        result, error = self._packet_handler.write1ByteTxRx(
            self._port_handler,
            config.motor_id,
            config.profile.torque_enable_addr,
            1 if enabled else 0,
        )
        ok = self._record_comm(config.motor_id, result, error, "torque enable")
        if ok:
            self._torque_enabled_by_id[config.motor_id] = enabled
        return ok

    def write_joint_targets(self, targets: Dict[str, int]) -> None:
        if self.blocked_motor_ids():
            blocked = ", ".join(str(motor_id) for motor_id in self.blocked_motor_ids())
            raise RuntimeError(f"DYNAMIXEL writes blocked by repeated failures: {blocked}")

        target_configs = [
            (self._config_by_joint[joint_name], raw_position)
            for joint_name, raw_position in targets.items()
            if joint_name in self._config_by_joint
        ]
        for profile, group_items in group_by_profile(target_configs).items():
            self._sync_write_goal_positions(profile, group_items)

    def read_diagnostics(self) -> List[MotorDiagnostic]:
        values = self._read_bulk_diagnostic_values()
        positions = values["position"]
        voltages = values["voltage"]
        temperatures = values["temperature"]
        loads = values["load"]

        diagnostics = []
        for config in self._configs:
            raw_position = positions.get(config.motor_id, config.home_raw)
            diagnostic = MotorDiagnostic()
            diagnostic.id = config.motor_id
            diagnostic.joint_name = config.joint_name
            diagnostic.model = config.model
            diagnostic.raw_position = raw_position
            diagnostic.angle_deg = raw_to_angle_deg(raw_position, config)
            diagnostic.voltage_v = voltages.get(config.motor_id, 0.0)
            diagnostic.temperature_c = temperatures.get(config.motor_id, 0.0)
            diagnostic.load = loads.get(config.motor_id, 0.0)
            diagnostic.torque_enabled = self._torque_enabled_by_id.get(
                config.motor_id,
                False,
            )
            diagnostic.error_code = min(self._failure_counts.get(config.motor_id, 0), 255)
            diagnostic.error_message = self._last_errors.get(config.motor_id, "")
            diagnostics.append(diagnostic)
        return diagnostics

    def read_diagnostic_field(self, field: str) -> dict[int, float | int] | None:
        if field not in DIAGNOSTIC_FIELDS:
            raise ValueError(f"Unsupported diagnostic field: {field}")
        return self._read_bulk_diagnostic_values()[field]

    def home(self) -> None:
        self.write_joint_targets(
            {config.joint_name: config.home_raw for config in self._configs}
        )

    def stop(self) -> None:
        self.set_torque_enabled(False)

    def reboot(self, motor_id: int) -> bool:
        config = self._config_by_id.get(motor_id)
        if config is None:
            return False
        result, error = self._packet_handler.reboot(self._port_handler, motor_id)
        self._record_comm(motor_id, result, error, "reboot")
        if result != COMM_SUCCESS or error:
            return False
        return self._ping(motor_id)

    def blocked_motor_ids(self) -> list[int]:
        return [
            motor_id
            for motor_id, count in self._failure_counts.items()
            if count > FAILURE_BLOCK_THRESHOLD
        ]

    def failure_counts(self) -> dict[int, int]:
        return dict(self._failure_counts)

    def torque_enabled_by_id(self) -> dict[int, bool]:
        return dict(self._torque_enabled_by_id)

    def update_motor_configs(self, motor_configs: Iterable[MotorConfig]) -> None:
        self._configs = list(motor_configs)
        self._config_by_joint = {config.joint_name: config for config in self._configs}
        self._config_by_id = {config.motor_id: config for config in self._configs}
        self._failure_counts = {
            config.motor_id: self._failure_counts.get(config.motor_id, 0)
            for config in self._configs
        }
        self._last_errors = {
            config.motor_id: self._last_errors.get(config.motor_id, "")
            for config in self._configs
        }
        self._torque_enabled_by_id = {
            config.motor_id: self._torque_enabled_by_id.get(config.motor_id, False)
            for config in self._configs
        }

    def _ping(self, motor_id: int) -> bool:
        _model_number, result, error = self._packet_handler.ping(
            self._port_handler,
            motor_id,
        )
        ok = self._record_comm(motor_id, result, error, "ping")
        if ok:
            self._active_ids.add(motor_id)
        else:
            self._active_ids.discard(motor_id)
        return ok

    def _sync_write_goal_positions(
        self,
        profile: ControlTableProfile,
        group_items: list[tuple[MotorConfig, int]],
    ) -> None:
        group = GroupSyncWrite(
            self._port_handler,
            self._packet_handler,
            profile.goal_position_addr,
            profile.goal_position_len,
        )
        added: list[MotorConfig] = []
        for config, raw_position in group_items:
            raw_position = clamp(raw_position, config.min_raw, config.max_raw)
            if not group.addParam(
                config.motor_id,
                unsigned_bytes(raw_position, profile.goal_position_len),
            ):
                self._increment_failure(config.motor_id, "sync write addParam failed")
                continue
            added.append(config)

        if not added:
            group.clearParam()
            return

        result = group.txPacket()
        for config in added:
            self._record_comm(config.motor_id, result, 0, "sync write goal position")
        group.clearParam()

    def _read_profile_field(self, field: str) -> dict[int, float | int]:
        values: dict[int, float | int] = {}
        for profile, configs in group_configs_by_profile(self._configs).items():
            address, length = sync_read_address(profile, field)
            group = GroupSyncRead(
                self._port_handler,
                self._packet_handler,
                address,
                length,
            )
            added: list[MotorConfig] = []
            for config in configs:
                if not group.addParam(config.motor_id):
                    self._increment_failure(config.motor_id, f"{field} addParam failed")
                    continue
                added.append(config)

            if not added:
                group.clearParam()
                continue

            result = group.txRxPacket()
            if result != COMM_SUCCESS:
                for config in added:
                    self._record_comm(config.motor_id, result, 0, f"sync read {field}")
                group.clearParam()
                continue

            for config in added:
                if not group.isAvailable(config.motor_id, address, length):
                    self._increment_failure(config.motor_id, f"{field} unavailable")
                    continue
                raw_value = int(group.getData(config.motor_id, address, length))
                values[config.motor_id] = convert_profile_value(profile, field, raw_value)
                self._decrement_failure(config.motor_id)
            group.clearParam()
        return values

    def _read_bulk_diagnostic_values(self) -> dict[str, dict[int, float | int]]:
        values: dict[str, dict[int, float | int]] = {
            field: {} for field in DIAGNOSTIC_FIELDS
        }
        for profile, configs in group_configs_by_profile(self._configs).items():
            group = GroupBulkRead(self._port_handler, self._packet_handler)
            added: list[MotorConfig] = []
            for config in configs:
                if not group.addParam(
                    config.motor_id,
                    profile.diagnostic_block_addr,
                    profile.diagnostic_block_len,
                ):
                    self._increment_failure(
                        config.motor_id,
                        "bulk read diagnostics addParam failed",
                    )
                    continue
                added.append(config)

            if not added:
                group.clearParam()
                continue

            result = group.txRxPacket()
            if result != COMM_SUCCESS:
                for config in added:
                    self._record_comm(
                        config.motor_id,
                        result,
                        0,
                        "bulk read diagnostics",
                    )
                group.clearParam()
                continue

            for config in added:
                motor_ok = True
                for field in DIAGNOSTIC_FIELDS:
                    address, length = sync_read_address(profile, field)
                    if not group.isAvailable(config.motor_id, address, length):
                        self._increment_failure(
                            config.motor_id,
                            f"bulk read {field} unavailable",
                        )
                        motor_ok = False
                        continue
                    raw_value = int(group.getData(config.motor_id, address, length))
                    values[field][config.motor_id] = convert_profile_value(
                        profile,
                        field,
                        raw_value,
                    )
                if motor_ok:
                    self._decrement_failure(config.motor_id)
            group.clearParam()
        return values

    def _record_comm(
        self,
        motor_id: int,
        result: int,
        error: int,
        context: str,
    ) -> bool:
        if result == COMM_SUCCESS and not error:
            self._decrement_failure(motor_id)
            self._last_errors[motor_id] = ""
            return True

        if result != COMM_SUCCESS:
            message = self._packet_handler.getTxRxResult(result)
        else:
            message = self._packet_handler.getRxPacketError(error)
        self._increment_failure(motor_id, f"{context}: {message}")
        return False

    def _increment_failure(self, motor_id: int, message: str) -> None:
        self._failure_counts[motor_id] = self._failure_counts.get(motor_id, 0) + 1
        self._last_errors[motor_id] = message

    def _decrement_failure(self, motor_id: int) -> None:
        self._failure_counts[motor_id] = max(0, self._failure_counts.get(motor_id, 0) - 1)
        if self._failure_counts[motor_id] == 0:
            self._last_errors[motor_id] = ""

    def _mark_all_failed(self, message: str) -> None:
        for config in self._configs:
            self._increment_failure(config.motor_id, message)


def group_by_profile(
    items: list[tuple[MotorConfig, int]],
) -> dict[ControlTableProfile, list[tuple[MotorConfig, int]]]:
    groups: dict[ControlTableProfile, list[tuple[MotorConfig, int]]] = {}
    for config, raw_position in items:
        groups.setdefault(config.profile, []).append((config, raw_position))
    return groups


def group_configs_by_profile(
    configs: Iterable[MotorConfig],
) -> dict[ControlTableProfile, list[MotorConfig]]:
    groups: dict[ControlTableProfile, list[MotorConfig]] = {}
    for config in configs:
        groups.setdefault(config.profile, []).append(config)
    return groups


def sync_read_address(profile: ControlTableProfile, field: str) -> tuple[int, int]:
    if field == "position":
        return profile.present_position_addr, profile.present_position_len
    if field == "voltage":
        return profile.voltage_addr, profile.voltage_len
    if field == "temperature":
        return profile.temperature_addr, profile.temperature_len
    if field == "load":
        return profile.load_addr, profile.load_len
    raise ValueError(f"Unsupported sync read field: {field}")


def convert_profile_value(
    profile: ControlTableProfile,
    field: str,
    raw_value: int,
) -> float | int:
    if field == "voltage":
        return raw_value * profile.voltage_scale
    if field == "temperature":
        return float(raw_value)
    if field == "load":
        if profile.load_signed:
            raw_value = signed_value(raw_value, profile.load_len)
        return raw_value * profile.load_scale
    return raw_value


def signed_value(value: int, byte_len: int) -> int:
    sign_bit = 1 << (byte_len * 8 - 1)
    mask = (1 << (byte_len * 8)) - 1
    value &= mask
    return value - (1 << (byte_len * 8)) if value & sign_bit else value


def unsigned_bytes(value: int, byte_len: int) -> list[int]:
    return list(int(value).to_bytes(byte_len, byteorder="little", signed=False))


def clamp(value: int, minimum: int, maximum: int) -> int:
    lo = min(minimum, maximum)
    hi = max(minimum, maximum)
    return max(lo, min(hi, value))


def normalized_to_raw(normalized_value: float, config: MotorConfig) -> int:
    normalized = max(-100.0, min(100.0, normalized_value))
    if normalized >= 0.0:
        span = config.max_raw - config.home_raw
    else:
        span = config.home_raw - config.min_raw
    return int(round(config.home_raw + (normalized / 100.0) * span))


def raw_to_normalized(raw_position: int, config: MotorConfig) -> float:
    raw = clamp(int(raw_position), config.min_raw, config.max_raw)
    if (raw - config.home_raw) * (config.max_raw - config.home_raw) >= 0:
        span = config.max_raw - config.home_raw
    else:
        span = config.home_raw - config.min_raw
    if span == 0:
        return 0.0
    return max(-100.0, min(100.0, ((raw - config.home_raw) / span) * 100.0))


def raw_to_angle_deg(raw_position: int, config: MotorConfig) -> float:
    max_span = config.max_raw - config.home_raw
    min_span = config.min_raw - config.home_raw
    if max_span and (raw_position - config.home_raw) * max_span >= 0:
        ratio = (raw_position - config.home_raw) / max_span
        return config.home_angle_deg + (config.max_angle_deg - config.home_angle_deg) * ratio
    ratio = 0.0 if min_span == 0 else (raw_position - config.home_raw) / min_span
    return config.home_angle_deg + (config.min_angle_deg - config.home_angle_deg) * ratio


def raw_to_joint_deg(raw_position: int, config: MotorConfig) -> float:
    return raw_to_angle_deg(raw_position, config) - config.home_angle_deg


def angle_to_raw(angle_deg: float, config: MotorConfig) -> int:
    angle = max(config.min_angle_deg, min(config.max_angle_deg, angle_deg))
    if angle >= config.home_angle_deg:
        span = config.max_angle_deg - config.home_angle_deg
        ratio = 0.0 if span == 0.0 else (angle - config.home_angle_deg) / span
        return int(round(config.home_raw + (config.max_raw - config.home_raw) * ratio))
    span = config.home_angle_deg - config.min_angle_deg
    ratio = 0.0 if span == 0.0 else (config.home_angle_deg - angle) / span
    return int(round(config.home_raw + (config.min_raw - config.home_raw) * ratio))


def normalize_namespace(namespace: str) -> str:
    namespace = (namespace or "/animatronic").strip()
    if not namespace.startswith("/"):
        namespace = f"/{namespace}"
    return namespace.rstrip("/")


class MotorNode(Node):
    def __init__(self) -> None:
        super().__init__("motor_node")
        self._declare_parameters()

        namespace = normalize_namespace(self.get_parameter("namespace").value)
        self._motor_configs = self._load_motor_configs()
        self._config_by_joint = {
            config.joint_name: config for config in self._motor_configs
        }

        mock_mode = bool(self.get_parameter("mock_mode").value)
        if mock_mode:
            self._backend = MockDynamixelBackend(self._motor_configs)
        else:
            self._backend = RealDynamixelBackend(
                str(self.get_parameter("port").value),
                int(self.get_parameter("baudrate").value),
                float(self.get_parameter("protocol_version").value),
                self._motor_configs,
            )

        self._connected = self._backend.connect()
        self._torque_enabled = False
        self._last_diagnostics: List[MotorDiagnostic] = []
        self._stopped = False
        self._target_lock = threading.Lock()
        self._latest_targets: dict[str, int] = {}
        self._target_dirty = False

        self.create_subscription(
            Bool,
            f"{namespace}/motor/torque_enable",
            self._on_torque_enable,
            10,
        )
        self.create_subscription(
            JointTargets,
            f"{namespace}/target_joints",
            self._on_target_joints,
            10,
        )

        self._joint_state_pub = self.create_publisher(JointState, "/joint_states", 10)
        self._diagnostics_pub = self.create_publisher(
            MotorDiagnosticsArray,
            f"{namespace}/motor/diagnostics",
            10,
        )
        self._status_pub = self.create_publisher(
            MotorStatus,
            f"{namespace}/motor/status",
            10,
        )

        self.create_service(Trigger, f"{namespace}/motor/home", self._on_home)
        self.create_service(Trigger, f"{namespace}/motor/stop", self._on_stop)
        self.create_service(
            GetMotorPositions,
            f"{namespace}/motor/read_positions",
            self._on_read_positions,
        )
        self.create_service(
            MotorCommand,
            f"{namespace}/motor/reboot",
            self._on_reboot,
        )
        self.create_service(
            MotorCommand,
            f"{namespace}/motor/command",
            self._on_motor_command,
        )
        self.create_service(
            SetMotorCalibration,
            f"{namespace}/motor/calibration",
            self._on_set_calibration,
        )

        state_period = 1.0 / float(self.get_parameter("state_publish_rate_hz").value)
        diagnostics_period = 1.0 / float(
            self.get_parameter("diagnostics_publish_rate_hz").value
        )
        command_period = 1.0 / float(self.get_parameter("command_write_rate_hz").value)
        self.create_timer(state_period, self._publish_joint_states)
        self.create_timer(command_period, self._write_latest_targets)
        self.create_timer(diagnostics_period, self._publish_diagnostics_and_status)

        mode = "mock" if mock_mode else "real"
        self.get_logger().info(
            f"motor_node started in {mode} mode with {len(self._motor_configs)} motors"
        )

    def _declare_parameters(self) -> None:
        self.declare_parameter("namespace", "/animatronic")
        self.declare_parameter("port", "/dev/ttyUSB0")
        self.declare_parameter("baudrate", 57600)
        self.declare_parameter("protocol_version", 2.0)
        self.declare_parameter("mock_mode", True)
        self.declare_parameter("state_publish_rate_hz", 20.0)
        self.declare_parameter("diagnostics_publish_rate_hz", 2.0)
        self.declare_parameter("command_write_rate_hz", 50.0)
        self.declare_parameter("joint_names", list(DEFAULT_JOINT_NAMES))

        self.declare_parameter("motor_ids", [1, 2, 3, 4])
        self.declare_parameter(
            "motor_models",
            ["XM430-W210-T", "XM430-W210-T", "XL320", "XL320"],
        )
        self.declare_parameter("joint_min_raw", [0, 0, 0, 0])
        self.declare_parameter("joint_home_raw", [2048, 2048, 512, 512])
        self.declare_parameter("joint_max_raw", [4095, 4095, 1023, 1023])

        for joint_name in DEFAULT_JOINT_NAMES:
            default_model = (
                "XM430-W210-T" if joint_name.startswith("lower_") else "XL320"
            )
            profile = PROFILES[default_model]
            default_id = DEFAULT_JOINT_NAMES.index(joint_name) + 1
            default_min_angle = -90.0 if joint_name.endswith("_yaw") else -45.0
            default_max_angle = 90.0 if joint_name.endswith("_yaw") else 45.0
            self.declare_parameter(f"joints.{joint_name}.id", default_id)
            self.declare_parameter(f"joints.{joint_name}.model", default_model)
            self.declare_parameter(
                f"joints.{joint_name}.min_angle_deg",
                default_min_angle,
            )
            self.declare_parameter(f"joints.{joint_name}.home_angle_deg", 0.0)
            self.declare_parameter(
                f"joints.{joint_name}.max_angle_deg",
                default_max_angle,
            )
            self.declare_parameter(f"joints.{joint_name}.raw_min", profile.raw_min)
            self.declare_parameter(f"joints.{joint_name}.raw_home", profile.raw_home)
            self.declare_parameter(f"joints.{joint_name}.raw_max", profile.raw_max)

    def _load_motor_configs(self) -> List[MotorConfig]:
        joint_names = [str(name) for name in list(self.get_parameter("joint_names").value)]
        if all(self.has_parameter(f"joints.{name}.id") for name in joint_names):
            return [self._load_nested_motor_config(name) for name in joint_names]
        return self._load_legacy_motor_configs(joint_names)

    def _load_nested_motor_config(self, joint_name: str) -> MotorConfig:
        model = str(self.get_parameter(f"joints.{joint_name}.model").value)
        profile = profile_for_model(model)
        return MotorConfig(
            joint_name=joint_name,
            motor_id=int(self.get_parameter(f"joints.{joint_name}.id").value),
            model=profile.name,
            min_raw=int(self.get_parameter(f"joints.{joint_name}.raw_min").value),
            home_raw=int(self.get_parameter(f"joints.{joint_name}.raw_home").value),
            max_raw=int(self.get_parameter(f"joints.{joint_name}.raw_max").value),
            min_angle_deg=float(
                self.get_parameter(f"joints.{joint_name}.min_angle_deg").value
            ),
            home_angle_deg=float(
                self.get_parameter(f"joints.{joint_name}.home_angle_deg").value
            ),
            max_angle_deg=float(
                self.get_parameter(f"joints.{joint_name}.max_angle_deg").value
            ),
            profile=profile,
        )

    def _load_legacy_motor_configs(self, joint_names: list[str]) -> List[MotorConfig]:
        motor_ids = list(self.get_parameter("motor_ids").value)
        motor_models = list(self.get_parameter("motor_models").value)
        min_raw = list(self.get_parameter("joint_min_raw").value)
        home_raw = list(self.get_parameter("joint_home_raw").value)
        max_raw = list(self.get_parameter("joint_max_raw").value)

        lengths = {
            len(joint_names),
            len(motor_ids),
            len(motor_models),
            len(min_raw),
            len(home_raw),
            len(max_raw),
        }
        if len(lengths) != 1:
            raise ValueError("Motor parameter lists must have the same length")

        configs = []
        for index, joint_name in enumerate(joint_names):
            model = str(motor_models[index])
            profile = profile_for_model(model)
            configs.append(
                MotorConfig(
                    joint_name=str(joint_name),
                    motor_id=int(motor_ids[index]),
                    model=profile.name,
                    min_raw=int(min_raw[index]),
                    home_raw=int(home_raw[index]),
                    max_raw=int(max_raw[index]),
                    min_angle_deg=-90.0,
                    home_angle_deg=0.0,
                    max_angle_deg=90.0,
                    profile=profile,
                )
            )
        return configs

    def _on_torque_enable(self, msg: Bool) -> None:
        try:
            self._backend.set_torque_enabled(bool(msg.data))
            self._torque_enabled = bool(msg.data)
        except RuntimeError as exc:
            self.get_logger().error(str(exc))

    def _on_target_joints(self, msg) -> None:
        targets = {}
        raw_mode = getattr(msg, "source", "") == "web:motor_raw"
        joint_deg_mode = getattr(msg, "source", "") == "web:motor_joint_deg"
        for joint in msg.joints:
            config = self._config_by_joint.get(joint.name)
            if config is None:
                self.get_logger().warn(f"Ignoring unknown joint target: {joint.name}")
                continue
            if raw_mode:
                raw_position = int(joint.raw_position)
            elif joint_deg_mode:
                raw_position = angle_to_raw(
                    config.home_angle_deg + float(joint.angle_deg),
                    config,
                )
            else:
                raw_position = normalized_to_raw(joint.normalized_value, config)
            targets[joint.name] = clamp(raw_position, config.min_raw, config.max_raw)

        if not targets:
            return

        with self._target_lock:
            self._latest_targets = targets
            self._target_dirty = True

    def _write_latest_targets(self) -> None:
        with self._target_lock:
            if not self._target_dirty:
                return
            targets = dict(self._latest_targets)
            self._target_dirty = False

        try:
            self._backend.write_joint_targets(targets)
            self._stopped = False
        except RuntimeError as exc:
            self.get_logger().error(str(exc))

    def _on_home(self, request: Trigger.Request, response: Trigger.Response):
        del request
        try:
            self._backend.home()
            self._stopped = False
            response.success = True
            response.message = "Moved motors to configured home positions"
        except RuntimeError as exc:
            response.success = False
            response.message = str(exc)
        return response

    def _on_stop(self, request: Trigger.Request, response: Trigger.Response):
        del request
        try:
            self._backend.stop()
            self._torque_enabled = False
            self._stopped = True
            response.success = True
            response.message = "Motor commands stopped and torque disabled"
        except RuntimeError as exc:
            response.success = False
            response.message = str(exc)
        return response

    def _on_read_positions(
        self,
        request: GetMotorPositions.Request,
        response: GetMotorPositions.Response,
    ):
        del request
        try:
            diagnostics = self._read_current_position_diagnostics()
        except RuntimeError as exc:
            response.success = False
            response.message = str(exc)
            return response

        response.stamp = self.get_clock().now().to_msg()
        response.diagnostics = diagnostics
        response.joint_positions = self._joint_positions_from_diagnostics(diagnostics)
        response.success = bool(diagnostics)
        response.message = (
            f"read {len(diagnostics)} motor positions"
            if diagnostics
            else "no motor positions read"
        )
        if diagnostics:
            self._merge_position_diagnostics(diagnostics)
        return response

    def _on_reboot(
        self, request: MotorCommand.Request, response: MotorCommand.Response
    ):
        try:
            if request.command and request.command != "reboot":
                response.success = False
                response.message = f"Unsupported motor command: {request.command}"
            elif self._backend.reboot(int(request.id)):
                response.success = True
                response.message = f"Reboot command accepted for motor {request.id}"
            else:
                response.success = False
                response.message = f"Unknown motor id: {request.id}"
        except RuntimeError as exc:
            response.success = False
            response.message = str(exc)
        return response

    def _on_motor_command(
        self, request: MotorCommand.Request, response: MotorCommand.Response
    ):
        motor_id = int(request.id)
        command = (request.command or "").strip().lower()
        try:
            if command == "reboot":
                ok = self._backend.reboot(motor_id)
                response.success = ok
                response.message = (
                    f"Reboot command accepted for motor {motor_id}"
                    if ok else f"Unknown motor id: {motor_id}"
                )
            elif command in {"torque_on", "torque_off"}:
                enabled = command == "torque_on"
                ok = self._backend.set_motor_torque_enabled(motor_id, enabled)
                self._torque_enabled = any(
                    self._backend.torque_enabled_by_id().values()
                )
                response.success = ok
                response.message = (
                    f"Motor {motor_id} torque {'enabled' if enabled else 'disabled'}"
                    if ok else f"Unknown motor id: {motor_id}"
                )
            else:
                response.success = False
                response.message = f"Unsupported motor command: {request.command}"
        except RuntimeError as exc:
            response.success = False
            response.message = str(exc)
        return response

    def _on_set_calibration(
        self,
        request: SetMotorCalibration.Request,
        response: SetMotorCalibration.Response,
    ):
        configs, errors = self._configs_from_calibrations(request.calibrations)
        response.errors = errors
        if errors:
            response.success = False
            response.message = "Invalid motor calibration"
            return response
        if not request.apply:
            response.success = True
            response.message = "Motor calibration is valid"
            return response
        if any(self._backend.torque_enabled_by_id().values()):
            response.success = False
            response.message = "Disable torque before applying motor calibration"
            return response

        self._motor_configs = configs
        self._config_by_joint = {
            config.joint_name: config for config in self._motor_configs
        }
        self._backend.update_motor_configs(self._motor_configs)
        response.success = True
        response.message = f"Applied calibration for {len(configs)} motors"
        return response

    def _configs_from_calibrations(
        self,
        calibrations: Iterable[MotorCalibration],
    ) -> tuple[list[MotorConfig], list[str]]:
        configs: list[MotorConfig] = []
        errors: list[str] = []
        seen_joints: set[str] = set()
        seen_ids: set[int] = set()
        for calibration in calibrations:
            joint_name = str(calibration.joint_name).strip()
            if not joint_name:
                errors.append("joint_name is required")
                continue
            if joint_name in seen_joints:
                errors.append(f"{joint_name}: duplicate joint_name")
                continue
            seen_joints.add(joint_name)
            motor_id = int(calibration.id)
            if motor_id in seen_ids:
                errors.append(f"{joint_name}: duplicate motor id {motor_id}")
                continue
            seen_ids.add(motor_id)
            try:
                profile = profile_for_model(str(calibration.model))
            except ValueError as exc:
                errors.append(f"{joint_name}: {exc}")
                continue
            raw_0 = int(calibration.raw_0_percent)
            raw_home = int(calibration.raw_home)
            raw_100 = int(calibration.raw_100_percent)
            if raw_0 == raw_100:
                errors.append(f"{joint_name}: 0% and 100% counts must differ")
            raw_lo = min(raw_0, raw_100)
            raw_hi = max(raw_0, raw_100)
            if raw_home < raw_lo or raw_home > raw_hi:
                errors.append(f"{joint_name}: home count must be inside 0%..100% range")
            if raw_lo < profile.raw_min or raw_hi > profile.raw_max:
                errors.append(
                    f"{joint_name}: counts must stay inside {profile.raw_min}..{profile.raw_max}"
                )
            min_angle = float(calibration.min_angle_deg)
            home_angle = float(calibration.home_angle_deg)
            max_angle = float(calibration.max_angle_deg)
            if min_angle == max_angle:
                errors.append(f"{joint_name}: min and max angles must differ")
            configs.append(
                MotorConfig(
                    joint_name=joint_name,
                    motor_id=motor_id,
                    model=profile.name,
                    min_raw=raw_0,
                    home_raw=raw_home,
                    max_raw=raw_100,
                    min_angle_deg=min_angle,
                    home_angle_deg=home_angle,
                    max_angle_deg=max_angle,
                    profile=profile,
                )
            )
        if not configs:
            errors.append("at least one motor calibration is required")
        return configs, errors

    def _publish_diagnostics_and_status(self) -> None:
        try:
            self._refresh_diagnostics()
        except RuntimeError as exc:
            self.get_logger().error(str(exc))
            self._last_diagnostics = []

        diagnostics = MotorDiagnosticsArray()
        diagnostics.stamp = self.get_clock().now().to_msg()
        diagnostics.diagnostics = self._last_diagnostics
        self._diagnostics_pub.publish(diagnostics)

        status = MotorStatus()
        status.stamp = diagnostics.stamp
        status.connected = self._connected
        status.torque_enabled = self._torque_enabled
        failure_counts = self._backend.failure_counts()
        blocked_ids = self._backend.blocked_motor_ids()
        status.missing_ids = [
            motor_id for motor_id, count in failure_counts.items() if count > 0
        ]

        if self._stopped:
            status.status = MotorStatus.STOPPED
            status.message = "Stopped"
        elif blocked_ids:
            status.status = MotorStatus.ERROR
            status.message = (
                "DYNAMIXEL writes blocked by repeated failures: "
                + ", ".join(str(motor_id) for motor_id in blocked_ids)
            )
        elif not self._connected:
            status.status = MotorStatus.DISCONNECTED
            status.message = "DYNAMIXEL backend is disconnected"
        elif status.missing_ids:
            status.status = MotorStatus.OK
            status.message = (
                "DYNAMIXEL communication warnings: "
                + ", ".join(
                    f"{motor_id}={failure_counts[motor_id]}"
                    for motor_id in status.missing_ids
                )
            )
        else:
            status.status = MotorStatus.OK
            status.message = "OK"
        self._status_pub.publish(status)

    def _refresh_diagnostics(self) -> None:
        self._last_diagnostics = self._backend.read_diagnostics()

    def _read_current_position_diagnostics(self) -> list[MotorDiagnostic]:
        values = self._backend.read_diagnostic_field("position")
        if values is None:
            diagnostics = self._backend.read_diagnostics()
            return [diagnostic for diagnostic in diagnostics if diagnostic.joint_name]

        failure_counts = self._backend.failure_counts()
        torque_by_id = self._backend.torque_enabled_by_id()
        diagnostics: list[MotorDiagnostic] = []
        for config in self._motor_configs:
            if config.motor_id not in values:
                continue
            diagnostic = MotorDiagnostic()
            diagnostic.id = config.motor_id
            diagnostic.joint_name = config.joint_name
            diagnostic.model = config.model
            diagnostic.raw_position = int(values[config.motor_id])
            diagnostic.angle_deg = raw_to_angle_deg(diagnostic.raw_position, config)
            diagnostic.torque_enabled = torque_by_id.get(config.motor_id, False)
            diagnostic.error_code = min(failure_counts.get(config.motor_id, 0), 255)
            diagnostics.append(diagnostic)
        return diagnostics

    def _joint_positions_from_diagnostics(
        self,
        diagnostics: list[MotorDiagnostic],
    ) -> list[MotorJointPosition]:
        configs_by_joint = {config.joint_name: config for config in self._motor_configs}
        positions: list[MotorJointPosition] = []
        for diagnostic in diagnostics:
            config = configs_by_joint.get(diagnostic.joint_name)
            if config is None:
                continue
            position = MotorJointPosition()
            position.joint_name = diagnostic.joint_name
            position.raw_position = int(diagnostic.raw_position)
            position.joint_angle_deg = raw_to_joint_deg(
                diagnostic.raw_position,
                config,
            )
            position.normalized_value = raw_to_normalized(
                diagnostic.raw_position,
                config,
            )
            positions.append(position)
        return positions

    def _merge_position_diagnostics(self, diagnostics: list[MotorDiagnostic]) -> None:
        fresh_by_joint = {diagnostic.joint_name: diagnostic for diagnostic in diagnostics}
        previous_by_joint = {
            diagnostic.joint_name: diagnostic for diagnostic in self._last_diagnostics
        }
        merged: list[MotorDiagnostic] = []
        for config in self._motor_configs:
            fresh = fresh_by_joint.get(config.joint_name)
            previous = previous_by_joint.get(config.joint_name)
            if fresh is None:
                if previous is not None:
                    merged.append(previous)
                continue
            if previous is not None:
                fresh.voltage_v = previous.voltage_v
                fresh.temperature_c = previous.temperature_c
                fresh.load = previous.load
                fresh.error_message = previous.error_message
            merged.append(fresh)
        self._last_diagnostics = merged

    def _publish_joint_states(self) -> None:
        diagnostics_by_joint = {
            diagnostic.joint_name: diagnostic for diagnostic in self._last_diagnostics
        }
        joint_state = JointState()
        joint_state.header.stamp = self.get_clock().now().to_msg()
        for config in self._motor_configs:
            diagnostic = diagnostics_by_joint.get(config.joint_name)
            raw_position = (
                diagnostic.raw_position if diagnostic is not None else config.home_raw
            )
            joint_state.name.append(config.joint_name)
            joint_state.position.append(raw_to_joint_deg(raw_position, config) * pi / 180.0)
        self._joint_state_pub.publish(joint_state)


def profile_for_model(model: str) -> ControlTableProfile:
    normalized = model.strip().upper()
    if normalized in PROFILES:
        return PROFILES[normalized]
    for profile_name, profile in PROFILES.items():
        if normalized == profile_name.upper():
            return profile
    raise ValueError(f"Unsupported DYNAMIXEL model: {model}")


def main(args=None) -> None:
    rclpy.init(args=args)
    node = MotorNode()
    try:
        rclpy.spin(node)
    except (ExternalShutdownException, KeyboardInterrupt):
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
