import json
from datetime import datetime
from pathlib import Path

import rclpy
from animatronic_interfaces.msg import EventLog, MotorStatus, SensorStatus
from rclpy.node import Node


SEVERITY_NAMES = {
    EventLog.DEBUG: "DEBUG",
    EventLog.INFO: "INFO",
    EventLog.WARN: "WARN",
    EventLog.ERROR: "ERROR",
}


class LoggerNode(Node):
    def __init__(self):
        super().__init__("logger_node")
        self.declare_parameter("namespace", "/animatronic")
        self.declare_parameter("log_dir", "logs")
        self.declare_parameter("mirror_to_stdout", False)

        namespace = normalize_namespace(
            self.get_parameter("namespace").get_parameter_value().string_value
        )
        self._log_dir = Path(
            self.get_parameter("log_dir").get_parameter_value().string_value
        ).expanduser()
        self._mirror_to_stdout = (
            self.get_parameter("mirror_to_stdout").get_parameter_value().bool_value
        )
        self._log_dir.mkdir(parents=True, exist_ok=True)

        self.create_subscription(
            EventLog,
            topic(namespace, "events"),
            self._handle_event,
            10,
        )
        self.create_subscription(
            MotorStatus,
            topic(namespace, "motor/status"),
            self._handle_motor_status,
            10,
        )
        self.create_subscription(
            SensorStatus,
            topic(namespace, "sensor/status"),
            self._handle_sensor_status,
            10,
        )
        self.get_logger().info(f"Writing JSONL logs to {self._log_dir}")

    def _handle_event(self, msg):
        self._write_record(
            {
                "timestamp": self._format_stamp(msg.stamp),
                "severity": SEVERITY_NAMES.get(msg.severity, str(msg.severity)),
                "source": msg.source,
                "event_type": msg.event_type,
                "message": msg.message,
                "detail": msg.detail,
            }
        )

    def _handle_motor_status(self, msg):
        detail = {
            "status": int(msg.status),
            "connected": bool(msg.connected),
            "torque_enabled": bool(msg.torque_enabled),
            "missing_ids": list(msg.missing_ids),
        }
        self._write_record(
            {
                "timestamp": self._format_stamp(msg.stamp),
                "severity": "ERROR"
                if msg.status == MotorStatus.ERROR
                else "WARN"
                if msg.status == MotorStatus.DISCONNECTED
                else "INFO",
                "source": "motor",
                "event_type": "motor_status",
                "message": msg.message,
                "detail": detail,
            }
        )

    def _handle_sensor_status(self, msg):
        detail = {
            "status": int(msg.status),
            "connected": bool(msg.connected),
            "sensor_model": msg.sensor_model,
        }
        self._write_record(
            {
                "timestamp": self._format_stamp(msg.stamp),
                "severity": "ERROR"
                if msg.status == SensorStatus.ERROR
                else "WARN"
                if msg.status in (SensorStatus.DISCONNECTED, SensorStatus.DEGRADED)
                else "INFO",
                "source": "sensor",
                "event_type": "sensor_status",
                "message": msg.message,
                "detail": detail,
            }
        )

    def _write_record(self, record):
        timestamp = record.get("timestamp") or self._now_iso()
        record["timestamp"] = timestamp
        path = self._log_dir / f"{timestamp[:10]}.jsonl"
        line = json.dumps(record, ensure_ascii=False, sort_keys=True)
        with path.open("a", encoding="utf-8") as log_file:
            log_file.write(line + "\n")
        if self._mirror_to_stdout:
            print(line, flush=True)

    def _format_stamp(self, stamp):
        if stamp.sec == 0 and stamp.nanosec == 0:
            return self._now_iso()
        return datetime.fromtimestamp(
            stamp.sec + stamp.nanosec / 1_000_000_000
        ).astimezone().isoformat()

    def _now_iso(self):
        return datetime.now().astimezone().isoformat()


def normalize_namespace(namespace: str) -> str:
    namespace = (namespace or "/animatronic").strip()
    if not namespace.startswith("/"):
        namespace = f"/{namespace}"
    return namespace.rstrip("/")


def topic(namespace: str, suffix: str) -> str:
    return f"{namespace}/{suffix.lstrip('/')}"


def main(args=None):
    rclpy.init(args=args)
    node = LoggerNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
