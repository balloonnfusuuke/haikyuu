import { PLATE_HALF_WIDTH_FT } from "@/lib/field-constants";

const ROWS = 5;
const COLS = 5;

function columnEdges(): number[] {
  const width = (2 * PLATE_HALF_WIDTH_FT) / 3;
  const left = -PLATE_HALF_WIDTH_FT;
  return [left - width, left, left + width, left + 2 * width, left + 3 * width, left + 4 * width];
}

function rowEdges(szBot: number, szTop: number): number[] {
  const height = Math.max(szTop - szBot, 0.9);
  const band = height / 3;
  return [szBot - band, szBot, szBot + band, szBot + 2 * band, szTop, szTop + band];
}

/** 5×5 のマス中心。行 0 が最も高い。単位はフィート。 */
export function cellCenter(cell: number, szBot: number, szTop: number): [number, number] {
  const rect = cellRect(cell, szBot, szTop);
  return [(rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2];
}

/** マスの境界。x は捕手から見て右が正、z は高さ。行 0 が最も高い。 */
export function cellRect(
  cell: number,
  szBot: number,
  szTop: number,
): { x0: number; x1: number; z0: number; z1: number } {
  const row = Math.floor(cell / COLS);
  const col = cell % COLS;
  const xs = columnEdges();
  const zs = rowEdges(szBot, szTop);
  const band = ROWS - 1 - row;
  return { x0: xs[col], x1: xs[col + 1], z0: zs[band], z1: zs[band + 1] };
}
