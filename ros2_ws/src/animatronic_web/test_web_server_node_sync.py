import asyncio
import threading
import unittest

from action_msgs.msg import GoalStatus
from animatronic_interfaces.msg import MotionStatus
from animatronic_web.web_server_node import MotionRunRequest, MotionSyncRequest, WebBridgeNode, idle_operation_status


def motor_positions_result(result):
    async def call():
        return result
    return call


class WebBridgeMotionSyncTest(unittest.TestCase):
    def make_node(self):
        node = WebBridgeNode.__new__(WebBridgeNode)
        node._lock = threading.RLock()
        node._logs = []
        node._last_joint_state = None
        node._last_joint_state_monotonic_ns = None
        node._sync_stop_event = None
        node._operation_status = idle_operation_status()
        node._state = {"motion_status": None}
        node.service_timeout_sec = 1.0
        node.log_event = lambda *args: None
        node.get_clock = lambda: type("Clock", (), {
            "now": lambda self: type("Now", (), {"to_msg": lambda self: None})()
        })()
        node.call_motor_positions = motor_positions_result({
            "success": True,
            "message": "ok",
            "diagnostics": [{"joint_name": "lower_pitch", "angle_deg": 30.0}],
            "joint_positions": [{"joint_name": "lower_pitch", "joint_angle_deg": 5.0}],
        })
        return node

    def test_sync_fails_when_fresh_motor_read_fails(self):
        node = self.make_node()
        node.call_motor_positions = motor_positions_result({
            "success": False,
            "message": "motor/read_positions service is not available",
        })

        result = asyncio.run(WebBridgeNode.sync_motion_pose(
            node,
            MotionSyncRequest(positions={"lower_pitch": 10.0}, duration_ms=0),
        ))

        self.assertFalse(result["success"])
        self.assertIn("not available", result["message"])
        self.assertEqual(node._operation_status["phase"], "error")

    def test_sync_publishes_from_actual_position_to_target(self):
        node = self.make_node()
        node.call_motor_positions = motor_positions_result({
            "success": True,
            "message": "ok",
            "diagnostics": [
                {"joint_name": "lower_yaw", "angle_deg": 40.0},
                {"joint_name": "lower_pitch", "angle_deg": 5.0},
            ],
            "joint_positions": [
                {"joint_name": "lower_yaw", "joint_angle_deg": 40.0},
                {"joint_name": "lower_pitch", "joint_angle_deg": 5.0},
            ],
        })
        published = []
        node._publish_target_positions = lambda positions, source: published.append((positions, source))

        result = asyncio.run(WebBridgeNode.sync_motion_pose(
            node,
            MotionSyncRequest(positions={"lower_yaw": 90.0, "lower_pitch": 25.0}, duration_ms=40),
        ))

        self.assertTrue(result["success"])
        self.assertGreaterEqual(len(published), 2)
        self.assertAlmostEqual(published[0][0]["lower_yaw"], 40.0)
        self.assertAlmostEqual(published[0][0]["lower_pitch"], 5.0)
        self.assertAlmostEqual(published[-1][0]["lower_yaw"], 90.0)
        self.assertAlmostEqual(published[-1][0]["lower_pitch"], 25.0)
        self.assertEqual(published[-1][1], "web:motor_joint_deg")
        self.assertEqual(node._operation_status["phase"], "done")
        self.assertAlmostEqual(node._operation_status["progress"], 1.0)

    def test_sync_updates_progress_during_loop(self):
        node = self.make_node()
        progress = []

        def publish(_positions, _source):
            progress.append((
                node._operation_status["phase"],
                node._operation_status["progress"],
                node._operation_status["remaining_ms"],
            ))

        node._publish_target_positions = publish

        result = asyncio.run(WebBridgeNode.sync_motion_pose(
            node,
            MotionSyncRequest(positions={"lower_pitch": 25.0}, duration_ms=40),
        ))

        self.assertTrue(result["success"])
        self.assertGreaterEqual(len(progress), 2)
        self.assertEqual(progress[0][0], "syncing")
        self.assertGreaterEqual(progress[0][2], 0)
        self.assertEqual(progress[-1][1], 1.0)

    def test_sync_stop_sets_stopped_status(self):
        node = self.make_node()

        def publish(_positions, _source):
            node._sync_stop_event.set()

        node._publish_target_positions = publish

        result = asyncio.run(WebBridgeNode.sync_motion_pose(
            node,
            MotionSyncRequest(positions={"lower_pitch": 25.0}, duration_ms=80),
        ))

        self.assertFalse(result["success"])
        self.assertEqual(node._operation_status["phase"], "stopped")

    def test_sync_publish_uses_joint_deg_without_normalized_percent(self):
        node = self.make_node()
        published = []
        node.target_joints_pub = type("Pub", (), {
            "publish": lambda self, msg: published.append(msg)
        })()

        WebBridgeNode._publish_target_positions(
            node,
            {"lower_pitch": 5.0},
            "web:motor_joint_deg",
        )

        target = published[0].joints[0]
        self.assertEqual(published[0].source, "web:motor_joint_deg")
        self.assertEqual(target.name, "lower_pitch")
        self.assertAlmostEqual(target.angle_deg, 5.0)
        self.assertAlmostEqual(target.normalized_value, 0.0)

    def test_sync_rejects_while_motion_running(self):
        node = self.make_node()
        node._state["motion_status"] = {"status": MotionStatus.RUNNING}

        result = asyncio.run(WebBridgeNode.sync_motion_pose(
            node,
            MotionSyncRequest(positions={"lower_pitch": 10.0}, duration_ms=0),
        ))

        self.assertFalse(result["success"])
        self.assertIn("running", result["message"])

    def test_run_feedback_updates_operation_status(self):
        node = self.make_node()
        feedback_statuses = []

        class DoneFuture:
            def __init__(self, value):
                self.value = value

            def done(self):
                return True

            def result(self):
                return self.value

        class GoalHandle:
            accepted = True

            def get_result_async(self):
                result = type("Result", (), {"success": True, "message": "done"})()
                wrapped = type("Wrapped", (), {
                    "status": GoalStatus.STATUS_SUCCEEDED,
                    "result": result,
                })()
                return DoneFuture(wrapped)

        class ActionClient:
            def server_is_ready(self):
                return True

            def send_goal_async(self, _goal, feedback_callback=None):
                feedback = type("Feedback", (), {
                    "progress": 0.42,
                    "current_keyframe": "120",
                })()
                feedback_callback(type("FeedbackMsg", (), {"feedback": feedback})())
                feedback_statuses.append(dict(node._operation_status))
                return DoneFuture(GoalHandle())

        node.run_pattern_client = ActionClient()

        result = asyncio.run(WebBridgeNode.run_motion_pattern(
            node,
            MotionRunRequest(pattern_name="test", pattern_yaml="", start_time_ms=0),
        ))

        self.assertTrue(result["success"])
        self.assertEqual(feedback_statuses[0]["phase"], "running_pattern")
        self.assertAlmostEqual(feedback_statuses[0]["progress"], 0.42)
        self.assertEqual(feedback_statuses[0]["current_keyframe"], "120")


if __name__ == "__main__":
    unittest.main()
