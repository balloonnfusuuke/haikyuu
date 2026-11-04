import random
import unittest

from plate_game.engine import (
    BatterPitch,
    StoredPitch,
    advance_count,
    adjust_for_repeat,
    choose_pitch,
    pick_contact,
    select_contact,
    spray_degrees,
    throw_pitch,
)
from plate_game.store import split_games
from plate_game.rates import Bucket, Table, batter_swing, batter_whiff, shrink
from plate_game.zone import cell_for, cell_label, is_strike_cell, is_strike_location


def pitch(plate_x: float, plate_z: float, pitch_type: str = "FF") -> StoredPitch:
    return StoredPitch(
        pitch_type,
        plate_x,
        plate_z,
        -1.5,
        54.0,
        6.0,
        2.0,
        -128.0,
        -6.0,
        5.0,
        28.0,
        -20.0,
        2300,
        200,
        96.0,
        3.5,
        1.5,
        "2025-06-15",
        "R",
    )


class Rates(unittest.TestCase):
    def test_shrink_is_league_when_empty_and_batter_when_large(self):
        self.assertAlmostEqual(shrink(0, 0, 0.4, 48), 0.4)
        self.assertAlmostEqual(shrink(200, 200, 0.4, 48), (200 + 48 * 0.4) / 248)
        self.assertGreater(shrink(200, 200, 0.4, 48), 0.85)

    def test_sparse_bucket_stays_near_league_and_large_bucket_moves(self):
        batter = Table()
        league = Table()
        league.buckets["*|*|*"] = Bucket(n=400, swing=160)
        rate, samples = batter_swing(batter, league, "FF", 12, "0-0")
        self.assertEqual(samples, 0)
        self.assertAlmostEqual(rate, 0.4)
        batter.add("FF", 12, "0-0", Bucket(n=400, swing=40))
        rate, samples = batter_swing(batter, league, "FF", 12, "0-0")
        self.assertEqual(samples, 400)
        self.assertLess(rate, 0.2)

    def test_zone_heart_stays_aggressive_and_the_chase_cell_does_not(self):
        batter = Table()
        league = Table()
        league.buckets["*|*|*"] = Bucket(n=800, swing=360)
        batter.add("FF", 12, "0-0", Bucket(n=80, swing=68))
        batter.add("FF", 0, "0-0", Bucket(n=80, swing=8))
        heart, _samples = batter_swing(batter, league, "FF", 12, "0-0")
        chase, _samples = batter_swing(batter, league, "FF", 0, "0-0")
        self.assertGreater(heart, 0.7)
        self.assertLess(chase, 0.25)

    def test_slider_whiff_is_not_pulled_down_to_the_sinker(self):
        batter = Table()
        league = Table()
        league.buckets["*|*|*"] = Bucket(n=800, swing=400, whiff=110)
        league.buckets["SL|*|*"] = Bucket(n=400, swing=200, whiff=80)
        league.buckets["SI|*|*"] = Bucket(n=400, swing=200, whiff=30)
        batter.add("SL", 12, "0-0", Bucket(n=200, swing=100, whiff=40))
        batter.add("SI", 12, "0-0", Bucket(n=200, swing=100, whiff=14))
        slider, _samples = batter_whiff(batter, league, "SL", 12, "0-0")
        sinker, _samples = batter_whiff(batter, league, "SI", 12, "0-0")
        self.assertGreater(slider, 0.32)
        self.assertLess(sinker, 0.22)

    def test_chase_whiff_stays_above_the_heart(self):
        batter = Table()
        league = Table()
        league.buckets["SL|*|*"] = Bucket(n=600, swing=300, whiff=90)
        batter.add("SL", 12, "0-0", Bucket(n=400, swing=200, whiff=30))
        for cell in (0, 4, 20, 24):
            batter.add("SL", cell, "0-0", Bucket(n=40, swing=20, whiff=12))
        heart, _samples = batter_whiff(batter, league, "SL", 12, "0-0")
        chase, _samples = batter_whiff(batter, league, "SL", 0, "0-0")
        self.assertLess(heart, 0.22)
        self.assertGreater(chase, 0.45)


class Count(unittest.TestCase):
    def test_walk_strikeout_and_foul_at_two_strikes(self):
        balls, strikes, pa = advance_count(3, 2, "ball")
        self.assertEqual((balls, pa), (4, "walk"))
        _, strikes, pa = advance_count(0, 2, "swinging_strike")
        self.assertEqual((strikes, pa), (3, "strikeout_swinging"))
        _, strikes, pa = advance_count(1, 2, "called_strike")
        self.assertEqual(pa, "strikeout_looking")
        balls, strikes, pa = advance_count(1, 2, "foul")
        self.assertEqual((balls, strikes, pa), (1, 2, None))
        _, strikes, pa = advance_count(0, 1, "foul")
        self.assertEqual((strikes, pa), (2, None))
        self.assertEqual(advance_count(0, 0, "in_play")[2], "in_play")


class Zone(unittest.TestCase):
    def test_middle_is_a_strike_cell_and_the_corner_is_not(self):
        self.assertTrue(is_strike_cell(12))
        self.assertFalse(is_strike_cell(0))
        self.assertTrue(is_strike_location(0.1, 2.5, 1.5, 3.5))
        self.assertFalse(is_strike_location(2.2, 2.5, 1.5, 3.5))
        self.assertEqual(cell_for(0.0, 2.5, 1.5, 3.5), 12)
        self.assertIn("内", cell_label(11, "R"))


class Contact(unittest.TestCase):
    def test_spray_is_zero_up_the_middle_and_positive_to_the_right(self):
        self.assertAlmostEqual(spray_degrees(125.42, 100), 0, places=4)
        self.assertGreater(spray_degrees(180, 100), 0)
        self.assertIsNone(spray_degrees(None, 100))

    def test_in_play_uses_a_real_batted_ball(self):
        ball = BatterPitch(
            "FF",
            0.1,
            2.4,
            3.5,
            1.5,
            0,
            0,
            "hit_into_play",
            "single",
            "line_drive",
            "FF",
            12,
            launch_speed=104.2,
            launch_angle=11.0,
            spray=-8.0,
        )
        bb, speed, angle, spray = pick_contact([ball], "single", random.Random(1))
        self.assertEqual(bb, "line_drive")
        self.assertEqual(speed, 104.2)
        self.assertEqual(angle, 11.0)
        self.assertEqual(spray, -8.0)

    def test_small_cell_does_not_lock_one_batted_ball(self):
        local = BatterPitch(
            "FF",
            0.05,
            2.5,
            3.5,
            1.5,
            0,
            0,
            "hit_into_play",
            "field_out",
            "ground_ball",
            "FF",
            12,
            launch_speed=82.0,
            launch_angle=-8.0,
            hc_x=140.0,
            hc_y=170.0,
            pitch_id="local-gb",
            p_throws="R",
        )
        league = [
            BatterPitch(
                "FF",
                0.2,
                2.2,
                3.5,
                1.5,
                0,
                0,
                "hit_into_play",
                "home_run",
                "fly_ball",
                "FF",
                12,
                launch_speed=108.0,
                launch_angle=28.0,
                hc_x=80.0 + index,
                hc_y=70.0,
                pitch_id=f"hr-{index}",
                p_throws="R",
            )
            for index in range(24)
        ]
        picked = {
            select_contact([local], league, "FF", "R", 0.05, 2.5, 1.5, 3.5, random.Random(index)).pitch_id
            for index in range(40)
        }
        self.assertIn("local-gb", picked)
        self.assertGreater(len(picked), 1)

    def test_games_split_into_earlier_and_later(self):
        def pitch_on(day: str) -> BatterPitch:
            return BatterPitch("FF", 0, 2, 3.5, 1.5, 0, 0, "ball", None, None, "FF", 12, game_date=day)

        early, late = split_games([pitch_on("2024-04-01"), pitch_on("2024-09-01"), pitch_on("2024-05-01")])
        self.assertEqual([pitch.game_date for pitch in early], ["2024-04-01"])
        self.assertEqual(sorted(pitch.game_date for pitch in late), ["2024-05-01", "2024-09-01"])


class Selection(unittest.TestCase):
    def test_same_seed_repeats_and_center_is_preferred(self):
        near = pitch(0.0, 2.5)
        far = pitch(1.6, 4.2)
        pool = [near, far]
        first = [choose_pitch(pool, "FF", 12, 1.5, 3.5, random.Random("7:0")) for _ in range(1)]
        again = choose_pitch(pool, "FF", 12, 1.5, 3.5, random.Random("7:0"))
        self.assertEqual(first[0].plate_x, again.plate_x)
        hits = 0
        for index in range(40):
            chosen = choose_pitch(pool, "FF", 12, 1.5, 3.5, random.Random(f"spread:{index}"))
            if chosen.plate_z < 3:
                hits += 1
        self.assertGreater(hits, 30)

    def test_repeat_makes_contact_more_likely(self):
        bip = {"out": 0.7, "single": 0.2, "double": 0.05, "triple": 0.01, "home_run": 0.04}
        swing, whiff, boosted = adjust_for_repeat(0.5, 0.3, bip, 3, 0.06)
        self.assertGreater(swing, 0.5)
        self.assertLess(whiff, 0.3)
        self.assertGreater(boosted["single"], bip["single"])
        same_swing, same_whiff, same_bip = adjust_for_repeat(0.5, 0.3, bip, 3, 0)
        self.assertEqual((same_swing, same_whiff), (0.5, 0.3))
        self.assertEqual(same_bip, bip)

    def test_throw_is_reproducible(self):
        pitches = [pitch(-0.2, 2.4), pitch(0.4, 2.7), pitch(0.9, 1.6, "SL")]
        batter = Table()
        league = Table()
        league.buckets["*|*|*"] = Bucket(n=200, swing=90, whiff=20, contact=70, foul=30, in_play=40, out=28, single=8, double=2, triple=0, home_run=2)
        kwargs = dict(
            pitcher_pitches=pitches,
            pitcher_name="Skubal, Tarik",
            throws="L",
            batter_table=batter,
            batter_bb=[],
            league=league,
            bats="R",
            sz_bot=1.5,
            sz_top=3.5,
            pitch_type="FF",
            cell=12,
            balls=0,
            strikes=0,
            history=[],
            seed=11,
            pitch_index=0,
            repeat_alpha=0.06,
        )
        self.assertEqual(throw_pitch(**kwargs), throw_pitch(**kwargs))
        plates = {throw_pitch(**{**kwargs, "pitch_index": index})["pitch"]["plateX"] for index in range(12)}
        self.assertGreater(len(plates), 1)


if __name__ == "__main__":
    unittest.main()
