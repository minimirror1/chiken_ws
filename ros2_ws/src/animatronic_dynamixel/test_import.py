import unittest


class ImportTest(unittest.TestCase):
    def test_import_motor_node(self):
        import animatronic_dynamixel.motor_node  # noqa: F401

