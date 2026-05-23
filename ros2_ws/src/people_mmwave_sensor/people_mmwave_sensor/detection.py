from dataclasses import dataclass


@dataclass(frozen=True)
class PersonDetection:
    """Internal representation before conversion to ROS messages."""

    track_id: str
    x_m: float
    y_m: float
    z_m: float
    confidence: float

    @property
    def distance_m(self) -> float:
        return (self.x_m**2 + self.y_m**2 + self.z_m**2) ** 0.5

    @property
    def angle_deg(self) -> float:
        import math

        return math.degrees(math.atan2(self.y_m, self.x_m))
