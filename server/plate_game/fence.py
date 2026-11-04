"""甲子園モデルの外野フェンス。data/koshien-fence.json は球場メッシュの内野側の面。"""

from __future__ import annotations

import json
import math
from functools import cache
from pathlib import Path

_PATH = Path(__file__).resolve().parents[2] / "data" / "koshien-fence.json"


@cache
def _table() -> dict:
    return json.loads(_PATH.read_text())


def fence_height_ft() -> float:
    return float(_table()["heightFt"])


def fence_distance(angle_deg: float) -> float:
    data = _table()["distanceFt"]
    foul = float(_table()["foulDeg"])
    clamped = min(foul, max(-foul, angle_deg))
    index = clamped + foul
    lower = int(index)
    upper = min(len(data) - 1, lower + 1)
    span = index - lower
    return data[lower] + (data[upper] - data[lower]) * span


def spray_angle(x: float, y: float) -> float:
    return math.degrees(math.atan2(x, y))
