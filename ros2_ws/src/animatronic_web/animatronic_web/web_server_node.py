import asyncio
import json
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
    Mode,
    MotionStatus,
    MotorDiagnosticsArray,
)
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


class ModeRequest(BaseModel):
    mode: str | int
    label: str | None = None


class TorqueRequest(BaseModel):
    enabled: bool


class PatternDocument(BaseModel):
    content: str


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


class WebBridgeNode(Node):
    def __init__(self) -> None:
        super().__init__("web_server_node")
        self.declare_parameter("namespace", "/animatronic")
        self.declare_parameter("web.host", "0.0.0.0")
        self.declare_parameter("web.port", 8080)
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
        self.motor_home_client = self.create_client(Trigger, self.topic("motor/home"))
        self.motor_stop_client = self.create_client(Trigger, self.topic("motor/stop"))
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
