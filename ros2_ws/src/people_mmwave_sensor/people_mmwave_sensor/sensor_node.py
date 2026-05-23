from typing import Iterable

import rclpy
from animatronic_interfaces.msg import (
    DetectedPerson,
    DetectedPersonArray,
    SensorStatus,
)
from rclpy.node import Node

from people_mmwave_sensor.backends import MockPeopleBackend, SerialPeopleBackend
from people_mmwave_sensor.detection import PersonDetection
from people_mmwave_sensor.parsers import Iwr6843PlaceholderParser


class PeopleMmWaveSensorNode(Node):
    def __init__(self) -> None:
        super().__init__("sensor_node")

        self.declare_parameter("namespace", "/animatronic")
        self.declare_parameter("port", "/dev/ttyUSB0")
        self.declare_parameter("baudrate", 921600)
        self.declare_parameter("mock_mode", True)
        self.declare_parameter("publish_rate_hz", 5.0)
        self.declare_parameter("max_detection_distance_m", 5.0)

        self._port = self.get_parameter("port").value
        self._baudrate = int(self.get_parameter("baudrate").value)
        self._mock_mode = bool(self.get_parameter("mock_mode").value)
        publish_rate_hz = float(self.get_parameter("publish_rate_hz").value)
        self._max_detection_distance_m = float(
            self.get_parameter("max_detection_distance_m").value
        )
        namespace = normalize_namespace(self.get_parameter("namespace").value)

        self._people_pub = self.create_publisher(
            DetectedPersonArray, topic(namespace, "people"), 10
        )
        self._nearest_pub = self.create_publisher(
            DetectedPerson, topic(namespace, "nearest_person"), 10
        )
        self._status_pub = self.create_publisher(
            SensorStatus, topic(namespace, "sensor/status"), 10
        )

        self._backend = self._create_backend()
        self._last_error = ""

        timer_period_s = 1.0 / publish_rate_hz if publish_rate_hz > 0.0 else 1.0
        self._timer = self.create_timer(timer_period_s, self._publish_sensor_update)

        mode = "mock" if self._mock_mode else "serial"
        self.get_logger().info(f"people_mmwave_sensor started in {mode} mode")

    def _create_backend(self):
        if self._mock_mode:
            return MockPeopleBackend()

        parser = Iwr6843PlaceholderParser()
        try:
            return SerialPeopleBackend(self._port, self._baudrate, parser)
        except RuntimeError as exc:
            self.get_logger().error(str(exc))
            self._last_error = str(exc)
            return None

    def _publish_sensor_update(self) -> None:
        now = self.get_clock().now().to_msg()

        try:
            detections = self._read_filtered_detections()
            self._last_error = ""
            connected = self._backend is not None
            status = SensorStatus.OK if connected else SensorStatus.DISCONNECTED
        except Exception as exc:  # Keep the node alive while the backend is replaced.
            detections = []
            connected = False
            status = SensorStatus.ERROR
            self._last_error = str(exc)
            self.get_logger().error(f"sensor update failed: {exc}")

        people_msg = DetectedPersonArray()
        people_msg.stamp = now
        people_msg.people = [self._to_person_msg(detection, now) for detection in detections]
        self._people_pub.publish(people_msg)

        nearest = self._nearest_detection(detections)
        if nearest is not None:
            self._nearest_pub.publish(self._to_person_msg(nearest, now))

        self._status_pub.publish(self._status_msg(now, status, connected))

    def _read_filtered_detections(self) -> list[PersonDetection]:
        if self._backend is None:
            return []

        return [
            detection
            for detection in self._backend.read_detections()
            if detection.distance_m <= self._max_detection_distance_m
        ]

    def _nearest_detection(
        self, detections: Iterable[PersonDetection]
    ) -> PersonDetection | None:
        return min(detections, key=lambda detection: detection.distance_m, default=None)

    def _to_person_msg(self, detection: PersonDetection, stamp) -> DetectedPerson:
        msg = DetectedPerson()
        msg.id = detection.track_id
        msg.x_m = float(detection.x_m)
        msg.y_m = float(detection.y_m)
        msg.z_m = float(detection.z_m)
        msg.distance_m = float(detection.distance_m)
        msg.angle_deg = float(detection.angle_deg)
        msg.confidence = float(max(0.0, min(1.0, detection.confidence)))
        msg.stamp = stamp
        return msg

    def _status_msg(self, stamp, status: int, connected: bool) -> SensorStatus:
        msg = SensorStatus()
        msg.stamp = stamp
        msg.status = status
        msg.connected = connected
        msg.sensor_model = "IWR6843"
        if self._mock_mode:
            msg.message = "mock mode active"
        elif self._last_error:
            msg.message = self._last_error
        else:
            msg.message = "serial backend active; parser protocol placeholder"
        return msg

    def destroy_node(self) -> bool:
        if self._backend is not None:
            self._backend.close()
        return super().destroy_node()


def normalize_namespace(namespace: str) -> str:
    namespace = (namespace or "/animatronic").strip()
    if not namespace.startswith("/"):
        namespace = f"/{namespace}"
    return namespace.rstrip("/")


def topic(namespace: str, suffix: str) -> str:
    return f"{namespace}/{suffix.lstrip('/')}"


def main(args=None) -> None:
    rclpy.init(args=args)
    node = PeopleMmWaveSensorNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
