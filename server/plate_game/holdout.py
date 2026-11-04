"""2024年で作った打者を、2025年の実際の打席と比べる。"""

from __future__ import annotations

from plate_game.engine import BatterPitch, advance_count, decide
from plate_game.rates import BB_EVENTS, IN_PLAY, K_EVENTS, SWING, WHIFF, Table, bip_result

HOLDOUT_PA = 2000
HOLDOUT_SEED = 7
COUNT_KEYS = ("0-0", "0-2", "3-2")
RATE_KEYS = (
    "swingRate",
    "whiffRate",
    "strikeoutRate",
    "walkRate",
    "groundRate",
    "lineRate",
    "flyRate",
    "hitRate",
    "extraBaseRate",
    "homeRunRate",
)


class _Tally:
    def __init__(self) -> None:
        self.pitches = 0
        self.swings = 0
        self.whiffs = 0
        self.pa = 0
        self.strikeouts = 0
        self.walks = 0
        self.bip = 0
        self.ground = 0
        self.line = 0
        self.fly = 0
        self.hit = 0
        self.extra = 0
        self.home_run = 0
        self.count_n = {key: 0 for key in COUNT_KEYS}
        self.count_swing = {key: 0 for key in COUNT_KEYS}


def _div(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return numerator / denominator


def _rates(tally: _Tally) -> dict:
    tracked = tally.ground + tally.line + tally.fly
    return {
        "pitches": tally.pitches,
        "plateAppearances": tally.pa,
        "ballsInPlay": tally.bip,
        "swingRate": _div(tally.swings, tally.pitches),
        "whiffRate": _div(tally.whiffs, tally.swings),
        "strikeoutRate": _div(tally.strikeouts, tally.pa),
        "walkRate": _div(tally.walks, tally.pa),
        "groundRate": _div(tally.ground, tracked),
        "lineRate": _div(tally.line, tracked),
        "flyRate": _div(tally.fly, tracked),
        "hitRate": _div(tally.hit, tally.bip),
        "extraBaseRate": _div(tally.extra, tally.bip),
        "homeRunRate": _div(tally.home_run, tally.bip),
        "swingByCount": {
            key: {"rate": _div(tally.count_swing[key], tally.count_n[key]), "pitches": tally.count_n[key]}
            for key in COUNT_KEYS
        },
    }


def _note_contact(tally: _Tally, bip_key: str | None, bb_type: str | None) -> None:
    if bip_key in {"single", "double", "triple", "home_run"}:
        tally.hit += 1
    if bip_key in {"double", "triple", "home_run"}:
        tally.extra += 1
    if bip_key == "home_run":
        tally.home_run += 1
    if bb_type == "ground_ball":
        tally.ground += 1
    elif bb_type == "line_drive":
        tally.line += 1
    elif bb_type in {"fly_ball", "popup"}:
        tally.fly += 1


def summarize_actual(pitches: list[BatterPitch]) -> dict:
    tally = _Tally()
    for pitch in pitches:
        tally.pitches += 1
        count = f"{pitch.balls}-{pitch.strikes}"
        swung = pitch.description in SWING
        if count in COUNT_KEYS:
            tally.count_n[count] += 1
            if swung:
                tally.count_swing[count] += 1
        if swung:
            tally.swings += 1
            if pitch.description in WHIFF:
                tally.whiffs += 1
        if pitch.events in K_EVENTS:
            tally.pa += 1
            tally.strikeouts += 1
        elif pitch.events in BB_EVENTS:
            tally.pa += 1
            tally.walks += 1
        elif pitch.description in IN_PLAY:
            tally.pa += 1
            tally.bip += 1
            _note_contact(tally, bip_result(pitch.events), pitch.bb_type)
    return _rates(tally)


def simulate_outcomes(
    seen: list[BatterPitch],
    batter: Table,
    league: Table,
    contact: list[BatterPitch],
    sz_bot: float,
    sz_top: float,
    plate_appearances: int,
    seed: int,
    repeat_alpha: float,
    league_contact: list[BatterPitch] | None = None,
) -> dict:
    """テスト年に見た球の分布で配球し、学習年の判断で打席を進める。"""
    by_count: dict[str, list[BatterPitch]] = {}
    for pitch in seen:
        by_count.setdefault(f"{pitch.balls}-{pitch.strikes}", []).append(pitch)
    fallback = seen
    rng_mod = __import__("random")
    rng = rng_mod.Random(f"sim:{seed}")
    tally = _Tally()
    for _appearance in range(plate_appearances):
        balls, strikes = 0, 0
        history: list[dict] = []
        for _pitch_index in range(16):
            pool = by_count.get(f"{balls}-{strikes}") or fallback
            faced = pool[rng.randrange(len(pool))]
            count = f"{balls}-{strikes}"
            decision = decide(
                batter,
                league,
                faced.group,
                faced.cell,
                balls,
                strikes,
                faced.plate_x,
                faced.plate_z,
                sz_bot,
                sz_top,
                history,
                rng,
                repeat_alpha,
                contact,
                faced.pitch_type,
                faced.p_throws,
                league_contact if league_contact is not None else contact,
            )
            tally.pitches += 1
            if count in COUNT_KEYS:
                tally.count_n[count] += 1
                if decision["swing"]:
                    tally.count_swing[count] += 1
            if decision["swing"]:
                tally.swings += 1
            if decision["whiff"]:
                tally.whiffs += 1
            balls, strikes, pa = advance_count(balls, strikes, decision["outcome"])
            history.append({"group": faced.group, "cell": faced.cell})
            if pa in {"strikeout_looking", "strikeout_swinging"}:
                tally.pa += 1
                tally.strikeouts += 1
                break
            if pa == "walk":
                tally.pa += 1
                tally.walks += 1
                break
            if pa == "in_play":
                tally.pa += 1
                tally.bip += 1
                _note_contact(tally, decision["bip"], decision["bbType"])
                break
    return _rates(tally)


def _pair(actual: dict, simulated: dict, trained: float, key: str) -> dict:
    """baseline は学習年の成績を、そのままテスト年に当てた差。"""
    return {
        "actual": actual[key],
        "simulated": simulated[key],
        "trained": trained,
        "gap": simulated[key] - actual[key],
        "baseline": trained - actual[key],
    }


def compare_batter(
    name: str,
    batter_id: int,
    method: str,
    train_pitches: int,
    seen: list[BatterPitch],
    table: Table,
    contact: list[BatterPitch],
    league: Table,
    sz_bot: float,
    sz_top: float,
    plate_appearances: int = HOLDOUT_PA,
    seed: int = HOLDOUT_SEED,
    repeat_alpha: float = 0.06,
    league_contact: list[BatterPitch] | None = None,
) -> dict:
    actual = summarize_actual(seen)
    trained = summarize_actual(contact)
    simulated = simulate_outcomes(
        seen,
        table,
        league,
        contact,
        sz_bot,
        sz_top,
        plate_appearances,
        seed,
        repeat_alpha,
        league_contact,
    )
    report = {
        "batterId": batter_id,
        "name": name,
        "method": method,
        "trainPitches": train_pitches,
        "testPitches": len(seen),
        "testPlateAppearances": actual["plateAppearances"],
        "simulatedPlateAppearances": plate_appearances,
        "seed": seed,
        "repeatAlpha": repeat_alpha,
    }
    for key in RATE_KEYS:
        report[key] = _pair(actual, simulated, trained[key], key)
    report["swingByCount"] = {
        key: {
            "actual": actual["swingByCount"][key]["rate"],
            "trained": trained["swingByCount"][key]["rate"],
            "simulated": simulated["swingByCount"][key]["rate"],
            "gap": simulated["swingByCount"][key]["rate"] - actual["swingByCount"][key]["rate"],
            "baseline": trained["swingByCount"][key]["rate"] - actual["swingByCount"][key]["rate"],
            "actualPitches": actual["swingByCount"][key]["pitches"],
            "trainedPitches": trained["swingByCount"][key]["pitches"],
            "simulatedPitches": simulated["swingByCount"][key]["pitches"],
        }
        for key in COUNT_KEYS
    }
    return report
