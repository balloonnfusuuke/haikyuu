"""MLB 公式戦の Statcast を一度取り、data/game に保存する。起動時には走らない。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
from pybaseball import playerid_lookup, statcast, statcast_batter, statcast_pitcher

from plate_game.rates import observe, pitch_group
from plate_game.zone import cell_for

ROOT = Path(__file__).resolve().parents[1] / "data" / "game"
SEASON_START = "2025-03-27"
SEASON_END = "2025-11-02"
LEAGUE_RANGES = [("2025-06-02", "2025-06-08"), ("2025-10-01", "2025-10-05")]
TRAIN_START = "2024-03-20"
TRAIN_END = "2024-11-02"
TRAIN_LEAGUE = [("2024-06-03", "2024-06-09"), ("2024-10-01", "2024-10-05")]
OFFICIAL = {"R", "F", "D", "L", "W"}

PLAYERS = [
    ("pitcher", "Skubal", "Tarik"),
    ("pitcher", "Skenes", "Paul"),
    ("pitcher", "Yamamoto", "Yoshinobu"),
    ("batter", "Judge", "Aaron"),
    ("batter", "Ohtani", "Shohei"),
    ("batter", "Soto", "Juan"),
]


def lookup_id(last: str, first: str) -> tuple[int, str]:
    frame = playerid_lookup(last, first)
    if frame.empty:
        raise SystemExit(f"{last}, {first} が見つかりません")
    frame = frame.dropna(subset=["key_mlbam"]).sort_values("mlb_played_last", ascending=False)
    row = frame.iloc[0]
    player_id = int(row["key_mlbam"])
    name = f"{str(row['name_last']).title()}, {str(row['name_first']).title()}"
    return player_id, name


def _float(value):
    if value is None or (isinstance(value, float) and pd.isna(value)) or pd.isna(value):
        return None
    return float(value)


def _text(value) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)) or pd.isna(value):
        return None
    return str(value)


def official_rows(frame: pd.DataFrame) -> pd.DataFrame:
    if frame is None or frame.empty:
        return pd.DataFrame()
    data = frame.copy()
    if "game_type" not in data.columns:
        return pd.DataFrame()
    data = data[data["game_type"].isin(OFFICIAL)]
    needed = ["pitch_type", "plate_x", "plate_z", "sz_top", "sz_bot", "description"]
    data = data.dropna(subset=needed)
    return data


def pitcher_record(row) -> dict | None:
    kinematics = [
        "release_pos_x",
        "release_pos_y",
        "release_pos_z",
        "vx0",
        "vy0",
        "vz0",
        "ax",
        "ay",
        "az",
    ]
    if any(pd.isna(row[key]) for key in kinematics):
        return None
    return {
        "pitchType": row["pitch_type"],
        "plateX": float(row["plate_x"]),
        "plateZ": float(row["plate_z"]),
        "releaseX": float(row["release_pos_x"]),
        "releaseY": float(row["release_pos_y"]),
        "releaseZ": float(row["release_pos_z"]),
        "vx0": float(row["vx0"]),
        "vy0": float(row["vy0"]),
        "vz0": float(row["vz0"]),
        "ax": float(row["ax"]),
        "ay": float(row["ay"]),
        "az": float(row["az"]),
        "spinRpm": _float(row.get("release_spin_rate")),
        "spinAxis": _float(row.get("spin_axis")),
        "releaseSpeed": _float(row.get("release_speed")),
        "szTop": float(row["sz_top"]),
        "szBot": float(row["sz_bot"]),
        "gameDate": str(row["game_date"])[:10],
        "gameType": row["game_type"],
    }


def batter_record(row) -> dict | None:
    balls = row.get("balls")
    strikes = row.get("strikes")
    if pd.isna(balls) or pd.isna(strikes):
        return None
    description = _text(row.get("description"))
    if observe(description, _text(row.get("events"))) is None:
        return None
    return {
        "pitchType": row["pitch_type"],
        "plateX": float(row["plate_x"]),
        "plateZ": float(row["plate_z"]),
        "szTop": float(row["sz_top"]),
        "szBot": float(row["sz_bot"]),
        "balls": int(balls),
        "strikes": int(strikes),
        "description": description,
        "events": _text(row.get("events")),
        "bbType": _text(row.get("bb_type")),
        "gameDate": str(row["game_date"])[:10],
        "gameType": row["game_type"],
        "gamePk": None if pd.isna(row.get("game_pk")) else int(row["game_pk"]),
        "launchSpeed": _float(row.get("launch_speed")),
        "launchAngle": _float(row.get("launch_angle")),
        "hcX": _float(row.get("hc_x")),
        "hcY": _float(row.get("hc_y")),
    }


def median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {path} ({path.stat().st_size / 1_048_576:.1f} MB)")


def fetch_players() -> None:
    for role, last, first in PLAYERS:
        player_id, name = lookup_id(last, first)
        print(f"fetch {role} {name} {player_id}")
        if role == "pitcher":
            frame = official_rows(statcast_pitcher(SEASON_START, SEASON_END, player_id))
            pitches = [record for row in frame.to_dict("records") if (record := pitcher_record(row))]
            throws = frame["p_throws"].dropna().mode().iloc[0] if not frame.empty else "R"
            write_json(
                ROOT / "pitchers" / f"{player_id}.json",
                {"id": player_id, "name": name, "throws": throws, "from": SEASON_START, "to": SEASON_END, "pitches": pitches},
            )
        else:
            frame = official_rows(statcast_batter(SEASON_START, SEASON_END, player_id))
            pitches = [record for row in frame.to_dict("records") if (record := batter_record(row))]
            bats = frame["stand"].dropna().mode().iloc[0] if not frame.empty else "R"
            write_json(
                ROOT / "batters" / f"{player_id}.json",
                {
                    "id": player_id,
                    "name": name,
                    "bats": bats,
                    "szTop": median([pitch["szTop"] for pitch in pitches]),
                    "szBot": median([pitch["szBot"] for pitch in pitches]),
                    "from": SEASON_START,
                    "to": SEASON_END,
                    "pitches": pitches,
                },
            )


def fetch_league() -> None:
    frames = []
    for start, end in LEAGUE_RANGES:
        print(f"fetch league {start} {end}")
        frames.append(official_rows(statcast(start, end)))
    data = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    buckets: dict[str, dict] = {}
    kept = 0
    for row in data.to_dict("records"):
        observed = observe(_text(row.get("description")), _text(row.get("events")))
        if observed is None or pd.isna(row.get("balls")) or pd.isna(row.get("strikes")):
            continue
        balls = int(row["balls"])
        strikes = int(row["strikes"])
        if not 0 <= balls <= 3 or not 0 <= strikes <= 2:
            continue
        group = pitch_group(row["pitch_type"])
        cell = cell_for(float(row["plate_x"]), float(row["plate_z"]), float(row["sz_bot"]), float(row["sz_top"]))
        key = f"{group}|{cell}|{balls}-{strikes}"
        slot = buckets.setdefault(
            key,
            {"n": 0, "swing": 0, "whiff": 0, "contact": 0, "foul": 0, "in_play": 0, "out": 0, "single": 0, "double": 0, "triple": 0, "home_run": 0},
        )
        for field, value in observed.as_dict().items():
            slot[field] += value
        kept += 1
    write_json(
        ROOT / "league.json",
        {
            "from": LEAGUE_RANGES[0][0],
            "to": LEAGUE_RANGES[-1][1],
            "ranges": LEAGUE_RANGES,
            "pitches": kept,
            "note": "2025年のレギュラーシーズン1週間と、ポストシーズンの5日。公式戦（R/F/D/L/W）だけ。",
            "buckets": buckets,
        },
    )


def _fetch_batter(player_id: int, name: str, start: str, end: str, path: Path) -> None:
    print(f"fetch batter {name} {player_id} {start} {end}", flush=True)
    frame = official_rows(statcast_batter(start, end, player_id))
    pitches = [record for row in frame.to_dict("records") if (record := batter_record(row))]
    bats = frame["stand"].dropna().mode().iloc[0] if not frame.empty and "stand" in frame.columns else "R"
    write_json(
        path,
        {
            "id": player_id,
            "name": name,
            "bats": bats,
            "szTop": median([pitch["szTop"] for pitch in pitches]) if pitches else 3.5,
            "szBot": median([pitch["szBot"] for pitch in pitches]) if pitches else 1.5,
            "from": start,
            "to": end,
            "pitches": pitches,
        },
    )


def fetch_training() -> None:
    """2024年の公式戦。打者の AI はここから作り、2025年では測らない。"""
    root = ROOT / "train"
    for _role, last, first in PLAYERS:
        if _role != "batter":
            continue
        player_id, name = lookup_id(last, first)
        _fetch_batter(player_id, name, TRAIN_START, TRAIN_END, root / "batters" / f"{player_id}.json")
    frames = []
    for start, end in TRAIN_LEAGUE:
        print(f"fetch league {start} {end}", flush=True)
        frames.append(official_rows(statcast(start, end)))
    data = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    buckets: dict[str, dict] = {}
    kept = 0
    for row in data.to_dict("records"):
        observed = observe(_text(row.get("description")), _text(row.get("events")))
        if observed is None or pd.isna(row.get("balls")) or pd.isna(row.get("strikes")):
            continue
        balls = int(row["balls"])
        strikes = int(row["strikes"])
        if not 0 <= balls <= 3 or not 0 <= strikes <= 2:
            continue
        group = pitch_group(row["pitch_type"])
        cell = cell_for(float(row["plate_x"]), float(row["plate_z"]), float(row["sz_bot"]), float(row["sz_top"]))
        key = f"{group}|{cell}|{balls}-{strikes}"
        slot = buckets.setdefault(
            key,
            {"n": 0, "swing": 0, "whiff": 0, "contact": 0, "foul": 0, "in_play": 0, "out": 0, "single": 0, "double": 0, "triple": 0, "home_run": 0},
        )
        for field, value in observed.as_dict().items():
            slot[field] += value
        kept += 1
    write_json(
        root / "league.json",
        {
            "from": TRAIN_LEAGUE[0][0],
            "to": TRAIN_LEAGUE[-1][1],
            "ranges": TRAIN_LEAGUE,
            "pitches": kept,
            "note": "2024年のレギュラーシーズン1週間と、ポストシーズンの5日。公式戦（R/F/D/L/W）だけ。打者モデルのリーグ平均に使う。",
            "buckets": buckets,
        },
    )


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "train":
        fetch_training()
    else:
        fetch_players()
        fetch_league()
