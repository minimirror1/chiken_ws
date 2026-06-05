import asyncio
import threading
import unittest

from animatronic_interfaces.msg import MotionStatus
from animatronic_web.web_server_node import MotionSyncRequest, WebBridgeNode


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
        node._state = {"motion_status": None}
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
        self.assertNotIn("lower_yaw", published[0][0])
        self.assertAlmostEqual(published[0][0]["lower_pitch"], 5.0)
        self.assertAlmostEqual(published[-1][0]["lower_pitch"], 25.0)
        self.assertEqual(published[-1][1], "web:motor_joint_deg")

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


if __name__ == "__main__":
    unittest.main()
