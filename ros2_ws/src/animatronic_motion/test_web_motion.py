import unittest

from animatronic_motion.web_motion import parse_web_motion_yaml, pose_at_time


def pattern_yaml(mode, in_mode=None, out_dy=0, in_dy=0):
    in_mode = in_mode or mode
    return f"""
name: test
tracks:
  lower_yaw:
    - time_ms: 0
      value: 0
      tangent:
        in: {{ mode: {mode}, dx: 120, dy: 0 }}
        out: {{ mode: {mode}, dx: 100, dy: {out_dy} }}
    - time_ms: 1000
      value: 100
      tangent:
        in: {{ mode: {in_mode}, dx: 100, dy: {in_dy} }}
        out: {{ mode: {in_mode}, dx: 120, dy: 0 }}
  lower_pitch: []
  upper_yaw: []
  upper_pitch: []
"""


class WebMotionInterpolationTest(unittest.TestCase):
    def test_linear_matches_straight_line(self):
        pattern = parse_web_motion_yaml(pattern_yaml("linear"))
        self.assertAlmostEqual(pose_at_time(pattern, 500)["lower_yaw"], 50.0)

    def test_flat_uses_zero_slopes(self):
        pattern = parse_web_motion_yaml(pattern_yaml("flat"))
        self.assertAlmostEqual(pose_at_time(pattern, 250)["lower_yaw"], 15.625)
        self.assertAlmostEqual(pose_at_time(pattern, 500)["lower_yaw"], 50.0)

    def test_auto_uses_neighbor_slope(self):
        pattern = parse_web_motion_yaml("""
name: auto
tracks:
  lower_yaw:
    - time_ms: 0
      value: 0
      tangent:
        in: { mode: auto, dx: 120, dy: 0 }
        out: { mode: auto, dx: 120, dy: 0 }
    - time_ms: 1000
      value: 100
      tangent:
        in: { mode: auto, dx: 120, dy: 0 }
        out: { mode: auto, dx: 120, dy: 0 }
    - time_ms: 2000
      value: 100
      tangent:
        in: { mode: auto, dx: 120, dy: 0 }
        out: { mode: auto, dx: 120, dy: 0 }
  lower_pitch: []
  upper_yaw: []
  upper_pitch: []
""")
        self.assertAlmostEqual(pose_at_time(pattern, 500)["lower_yaw"], 56.25)

    def test_manual_handles_match_js_sign_rules(self):
        pattern = parse_web_motion_yaml(pattern_yaml("manual", out_dy=10, in_dy=-10))
        self.assertAlmostEqual(pose_at_time(pattern, 500)["lower_yaw"], 50.0)
        self.assertAlmostEqual(pose_at_time(pattern, 250)["lower_yaw"], 25.0)

    def test_step_holds_previous_value(self):
        pattern = parse_web_motion_yaml(pattern_yaml("step"))
        self.assertAlmostEqual(pose_at_time(pattern, 999)["lower_yaw"], 0.0)
        self.assertAlmostEqual(pose_at_time(pattern, 1000)["lower_yaw"], 100.0)


if __name__ == "__main__":
    unittest.main()
