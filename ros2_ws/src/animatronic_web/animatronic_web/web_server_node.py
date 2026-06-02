import asyncio
import json
import math
import threading
from collections import deque
from pathlib import Path
from typing import Any

import rclpy
from ament_index_python.packages import get_package_share_directory
from animatronic_interfaces.action import RunPattern
from animatronic_interfaces.msg import (
    DetectedPerson,
    EventLog,
    JointTarget,
    JointTargets,
    Mode,
    MotorCalibration,
    MotionStatus,
    MotorDiagnosticsArray,
)
from animatronic_interfaces.srv import SetMotorCalibration
from animatronic_interfaces.srv import MotorCommand
from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from rclpy.action import ActionClient
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import Bool
from std_srvs.srv import Trigger
import uvicorn
import yaml

try:
    from rosidl_runtime_py.convert import message_to_ordereddict
except ImportError:
    message_to_ordereddict = None


MODE_LABELS = {
    "stopped": Mode.STOPPED,
    "detection": Mode.DETECTION,
    "random": Mode.RANDOM,
    "test": Mode.TEST,
}

JOINT_NORMALIZATION_DEG = {
    "lower_yaw": 90.0,
    "lower_pitch": 35.0,
    "upper_yaw": 80.0,
    "upper_pitch": 48.0,
}
VIRTUAL_JOINTS = {"lower_yaw"}


class ModeRequest(BaseModel):
    mode: str | int
    label: str | None = None


class TorqueRequest(BaseModel):
    enabled: bool


class PatternDocument(BaseModel):
    content: str


class JointPositions(BaseModel):
    positions: dict[str, float]  # joint_name -> degrees


class RawPositionRequest(BaseModel):
    raw: int


class MotorCalibrationItem(BaseModel):
    joint_name: str
    id: int
    model: str
    raw_0_percent: int
    raw_home: int
    raw_100_percent: int
    min_angle_deg: float = -100.0
    home_angle_deg: float = 0.0
    max_angle_deg: float = 100.0


class MotorCalibrationDocument(BaseModel):
    calibrations: list[MotorCalibrationItem]


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def ros_message_to_dict(message: Any) -> Any:
    if message is None:
        return None
    if message_to_ordereddict is not None:
        return json.loads(json.dumps(message_to_ordereddict(message)))
    if hasattr(message, "get_fields_and_field_types"):
        return {
            name: ros_message_to_dict(getattr(message, name))
            for name in message.get_fields_and_field_types()
        }
    if isinstance(message, (list, tuple)):
        return [ros_message_to_dict(value) for value in message]
    return message


def motor_config_path() -> Path:
    return Path(get_package_share_directory("chicken_bringup")) / "config" / "motors.yaml"


def read_motor_calibrations(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    params = data.get("/**", {}).get("ros__parameters", {})
    joint_names = params.get("joint_names", [])
    joints = params.get("joints", {})
    calibrations = []
    for name in joint_names:
        item = joints.get(name, {})
        if not item:
            continue
        calibrations.append({
            "joint_name": name,
            "id": int(item.get("id", 0)),
            "model": str(item.get("model", "")),
            "raw_0_percent": int(item.get("raw_min", 0)),
            "raw_home": int(item.get("raw_home", 0)),
            "raw_100_percent": int(item.get("raw_max", 0)),
            "min_angle_deg": float(item.get("min_angle_deg", -100.0)),
            "home_angle_deg": float(item.get("home_angle_deg", 0.0)),
            "max_angle_deg": float(item.get("max_angle_deg", 100.0)),
        })
    return calibrations


def write_motor_calibrations(path: Path, document: MotorCalibrationDocument) -> None:
    data = {
        "/**": {
            "ros__parameters": {
                "mock_mode": False,
                "port": "/dev/ttyUSB0",
                "baudrate": 1000000,
                "protocol_version": 2.0,
                "joint_names": [item.joint_name for item in document.calibrations],
                "joints": {},
            }
        }
    }
    joints = data["/**"]["ros__parameters"]["joints"]
    for item in document.calibrations:
        joints[item.joint_name] = {
            "id": int(item.id),
            "model": item.model,
            "raw_min": int(item.raw_0_percent),
            "raw_home": int(item.raw_home),
            "raw_max": int(item.raw_100_percent),
            "min_angle_deg": float(item.min_angle_deg),
            "home_angle_deg": float(item.home_angle_deg),
            "max_angle_deg": float(item.max_angle_deg),
        }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")


class WebBridgeNode(Node):
    def __init__(self) -> None:
        super().__init__("web_server_node")
        self.declare_parameter("namespace", "/animatronic")
        self.declare_parameter("web.host", "0.0.0.0")
        self.declare_parameter("web.port", 18080)
        self.declare_parameter("password", "")
        default_patterns = str(Path(get_package_share_directory("animatronic_web")) / "patterns")
        self.declare_parameter("pattern_dir", default_patterns)
        self.declare_parameter("service_timeout_sec", 1.0)

        self.namespace = self.get_parameter("namespace").value.rstrip("/")
        if not self.namespace.startswith("/"):
            self.namespace = f"/{self.namespace}"
        self.password = self.get_parameter("password").value
        self.pattern_dir = Path(self.get_parameter("pattern_dir").value)
        self.service_timeout_sec = float(self.get_parameter("service_timeout_sec").value)

        self._lock = threading.Lock()
        self._logs: deque[dict[str, Any]] = deque(maxlen=200)
        self._state: dict[str, Any] = {
            "joint_states": None,
            "motor_diagnostics": None,
            "motion_status": None,
            "nearest_person": None,
            "events": [],
        }

        self.mode_pub = self.create_publisher(Mode, self.topic("mode"), 10)
        self.torque_pub = self.create_publisher(Bool, self.topic("motor/torque_enable"), 10)
        self.joint_cmd_pub = self.create_publisher(JointState, self.topic("joint_cmd"), 10)
        self.target_joints_pub = self.create_publisher(JointTargets, self.topic("target_joints"), 10)
        self.motor_home_client = self.create_client(Trigger, self.topic("motor/home"))
        self.motor_stop_client = self.create_client(Trigger, self.topic("motor/stop"))
        self.motor_command_client = self.create_client(
            MotorCommand,
            self.topic("motor/command"),
        )
        self.motor_calibration_client = self.create_client(
            SetMotorCalibration,
            self.topic("motor/calibration"),
        )
        self.motion_stop_client = self.create_client(Trigger, self.topic("motion/stop"))
        self.run_pattern_client = ActionClient(self, RunPattern, self.topic("run_pattern"))

        self.create_subscription(JointState, "/joint_states", self._joint_state_cb, 10)
        self.create_subscription(
            MotorDiagnosticsArray,
            self.topic("motor/diagnostics"),
            self._motor_diagnostics_cb,
            10,
        )
        self.create_subscription(MotionStatus, self.topic("motion/status"), self._motion_status_cb, 10)
        self.create_subscription(DetectedPerson, self.topic("nearest_person"), self._nearest_person_cb, 10)
        self.create_subscription(EventLog, self.topic("events"), self._event_cb, 10)

    def topic(self, name: str) -> str:
        return f"{self.namespace}/{name.lstrip('/')}"

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                **self._state,
                "events": list(self._logs),
                "ros": {
                    "namespace": self.namespace,
                    "services": {
                        "motor_home": self.motor_home_client.service_is_ready(),
                        "motor_stop": self.motor_stop_client.service_is_ready(),
                        "motor_command": self.motor_command_client.service_is_ready(),
                        "motor_calibration": self.motor_calibration_client.service_is_ready(),
                        "motion_stop": self.motion_stop_client.service_is_ready(),
                    },
                    "actions": {
                        "run_pattern": self.run_pattern_client.server_is_ready(),
                    },
                },
            }

    def log_event(self, source: str, event_type: str, message: str, detail: str = "") -> None:
        entry = {
            "source": source,
            "event_type": event_type,
            "message": message,
            "detail": detail,
        }
        with self._lock:
            self._logs.appendleft(entry)

    def publish_mode(self, request: ModeRequest) -> dict[str, Any]:
        msg = Mode()
        if isinstance(request.mode, str):
            key = request.mode.lower()
            if key not in MODE_LABELS:
                raise HTTPException(status_code=400, detail=f"Unsupported mode: {request.mode}")
            msg.mode = MODE_LABELS[key]
            msg.label = request.label or key
        else:
            msg.mode = int(request.mode)
            msg.label = request.label or str(request.mode)
        self.mode_pub.publish(msg)
        self.log_event("web", "mode", f"Published mode {msg.label}")
        return {"success": True, "mode": ros_message_to_dict(msg)}

    def publish_torque(self, enabled: bool) -> dict[str, Any]:
        msg = Bool()
        msg.data = enabled
        self.torque_pub.publish(msg)
        self.log_event("web", "torque", f"Published torque {'enabled' if enabled else 'disabled'}")
        return {"success": True, "enabled": enabled}

    def publish_joint_positions(self, positions: dict[str, float]) -> dict[str, Any]:
        msg = JointState()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.name = list(positions.keys())
        msg.position = [math.radians(v) for v in positions.values()]
        self.joint_cmd_pub.publish(msg)
        targets = JointTargets()
        targets.stamp = msg.header.stamp
        targets.source = "web:manual"
        for name, angle_deg in positions.items():
            if name in VIRTUAL_JOINTS:
                continue
            scale_deg = JOINT_NORMALIZATION_DEG.get(name)
            if not scale_deg:
                continue
            target = JointTarget()
            target.name = name
            target.angle_deg = float(angle_deg)
            target.normalized_value = clamp((float(angle_deg) / scale_deg) * 100.0, -100.0, 100.0)
            target.raw_position = 0
            targets.joints.append(target)
        if targets.joints:
            self.target_joints_pub.publish(targets)
        self.log_event("web", "joints", f"Joint cmd: {positions}")
        return {"success": True, "positions": positions}

    def publish_raw_position(self, joint_name: str, raw_position: int) -> dict[str, Any]:
        targets = JointTargets()
        targets.stamp = self.get_clock().now().to_msg()
        targets.source = "web:motor_raw"
        target = JointTarget()
        target.name = joint_name
        target.angle_deg = 0.0
        target.normalized_value = 0.0
        target.raw_position = int(raw_position)
        targets.joints.append(target)
        self.target_joints_pub.publish(targets)
        self.log_event("web", "motor_raw", f"Raw target: {joint_name}={raw_position}")
        return {"success": True, "joint_name": joint_name, "raw": int(raw_position)}

    async def call_trigger(self, client: Any, name: str) -> dict[str, Any]:
        if not client.service_is_ready():
            return {"success": False, "message": f"{name} service is not available"}
        future = client.call_async(Trigger.Request())
        deadline = asyncio.get_running_loop().time() + self.service_timeout_sec
        while not future.done():
            if asyncio.get_running_loop().time() > deadline:
                return {"success": False, "message": f"{name} service timed out"}
            await asyncio.sleep(0.02)
        result = future.result()
        return {"success": bool(result.success), "message": result.message}

    async def call_motor_command(
        self,
        motor_id: int,
        command: str,
    ) -> dict[str, Any]:
        client = self.motor_command_client
        if not client.service_is_ready():
            return {"success": False, "message": "motor/command service is not available"}
        request = MotorCommand.Request()
        request.id = int(motor_id)
        request.command = command
        future = client.call_async(request)
        deadline = asyncio.get_running_loop().time() + self.service_timeout_sec
        while not future.done():
            if asyncio.get_running_loop().time() > deadline:
                return {"success": False, "message": "motor/command service timed out"}
            await asyncio.sleep(0.02)
        result = future.result()
        return {"success": bool(result.success), "message": result.message}

    async def call_motor_calibration(
        self,
        document: MotorCalibrationDocument,
        apply: bool,
    ) -> dict[str, Any]:
        client = self.motor_calibration_client
        if not client.service_is_ready():
            return {"success": False, "message": "motor/calibration service is not available", "errors": []}
        request = SetMotorCalibration.Request()
        request.apply = apply
        for item in document.calibrations:
            calibration = MotorCalibration()
            calibration.joint_name = item.joint_name
            calibration.id = int(item.id)
            calibration.model = item.model
            calibration.raw_0_percent = int(item.raw_0_percent)
            calibration.raw_home = int(item.raw_home)
            calibration.raw_100_percent = int(item.raw_100_percent)
            calibration.min_angle_deg = float(item.min_angle_deg)
            calibration.home_angle_deg = float(item.home_angle_deg)
            calibration.max_angle_deg = float(item.max_angle_deg)
            request.calibrations.append(calibration)
        future = client.call_async(request)
        deadline = asyncio.get_running_loop().time() + self.service_timeout_sec
        while not future.done():
            if asyncio.get_running_loop().time() > deadline:
                return {"success": False, "message": "motor/calibration service timed out", "errors": []}
            await asyncio.sleep(0.02)
        result = future.result()
        return {
            "success": bool(result.success),
            "message": result.message,
            "errors": list(result.errors),
        }

    def _set_state(self, key: str, message: Any) -> None:
        with self._lock:
            self._state[key] = ros_message_to_dict(message)

    def _joint_state_cb(self, message: JointState) -> None:
        self._set_state("joint_states", message)

    def _motor_diagnostics_cb(self, message: MotorDiagnosticsArray) -> None:
        self._set_state("motor_diagnostics", message)

    def _motion_status_cb(self, message: MotionStatus) -> None:
        self._set_state("motion_status", message)

    def _nearest_person_cb(self, message: DetectedPerson) -> None:
        self._set_state("nearest_person", message)

    def _event_cb(self, message: EventLog) -> None:
        entry = ros_message_to_dict(message)
        with self._lock:
            self._logs.appendleft(entry)
            self._state["events"] = list(self._logs)


def create_app(node: WebBridgeNode) -> FastAPI:
    app = FastAPI(title="Animatronic Web Bridge")
    package_share = Path(get_package_share_directory("animatronic_web"))
    static_dir = package_share / "static"
    node.pattern_dir.mkdir(parents=True, exist_ok=True)

    def require_password(
        x_animatronic_password: str | None = Header(default=None),
        password: str | None = Query(default=None),
    ) -> None:
        if node.password and node.password not in {x_animatronic_password, password}:
            raise HTTPException(status_code=401, detail="Invalid password")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(static_dir / "index.html")

    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/api/status", dependencies=[Depends(require_password)])
    async def status() -> dict[str, Any]:
        return node.snapshot()

    @app.post("/api/mode", dependencies=[Depends(require_password)])
    async def set_mode(request: ModeRequest) -> dict[str, Any]:
        return node.publish_mode(request)

    @app.post("/api/home", dependencies=[Depends(require_password)])
    async def home() -> dict[str, Any]:
        return await node.call_trigger(node.motor_home_client, "motor/home")

    @app.post("/api/stop", dependencies=[Depends(require_password)])
    async def stop() -> dict[str, Any]:
        motor_result, motion_result = await asyncio.gather(
            node.call_trigger(node.motor_stop_client, "motor/stop"),
            node.call_trigger(node.motion_stop_client, "motion/stop"),
        )
        return {"success": motor_result["success"] or motion_result["success"], "motor": motor_result, "motion": motion_result}

    @app.post("/api/torque", dependencies=[Depends(require_password)])
    async def torque(request: TorqueRequest) -> dict[str, Any]:
        return node.publish_torque(request.enabled)

    @app.post("/api/motor/{motor_id}/torque", dependencies=[Depends(require_password)])
    async def motor_torque(motor_id: int, request: TorqueRequest) -> dict[str, Any]:
        return await node.call_motor_command(
            motor_id,
            "torque_on" if request.enabled else "torque_off",
        )

    @app.post("/api/joints", dependencies=[Depends(require_password)])
    async def set_joints(request: JointPositions) -> dict[str, Any]:
        return node.publish_joint_positions(request.positions)

    @app.post("/api/motor/{joint_name}/raw", dependencies=[Depends(require_password)])
    async def set_motor_raw(joint_name: str, request: RawPositionRequest) -> dict[str, Any]:
        return node.publish_raw_position(joint_name, request.raw)

    @app.get("/api/motor-config", dependencies=[Depends(require_password)])
    async def get_motor_config() -> dict[str, Any]:
        path = motor_config_path()
        return {
            "path": str(path),
            "calibrations": read_motor_calibrations(path),
        }

    @app.post("/api/motor-config/validate", dependencies=[Depends(require_password)])
    async def validate_motor_config(document: MotorCalibrationDocument) -> dict[str, Any]:
        return await node.call_motor_calibration(document, apply=False)

    @app.post("/api/motor-config/apply", dependencies=[Depends(require_password)])
    async def apply_motor_config(document: MotorCalibrationDocument) -> dict[str, Any]:
        return await node.call_motor_calibration(document, apply=True)

    @app.put("/api/motor-config/save", dependencies=[Depends(require_password)])
    async def save_motor_config(document: MotorCalibrationDocument) -> dict[str, Any]:
        applied = await node.call_motor_calibration(document, apply=True)
        if not applied["success"]:
            raise HTTPException(status_code=400, detail=applied)
        path = motor_config_path()
        write_motor_calibrations(path, document)
        return {
            "success": True,
            "message": f"{applied['message']}; saved to YAML",
            "path": str(path),
        }

    @app.get("/api/patterns", dependencies=[Depends(require_password)])
    async def list_patterns() -> dict[str, Any]:
        patterns = sorted(path.stem for path in node.pattern_dir.glob("*.yaml"))
        return {"patterns": patterns}

    @app.get("/api/patterns/{name}", dependencies=[Depends(require_password)])
    async def get_pattern(name: str) -> dict[str, Any]:
        path = pattern_path(node.pattern_dir, name)
        if not path.exists():
            raise HTTPException(status_code=404, detail="Pattern not found")
        return {"name": path.stem, "content": path.read_text(encoding="utf-8")}

    @app.put("/api/patterns/{name}", dependencies=[Depends(require_password)])
    async def put_pattern(name: str, document: PatternDocument) -> dict[str, Any]:
        path = pattern_path(node.pattern_dir, name)
        try:
            yaml.safe_load(document.content) if document.content.strip() else None
        except yaml.YAMLError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid YAML: {exc}") from exc
        path.write_text(document.content, encoding="utf-8")
        return {"success": True, "name": path.stem}

    @app.get("/api/logs", dependencies=[Depends(require_password)])
    async def logs() -> dict[str, Any]:
        return {"logs": node.snapshot()["events"]}

    @app.websocket("/ws/status")
    async def websocket_status(websocket: WebSocket) -> None:
        await websocket.accept()
        password = websocket.query_params.get("password")
        if node.password and password != node.password:
            await websocket.close(code=1008)
            return
        try:
            while True:
                await websocket.send_json(node.snapshot())
                await asyncio.sleep(0.5)
        except WebSocketDisconnect:
            return

    return app


def pattern_path(pattern_dir: Path, name: str) -> Path:
    clean_name = Path(name).stem
    if not clean_name or clean_name != name.replace(".yaml", ""):
        raise HTTPException(status_code=400, detail="Pattern name must be a simple file name")
    return pattern_dir / f"{clean_name}.yaml"


def main(args: list[str] | None = None) -> None:
    rclpy.init(args=args)
    node = WebBridgeNode()
    executor = MultiThreadedExecutor()
    executor.add_node(node)
    spin_thread = threading.Thread(target=executor.spin, daemon=True)
    spin_thread.start()

    host = node.get_parameter("web.host").value
    port = int(node.get_parameter("web.port").value)
    app = create_app(node)

    try:
        uvicorn.run(app, host=host, port=port, log_level="info")
    finally:
        executor.shutdown()
        node.destroy_node()
        rclpy.shutdown()
        spin_thread.join(timeout=1.0)


if __name__ == "__main__":
    main()
