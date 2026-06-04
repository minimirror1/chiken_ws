import threading
import unittest

from animatronic_dynamixel.motor_node import (
    MotorConfig,
    MotorNode,
    PROFILES,
)
from animatronic_interfaces.msg import JointTarget, JointTargets


class RecordingBackend:
    def __init__(self):
        self.writes = []

    def write_joint_targets(self, targets):
        self.writes.append(dict(targets))


class Logger:
    def error(self, message):
        raise AssertionError(message)

    def warn(self, message):
        raise AssertionError(message)


class MotorSchedulerTest(unittest.TestCase):
    def test_target_callback_caches_and_timer_writes_once(self):
        config = MotorConfig(
            joint_name="lower_pitch",
            motor_id=1,
            model="XM430-W210-T",
            min_raw=0,
            home_raw=2048,
            max_raw=4095,
            min_angle_deg=-90.0,
            home_angle_deg=0.0,
            max_angle_deg=90.0,
            profile=PROFILES["XM430-W210-T"],
        )
        node = MotorNode.__new__(MotorNode)
        node._config_by_joint = {"lower_pitch": config}
        node._backend = RecordingBackend()
        node._target_lock = threading.Lock()
        node._latest_targets = {}
        node._target_dirty = False
        node._stopped = True
        node.get_logger = lambda: Logger()

        msg = JointTargets()
        target = JointTarget()
        target.name = "lower_pitch"
        target.normalized_value = 100.0
        msg.joints.append(target)

        MotorNode._on_target_joints(node, msg)
        self.assertEqual(node._backend.writes, [])
        self.assertTrue(node._target_dirty)

        MotorNode._write_latest_targets(node)
        self.assertEqual(node._backend.writes, [{"lower_pitch": 4095}])
        self.assertFalse(node._target_dirty)

        MotorNode._write_latest_targets(node)
        self.assertEqual(len(node._backend.writes), 1)


if __name__ == "__main__":
    unittest.main()
