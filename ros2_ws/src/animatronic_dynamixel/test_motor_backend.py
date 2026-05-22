import unittest

from animatronic_dynamixel.motor_node import (
    FAILURE_BLOCK_THRESHOLD,
    MotorConfig,
    PROFILES,
    MockDynamixelBackend,
    angle_to_raw,
    normalized_to_raw,
    raw_to_angle_deg,
    signed_value,
)


class ConversionTest(unittest.TestCase):
    def test_xm430_normalized_to_raw_uses_4095_range(self):
        config = MotorConfig(
            joint_name="lower_yaw",
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
        self.assertEqual(normalized_to_raw(-100.0, config), 0)
        self.assertEqual(normalized_to_raw(0.0, config), 2048)
        self.assertEqual(normalized_to_raw(100.0, config), 4095)

    def test_xl320_normalized_to_raw_uses_1023_range(self):
        config = MotorConfig(
            joint_name="upper_yaw",
            motor_id=3,
            model="XL320",
            min_raw=0,
            home_raw=512,
            max_raw=1023,
            min_angle_deg=-90.0,
            home_angle_deg=0.0,
            max_angle_deg=90.0,
            profile=PROFILES["XL320"],
        )
        self.assertEqual(normalized_to_raw(-100.0, config), 0)
        self.assertEqual(normalized_to_raw(0.0, config), 512)
        self.assertEqual(normalized_to_raw(100.0, config), 1023)

    def test_angle_mapping_round_trip(self):
        config = MotorConfig(
            joint_name="lower_pitch",
            motor_id=2,
            model="XM430-W210-T",
            min_raw=1024,
            home_raw=2048,
            max_raw=3072,
            min_angle_deg=-45.0,
            home_angle_deg=0.0,
            max_angle_deg=45.0,
            profile=PROFILES["XM430-W210-T"],
        )
        self.assertEqual(angle_to_raw(-45.0, config), 1024)
        self.assertEqual(angle_to_raw(0.0, config), 2048)
        self.assertEqual(angle_to_raw(45.0, config), 3072)
        self.assertAlmostEqual(raw_to_angle_deg(1024, config), -45.0)
        self.assertAlmostEqual(raw_to_angle_deg(2048, config), 0.0)
        self.assertAlmostEqual(raw_to_angle_deg(3072, config), 45.0)

    def test_signed_value(self):
        self.assertEqual(signed_value(0x0001, 2), 1)
        self.assertEqual(signed_value(0xFFFF, 2), -1)


class FailurePolicyTest(unittest.TestCase):
    def test_mock_backend_never_blocks(self):
        backend = MockDynamixelBackend([])
        self.assertEqual(backend.blocked_motor_ids(), [])
        self.assertEqual(backend.failure_counts(), {})

    def test_threshold_constant_matches_policy(self):
        self.assertEqual(FAILURE_BLOCK_THRESHOLD, 5)


if __name__ == "__main__":
    unittest.main()
