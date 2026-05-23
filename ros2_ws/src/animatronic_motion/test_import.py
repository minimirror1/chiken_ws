import unittest


class ImportTest(unittest.TestCase):
    def test_import_motion_node(self):
        import animatronic_motion.motion_node  # noqa: F401

