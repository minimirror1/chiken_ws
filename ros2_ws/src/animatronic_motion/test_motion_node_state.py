import threading
import unittest

from animatronic_interfaces.msg import MotionStatus
from animatronic_motion.motion_node import MotionNode
from animatronic_motion.web_motion import parse_web_motion_yaml
from rclpy.action import GoalResponse


class MotionNodeStateTest(unittest.TestCase):
    def test_goal_callback_rejects_busy_even_when_interrupt_allowed(self):
        node = MotionNode.__new__(MotionNode)
        node._state_lock = threading.RLock()
        node._active_stop_event = threading.Event()
        node._lock_until_ns = 0
        node._now_ns = lambda: 0
        goal = type("Goal", (), {"allow_interrupt": True})()

        self.assertEqual(MotionNode._goal_callback(node, goal), GoalResponse.REJECT)

    def test_stale_finish_does_not_clear_new_active_stop_event(self):
        old_event = threading.Event()
        new_event = threading.Event()
        node = MotionNode.__new__(MotionNode)
        node._state_lock = threading.RLock()
        node._current_pattern = "new"
        node._progress = 0.5
        node._active_stop_event = new_event
        node._status = MotionStatus.RUNNING
        node._message = "running"

        MotionNode._finish_pattern(node, "stopped", old_event)

        self.assertIs(node._active_stop_event, new_event)
        self.assertEqual(node._current_pattern, "new")
        self.assertEqual(node._progress, 0.5)
        self.assertEqual(node._status, MotionStatus.RUNNING)
        self.assertEqual(node._message, "running")

    def test_active_finish_clears_matching_stop_event(self):
        active_event = threading.Event()
        node = MotionNode.__new__(MotionNode)
        node._state_lock = threading.RLock()
        node._current_pattern = "active"
        node._progress = 0.5
        node._active_stop_event = active_event
        node._status = MotionStatus.RUNNING
        node._message = "running"

        MotionNode._finish_pattern(node, "stopped", active_event)

        self.assertIsNone(node._active_stop_event)
        self.assertEqual(node._current_pattern, "")
        self.assertEqual(node._progress, 0.0)
        self.assertEqual(node._status, MotionStatus.STOPPED)
        self.assertEqual(node._message, "stopped")

    def test_start_time_offset_samples_remaining_pattern(self):
        pattern = parse_web_motion_yaml("""
name: offset
tracks:
  lower_yaw:
    - time_ms: 0
      value: 0
      tangent: null
    - time_ms: 1000
      value: 100
      tangent: null
  lower_pitch: []
  upper_yaw: []
  upper_pitch: []
""")
        published = []
        feedback = []
        goal = type("Goal", (), {
            "pattern_name": "offset",
            "pattern_yaml": "inline",
            "preview_only": False,
            "allow_interrupt": False,
            "start_time_ms": 500,
        })()
        handle = type("Handle", (), {
            "request": goal,
            "is_cancel_requested": False,
            "abort": lambda self: None,
            "succeed": lambda self: None,
            "publish_feedback": lambda self, msg: feedback.append((msg.progress, msg.current_keyframe)),
        })()
        node = MotionNode.__new__(MotionNode)
        node._state_lock = threading.RLock()
        node._active_stop_event = None
        node._current_pattern = ""
        node._progress = 0.0
        node._status = MotionStatus.IDLE
        node._message = "idle"
        node._pattern_lock_ms = 0
        node._lock_until_ns = 0
        node._publish_rate_hz = 10_000.0
        node._now_ns = lambda: 0
        node._lock_for_ms = lambda duration_ms: None
        node._publish_event = lambda *args: None
        node._publish_joint_targets = lambda values, source: published.append(values)
        node._finish_pattern = lambda message, stop_event=None: MotionNode._finish_pattern(node, message, stop_event)

        import animatronic_motion.motion_node as motion_node_module

        original_parse = motion_node_module.parse_web_motion_yaml
        original_ok = motion_node_module.rclpy.ok
        motion_node_module.parse_web_motion_yaml = lambda yaml, name: pattern
        motion_node_module.rclpy.ok = lambda: True
        try:
            result = MotionNode._execute_run_pattern(node, handle)
        finally:
            motion_node_module.parse_web_motion_yaml = original_parse
            motion_node_module.rclpy.ok = original_ok

        self.assertTrue(result.success)
        self.assertTrue(published)
        self.assertGreaterEqual(published[0]["lower_yaw"], 50.0)
        self.assertEqual(published[-1]["lower_yaw"], 100.0)
        self.assertEqual(feedback[-1][1], "1000")


if __name__ == "__main__":
    unittest.main()
