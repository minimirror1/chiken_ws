import unittest


class ImportTest(unittest.TestCase):
    def test_import_sensor_node(self):
        import people_mmwave_sensor.sensor_node  # noqa: F401

