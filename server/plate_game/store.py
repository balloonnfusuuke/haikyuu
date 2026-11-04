"""取得済みの Statcast を読み、起動のたびに取りに行かない。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from plate_game.engine import BatterPitch, StoredPitch, spray_degrees
from plate_game.rates import Table, observe, pitch_group
from plate_game.zone import cell_for

MIN_TRAIN_PITCHES = 800

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
    seen: list[BatterPitch]
    model_note: str
    train_pitches: int


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


def _read_pitches(path: Path) -> tuple[dict, list[BatterPitch]]:
    raw = json.loads(path.read_text())
    pitches: list[BatterPitch] = []
    for row in raw["pitches"]:
        if row.get("gameType") not in OFFICIAL_GAME_TYPES:
            continue
        balls = int(row["balls"])
        strikes = int(row["strikes"])
        if not 0 <= balls <= 3 or not 0 <= strikes <= 2:
            continue
        observed = observe(row["description"], row.get("events"))
        if observed is None:
            continue
        group = pitch_group(row["pitchType"])
        cell = cell_for(row["plateX"], row["plateZ"], row["szBot"], row["szTop"])
        game_pk = row.get("gamePk")
        pitches.append(
            BatterPitch(
                pitch_type=row["pitchType"],
                plate_x=row["plateX"],
                plate_z=row["plateZ"],
                sz_top=row["szTop"],
                sz_bot=row["szBot"],
                balls=balls,
                strikes=strikes,
                description=row["description"],
                events=row.get("events"),
                bb_type=row.get("bbType"),
                group=group,
                cell=cell,
                game_date=str(row.get("gameDate") or ""),
                game_pk=int(game_pk) if game_pk else None,
                launch_speed=_num(row.get("launchSpeed")),
                launch_angle=_num(row.get("launchAngle")),
                spray=spray_degrees(_num(row.get("hcX")), _num(row.get("hcY"))),
            )
        )
    return raw, pitches


def table_from(pitches: list[BatterPitch]) -> Table:
    table = Table()
    for pitch in pitches:
        observed = observe(pitch.description, pitch.events)
        if observed is None:
            continue
        table.add(pitch.group, pitch.cell, f"{pitch.balls}-{pitch.strikes}", observed)
    return table


def _game_id(pitch: BatterPitch) -> str:
    if pitch.game_pk:
        return str(pitch.game_pk)
    return pitch.game_date or "?"


def split_games(pitches: list[BatterPitch]) -> tuple[list[BatterPitch], list[BatterPitch]]:
    """試合日の前半で学習し、後半で測る。"""
    games = sorted({_game_id(pitch) for pitch in pitches})
    if len(games) < 2:
        mid = max(1, len(pitches) // 2)
        return pitches[:mid], pitches[mid:] or pitches[:mid]
    train_games = set(games[: len(games) // 2])
    train = [pitch for pitch in pitches if _game_id(pitch) in train_games]
    test = [pitch for pitch in pitches if _game_id(pitch) not in train_games]
    if not train or not test:
        mid = max(1, len(pitches) // 2)
        return pitches[:mid], pitches[mid:]
    return train, test


def _resolve_model(
    train: list[BatterPitch],
    season: list[BatterPitch],
) -> tuple[list[BatterPitch], list[BatterPitch], str]:
    if len(train) >= MIN_TRAIN_PITCHES:
        return (
            train,
            season,
            f"2024年の公式戦 {len(train)} 球で作り、2025年の公式戦 {len(season)} 球で測る",
        )
    model, held = split_games([*train, *season])
    return (
        model,
        held,
        f"2024年は {len(train)} 球しかないので、試合日の前半 {len(model)} 球で作り、後半 {len(held)} 球で測る",
    )


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
    batters: dict[int, BatterBook] = {}
    train_root = root / "train" / "batters"
    train_league_path = root / "train" / "league.json"
    for path in sorted((root / "batters").glob("*.json")):
        raw, season = _read_pitches(path)
        train_path = train_root / path.name
        train = _read_pitches(train_path)[1] if train_path.exists() else []
        model, seen, note = _resolve_model(train, season)
        batters[int(raw["id"])] = BatterBook(
            int(raw["id"]),
            raw["name"],
            raw["bats"],
            float(raw["szTop"]),
            float(raw["szBot"]),
            model,
            table_from(model),
            seen,
            note,
            len(model),
        )
    if train_league_path.exists():
        league, meta = _load_league(train_league_path)
    else:
        league, meta = _load_league(root / "league.json")
        meta = {**meta, "note": "2024年のリーグ平均がまだ無いので、2025年の週を使っている。"}
    if not pitchers or not batters:
        raise FileNotFoundError(f"{root} に投手か打者のデータがありません")
    return Catalog(pitchers, batters, league, meta)
