import unittest
from unittest.mock import Mock, patch

from animatronic_dynamixel import motor_node
from animatronic_dynamixel.motor_node import (
    FAILURE_BLOCK_THRESHOLD,
    MotorConfig,
    MotorNode,
    PROFILES,
    MockDynamixelBackend,
    RealDynamixelBackend,
    angle_to_raw,
    convert_profile_value,
    normalized_to_raw,
    raw_to_angle_deg,
    raw_to_joint_deg,
    raw_to_normalized,
    signed_value,
)


class FakePortHandler:
    instances = []

    def __init__(self, port):
        self.port = port
        self.opened = False
        self.closed = False
        FakePortHandler.instances.append(self)

    def openPort(self):
        self.opened = True
        return True

    def closePort(self):
        self.closed = True

    def setBaudRate(self, baudrate):
        self.baudrate = baudrate
        return True


class FakePacketHandler:
    ping_exception = None
    write_exception = None
    reboot_exception = None

    def __init__(self, protocol_version):
        self.protocol_version = protocol_version

    def getTxRxResult(self, result):
        return f"comm {result}"

    def getRxPacketError(self, error):
        return f"packet {error}"

    def ping(self, port_handler, motor_id):
        del port_handler
        if FakePacketHandler.ping_exception is not None:
            raise FakePacketHandler.ping_exception
        return motor_id, 0, 0

    def write1ByteTxRx(self, port_handler, motor_id, address, value):
        del port_handler, motor_id, address, value
        if FakePacketHandler.write_exception is not None:
            raise FakePacketHandler.write_exception
        return 0, 0

    def reboot(self, port_handler, motor_id):
        del port_handler, motor_id
        if FakePacketHandler.reboot_exception is not None:
            raise FakePacketHandler.reboot_exception
        return 0, 0


class FakeGroupBulkRead:
    instances = []
    data = {}
    unavailable = set()
    tx_result = 0
    tx_exception = None

    def __init__(self, port_handler, packet_handler):
        self.port_handler = port_handler
        self.packet_handler = packet_handler
        self.params = []
        FakeGroupBulkRead.instances.append(self)

    def addParam(self, motor_id, address, length):
        self.params.append((motor_id, address, length))
        return True

    def txRxPacket(self):
        if FakeGroupBulkRead.tx_exception is not None:
            raise FakeGroupBulkRead.tx_exception
        return FakeGroupBulkRead.tx_result

    def isAvailable(self, motor_id, address, length):
        return (motor_id, address, length) not in FakeGroupBulkRead.unavailable

    def getData(self, motor_id, address, length):
        return FakeGroupBulkRead.data[(motor_id, address, length)]

    def clearParam(self):
        pass


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
        self.assertAlmostEqual(raw_to_normalized(3500, config), -100.0)
        self.assertAlmostEqual(raw_to_normalized(1700, config), 0.0)
        self.assertAlmostEqual(raw_to_normalized(1000, config), 100.0)
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
        self.assertAlmostEqual(raw_to_normalized(1000, config), -100.0)
        self.assertAlmostEqual(raw_to_normalized(1700, config), 0.0)
        self.assertAlmostEqual(raw_to_normalized(3500, config), 100.0)
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

    def test_node_reconnects_at_configured_failure_threshold(self):
        node = MotorNode.__new__(MotorNode)
        backend = Mock()
        backend.reconnect.return_value = True
        node._backend = backend
        node._connected = False
        node._shutdown_requested = False
        node._reconnect_failure_threshold = 5
        node._shutdown_failure_threshold = 10
        node.get_logger = Mock(return_value=Mock())

        MotorNode._handle_backend_failures(node, {1: 5})

        backend.reconnect.assert_called_once_with()
        self.assertTrue(node._connected)

    def test_node_shutdowns_at_configured_failure_threshold(self):
        node = MotorNode.__new__(MotorNode)
        backend = Mock()
        node._backend = backend
        node._torque_enabled = True
        node._stopped = False
        node._shutdown_requested = False
        node._reconnect_failure_threshold = 5
        node._shutdown_failure_threshold = 10
        node.get_logger = Mock(return_value=Mock())

        with patch.object(motor_node.rclpy, "shutdown") as shutdown:
            MotorNode._handle_backend_failures(node, {1: 10})

        backend.stop.assert_called_once_with()
        shutdown.assert_called_once_with()
        self.assertTrue(node._shutdown_requested)
        self.assertFalse(node._torque_enabled)
        self.assertTrue(node._stopped)


class RealBulkReadTest(unittest.TestCase):
    def setUp(self):
        FakePortHandler.instances = []
        FakePacketHandler.ping_exception = None
        FakePacketHandler.write_exception = None
        FakePacketHandler.reboot_exception = None
        FakeGroupBulkRead.instances = []
        FakeGroupBulkRead.data = {}
        FakeGroupBulkRead.unavailable = set()
        FakeGroupBulkRead.tx_result = 0
        FakeGroupBulkRead.tx_exception = None
        patchers = [
            patch.object(motor_node, "PortHandler", FakePortHandler),
            patch.object(motor_node, "PacketHandler", FakePacketHandler),
            patch.object(motor_node, "GroupBulkRead", FakeGroupBulkRead),
            patch.object(motor_node, "COMM_SUCCESS", 0),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_bulk_read_registers_profile_blocks(self):
        configs = [
            self._config("lower_pitch", 1, "XM430-W210-T"),
            self._config("upper_pitch", 3, "XL320"),
        ]
        self._set_bulk_values(configs)
        backend = RealDynamixelBackend("/dev/null", 57600, 2.0, configs)

        backend.read_diagnostics()

        self.assertEqual(FakeGroupBulkRead.instances[0].params, [(1, 126, 21)])
        self.assertEqual(FakeGroupBulkRead.instances[1].params, [(3, 37, 10)])

    def test_bulk_read_populates_diagnostics(self):
        configs = [
            self._config("lower_pitch", 1, "XM430-W210-T"),
            self._config("upper_pitch", 3, "XL320"),
        ]
        self._set_bulk_values(
            configs,
            {
                (1, "position"): 2050,
                (1, "voltage"): 121,
                (1, "temperature"): 34,
                (1, "load"): 10,
                (3, "position"): 513,
                (3, "voltage"): 74,
                (3, "temperature"): 30,
                (3, "load"): 512,
            },
        )
        backend = RealDynamixelBackend("/dev/null", 57600, 2.0, configs)

        diagnostics = {
            diagnostic.id: diagnostic for diagnostic in backend.read_diagnostics()
        }

        self.assertEqual(diagnostics[1].raw_position, 2050)
        self.assertAlmostEqual(diagnostics[1].voltage_v, 12.1)
        self.assertAlmostEqual(diagnostics[1].temperature_c, 34.0)
        self.assertAlmostEqual(diagnostics[1].load, 26.9)
        self.assertEqual(diagnostics[3].raw_position, 513)
        self.assertAlmostEqual(diagnostics[3].voltage_v, 7.4)
        self.assertAlmostEqual(diagnostics[3].temperature_c, 30.0)
        self.assertAlmostEqual(diagnostics[3].load, 512 / 1023.0)

    def test_signed_load_conversion_matches_profile_policy(self):
        profile = PROFILES["XM430-W210-T"]
        self.assertAlmostEqual(convert_profile_value(profile, "load", 0xFFFF), -2.69)

    def test_read_position_field_uses_bulk_values(self):
        configs = [self._config("lower_pitch", 1, "XM430-W210-T")]
        self._set_bulk_values(configs, {(1, "position"): 2100})
        backend = RealDynamixelBackend("/dev/null", 57600, 2.0, configs)

        self.assertEqual(backend.read_diagnostic_field("position"), {1: 2100})

    def test_unavailable_field_records_failure_and_keeps_other_results(self):
        configs = [
            self._config("lower_pitch", 1, "XM430-W210-T"),
            self._config("upper_pitch", 2, "XM430-W210-T"),
        ]
        self._set_bulk_values(
            configs,
            {
                (1, "position"): 2050,
                (2, "voltage"): 120,
                (2, "temperature"): 33,
                (2, "load"): 0,
            },
        )
        profile = PROFILES["XM430-W210-T"]
        FakeGroupBulkRead.unavailable = {
            (2, profile.present_position_addr, profile.present_position_len)
        }
        backend = RealDynamixelBackend("/dev/null", 57600, 2.0, configs)

        diagnostics = {
            diagnostic.id: diagnostic for diagnostic in backend.read_diagnostics()
        }

        self.assertEqual(diagnostics[1].raw_position, 2050)
        self.assertEqual(diagnostics[2].raw_position, configs[1].home_raw)
        self.assertEqual(backend.failure_counts()[2], 1)
        self.assertIn("position unavailable", diagnostics[2].error_message)

    def test_bulk_read_io_exception_records_failure_without_raising(self):
        configs = [self._config("lower_pitch", 1, "XM430-W210-T")]
        FakeGroupBulkRead.tx_exception = OSError("device disconnected")
        backend = RealDynamixelBackend("/dev/null", 57600, 2.0, configs)

        diagnostics = backend.read_diagnostics()

        self.assertEqual(len(diagnostics), 1)
        self.assertEqual(diagnostics[0].raw_position, configs[0].home_raw)
        self.assertEqual(backend.failure_counts()[1], 1)
        self.assertIn("bulk read diagnostics", diagnostics[0].error_message)
        self.assertIn("device disconnected", diagnostics[0].error_message)

    def test_torque_io_exception_records_failure_without_raising(self):
        configs = [self._config("lower_pitch", 1, "XM430-W210-T")]
        FakePacketHandler.write_exception = OSError("write failed")
        backend = RealDynamixelBackend("/dev/null", 57600, 2.0, configs)

        backend.set_torque_enabled(True)

        self.assertEqual(backend.failure_counts()[1], 1)
        self.assertFalse(backend.torque_enabled_by_id()[1])

    def test_reconnect_replaces_port_and_clears_failures_on_success(self):
        configs = [self._config("lower_pitch", 1, "XM430-W210-T")]
        FakeGroupBulkRead.tx_exception = OSError("device disconnected")
        backend = RealDynamixelBackend("/dev/null", 57600, 2.0, configs)
        backend.read_diagnostics()
        first_port = FakePortHandler.instances[0]

        self.assertTrue(backend.reconnect())

        self.assertTrue(first_port.closed)
        self.assertEqual(len(FakePortHandler.instances), 2)
        self.assertTrue(FakePortHandler.instances[1].opened)
        self.assertEqual(backend.failure_counts()[1], 0)

    def _config(self, joint_name, motor_id, model):
        profile = PROFILES[model]
        return MotorConfig(
            joint_name=joint_name,
            motor_id=motor_id,
            model=model,
            min_raw=profile.raw_min,
            home_raw=profile.raw_home,
            max_raw=profile.raw_max,
            min_angle_deg=-90.0,
            home_angle_deg=0.0,
            max_angle_deg=90.0,
            profile=profile,
        )

    def _set_bulk_values(self, configs, overrides=None):
        overrides = overrides or {}
        for config in configs:
            profile = config.profile
            defaults = {
                "position": config.home_raw,
                "voltage": 120,
                "temperature": 32,
                "load": 0,
            }
            for field, raw_value in defaults.items():
                raw_value = overrides.get((config.motor_id, field), raw_value)
                address, length = motor_node.sync_read_address(profile, field)
                FakeGroupBulkRead.data[(config.motor_id, address, length)] = raw_value


if __name__ == "__main__":
    unittest.main()
