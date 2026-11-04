"""打者の判断と結果はここ。表示は Three.js 側。"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from plate_game.engine import (
    DEFAULT_REPEAT_ALPHA,
    pitch_name,
    throw_pitch,
)
from plate_game.holdout import HOLDOUT_PA, HOLDOUT_SEED, compare_batter
from plate_game.store import load_catalog
from plate_game.zone import COLUMNS_FOR_LEFT, COLUMNS_FOR_RIGHT, ROW_LABELS, is_strike_cell

app = FastAPI(title="打席")
CATALOG = None
HOLDOUT: dict[tuple, dict] = {}


def catalog():
    global CATALOG
    if CATALOG is None:
        CATALOG = load_catalog()
    return CATALOG


class HistoryItem(BaseModel):
    pitchType: str
    group: str
    cell: int
    label: str | None = None


class PitchRequest(BaseModel):
    pitcherId: int
    batterId: int
    pitchType: str
    cell: int
    balls: int = 0
    strikes: int = 0
    history: list[HistoryItem] = Field(default_factory=list)
    seed: int = 1
    pitchIndex: int = 0
    repeatAlpha: float = DEFAULT_REPEAT_ALPHA


@app.get("/health")
def health() -> dict:
    book = catalog()
    return {"ok": True, "pitchers": len(book.pitchers), "batters": len(book.batters)}


@app.get("/roster")
def roster() -> dict:
    book = catalog()
    return {
        "repeatAlpha": DEFAULT_REPEAT_ALPHA,
        "rows": ROW_LABELS,
        "columnsRight": COLUMNS_FOR_RIGHT,
        "columnsLeft": COLUMNS_FOR_LEFT,
        "strikeCells": [cell for cell in range(25) if is_strike_cell(cell)],
        "league": book.league_meta,
        "pitchers": [
            {
                "id": pitcher.player_id,
                "name": pitcher.name,
                "throws": pitcher.throws,
                "pitches": len(pitcher.pitches),
                "arsenal": [
                    {**row, "name": pitch_name(row["code"])}
                    for row in pitcher.arsenal
                ],
            }
            for pitcher in book.pitchers.values()
        ],
        "batters": [
            {
                "id": batter.player_id,
                "name": batter.name,
                "bats": batter.bats,
                "szTop": batter.sz_top,
                "szBot": batter.sz_bot,
                "pitches": len(batter.seen),
                "modelPitches": batter.train_pitches,
                "modelNote": batter.model_note,
            }
            for batter in book.batters.values()
        ],
    }


@app.post("/pitch")
def pitch(body: PitchRequest) -> dict:
    book = catalog()
    pitcher = book.pitchers.get(body.pitcherId)
    batter = book.batters.get(body.batterId)
    if pitcher is None or batter is None:
        raise HTTPException(404, "投手か打者がデータにありません")
    codes = {row["code"] for row in pitcher.arsenal}
    if body.pitchType not in codes:
        raise HTTPException(400, "その投手はこの球種を投げていません")
    try:
        return throw_pitch(
            pitcher.pitches,
            pitcher.name,
            pitcher.throws,
            batter.table,
            batter.pitches,
            book.league,
            batter.bats,
            batter.sz_bot,
            batter.sz_top,
            body.pitchType,
            body.cell,
            body.balls,
            body.strikes,
            [item.model_dump() for item in body.history],
            body.seed,
            body.pitchIndex,
            body.repeatAlpha,
        )
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


@app.get("/holdout")
def holdout(seed: int = HOLDOUT_SEED, n: int = HOLDOUT_PA, repeatAlpha: float = DEFAULT_REPEAT_ALPHA) -> dict:
    """学習年とテスト年を分けた比較。画面の 1 打席も、この学習年の判断を使う。"""
    if n < 1 or n > 5000:
        raise HTTPException(400, "打席数は 1 から 5000 です")
    book = catalog()
    key = (seed, n, round(repeatAlpha, 4))
    if key not in HOLDOUT:
        batters = [
            compare_batter(
                batter.name,
                batter.player_id,
                batter.model_note,
                batter.train_pitches,
                batter.seen,
                batter.table,
                batter.pitches,
                book.league,
                batter.sz_bot,
                batter.sz_top,
                n,
                seed,
                repeatAlpha,
            )
            for batter in book.batters.values()
        ]
        HOLDOUT[key] = {
            "seed": seed,
            "n": n,
            "repeatAlpha": repeatAlpha,
            "league": book.league_meta,
            "batters": batters,
        }
    return HOLDOUT[key]
