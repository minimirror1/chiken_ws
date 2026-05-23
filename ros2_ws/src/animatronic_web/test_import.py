import unittest


class ImportTest(unittest.TestCase):
    def test_import_web_server_node(self):
        import animatronic_web.web_server_node  # noqa: F401

