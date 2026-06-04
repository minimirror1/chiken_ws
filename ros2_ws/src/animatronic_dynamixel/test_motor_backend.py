import unittest

from animatronic_dynamixel.motor_node import (
    FAILURE_BLOCK_THRESHOLD,
    MotorConfig,
    PROFILES,
    MockDynamixelBackend,
    angle_to_raw,
    normalized_to_raw,
    raw_to_angle_deg,
    raw_to_joint_deg,
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

    def test_reversed_percent_mapping(self):
        config = MotorConfig(
            joint_name="upper_yaw",
            motor_id=2,
            model="XM430-W350-R",
            min_raw=3500,
            home_raw=1700,
            max_raw=1000,
            min_angle_deg=-30.0,
            home_angle_deg=0.0,
            max_angle_deg=30.0,
            profile=PROFILES["XM430-W350-R"],
        )
        self.assertEqual(normalized_to_raw(-100.0, config), 3500)
        self.assertEqual(normalized_to_raw(0.0, config), 1700)
        self.assertEqual(normalized_to_raw(100.0, config), 1000)
        self.assertAlmostEqual(raw_to_angle_deg(3500, config), -30.0)
        self.assertAlmostEqual(raw_to_angle_deg(1700, config), 0.0)
        self.assertAlmostEqual(raw_to_angle_deg(1000, config), 30.0)

    def test_asymmetric_home_count_is_allowed(self):
        config = MotorConfig(
            joint_name="lower_pitch",
            motor_id=1,
            model="XM430-W350-R",
            min_raw=1000,
            home_raw=1700,
            max_raw=3500,
            min_angle_deg=-20.0,
            home_angle_deg=0.0,
            max_angle_deg=20.0,
            profile=PROFILES["XM430-W350-R"],
        )
        self.assertEqual(normalized_to_raw(-100.0, config), 1000)
        self.assertEqual(normalized_to_raw(0.0, config), 1700)
        self.assertEqual(normalized_to_raw(100.0, config), 3500)
        self.assertEqual(config.home_raw, 1700)

    def test_joint_angle_is_relative_to_home_angle(self):
        config = MotorConfig(
            joint_name="upper_pitch",
            motor_id=3,
            model="XM430-W350-R",
            min_raw=2046,
            home_raw=3000,
            max_raw=4095,
            min_angle_deg=179.9,
            home_angle_deg=263.7,
            max_angle_deg=360.0,
            profile=PROFILES["XM430-W350-R"],
        )
        self.assertAlmostEqual(raw_to_angle_deg(3000, config), 263.7)
        self.assertAlmostEqual(raw_to_joint_deg(3000, config), 0.0)
        self.assertAlmostEqual(raw_to_joint_deg(2046, config), -83.8)

    def test_signed_value(self):
        self.assertEqual(signed_value(0x0001, 2), 1)
        self.assertEqual(signed_value(0xFFFF, 2), -1)


class FailurePolicyTest(unittest.TestCase):
    def test_mock_backend_never_blocks(self):
        backend = MockDynamixelBackend([])
        self.assertEqual(backend.blocked_motor_ids(), [])
        self.assertEqual(backend.failure_counts(), {})

    def test_mock_backend_accepts_direct_raw_targets(self):
        config = MotorConfig(
            joint_name="lower_pitch",
            motor_id=1,
            model="XM430-W350-R",
            min_raw=1000,
            home_raw=1700,
            max_raw=3500,
            min_angle_deg=0.0,
            home_angle_deg=149.5,
            max_angle_deg=307.7,
            profile=PROFILES["XM430-W350-R"],
        )
        backend = MockDynamixelBackend([config])
        backend.write_joint_targets({"lower_pitch": 1701})
        diagnostic = backend.read_diagnostics()[0]
        self.assertEqual(diagnostic.raw_position, 1701)

    def test_mock_backend_tracks_single_motor_torque(self):
        configs = [
            MotorConfig(
                joint_name="lower_pitch",
                motor_id=1,
                model="XM430-W350-R",
                min_raw=1000,
                home_raw=1700,
                max_raw=3500,
                min_angle_deg=0.0,
                home_angle_deg=149.5,
                max_angle_deg=307.7,
                profile=PROFILES["XM430-W350-R"],
            ),
            MotorConfig(
                joint_name="upper_yaw",
                motor_id=2,
                model="XM430-W350-R",
                min_raw=1000,
                home_raw=1700,
                max_raw=3500,
                min_angle_deg=0.0,
                home_angle_deg=149.5,
                max_angle_deg=307.7,
                profile=PROFILES["XM430-W350-R"],
            ),
        ]
        backend = MockDynamixelBackend(configs)
        self.assertTrue(backend.set_motor_torque_enabled(1, True))
        diagnostics = {
            diagnostic.id: diagnostic for diagnostic in backend.read_diagnostics()
        }
        self.assertTrue(diagnostics[1].torque_enabled)
        self.assertFalse(diagnostics[2].torque_enabled)
        self.assertEqual(backend.torque_enabled_by_id(), {1: True, 2: False})

    def test_threshold_constant_matches_policy(self):
        self.assertEqual(FAILURE_BLOCK_THRESHOLD, 5)


if __name__ == "__main__":
    unittest.main()
