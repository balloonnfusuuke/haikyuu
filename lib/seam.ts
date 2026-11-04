import type { Vec3 } from "./coords";

/**
 * ボールモデルの縫い目。
 * ローカル +X まわりの回転がフォーシーム、+Y まわりがツーシームに見える。
 * pitch_type でその軸を選び、その後 spin_axis と release_spin_rate で回す。
 */
export type SeamKind = "four" | "two";

const TWO_SEAM = new Set(["SI", "FT"]);

export function seamKind(pitchType: string | null | undefined): SeamKind {
  if (pitchType && TWO_SEAM.has(pitchType)) return "two";
  return "four";
}

export function seamAxis(pitchType: string | null | undefined): Vec3 {
  return seamKind(pitchType) === "two" ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
}
