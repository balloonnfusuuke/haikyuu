"""取得済みの Statcast を読み、起動のたびに取りに行かない。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from plate_game.engine import BatterPitch, StoredPitch
from plate_game.rates import Table, observe, pitch_group
from plate_game.zone import cell_for

ROOT = Path(__file__).resolve().parents[2] / "data" / "game"
OFFICIAL_GAME_TYPES = {"R", "F", "D", "L", "W"}


def _num(value) -> float | None:
    if value is None:
        return None
    number = float(value)
    if number != number:
        return None
    return number


@dataclass
class PitcherBook:
    player_id: int
    name: str
    throws: str
    pitches: list[StoredPitch]

    @property
    def arsenal(self) -> list[dict]:
        counts: dict[str, int] = {}
        for pitch in self.pitches:
            counts[pitch.pitch_type] = counts.get(pitch.pitch_type, 0) + 1
        total = sum(counts.values()) or 1
        rows = [
            {"code": code, "count": count, "usage": count / total}
            for code, count in counts.items()
            if count >= 15
        ]
        rows.sort(key=lambda row: row["count"], reverse=True)
        return rows


@dataclass
class BatterBook:
    player_id: int
    name: str
    bats: str
    sz_top: float
    sz_bot: float
    pitches: list[BatterPitch]
    table: Table


@dataclass
class Catalog:
    pitchers: dict[int, PitcherBook]
    batters: dict[int, BatterBook]
    league: Table
    league_meta: dict


def _load_pitcher(path: Path) -> PitcherBook:
    raw = json.loads(path.read_text())
    pitches: list[StoredPitch] = []
    for row in raw["pitches"]:
        if row.get("gameType") not in OFFICIAL_GAME_TYPES:
            continue
        pitches.append(
            StoredPitch(
                pitch_type=row["pitchType"],
                plate_x=row["plateX"],
                plate_z=row["plateZ"],
                release_x=row["releaseX"],
                release_y=row["releaseY"],
                release_z=row["releaseZ"],
                vx0=row["vx0"],
                vy0=row["vy0"],
                vz0=row["vz0"],
                ax=row["ax"],
                ay=row["ay"],
                az=row["az"],
                spin_rpm=_num(row.get("spinRpm")),
                spin_axis=_num(row.get("spinAxis")),
                release_speed=_num(row.get("releaseSpeed")),
                sz_top=row["szTop"],
                sz_bot=row["szBot"],
                game_date=row["gameDate"],
                game_type=row["gameType"],
            )
        )
    return PitcherBook(raw["id"], raw["name"], raw["throws"], pitches)


def _load_batter(path: Path) -> BatterBook:
    raw = json.loads(path.read_text())
    pitches: list[BatterPitch] = []
    table = Table()
    for row in raw["pitches"]:
        if row.get("gameType") not in OFFICIAL_GAME_TYPES:
            continue
        group = pitch_group(row["pitchType"])
        cell = cell_for(row["plateX"], row["plateZ"], row["szBot"], row["szTop"])
        pitch = BatterPitch(
            pitch_type=row["pitchType"],
            plate_x=row["plateX"],
            plate_z=row["plateZ"],
            sz_top=row["szTop"],
            sz_bot=row["szBot"],
            balls=int(row["balls"]),
            strikes=int(row["strikes"]),
            description=row["description"],
            events=row.get("events"),
            bb_type=row.get("bbType"),
            group=group,
            cell=cell,
        )
        observed = observe(pitch.description, pitch.events)
        if observed is None:
            continue
        if not 0 <= pitch.balls <= 3 or not 0 <= pitch.strikes <= 2:
            continue
        pitches.append(pitch)
        table.add(group, cell, f"{pitch.balls}-{pitch.strikes}", observed)
    return BatterBook(raw["id"], raw["name"], raw["bats"], raw["szTop"], raw["szBot"], pitches, table)


def _load_league(path: Path) -> tuple[Table, dict]:
    raw = json.loads(path.read_text())
    table = Table()
    for key, counts in raw["buckets"].items():
        table.buckets[key] = _bucket_from(counts)
    return table, {"from": raw["from"], "to": raw["to"], "pitches": raw["pitches"], "note": raw.get("note")}


def _bucket_from(counts: dict):
    from plate_game.rates import Bucket

    bucket = Bucket()
    for key in bucket.__dataclass_fields__:
        setattr(bucket, key, int(counts.get(key, 0)))
    return bucket


def load_catalog(root: Path = ROOT) -> Catalog:
    pitchers = {book.player_id: book for book in (_load_pitcher(path) for path in sorted((root / "pitchers").glob("*.json")))}
    batters = {book.player_id: book for book in (_load_batter(path) for path in sorted((root / "batters").glob("*.json")))}
    league, meta = _load_league(root / "league.json")
    if not pitchers or not batters:
        raise FileNotFoundError(f"{root} に投手か打者のデータがありません")
    return Catalog(pitchers, batters, league, meta)
