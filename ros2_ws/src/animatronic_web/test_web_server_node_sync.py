import asyncio
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import yaml

from action_msgs.msg import GoalStatus
from animatronic_interfaces.msg import MotionStatus
from animatronic_web import web_server_node
from animatronic_web.web_server_node import (
    MotorCalibrationDocument,
    MotorCalibrationItem,
    MotionRunRequest,
    MotionSyncRequest,
    WebBridgeNode,
    idle_operation_status,
    motor_config_read_path,
    motor_config_write_paths,
    write_motor_calibrations,
)


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
            "joint_positions": [{"joint_name": "lower_pitch", "joint_angle_deg": 5.0, "normalized_value": 12.0}],
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
            MotionSyncRequest(normalized_positions={"lower_pitch": 10.0}, duration_ms=0),
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
                {"joint_name": "lower_yaw", "joint_angle_deg": 40.0, "normalized_value": 44.0},
                {"joint_name": "lower_pitch", "joint_angle_deg": 5.0, "normalized_value": 12.0},
            ],
        })
        published = []
        node._publish_normalized_targets = lambda positions, source: published.append((positions, source))

        result = asyncio.run(WebBridgeNode.sync_motion_pose(
            node,
            MotionSyncRequest(normalized_positions={"lower_yaw": 90.0, "lower_pitch": 25.0}, duration_ms=40),
        ))

        self.assertTrue(result["success"])
        self.assertGreaterEqual(len(published), 2)
        self.assertAlmostEqual(published[0][0]["lower_yaw"], 44.0)
        self.assertAlmostEqual(published[0][0]["lower_pitch"], 12.0)
        self.assertAlmostEqual(published[-1][0]["lower_yaw"], 90.0)
        self.assertAlmostEqual(published[-1][0]["lower_pitch"], 25.0)
        self.assertEqual(published[-1][1], "web:motion_sync")
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

        node._publish_normalized_targets = publish

        result = asyncio.run(WebBridgeNode.sync_motion_pose(
            node,
            MotionSyncRequest(normalized_positions={"lower_pitch": 25.0}, duration_ms=40),
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

        node._publish_normalized_targets = publish

        result = asyncio.run(WebBridgeNode.sync_motion_pose(
            node,
            MotionSyncRequest(normalized_positions={"lower_pitch": 25.0}, duration_ms=80),
        ))

        self.assertFalse(result["success"])
        self.assertEqual(node._operation_status["phase"], "stopped")

    def test_joint_deg_publish_uses_angle_without_normalized_percent(self):
        node = self.make_node()
        published = []
        node.target_joints_pub = type("Pub", (), {
            "publish": lambda self, msg: published.append(msg)
        })()

        WebBridgeNode._publish_joint_deg_targets(
            node,
            {"lower_pitch": 5.0},
            "web:motor_joint_deg",
        )

        target = published[0].joints[0]
        self.assertEqual(published[0].source, "web:motor_joint_deg")
        self.assertEqual(target.name, "lower_pitch")
        self.assertAlmostEqual(target.angle_deg, 5.0)
        self.assertAlmostEqual(target.normalized_value, 0.0)

    def test_sync_publish_uses_normalized_without_angle_deg(self):
        node = self.make_node()
        published = []
        node.target_joints_pub = type("Pub", (), {
            "publish": lambda self, msg: published.append(msg)
        })()

        WebBridgeNode._publish_normalized_targets(
            node,
            {"lower_pitch": 25.0},
            "web:motion_sync",
        )

        target = published[0].joints[0]
        self.assertEqual(published[0].source, "web:motion_sync")
        self.assertEqual(target.name, "lower_pitch")
        self.assertAlmostEqual(target.normalized_value, 25.0)
        self.assertAlmostEqual(target.angle_deg, 0.0)

    def test_sync_rejects_while_motion_running(self):
        node = self.make_node()
        node._state["motion_status"] = {"status": MotionStatus.RUNNING}

        result = asyncio.run(WebBridgeNode.sync_motion_pose(
            node,
            MotionSyncRequest(normalized_positions={"lower_pitch": 10.0}, duration_ms=0),
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

    def test_sync_final_target_matches_run_first_target_at_nonzero_start(self):
        node = self.make_node()
        node.call_motor_positions = motor_positions_result({
            "success": True,
            "message": "ok",
            "diagnostics": [{"joint_name": "lower_pitch", "angle_deg": 5.0}],
            "joint_positions": [{"joint_name": "lower_pitch", "joint_angle_deg": 5.0, "normalized_value": 0.0}],
        })
        sync_published = []
        node._publish_normalized_targets = lambda positions, source: sync_published.append((positions, source))
        run_first_lower_pitch = 50.0

        result = asyncio.run(WebBridgeNode.sync_motion_pose(
            node,
            MotionSyncRequest(normalized_positions={"lower_pitch": run_first_lower_pitch}, duration_ms=0),
        ))

        self.assertTrue(result["success"])
        self.assertEqual(sync_published[-1][1], "web:motion_sync")
        self.assertAlmostEqual(sync_published[-1][0]["lower_pitch"], run_first_lower_pitch)


class MotorConfigWriteTest(unittest.TestCase):
    def test_motor_config_read_path_falls_back_to_example(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source_config = root / "src" / "chicken_bringup" / "config"
            install_config = root / "install" / "chicken_bringup" / "config"
            source_config.mkdir(parents=True)
            install_config.mkdir(parents=True)
            example_path = source_config / "motors.example.yaml"
            example_path.write_text("/**:\n  ros__parameters: {}\n", encoding="utf-8")
            previous_cwd = Path.cwd()
            os.chdir(root)
            self.addCleanup(os.chdir, previous_cwd)

            with patch.object(
                web_server_node,
                "get_package_share_directory",
                return_value=str(root / "install" / "chicken_bringup"),
            ):
                self.assertEqual(motor_config_read_path(), example_path)
                self.assertEqual(
                    motor_config_write_paths(),
                    [
                        install_config / "motors.yaml",
                        source_config / "motors.yaml",
                    ],
                )

    def test_write_motor_calibrations_preserves_runtime_parameters(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "motors.yaml"
            path.write_text(
                yaml.safe_dump(
                    {
                        "/**": {
                            "ros__parameters": {
                                "mock_mode": False,
                                "port": "/dev/ttyUSB0",
                                "baudrate": 1000000,
                                "protocol_version": 2.0,
                                "diagnostics_publish_rate_hz": 20.0,
                                "command_write_rate_hz": 50.0,
                                "joint_names": ["old_joint"],
                                "joints": {"old_joint": {"id": 99}},
                            }
                        }
                    },
                    sort_keys=False,
                ),
                encoding="utf-8",
            )
            document = MotorCalibrationDocument(
                calibrations=[
                    MotorCalibrationItem(
                        joint_name="lower_pitch",
                        id=1,
                        model="XM430-W350-R",
                        raw_0_percent=1,
                        raw_home=2048,
                        raw_100_percent=4095,
                        min_angle_deg=0.0,
                        home_angle_deg=180.0,
                        max_angle_deg=360.0,
                    )
                ]
            )

            write_motor_calibrations(path, document)

            params = yaml.safe_load(path.read_text(encoding="utf-8"))["/**"][
                "ros__parameters"
            ]
            self.assertEqual(params["baudrate"], 1000000)
            self.assertEqual(params["diagnostics_publish_rate_hz"], 20.0)
            self.assertEqual(params["command_write_rate_hz"], 50.0)
            self.assertEqual(params["joint_names"], ["lower_pitch"])
            self.assertEqual(set(params["joints"]), {"lower_pitch"})


if __name__ == "__main__":
    unittest.main()
