from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


JOINT_NAMES = ("lower_yaw", "lower_pitch", "upper_yaw", "upper_pitch")
INTERPOLATIONS = ("linear", "ease_in_out", "snap", "hold")
MIN_VALUE = -100.0
MAX_VALUE = 100.0


@dataclass(frozen=True)
class Keyframe:
    time_ms: int
    interpolation: str
    joints: dict[str, float]


@dataclass(frozen=True)
class MotionPattern:
    name: str
    keyframes: list[Keyframe]
    loop: bool = False
    description: str = ""

    @property
    def duration_ms(self) -> int:
        return self.keyframes[-1].time_ms if self.keyframes else 0


def load_pattern_file(path: Path) -> MotionPattern:
    return parse_pattern_yaml(path.read_text(encoding="utf-8"), fallback_name=path.stem)


def load_pattern_by_name(pattern_dir: Path, pattern_name: str) -> MotionPattern:
    safe_name = Path(pattern_name).name
    for suffix in (".yaml", ".yml", ""):
        path = pattern_dir / f"{safe_name}{suffix}"
        if path.is_file():
            return load_pattern_file(path)
    raise FileNotFoundError(f"pattern not found: {pattern_name}")


def parse_pattern_yaml(pattern_yaml: str, fallback_name: str = "") -> MotionPattern:
    data = yaml.safe_load(pattern_yaml)
    errors, _ = validate_pattern_data(data)
    if errors:
        raise ValueError("; ".join(errors))

    keyframes = [
        Keyframe(
            time_ms=int(frame["time_ms"]),
            interpolation=str(frame.get("interpolation", "linear")),
            joints={name: float(value) for name, value in frame["joints"].items()},
        )
        for frame in data["keyframes"]
    ]
    return MotionPattern(
        name=str(data.get("name") or fallback_name),
        description=str(data.get("description") or ""),
        loop=bool(data.get("loop", False)),
        keyframes=keyframes,
    )


def validate_pattern_data(data: Any) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(data, dict):
        return ["pattern YAML must be a mapping"], warnings

    name = data.get("name")
    if name is not None and not isinstance(name, str):
        errors.append("name must be a string")

    keyframes = data.get("keyframes")
    if not isinstance(keyframes, list) or not keyframes:
        errors.append("keyframes must be a non-empty list")
        return errors, warnings

    previous_time = -1
    previous_joints: set[str] | None = None
    for index, frame in enumerate(keyframes):
        prefix = f"keyframes[{index}]"
        if not isinstance(frame, dict):
            errors.append(f"{prefix} must be a mapping")
            continue

        time_ms = frame.get("time_ms")
        if not isinstance(time_ms, int) or time_ms < 0:
            errors.append(f"{prefix}.time_ms must be a non-negative integer")
        elif time_ms <= previous_time:
            errors.append(f"{prefix}.time_ms must be greater than the previous keyframe")
        else:
            previous_time = time_ms

        interpolation = frame.get("interpolation", "linear")
        if interpolation not in INTERPOLATIONS:
            errors.append(
                f"{prefix}.interpolation must be one of {', '.join(INTERPOLATIONS)}"
            )

        joints = frame.get("joints")
        if not isinstance(joints, dict) or not joints:
            errors.append(f"{prefix}.joints must be a non-empty mapping")
            continue

        joint_names = set(joints.keys())
        unknown = sorted(joint_names.difference(JOINT_NAMES))
        if unknown:
            errors.append(f"{prefix}.joints contains unknown joints: {', '.join(unknown)}")

        missing = sorted(set(JOINT_NAMES).difference(joint_names))
        if missing:
            warnings.append(f"{prefix}.joints omits: {', '.join(missing)}")

        for joint_name, value in joints.items():
            if not isinstance(value, (int, float)):
                errors.append(f"{prefix}.joints.{joint_name} must be numeric")
            elif value < MIN_VALUE or value > MAX_VALUE:
                errors.append(
                    f"{prefix}.joints.{joint_name} must be between -100 and 100"
                )

        if previous_joints is not None and joint_names != previous_joints:
            warnings.append(f"{prefix}.joints differs from previous keyframe")
        previous_joints = joint_names

    return errors, warnings


def validate_pattern_yaml(pattern_yaml: str) -> tuple[list[str], list[str]]:
    try:
        data = yaml.safe_load(pattern_yaml)
    except yaml.YAMLError as exc:
        return [f"invalid YAML: {exc}"], []
    return validate_pattern_data(data)


def interpolate_pattern(pattern: MotionPattern, elapsed_ms: int) -> tuple[dict[str, float], float, str]:
    if not pattern.keyframes:
        return {}, 0.0, ""

    if elapsed_ms <= pattern.keyframes[0].time_ms:
        frame = pattern.keyframes[0]
        return dict(frame.joints), 0.0, str(frame.time_ms)

    if elapsed_ms >= pattern.duration_ms:
        frame = pattern.keyframes[-1]
        return dict(frame.joints), 1.0, str(frame.time_ms)

    previous = pattern.keyframes[0]
    current = pattern.keyframes[-1]
    for index in range(1, len(pattern.keyframes)):
        if elapsed_ms <= pattern.keyframes[index].time_ms:
            previous = pattern.keyframes[index - 1]
            current = pattern.keyframes[index]
            break

    span_ms = max(current.time_ms - previous.time_ms, 1)
    ratio = (elapsed_ms - previous.time_ms) / span_ms
    eased = _apply_interpolation(ratio, current.interpolation)
    values: dict[str, float] = {}
    joint_names = set(previous.joints).union(current.joints)
    for joint_name in joint_names:
        start = previous.joints.get(joint_name, current.joints.get(joint_name, 0.0))
        end = current.joints.get(joint_name, start)
        values[joint_name] = start + (end - start) * eased

    progress = elapsed_ms / max(pattern.duration_ms, 1)
    return values, min(max(progress, 0.0), 1.0), str(current.time_ms)


def _apply_interpolation(ratio: float, interpolation: str) -> float:
    ratio = min(max(ratio, 0.0), 1.0)
    if interpolation == "ease_in_out":
        return ratio * ratio * (3.0 - 2.0 * ratio)
    if interpolation == "snap":
        return 1.0
    if interpolation == "hold":
        return 0.0
    return ratio
