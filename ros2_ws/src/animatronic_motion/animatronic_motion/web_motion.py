from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import yaml

from animatronic_motion.patterns import JOINT_NAMES, MAX_VALUE, MIN_VALUE


@dataclass(frozen=True)
class TangentHandle:
    mode: str = "auto"
    dx: float = 120.0
    dy: float = 0.0


@dataclass(frozen=True)
class TrackKey:
    time_ms: int
    value: float
    tangent_in: TangentHandle
    tangent_out: TangentHandle


@dataclass(frozen=True)
class WebMotionPattern:
    name: str
    tracks: dict[str, list[TrackKey]]
    description: str = ""

    @property
    def duration_ms(self) -> int:
        return max(
            (key.time_ms for track in self.tracks.values() for key in track),
            default=0,
        )


def parse_web_motion_yaml(pattern_yaml: str, fallback_name: str = "inline") -> WebMotionPattern:
    data = yaml.safe_load(pattern_yaml)
    errors, _warnings = validate_web_motion_data(data)
    if errors:
        raise ValueError("; ".join(errors))

    tracks: dict[str, list[TrackKey]] = {}
    for joint_name in JOINT_NAMES:
        track = data["tracks"].get(joint_name) or []
        keys = [
            TrackKey(
                time_ms=int(item["time_ms"]),
                value=float(item["value"]),
                tangent_in=_parse_handle((item.get("tangent") or {}).get("in", {})),
                tangent_out=_parse_handle((item.get("tangent") or {}).get("out", {})),
            )
            for item in track
        ]
        tracks[joint_name] = sorted(keys, key=lambda key: key.time_ms)

    return WebMotionPattern(
        name=str(data.get("name") or fallback_name),
        description=str(data.get("description") or ""),
        tracks=tracks,
    )


def validate_web_motion_data(data: Any) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(data, dict):
        return ["pattern YAML must be a mapping"], warnings

    tracks = data.get("tracks")
    if not isinstance(tracks, dict):
        return ["tracks must be a mapping"], warnings

    unknown = sorted(set(tracks).difference(JOINT_NAMES))
    if unknown:
        warnings.append(f"tracks contains unknown joints: {', '.join(unknown)}")

    for joint_name in JOINT_NAMES:
        track = tracks.get(joint_name)
        if track is None:
            warnings.append(f"tracks omits: {joint_name}")
            continue
        if not isinstance(track, list):
            errors.append(f"tracks.{joint_name} must be a list")
            continue
        previous_time = -1
        for index, item in enumerate(track):
            prefix = f"tracks.{joint_name}[{index}]"
            if not isinstance(item, dict):
                errors.append(f"{prefix} must be a mapping")
                continue
            time_ms = item.get("time_ms")
            if not isinstance(time_ms, int) or time_ms < 0:
                errors.append(f"{prefix}.time_ms must be a non-negative integer")
            elif time_ms <= previous_time:
                errors.append(f"{prefix}.time_ms must be greater than the previous key")
            else:
                previous_time = time_ms

            value = item.get("value")
            if not isinstance(value, (int, float)):
                errors.append(f"{prefix}.value must be numeric")
            elif value < MIN_VALUE or value > MAX_VALUE:
                errors.append(f"{prefix}.value must be between -100 and 100")

            tangent = item.get("tangent", {})
            if tangent is not None and not isinstance(tangent, dict):
                errors.append(f"{prefix}.tangent must be a mapping")
                continue
            for side in ("in", "out"):
                handle = (tangent or {}).get(side, {})
                if handle is not None and not isinstance(handle, dict):
                    errors.append(f"{prefix}.tangent.{side} must be a mapping")
                    continue
                mode = (handle or {}).get("mode", "auto")
                if mode not in {"auto", "flat", "linear", "manual", "step"}:
                    errors.append(f"{prefix}.tangent.{side}.mode is unsupported: {mode}")
    return errors, warnings


def validate_web_motion_yaml(pattern_yaml: str) -> tuple[list[str], list[str]]:
    try:
        data = yaml.safe_load(pattern_yaml)
    except yaml.YAMLError as exc:
        return [f"invalid YAML: {exc}"], []
    return validate_web_motion_data(data)


def pose_at_time(pattern: WebMotionPattern, time_ms: float) -> dict[str, float]:
    values: dict[str, float] = {}
    for joint_name in JOINT_NAMES:
        keys = pattern.tracks.get(joint_name, [])
        values[joint_name] = _track_value_at(keys, time_ms)
    return values


def interpolate_web_motion(
    pattern: WebMotionPattern,
    elapsed_ms: int,
) -> tuple[dict[str, float], float, str]:
    values = pose_at_time(pattern, elapsed_ms)
    duration_ms = max(pattern.duration_ms, 1)
    progress = min(max(elapsed_ms / duration_ms, 0.0), 1.0)
    return values, progress, str(min(elapsed_ms, pattern.duration_ms))


def _parse_handle(data: Any) -> TangentHandle:
    if not isinstance(data, dict):
        return TangentHandle()
    return TangentHandle(
        mode=str(data.get("mode") or "auto"),
        dx=float(data.get("dx") or 120.0),
        dy=float(data.get("dy") or 0.0),
    )


def _track_value_at(keys: list[TrackKey], time_ms: float) -> float:
    if not keys:
        return 0.0
    if time_ms <= keys[0].time_ms:
        return keys[0].value
    last = keys[-1]
    if time_ms >= last.time_ms:
        return last.value

    index = 0
    while index < len(keys) - 1 and keys[index + 1].time_ms <= time_ms:
        index += 1
    start = keys[index]
    end = keys[index + 1]
    span_ms = end.time_ms - start.time_ms or 1
    ratio = (time_ms - start.time_ms) / span_ms
    if start.tangent_out.mode == "step":
        return start.value
    value = _hermite(
        start,
        end,
        _slope_for(keys, index, "out"),
        _slope_for(keys, index + 1, "in"),
        ratio,
    )
    return min(max(value, MIN_VALUE), MAX_VALUE)


def _slope_for(keys: list[TrackKey], index: int, side: str) -> float:
    key = keys[index]
    handle = key.tangent_out if side == "out" else key.tangent_in
    mode = handle.mode
    if mode in {"flat", "step"}:
        return 0.0
    if mode == "linear":
        if side == "out" and index + 1 < len(keys):
            return _linear_slope(key, keys[index + 1])
        if side == "in" and index > 0:
            return _linear_slope(keys[index - 1], key)
        return 0.0
    if mode == "manual":
        dx = max(1.0, handle.dx or 120.0)
        return (-(handle.dy or 0.0) / dx) if side == "in" else ((handle.dy or 0.0) / dx)
    return _auto_slope(keys, index)


def _linear_slope(start: TrackKey, end: TrackKey) -> float:
    return (end.value - start.value) / max(1, end.time_ms - start.time_ms)


def _auto_slope(keys: list[TrackKey], index: int) -> float:
    previous = keys[max(0, index - 1)]
    next_key = keys[min(len(keys) - 1, index + 1)]
    if previous == next_key:
        return 0.0
    return (next_key.value - previous.value) / max(1, next_key.time_ms - previous.time_ms)


def _hermite(start: TrackKey, end: TrackKey, slope_out: float, slope_in: float, ratio: float) -> float:
    span_ms = max(1, end.time_ms - start.time_ms)
    t2 = ratio * ratio
    t3 = t2 * ratio
    return (
        (2 * t3 - 3 * t2 + 1) * start.value
        + (t3 - 2 * t2 + ratio) * span_ms * slope_out
        + (-2 * t3 + 3 * t2) * end.value
        + (t3 - t2) * span_ms * slope_in
    )
