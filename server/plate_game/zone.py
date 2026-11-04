"""捕手から見た 5×5。内側の 3×3 がストライク、外周がボールゾーン。"""

from __future__ import annotations

import math

PLATE_HALF_FT = 8.5 / 12
BALL_RADIUS_FT = (9.125 / 12) / (2 * math.pi)
# 球の中心がプレート幅＋球の半径に入れば、球のどこかがゾーンに掛かる。
STRIKE_HALF_FT = PLATE_HALF_FT + BALL_RADIUS_FT

ROWS = 5
COLS = 5


def column_edges() -> list[float]:
    width = (2 * PLATE_HALF_FT) / 3
    left = -PLATE_HALF_FT
    return [left - width, left, left + width, left + 2 * width, left + 3 * width, left + 4 * width]


def row_edges(sz_bot: float, sz_top: float) -> list[float]:
    height = max(sz_top - sz_bot, 0.9)
    band = height / 3
    return [sz_bot - band, sz_bot, sz_bot + band, sz_bot + 2 * band, sz_top, sz_top + band]


def cell_center(cell: int, sz_bot: float, sz_top: float) -> tuple[float, float]:
    row, col = divmod(cell, COLS)
    xs = column_edges()
    zs = row_edges(sz_bot, sz_top)
    # 行 0 が最も高い。
    band = (ROWS - 1) - row
    return (xs[col] + xs[col + 1]) / 2, (zs[band] + zs[band + 1]) / 2


def cell_for(plate_x: float, plate_z: float, sz_bot: float, sz_top: float) -> int:
    """5×5 の外に出た球は、一番外側のマスに寄せる。"""
    xs = column_edges()
    zs = row_edges(sz_bot, sz_top)
    col = 0
    for index in range(COLS):
        if plate_x < xs[index + 1] or index == COLS - 1:
            col = index
            break
    band = 0
    for index in range(ROWS):
        if plate_z < zs[index + 1] or index == ROWS - 1:
            band = index
            break
    row = (ROWS - 1) - band
    return row * COLS + col


def is_strike_location(plate_x: float, plate_z: float, sz_bot: float, sz_top: float) -> bool:
    return abs(plate_x) <= STRIKE_HALF_FT and sz_bot <= plate_z <= sz_top


def is_strike_cell(cell: int) -> bool:
    row, col = divmod(cell, COLS)
    return 1 <= row <= 3 and 1 <= col <= 3


ROW_LABELS = ["ボール高め", "高め", "真中", "低め", "ボール低め"]
# 捕手から見て左が負の plate_x（三塁側）。右打者の内角は負の x。
COLUMNS_FOR_RIGHT = ["ボール内", "内", "中", "外", "ボール外"]
COLUMNS_FOR_LEFT = ["ボール外", "外", "中", "内", "ボール内"]


def cell_label(cell: int, bats: str) -> str:
    row, col = divmod(cell, COLS)
    columns = COLUMNS_FOR_RIGHT if bats == "R" else COLUMNS_FOR_LEFT
    height = ROW_LABELS[row]
    side = columns[col]
    if height.startswith("ボール") and side.startswith("ボール"):
        return f"{height}・{side.removeprefix('ボール')}"
    return f"{height}・{side}"
