import type { FieldFrame, Vec3 } from "./coords";

/** 当たってから歩き出すまでの間。打球を見てから動き出す。 */
export const CONVICTION_DELAY_S = 0.4;
/** 確信歩きの速さ。走りではなく、ゆったりした歩行。 */
export const CONVICTION_SPEED_M_S = 1.2;
/** 一塁方向へ進む距離。ベースまで走らない。 */
export const CONVICTION_DISTANCE_M = 7.5;
const ACCEL_S = 0.7;
const STEP_M = 0.64;
const BOB_M = 0.02;

export function convictionDistance(elapsed: number): number {
  if (elapsed <= 0) return 0;
  const speed = CONVICTION_SPEED_M_S;
  const raw =
    elapsed < ACCEL_S
      ? (speed * elapsed * elapsed) / (2 * ACCEL_S)
      : speed * (ACCEL_S / 2 + (elapsed - ACCEL_S));
  return Math.min(CONVICTION_DISTANCE_M, raw);
}

/** 歩き始めと止まりでは 0。途中だけ足の上下。 */
export function convictionBob(distanceM: number): number {
  if (distanceM <= 0 || distanceM >= CONVICTION_DISTANCE_M - 1e-4) return 0;
  const along = Math.min(1, distanceM / CONVICTION_DISTANCE_M);
  const envelope = Math.sin(Math.PI * along);
  return Math.sin((distanceM / STEP_M) * Math.PI * 2) * BOB_M * envelope;
}

export function convictionTravel(args: {
  preset: string;
  homeRun: boolean;
  hit: boolean;
  t: number;
  tContact: number | null;
}): { distanceM: number; bobM: number } {
  const batter = args.preset === "rhh" || args.preset === "lhh";
  if (!batter || !args.homeRun || !args.hit || args.tContact == null) {
    return { distanceM: 0, bobM: 0 };
  }
  const distanceM = convictionDistance(args.t - args.tContact - CONVICTION_DELAY_S);
  return { distanceM, bobM: convictionBob(distanceM) };
}

/** 一塁方向（ファウルライン）への移動。right が一塁側、forward が投手方向。 */
export function convictionOffset(frame: FieldFrame, distanceM: number, bobM: number): Vec3 {
  const along = distanceM * Math.SQRT1_2;
  return {
    x: frame.right.x * along + frame.forward.x * along + frame.up.x * bobM,
    y: frame.right.y * along + frame.forward.y * along + frame.up.y * bobM,
    z: frame.right.z * along + frame.forward.z * along + frame.up.z * bobM,
  };
}
