"""配球を実在の1球から選び、AI 打者の結果を決める。同じ種なら同じ結果になる。"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from plate_game.rates import (
    BIP_KEYS,
    Bucket,
    Table,
    batter_bip,
    batter_foul,
    batter_swing,
    batter_whiff,
    pitch_group,
)
from plate_game.zone import cell_center, cell_for, cell_label, is_strike_location

DEFAULT_REPEAT_ALPHA = 0.06
# マスの中心から半マスほどずれても、まだ十分に選ばれる。
LOCATION_SIGMA_FT = 0.48

PITCH_NAMES = {
    "FF": "フォーシーム",
    "FA": "フォーシーム",
    "SI": "シンカー",
    "FT": "ツーシーム",
    "FC": "カッター",
    "SL": "スライダー",
    "ST": "スイーパー",
    "SV": "スラーブ",
    "CU": "カーブ",
    "KC": "ナックルカーブ",
    "CH": "チェンジアップ",
    "FS": "スプリット",
    "FO": "フォーク",
    "SC": "スクリュー",
    "KN": "ナックル",
}

BB_NAMES = {
    "ground_ball": "ゴロ",
    "line_drive": "ライナー",
    "fly_ball": "フライ",
    "popup": "ポップフライ",
}
HIT_NAMES = {
    "out": "アウト",
    "single": "シングル",
    "double": "二塁打",
    "triple": "三塁打",
    "home_run": "本塁打",
}


@dataclass
class StoredPitch:
    pitch_type: str
    plate_x: float
    plate_z: float
    release_x: float
    release_y: float
    release_z: float
    vx0: float
    vy0: float
    vz0: float
    ax: float
    ay: float
    az: float
    spin_rpm: float | None
    spin_axis: float | None
    release_speed: float | None
    sz_top: float
    sz_bot: float
    game_date: str
    game_type: str


@dataclass
class BatterPitch:
    pitch_type: str
    plate_x: float
    plate_z: float
    sz_top: float
    sz_bot: float
    balls: int
    strikes: int
    description: str
    events: str | None
    bb_type: str | None
    group: str
    cell: int


def pitch_name(code: str) -> str:
    return PITCH_NAMES.get(code, code)


def _rng(seed: int, pitch_index: int) -> random.Random:
    return random.Random(f"{seed}:{pitch_index}")


def choose_pitch(
    pitches: list[StoredPitch],
    pitch_type: str,
    cell: int,
    sz_bot: float,
    sz_top: float,
    rng: random.Random,
) -> StoredPitch:
    center_x, center_z = cell_center(cell, sz_bot, sz_top)
    pool = [pitch for pitch in pitches if pitch.pitch_type == pitch_type]
    if not pool:
        raise ValueError(f"{pitch_type} の球がありません")
    weights = []
    for pitch in pool:
        distance = math.hypot(pitch.plate_x - center_x, pitch.plate_z - center_z)
        weights.append(max(math.exp(-0.5 * (distance / LOCATION_SIGMA_FT) ** 2), 1e-12))
    return rng.choices(pool, weights=weights, k=1)[0]


def repeat_streak(history: list[dict], group: str, cell: int) -> int:
    streak = 0
    for item in reversed(history):
        if item.get("group") == group and item.get("cell") == cell:
            streak += 1
        else:
            break
    return streak


def adjust_for_repeat(p_swing: float, p_whiff: float, bip: dict[str, float], streak: int, alpha: float) -> tuple[float, float, dict[str, float]]:
    """同じ球種・同じコースが続くほど、少し振って少し捉える。alpha の初期値は小さい。"""
    if streak <= 0 or alpha == 0:
        return p_swing, p_whiff, bip
    swing = min(0.97, max(0.02, p_swing * (1 + 0.35 * alpha * streak)))
    whiff = min(0.95, max(0.02, p_whiff * (1 - alpha * streak)))
    boosted = dict(bip)
    lift = 1 + alpha * streak
    for key in ("single", "double", "triple", "home_run"):
        boosted[key] *= lift
    total = sum(boosted.values())
    return swing, whiff, {key: value / total for key, value in boosted.items()}


def sample_bip(bip: dict[str, float], rng: random.Random) -> str:
    roll = rng.random()
    cursor = 0.0
    last = BIP_KEYS[-1]
    for key in BIP_KEYS:
        cursor += bip[key]
        if roll <= cursor:
            return key
    return last


def advance_count(balls: int, strikes: int, outcome: str) -> tuple[int, int, str | None]:
    if outcome == "ball":
        balls += 1
        if balls >= 4:
            return balls, strikes, "walk"
        return balls, strikes, None
    if outcome in {"called_strike", "swinging_strike"}:
        strikes += 1
        if strikes >= 3:
            return balls, strikes, "strikeout_looking" if outcome == "called_strike" else "strikeout_swinging"
        return balls, strikes, None
    if outcome == "foul":
        if strikes < 2:
            strikes += 1
        return balls, strikes, None
    if outcome == "in_play":
        return balls, strikes, "in_play"
    raise ValueError(outcome)


def outcome_label(outcome: str, bip: str | None, bb_type: str | None) -> str:
    if outcome == "ball":
        return "ボール"
    if outcome == "called_strike":
        return "見逃しストライク"
    if outcome == "swinging_strike":
        return "空振りストライク"
    if outcome == "foul":
        return "ファウル"
    hit = HIT_NAMES.get(bip or "out", "アウト")
    contact = BB_NAMES.get(bb_type or "", "")
    if bip == "home_run":
        return "本塁打" if not contact else f"{contact}の本塁打"
    if bip == "out":
        return f"{contact}のアウト" if contact else "アウト"
    return f"{contact}の{hit}" if contact else hit


def pa_label(pa: str | None, bip: str | None, bb_type: str | None) -> str | None:
    if pa == "walk":
        return "四球"
    if pa == "strikeout_looking":
        return "見逃し三振"
    if pa == "strikeout_swinging":
        return "空振り三振"
    if pa == "in_play":
        return outcome_label("in_play", bip, bb_type)
    return None


def decide(
    batter: Table,
    league: Table,
    group: str,
    cell: int,
    balls: int,
    strikes: int,
    plate_x: float,
    plate_z: float,
    sz_bot: float,
    sz_top: float,
    history: list[dict],
    rng: random.Random,
    repeat_alpha: float,
    bb_pool: list[BatterPitch],
) -> dict:
    count = f"{balls}-{strikes}"
    p_swing, swing_n = batter_swing(batter, league, group, cell, count)
    p_whiff, whiff_n = batter_whiff(batter, league, group, cell, count)
    p_foul, foul_n = batter_foul(batter, league, group, cell, count)
    bip = batter_bip(batter, league, group, cell, count)
    streak = repeat_streak(history, group, cell)
    p_swing, p_whiff, bip = adjust_for_repeat(p_swing, p_whiff, bip, streak, repeat_alpha)

    swing = rng.random() < p_swing
    swung_whiff = False
    foul = False
    bip_key = None
    bb_type = None
    if not swing:
        outcome = "called_strike" if is_strike_location(plate_x, plate_z, sz_bot, sz_top) else "ball"
    elif rng.random() < p_whiff:
        outcome = "swinging_strike"
        swung_whiff = True
    elif rng.random() < p_foul:
        outcome = "foul"
        foul = True
    else:
        outcome = "in_play"
        bip_key = sample_bip(bip, rng)
        matches = [
            pitch
            for pitch in bb_pool
            if pitch.group == group and pitch.events and _event_key(pitch.events) == bip_key and pitch.bb_type
        ]
        if not matches:
            matches = [pitch for pitch in bb_pool if _event_key(pitch.events) == bip_key and pitch.bb_type]
        if matches:
            bb_type = rng.choice(matches).bb_type

    return {
        "swing": swing,
        "whiff": swung_whiff,
        "foul": foul,
        "outcome": outcome,
        "bip": bip_key,
        "bbType": bb_type,
        "pSwing": round(p_swing, 4),
        "pWhiff": round(p_whiff, 4),
        "pFoul": round(p_foul, 4),
        "swingSamples": swing_n,
        "whiffSamples": whiff_n,
        "foulSamples": foul_n,
        "repeatStreak": streak,
    }


def _event_key(events: str | None) -> str | None:
    from plate_game.rates import bip_result

    if events is None:
        return None
    return bip_result(events)


def throw_pitch(
    pitcher_pitches: list[StoredPitch],
    pitcher_name: str,
    throws: str,
    batter_table: Table,
    batter_bb: list[BatterPitch],
    league: Table,
    bats: str,
    sz_bot: float,
    sz_top: float,
    pitch_type: str,
    cell: int,
    balls: int,
    strikes: int,
    history: list[dict],
    seed: int,
    pitch_index: int,
    repeat_alpha: float = DEFAULT_REPEAT_ALPHA,
) -> dict:
    if not 0 <= cell <= 24:
        raise ValueError("コースは 0 から 24 です")
    if not 0 <= balls <= 3 or not 0 <= strikes <= 2:
        raise ValueError("カウントが打席の途中ではありません")
    rng = _rng(seed, pitch_index)
    chosen = choose_pitch(pitcher_pitches, pitch_type, cell, sz_bot, sz_top, rng)
    group = pitch_group(pitch_type)
    decision = decide(
        batter_table,
        league,
        group,
        cell,
        balls,
        strikes,
        chosen.plate_x,
        chosen.plate_z,
        sz_bot,
        sz_top,
        history,
        rng,
        repeat_alpha,
        batter_bb,
    )
    balls_after, strikes_after, pa = advance_count(balls, strikes, decision["outcome"])
    actual_cell = cell_for(chosen.plate_x, chosen.plate_z, sz_bot, sz_top)
    return {
        "pitch": {
            "id": f"{seed}-{pitch_index}-{pitch_type}",
            "pitcher": pitcher_name,
            "throws": throws,
            "pitchType": chosen.pitch_type,
            "pitchName": pitch_name(chosen.pitch_type),
            "gameDate": chosen.game_date,
            "gameType": chosen.game_type,
            "plateX": chosen.plate_x,
            "plateZ": chosen.plate_z,
            "releaseX": chosen.release_x,
            "releaseY": chosen.release_y,
            "releaseZ": chosen.release_z,
            "vx0": chosen.vx0,
            "vy0": chosen.vy0,
            "vz0": chosen.vz0,
            "ax": chosen.ax,
            "ay": chosen.ay,
            "az": chosen.az,
            "spinRpm": chosen.spin_rpm,
            "spinAxis": chosen.spin_axis,
            "releaseSpeed": chosen.release_speed,
            "szTop": sz_top,
            "szBot": sz_bot,
        },
        "call": {
            "cell": cell,
            "label": cell_label(cell, bats),
            "actualCell": actual_cell,
            "actualLabel": cell_label(actual_cell, bats),
            "inZone": is_strike_location(chosen.plate_x, chosen.plate_z, sz_bot, sz_top),
        },
        "decision": decision,
        "result": {
            "code": decision["outcome"],
            "label": outcome_label(decision["outcome"], decision["bip"], decision["bbType"]),
            "pa": pa,
            "paLabel": pa_label(pa, decision["bip"], decision["bbType"]),
            "balls": balls_after,
            "strikes": strikes_after,
            "over": pa is not None,
        },
        "historyItem": {
            "pitchType": pitch_type,
            "group": group,
            "cell": cell,
            "label": cell_label(cell, bats),
        },
    }


def actual_rates(pitches: list[BatterPitch]) -> dict[str, float]:
    bucket = Bucket()
    for pitch in pitches:
        observed = _observe_batter(pitch)
        if observed:
            bucket.add(observed)
    return {
        "pitches": bucket.n,
        "swingRate": bucket.swing / bucket.n if bucket.n else 0,
        "whiffRate": bucket.whiff / bucket.swing if bucket.swing else 0,
    }


def _observe_batter(pitch: BatterPitch) -> Bucket | None:
    from plate_game.rates import observe

    return observe(pitch.description, pitch.events)


def simulate_plate_appearances(
    batter_pitches: list[BatterPitch],
    batter_table: Table,
    league: Table,
    sz_bot: float,
    sz_top: float,
    plate_appearances: int,
    seed: int,
    repeat_alpha: float = DEFAULT_REPEAT_ALPHA,
) -> dict[str, float]:
    """打者が実際に見た球の分布で配球し、AI の判断を 1,000 打席ぶん積む。"""
    by_count: dict[str, list[BatterPitch]] = {}
    for pitch in batter_pitches:
        by_count.setdefault(f"{pitch.balls}-{pitch.strikes}", []).append(pitch)
    fallback = batter_pitches
    rng = random.Random(f"sim:{seed}")
    pitches_seen = 0
    swings = 0
    whiffs = 0
    for appearance in range(plate_appearances):
        balls, strikes = 0, 0
        history: list[dict] = []
        for pitch_index in range(12):
            pool = by_count.get(f"{balls}-{strikes}") or fallback
            seen = pool[rng.randrange(len(pool))]
            decision = decide(
                batter_table,
                league,
                seen.group,
                seen.cell,
                balls,
                strikes,
                seen.plate_x,
                seen.plate_z,
                sz_bot,
                sz_top,
                history,
                rng,
                repeat_alpha,
                batter_pitches,
            )
            pitches_seen += 1
            if decision["swing"]:
                swings += 1
            if decision["whiff"]:
                whiffs += 1
            balls, strikes, pa = advance_count(balls, strikes, decision["outcome"])
            history.append({"group": seen.group, "cell": seen.cell})
            if pa:
                break
    return {
        "plateAppearances": plate_appearances,
        "pitches": pitches_seen,
        "swingRate": swings / pitches_seen if pitches_seen else 0,
        "whiffRate": whiffs / swings if swings else 0,
    }
