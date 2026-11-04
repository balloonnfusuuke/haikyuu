import math
import unittest

from plate_game.fence import fence_distance, fence_height_ft
from plate_game.park import apply_park, resolve_fair_ball


def play(ev, la, angle, carry, ground=False):
    rad = math.radians(angle)
    return resolve_fair_ball(
        x=0.1,
        y=17 / 12,
        z=2.6,
        speed_mph=ev,
        launch_deg=la,
        aim_x=math.sin(rad) * 300,
        aim_y=math.cos(rad) * 300,
        carry_ft=carry,
        ground=ground,
        bb_type="ground_ball" if ground else "fly_ball",
    )


class Park(unittest.TestCase):
    def test_center_is_deeper_than_the_lines(self):
        self.assertGreater(fence_distance(0), fence_distance(45) + 50)
        self.assertAlmostEqual(fence_distance(-20), fence_distance(20), delta=0.2)
        self.assertLess(fence_distance(45), 320)
        self.assertGreater(fence_distance(0), 380)
        self.assertGreater(fence_height_ft(), 9)
        self.assertLess(fence_height_ft(), 9.4)

    def test_a_carry_past_the_fence_is_a_home_run(self):
        flown = play(110, 28, 0, 430)
        self.assertEqual(flown["bip"], "home_run")
        self.assertTrue(flown["cleared"])
        self.assertGreater(flown["heightFt"], fence_height_ft())

    def test_a_fly_in_front_of_center_is_not_a_home_run(self):
        flown = play(102, 26, -13, 360)
        self.assertNotEqual(flown["bip"], "home_run")
        self.assertFalse(flown["cleared"])
        self.assertEqual(flown["how"], "catch")
        self.assertEqual(flown["fielder"], "左翼")

    def test_a_ball_that_hits_the_wall_is_a_double(self):
        flown = play(100, 24, 0, 400)
        self.assertEqual(flown["bip"], "double")
        self.assertEqual(flown["how"], "wall")

    def test_outside_the_foul_line_is_not_a_home_run(self):
        outside = play(108, 32, 47, 400)
        self.assertFalse(outside["fair"])
        self.assertNotEqual(outside["bip"], "home_run")
        self.assertIn("ファウル", outside["note"])
        on_the_line = play(105, 32, 45, 380)
        self.assertTrue(on_the_line["fair"])
        self.assertEqual(on_the_line["bip"], "home_run")
        down_the_line = play(100, 35, 40, 360)
        self.assertTrue(down_the_line["fair"])
        self.assertEqual(down_the_line["bip"], "home_run")
        ground = play(95, -6, 50, 160, ground=True)
        self.assertEqual(ground["how"], "foul")
        self.assertEqual(ground["label"], "ファウル")

    def test_a_fair_sample_called_foul_stays_a_foul_when_it_hooks_outside(self):
        decision = {
            "outcome": "in_play",
            "bip": "home_run",
            "bbType": "fly_ball",
            "exitSpeed": 108.0,
            "launchAngle": 32.0,
            "spray": 47.0,
            "hcX": None,
            "hcY": None,
            "hitDistance": 400.0,
            "foul": False,
        }
        apply_park(decision, 0.0, 2.5)
        self.assertEqual(decision["outcome"], "foul")
        self.assertIsNone(decision["bip"])
        self.assertTrue(decision["foul"])
        self.assertTrue(decision["park"]["note"].startswith("MLB では本塁打"))

    def test_ground_balls_split_into_outs_and_hits(self):
        at_short = play(90, -8, -16, 140, ground=True)
        self.assertEqual(at_short["bip"], "out")
        self.assertEqual(at_short["fielder"], "遊撃")
        hole = play(98, -6, -28, 160, ground=True)
        self.assertEqual(hole["bip"], "single")
        self.assertEqual(hole["label"], "ゴロの単打")
        slow = play(68, -18, 2, 40, ground=True)
        self.assertEqual(slow["bip"], "out")
        self.assertEqual(slow["fielder"], "投手")

    def test_an_mlb_home_run_short_of_this_fence_says_so(self):
        decision = {
            "outcome": "in_play",
            "bip": "home_run",
            "bbType": "fly_ball",
            "exitSpeed": 102.0,
            "launchAngle": 26.0,
            "spray": -13.0,
            "hcX": None,
            "hcY": None,
            "hitDistance": 360.0,
        }
        apply_park(decision, 0.0, 2.5)
        self.assertNotEqual(decision["bip"], "home_run")
        self.assertTrue(decision["park"]["note"].startswith("MLB では本塁打"))
        self.assertEqual(decision["mlbBip"], "home_run")


if __name__ == "__main__":
    unittest.main()
