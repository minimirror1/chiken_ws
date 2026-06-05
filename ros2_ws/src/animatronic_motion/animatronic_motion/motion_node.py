from __future__ import annotations

import threading
import time
from pathlib import Path

import rclpy
from ament_index_python.packages import get_package_share_directory
from rclpy.action import ActionServer, CancelResponse, GoalResponse
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.time import Time
from std_srvs.srv import Trigger

from animatronic_interfaces.action import RunPattern
from animatronic_interfaces.msg import (
    DetectedPerson,
    EventLog,
    JointTarget,
    JointTargets,
    Mode,
    MotionStatus,
    MotorStatus,
)
from animatronic_interfaces.srv import ValidatePattern

from animatronic_motion.patterns import (
    JOINT_NAMES,
    MAX_VALUE,
    MIN_VALUE,
    interpolate_pattern,
    load_pattern_by_name,
    validate_pattern_yaml,
)
from animatronic_motion.web_motion import (
    interpolate_web_motion,
    parse_web_motion_yaml,
    validate_web_motion_yaml,
)


class MotionNode(Node):
    def __init__(self) -> None:
        super().__init__("motion_node")
        self._callback_group = ReentrantCallbackGroup()

        self.declare_parameter("namespace", "/animatronic")
        self.declare_parameter("pattern_dir", "")
        self.declare_parameter("default_mode", "stopped")
        self.declare_parameter("pattern_lock_ms", 4000)
        self.declare_parameter("second_look_delay_ms", 2500)
        self.declare_parameter("publish_rate_hz", 50.0)
        self.declare_parameter("mock_mode", True)

        self._namespace = _normalize_namespace(
            self.get_parameter("namespace").get_parameter_value().string_value
        )
        self._pattern_dir = self._resolve_pattern_dir()
        self._pattern_lock_ms = int(
            self.get_parameter("pattern_lock_ms").get_parameter_value().integer_value
        )
        self._second_look_delay_ms = int(
            self.get_parameter("second_look_delay_ms").get_parameter_value().integer_value
        )
        self._publish_rate_hz = float(
            self.get_parameter("publish_rate_hz").get_parameter_value().double_value
        )
        self._mock_mode = bool(
            self.get_parameter("mock_mode").get_parameter_value().bool_value
        )

        self._state_lock = threading.RLock()
        self._mode = self._mode_from_label(
            self.get_parameter("default_mode").get_parameter_value().string_value
        )
        self._motor_status = MotorStatus.OK
        self._current_pattern = ""
        self._progress = 0.0
        self._message = "idle"
        self._status = MotionStatus.IDLE
        self._lock_until_ns = 0
        self._active_stop_event: threading.Event | None = None
        self._pending_second_looks: list[tuple[int, dict[str, float]]] = []

        self._target_pub = self.create_publisher(
            JointTargets, self._topic("target_joints"), 10
        )
        self._status_pub = self.create_publisher(
            MotionStatus, self._topic("motion/status"), 10
        )
        self._event_pub = self.create_publisher(EventLog, self._topic("events"), 10)

        self.create_subscription(
            DetectedPerson,
            self._topic("nearest_person"),
            self._nearest_person_callback,
            10,
            callback_group=self._callback_group,
        )
        self.create_subscription(
            Mode,
            self._topic("mode"),
            self._mode_callback,
            10,
            callback_group=self._callback_group,
        )
        self.create_subscription(
            MotorStatus,
            self._topic("motor/status"),
            self._motor_status_callback,
            10,
            callback_group=self._callback_group,
        )

        self.create_service(
            Trigger,
            self._topic("motion/stop"),
            self._stop_callback,
            callback_group=self._callback_group,
        )
        self.create_service(
            ValidatePattern,
            self._topic("motion/validate_pattern"),
            self._validate_pattern_callback,
            callback_group=self._callback_group,
        )
        self._action_server = ActionServer(
            self,
            RunPattern,
            self._topic("run_pattern"),
            execute_callback=self._execute_run_pattern,
            goal_callback=self._goal_callback,
            cancel_callback=self._cancel_callback,
            callback_group=self._callback_group,
        )

        self.create_timer(
            0.2,
            self._publish_status,
            callback_group=self._callback_group,
        )
        self.create_timer(
            0.05,
            self._process_second_looks,
            callback_group=self._callback_group,
        )

        self._publish_event(EventLog.INFO, "node_started", "motion_node started")

    def _resolve_pattern_dir(self) -> Path:
        configured = self.get_parameter("pattern_dir").get_parameter_value().string_value
        if configured:
            return Path(configured).expanduser()
        return Path(get_package_share_directory("animatronic_motion")) / "patterns"

    def _topic(self, suffix: str) -> str:
        return f"{self._namespace}/{suffix.lstrip('/')}"

    def _now_ns(self) -> int:
        return self.get_clock().now().nanoseconds

    def _mode_from_label(self, label: str) -> Mode:
        mode = Mode()
        normalized = label.lower()
        if normalized == "detection":
            mode.mode = Mode.DETECTION
        elif normalized == "random":
            mode.mode = Mode.RANDOM
        elif normalized == "test":
            mode.mode = Mode.TEST
        else:
            mode.mode = Mode.STOPPED
            normalized = "stopped"
        mode.label = normalized
        return mode

    def _mode_callback(self, msg: Mode) -> None:
        with self._state_lock:
            self._mode = msg
            if msg.mode == Mode.STOPPED:
                self._stop_active_motion("mode stopped")
                self._status = MotionStatus.STOPPED
                self._message = "stopped by mode"
        self._publish_event(EventLog.INFO, "mode_changed", f"mode={msg.mode}")

    def _motor_status_callback(self, msg: MotorStatus) -> None:
        with self._state_lock:
            self._motor_status = msg.status
            if not self._mock_mode and msg.status in (
                MotorStatus.DISCONNECTED,
                MotorStatus.ERROR,
            ):
                self._stop_active_motion("motor unavailable")
                self._status = MotionStatus.ERROR
                self._message = msg.message or "motor unavailable"

    def _nearest_person_callback(self, msg: DetectedPerson) -> None:
        with self._state_lock:
            if self._mode.mode != Mode.DETECTION:
                return
            if self._is_locked():
                return
            if not self._mock_mode and self._motor_status != MotorStatus.OK:
                self._publish_event(
                    EventLog.WARN,
                    "look_skipped",
                    "nearest person ignored because motor status is not OK",
                )
                return

            target = self._look_target_from_person(msg)
            self._publish_joint_targets(target, "motion_node:detection")
            self._lock_for_ms(self._pattern_lock_ms)
            self._status = MotionStatus.LOCKED
            self._message = f"looking at detected person {msg.id}".strip()

            second_look_at = self._now_ns() + self._second_look_delay_ms * 1_000_000
            self._pending_second_looks.append((second_look_at, target))

        self._publish_event(EventLog.INFO, "person_detected", self._message)

    def _look_target_from_person(self, msg: DetectedPerson) -> dict[str, float]:
        yaw = _clamp(msg.angle_deg, MIN_VALUE, MAX_VALUE)
        pitch = 0.0
        if msg.distance_m > 0.01:
            pitch = _clamp((msg.z_m / msg.distance_m) * 50.0, -30.0, 30.0)
        return {
            "lower_yaw": yaw,
            "lower_pitch": pitch,
            "upper_yaw": _clamp(yaw * 0.45, MIN_VALUE, MAX_VALUE),
            "upper_pitch": _clamp(pitch * 0.5, MIN_VALUE, MAX_VALUE),
        }

    def _process_second_looks(self) -> None:
        ready: list[dict[str, float]] = []
        now_ns = self._now_ns()
        with self._state_lock:
            pending: list[tuple[int, dict[str, float]]] = []
            for due_ns, target in self._pending_second_looks:
                if due_ns <= now_ns:
                    ready.append(target)
                else:
                    pending.append((due_ns, target))
            self._pending_second_looks = pending

        for target in ready:
            self._publish_joint_targets(target, "motion_node:detection_second_look")
            self._publish_event(EventLog.INFO, "second_look", "published second look")

    def _stop_callback(self, request: Trigger.Request, response: Trigger.Response):
        del request
        with self._state_lock:
            self._stop_active_motion("stop service")
            self._pending_second_looks.clear()
            self._current_pattern = ""
            self._progress = 0.0
            self._status = MotionStatus.STOPPED
            self._message = "stopped"
        self._publish_event(EventLog.INFO, "motion_stopped", "motion stopped")
        response.success = True
        response.message = "motion stopped"
        return response

    def _validate_pattern_callback(
        self,
        request: ValidatePattern.Request,
        response: ValidatePattern.Response,
    ):
        pattern_yaml = request.pattern_yaml
        if not pattern_yaml and request.pattern_name:
            try:
                pattern = load_pattern_by_name(self._pattern_dir, request.pattern_name)
                response.valid = True
                response.errors = []
                response.warnings = []
                response.warnings.append(f"loaded pattern: {pattern.name}")
                return response
            except (FileNotFoundError, ValueError) as exc:
                response.valid = False
                response.errors = [str(exc)]
                response.warnings = []
                return response

        if pattern_yaml.strip() and _looks_like_web_motion_yaml(pattern_yaml):
            errors, warnings = validate_web_motion_yaml(pattern_yaml)
        else:
            errors, warnings = validate_pattern_yaml(pattern_yaml)
        response.valid = not errors
        response.errors = errors
        response.warnings = warnings
        return response

    def _goal_callback(self, goal_request: RunPattern.Goal):
        with self._state_lock:
            busy = self._active_stop_event is not None
            locked = self._is_locked()
        if busy:
            return GoalResponse.REJECT
        if locked and not goal_request.allow_interrupt:
            return GoalResponse.REJECT
        return GoalResponse.ACCEPT

    def _cancel_callback(self, goal_handle):
        del goal_handle
        with self._state_lock:
            self._stop_active_motion("action canceled")
        return CancelResponse.ACCEPT

    def _execute_run_pattern(self, goal_handle):
        goal = goal_handle.request
        if goal.preview_only:
            return self._preview_pattern(goal_handle, goal.pattern_name, goal.pattern_yaml)

        try:
            if goal.pattern_yaml.strip():
                pattern = parse_web_motion_yaml(goal.pattern_yaml, goal.pattern_name or "inline")
                interpolator = interpolate_web_motion
                pattern_source = "inline"
            else:
                pattern = load_pattern_by_name(self._pattern_dir, goal.pattern_name)
                interpolator = interpolate_pattern
                pattern_source = pattern.name
        except (FileNotFoundError, ValueError) as exc:
            goal_handle.abort()
            return _run_pattern_result(False, str(exc))

        start_time_ms = min(max(int(getattr(goal, "start_time_ms", 0)), 0), pattern.duration_ms)

        stop_event = threading.Event()
        with self._state_lock:
            if self._active_stop_event is not None:
                busy = True
            else:
                busy = False
                self._active_stop_event = stop_event
                self._current_pattern = pattern.name
                self._progress = start_time_ms / max(pattern.duration_ms, 1)
                self._status = MotionStatus.RUNNING
                self._message = "running"
                self._lock_for_ms(self._pattern_lock_ms)

        if busy:
            goal_handle.abort()
            return _run_pattern_result(False, "motion already running")

        self._publish_event(EventLog.INFO, "pattern_started", pattern.name)
        start_ns = time.monotonic_ns()
        period_ns = int(1_000_000_000 / max(self._publish_rate_hz, 1.0))
        tick = 0

        while rclpy.ok() and not stop_event.is_set():
            now_ns = time.monotonic_ns()
            elapsed_ms = int((now_ns - start_ns) / 1_000_000)
            sample_ms = min(start_time_ms + elapsed_ms, pattern.duration_ms)
            values, progress, keyframe = interpolator(pattern, sample_ms)
            self._publish_joint_targets(values, f"motion_node:{pattern_source}")
            self._publish_feedback(goal_handle, progress, keyframe)
            with self._state_lock:
                self._progress = progress

            if goal_handle.is_cancel_requested:
                stop_event.set()
                goal_handle.canceled()
                self._finish_pattern("", stop_event)
                return _run_pattern_result(False, "pattern canceled")
            if sample_ms >= pattern.duration_ms:
                break
            tick += 1
            next_ns = start_ns + tick * period_ns
            sleep_sec = (next_ns - time.monotonic_ns()) / 1_000_000_000
            if sleep_sec > 0:
                time.sleep(sleep_sec)

        if stop_event.is_set():
            goal_handle.abort()
            self._finish_pattern("", stop_event)
            return _run_pattern_result(False, "pattern stopped")

        with self._state_lock:
            if self._active_stop_event is stop_event:
                self._progress = 1.0
                self._status = MotionStatus.IDLE
                self._message = "idle"
                self._active_stop_event = None
        self._publish_event(EventLog.INFO, "pattern_completed", pattern.name)
        goal_handle.succeed()
        return _run_pattern_result(True, "pattern completed")

    def _preview_pattern(self, goal_handle, pattern_name: str, pattern_yaml: str = ""):
        try:
            if pattern_yaml.strip():
                pattern = parse_web_motion_yaml(pattern_yaml, pattern_name or "inline")
            else:
                pattern = load_pattern_by_name(self._pattern_dir, pattern_name)
        except (FileNotFoundError, ValueError) as exc:
            goal_handle.abort()
            return _run_pattern_result(False, str(exc))
        feedback = RunPattern.Feedback()
        feedback.progress = 1.0
        feedback.current_keyframe = str(pattern.duration_ms)
        goal_handle.publish_feedback(feedback)
        goal_handle.succeed()
        return _run_pattern_result(True, f"pattern valid: {pattern.name}")

    def _publish_feedback(self, goal_handle, progress: float, keyframe: str) -> None:
        feedback = RunPattern.Feedback()
        feedback.progress = float(progress)
        feedback.current_keyframe = keyframe
        goal_handle.publish_feedback(feedback)

    def _finish_pattern(
        self,
        message: str,
        stop_event: threading.Event | None = None,
    ) -> None:
        with self._state_lock:
            if stop_event is not None and self._active_stop_event is not stop_event:
                return
            self._current_pattern = ""
            self._progress = 0.0
            self._active_stop_event = None
            self._status = MotionStatus.STOPPED
            self._message = message or "stopped"

    def _stop_active_motion(self, message: str) -> None:
        if self._active_stop_event is not None:
            self._active_stop_event.set()
        self._message = message

    def _publish_joint_targets(self, values: dict[str, float], source: str) -> None:
        msg = JointTargets()
        msg.stamp = self.get_clock().now().to_msg()
        msg.source = source
        for joint_name in JOINT_NAMES:
            value = _clamp(float(values.get(joint_name, 0.0)), MIN_VALUE, MAX_VALUE)
            target = JointTarget()
            target.name = joint_name
            target.normalized_value = value
            target.angle_deg = 0.0
            target.raw_position = 0
            msg.joints.append(target)
        self._target_pub.publish(msg)

    def _publish_status(self) -> None:
        with self._state_lock:
            status_value = self._status
            if self._is_locked() and status_value == MotionStatus.IDLE:
                status_value = MotionStatus.LOCKED

            msg = MotionStatus()
            msg.stamp = self.get_clock().now().to_msg()
            msg.status = status_value
            msg.mode = self._mode
            msg.current_pattern = self._current_pattern
            msg.progress = float(self._progress)
            msg.pattern_locked = self._is_locked()
            msg.lock_until = Time(nanoseconds=self._lock_until_ns).to_msg()
            msg.message = self._message
        self._status_pub.publish(msg)

    def _publish_event(self, severity: int, event_type: str, message: str) -> None:
        msg = EventLog()
        msg.stamp = self.get_clock().now().to_msg()
        msg.severity = severity
        msg.source = "motion_node"
        msg.event_type = event_type
        msg.message = message
        msg.detail = ""
        self._event_pub.publish(msg)

    def _lock_for_ms(self, duration_ms: int) -> None:
        self._lock_until_ns = max(
            self._lock_until_ns,
            self._now_ns() + max(duration_ms, 0) * 1_000_000,
        )

    def _is_locked(self) -> bool:
        return self._now_ns() < self._lock_until_ns


def _normalize_namespace(namespace: str) -> str:
    if not namespace:
        return "/animatronic"
    namespace = namespace.strip()
    if not namespace.startswith("/"):
        namespace = "/" + namespace
    return namespace.rstrip("/")


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def _looks_like_web_motion_yaml(pattern_yaml: str) -> bool:
    try:
        import yaml

        data = yaml.safe_load(pattern_yaml)
    except Exception:
        return False
    return isinstance(data, dict) and "tracks" in data


def _run_pattern_result(success: bool, message: str) -> RunPattern.Result:
    result = RunPattern.Result()
    result.success = success
    result.message = message
    return result


def main(args: list[str] | None = None) -> None:
    rclpy.init(args=args)
    node = MotionNode()
    executor = MultiThreadedExecutor()
    executor.add_node(node)
    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
