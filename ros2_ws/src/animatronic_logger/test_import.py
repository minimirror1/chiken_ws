import unittest


class ImportTest(unittest.TestCase):
    def test_import_logger_node(self):
        import animatronic_logger.logger_node  # noqa: F401

