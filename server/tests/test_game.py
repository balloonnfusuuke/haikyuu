import random
import unittest

from plate_game.engine import (
    StoredPitch,
    advance_count,
    adjust_for_repeat,
    choose_pitch,
    throw_pitch,
)
from plate_game.rates import Bucket, Table, batter_swing, shrink
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


if __name__ == "__main__":
    unittest.main()
