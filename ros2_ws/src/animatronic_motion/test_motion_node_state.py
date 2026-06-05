import threading
import unittest

from animatronic_interfaces.msg import MotionStatus
from animatronic_motion.motion_node import MotionNode
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


if __name__ == "__main__":
    unittest.main()
