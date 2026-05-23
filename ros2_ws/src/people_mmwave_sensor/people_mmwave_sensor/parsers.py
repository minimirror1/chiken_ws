from abc import ABC, abstractmethod

from people_mmwave_sensor.detection import PersonDetection


class MmWaveParser(ABC):
    """Parser interface for replaceable mmWave sensor protocols."""

    @abstractmethod
    def feed(self, data: bytes) -> list[PersonDetection]:
        """Consume raw bytes and return the latest complete detections."""


class Iwr6843PlaceholderParser(MmWaveParser):
    """Placeholder until the exact IWR6843 firmware output format is fixed."""

    def feed(self, data: bytes) -> list[PersonDetection]:
        if not data:
            return []
        return []
