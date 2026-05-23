import math
import time
from abc import ABC, abstractmethod

from people_mmwave_sensor.detection import PersonDetection


class PeopleSensorBackend(ABC):
    @abstractmethod
    def read_detections(self) -> list[PersonDetection]:
        """Return the most recent detections."""

    @abstractmethod
    def close(self) -> None:
        """Release backend resources."""


class MockPeopleBackend(PeopleSensorBackend):
    def __init__(self) -> None:
        self._start_time = time.monotonic()

    def read_detections(self) -> list[PersonDetection]:
        elapsed = time.monotonic() - self._start_time
        count = int(elapsed // 5.0) % 3 + 1
        detections = []

        for index in range(count):
            phase = elapsed * (0.35 + index * 0.12) + index * 1.7
            radius = 1.2 + index * 0.9 + 0.25 * math.sin(phase * 0.7)
            angle = phase
            detections.append(
                PersonDetection(
                    track_id=f"mock_{index + 1}",
                    x_m=radius * math.cos(angle),
                    y_m=radius * math.sin(angle),
                    z_m=0.0,
                    confidence=max(0.5, 0.95 - index * 0.12),
                )
            )

        return detections

    def close(self) -> None:
        return None


class SerialPeopleBackend(PeopleSensorBackend):
    def __init__(self, port: str, baudrate: int, parser) -> None:
        self._parser = parser
        self._serial = None

        try:
            import serial
        except ImportError as exc:
            raise RuntimeError("pyserial is required when mock_mode is false") from exc

        self._serial = serial.Serial(port=port, baudrate=baudrate, timeout=0.0)

    def read_detections(self) -> list[PersonDetection]:
        waiting = getattr(self._serial, "in_waiting", 0)
        if waiting <= 0:
            return []
        data = self._serial.read(waiting)
        return self._parser.feed(data)

    def close(self) -> None:
        if self._serial is not None and self._serial.is_open:
            self._serial.close()
