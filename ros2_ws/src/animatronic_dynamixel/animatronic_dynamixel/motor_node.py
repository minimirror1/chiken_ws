from dataclasses import dataclass
from math import pi
from typing import Dict, Iterable, List

import rclpy
from rclpy.executors import ExternalShutdownException
from animatronic_interfaces.msg import (
    JointTargets,
    MotorDiagnostic,
    MotorDiagnosticsArray,
    MotorStatus,
)
from animatronic_interfaces.srv import MotorCommand
from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import Bool
from std_srvs.srv import Trigger


@dataclass(frozen=True)
class MotorConfig:
    joint_name: str
    motor_id: int
    model: str
    min_raw: int
    home_raw: int
    max_raw: int


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

    def write_joint_targets(self, targets: Dict[str, int]) -> None:
        raise NotImplementedError

    def read_diagnostics(self) -> List[MotorDiagnostic]:
        raise NotImplementedError

    def home(self) -> None:
        raise NotImplementedError

    def stop(self) -> None:
        raise NotImplementedError

    def reboot(self, motor_id: int) -> bool:
        raise NotImplementedError


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
            diagnostic.voltage_v = 12.0
            diagnostic.temperature_c = 32.0
            diagnostic.load = 0.0
            diagnostic.torque_enabled = state.torque_enabled
            diagnostic.error_code = state.error_code
            diagnostic.error_message = state.error_message
            diagnostics.append(diagnostic)
        return diagnostics

    def home(self) -> None:
        self.write_joint_targets(
            {config.joint_name: config.home_raw for config in self._configs}
        )

    def stop(self) -> None:
        self.set_torque_enabled(False)

    def reboot(self, motor_id: int) -> bool:
        return any(config.motor_id == motor_id for config in self._configs)


class RealDynamixelBackend(DynamixelBackend):
    def __init__(self, port: str, baudrate: int, protocol_version: float) -> None:
        self.port = port
        self.baudrate = baudrate
        self.protocol_version = protocol_version

    def connect(self) -> bool:
        return False

    def set_torque_enabled(self, enabled: bool) -> None:
        raise RuntimeError("Real DYNAMIXEL backend is not implemented yet")

    def write_joint_targets(self, targets: Dict[str, int]) -> None:
        raise RuntimeError("Real DYNAMIXEL backend is not implemented yet")

    def read_diagnostics(self) -> List[MotorDiagnostic]:
        return []

    def home(self) -> None:
        raise RuntimeError("Real DYNAMIXEL backend is not implemented yet")

    def stop(self) -> None:
        raise RuntimeError("Real DYNAMIXEL backend is not implemented yet")

    def reboot(self, motor_id: int) -> bool:
        raise RuntimeError("Real DYNAMIXEL backend is not implemented yet")


def clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def normalized_to_raw(normalized_value: float, config: MotorConfig) -> int:
    normalized = max(-100.0, min(100.0, normalized_value))
    if normalized >= 0.0:
        span = config.max_raw - config.home_raw
    else:
        span = config.home_raw - config.min_raw
    return int(round(config.home_raw + (normalized / 100.0) * span))


def raw_to_angle_deg(raw_position: int, config: MotorConfig) -> float:
    if raw_position >= config.home_raw:
        span = max(1, config.max_raw - config.home_raw)
        return 90.0 * (raw_position - config.home_raw) / span
    span = max(1, config.home_raw - config.min_raw)
    return -90.0 * (config.home_raw - raw_position) / span


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
            )

        self._connected = self._backend.connect()
        self._torque_enabled = False
        self._last_diagnostics: List[MotorDiagnostic] = []
        self._stopped = False

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
            MotorCommand,
            f"{namespace}/motor/reboot",
            self._on_reboot,
        )

        state_period = 1.0 / float(self.get_parameter("state_publish_rate_hz").value)
        diagnostics_period = 1.0 / float(
            self.get_parameter("diagnostics_publish_rate_hz").value
        )
        self.create_timer(state_period, self._publish_joint_states)
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
        self.declare_parameter(
            "joint_names",
            ["lower_yaw", "lower_pitch", "upper_yaw", "upper_pitch"],
        )
        self.declare_parameter("motor_ids", [1, 2, 3, 4])
        self.declare_parameter(
            "motor_models",
            ["XM430-W210-T", "XM430-W210-T", "XL320", "XL320"],
        )
        self.declare_parameter("joint_min_raw", [1024, 1024, 1024, 1024])
        self.declare_parameter("joint_home_raw", [2048, 2048, 2048, 2048])
        self.declare_parameter("joint_max_raw", [3072, 3072, 3072, 3072])

    def _load_motor_configs(self) -> List[MotorConfig]:
        joint_names = list(self.get_parameter("joint_names").value)
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
            configs.append(
                MotorConfig(
                    joint_name=str(joint_name),
                    motor_id=int(motor_ids[index]),
                    model=str(motor_models[index]),
                    min_raw=int(min_raw[index]),
                    home_raw=int(home_raw[index]),
                    max_raw=int(max_raw[index]),
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
        for joint in msg.joints:
            config = self._config_by_joint.get(joint.name)
            if config is None:
                self.get_logger().warn(f"Ignoring unknown joint target: {joint.name}")
                continue
            raw_position = normalized_to_raw(joint.normalized_value, config)
            targets[joint.name] = clamp(raw_position, config.min_raw, config.max_raw)

        if not targets:
            return

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

    def _publish_diagnostics_and_status(self) -> None:
        self._last_diagnostics = self._backend.read_diagnostics()

        diagnostics = MotorDiagnosticsArray()
        diagnostics.stamp = self.get_clock().now().to_msg()
        diagnostics.diagnostics = self._last_diagnostics
        self._diagnostics_pub.publish(diagnostics)

        status = MotorStatus()
        status.stamp = diagnostics.stamp
        status.connected = self._connected
        status.torque_enabled = self._torque_enabled
        configured_ids = {config.motor_id for config in self._motor_configs}
        seen_ids = {diagnostic.id for diagnostic in self._last_diagnostics}
        status.missing_ids = [motor_id for motor_id in configured_ids - seen_ids]

        if self._stopped:
            status.status = MotorStatus.STOPPED
            status.message = "Stopped"
        elif not self._connected:
            status.status = MotorStatus.DISCONNECTED
            status.message = "DYNAMIXEL backend is disconnected"
        elif status.missing_ids:
            status.status = MotorStatus.ERROR
            status.message = "One or more configured motors are missing"
        else:
            status.status = MotorStatus.OK
            status.message = "OK"
        self._status_pub.publish(status)

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
            joint_state.position.append(raw_to_angle_deg(raw_position, config) * pi / 180.0)
        self._joint_state_pub.publish(joint_state)


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
