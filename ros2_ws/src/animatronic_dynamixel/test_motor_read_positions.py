import unittest

from animatronic_dynamixel.motor_node import MotorConfig, MotorNode, PROFILES


class PositionBackend:
    def __init__(self, values):
        self.values = values

    def read_diagnostic_field(self, field):
        if field != "position":
            raise AssertionError(field)
        return self.values

    def failure_counts(self):
        return {}

    def torque_enabled_by_id(self):
        return {}


class MotorReadPositionsTest(unittest.TestCase):
    def test_current_position_read_omits_missing_values(self):
        config_present = MotorConfig(
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
        config_missing = MotorConfig(
            joint_name="upper_pitch",
            motor_id=2,
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
        node._motor_configs = [config_present, config_missing]
        node._backend = PositionBackend({1: 2048})

        diagnostics = MotorNode._read_current_position_diagnostics(node)

        self.assertEqual([diagnostic.joint_name for diagnostic in diagnostics], ["lower_pitch"])
        self.assertEqual(diagnostics[0].raw_position, 2048)

    def test_joint_positions_are_home_relative_degrees(self):
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
        node = MotorNode.__new__(MotorNode)
        node._motor_configs = [config]
        node._backend = PositionBackend({3: 2046})

        diagnostics = MotorNode._read_current_position_diagnostics(node)
        positions = MotorNode._joint_positions_from_diagnostics(node, diagnostics)

        self.assertEqual(positions[0].joint_name, "upper_pitch")
        self.assertEqual(positions[0].raw_position, 2046)
        self.assertAlmostEqual(positions[0].joint_angle_deg, -83.8, places=2)


if __name__ == "__main__":
    unittest.main()
