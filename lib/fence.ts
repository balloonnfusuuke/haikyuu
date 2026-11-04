import fence from "@/data/koshien-fence.json";

/** 甲子園モデルの外野フェンス。-45° が左翼線、0 が中堅、45° が右翼線。距離は内野側の面。 */
export const FENCE_HEIGHT_FT = fence.heightFt;
export const FENCE_FOUL_DEG = fence.foulDeg;
const DISTANCE_FT = fence.distanceFt;

/** フェアの角度にあるフェンスまでの距離（フィート）。線の外はポールの距離に止める。 */
export function fenceDistance(angleDeg: number): number {
  const clamped = Math.min(FENCE_FOUL_DEG, Math.max(-FENCE_FOUL_DEG, angleDeg));
  const index = clamped + FENCE_FOUL_DEG;
  const lower = Math.floor(index);
  const upper = Math.min(DISTANCE_FT.length - 1, lower + 1);
  const span = index - lower;
  return DISTANCE_FT[lower] + (DISTANCE_FT[upper] - DISTANCE_FT[lower]) * span;
}

export function sprayAngle(x: number, y: number): number {
  return (Math.atan2(x, y) * 180) / Math.PI;
}
