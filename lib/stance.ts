import { FEET_TO_METERS } from "@/lib/coords";
import {
  BOX_INSIDE_FT,
  BOX_WIDTH_FT,
  CATCHER_CAM_BACK_M,
  PLATE_SQUARE_CENTER_Y_FT,
} from "@/lib/field-constants";

/** 仮の打者の胴体。手の高さは、この胴の上端に合わせる。 */
export const FIGURE_BODY_RADIUS_M = 0.2;
export const FIGURE_BODY_LENGTH_M = 0.82;

const HAND_Z_FT = (FIGURE_BODY_LENGTH_M + FIGURE_BODY_RADIUS_M) / FEET_TO_METERS;
const HAND_INTO_BOX_FT = 0.55;
const HAND_FORWARD_FT = 0.35;

/** 捕手カメラからプレートへ 4 割進んだ深さ。画面の手前、ゾーンよりカメラ側にミットが来る。 */
export const MITT_SETUP_Y_FT = -(CATCHER_CAM_BACK_M / FEET_TO_METERS) * 0.42;

/** 投球中、ゾーンの下へずらす量。 */
export const MITT_DROP_FT = 1.05;

const MOVE_S = 0.14;
const CLOSE_S = 0.05;
export const MITT_GHOST_OPACITY = 0.32;

export function batterFeet(bats: "R" | "L"): { x: number; y: number; z: number } {
  const side = bats === "L" ? 1 : -1;
  return {
    x: side * (BOX_INSIDE_FT + BOX_WIDTH_FT / 2),
    y: PLATE_SQUARE_CENTER_Y_FT,
    z: 0,
  };
}

/** グリップ下端を置く手。グリップの長さはモデルのマーカー間隔を使う。 */
export function handBottom(bats: "R" | "L"): { x: number; y: number; z: number } {
  const side = bats === "L" ? 1 : -1;
  return {
    x: side * (BOX_INSIDE_FT + HAND_INTO_BOX_FT),
    y: PLATE_SQUARE_CENTER_Y_FT + HAND_FORWARD_FT,
    z: HAND_Z_FT,
  };
}

/** グリップ下端から上端への向き。左打者は左右を反転し、バットを反対の肩へ向ける。 */
export function gripDirection(bats: "R" | "L"): { x: number; y: number; z: number } {
  const away = (bats === "L" ? 1 : -1) * 0.22;
  const x = away;
  const y = -0.3;
  const z = 0.93;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

const FOLLOW_S = 0.45;

function unit(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function mix(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  u: number,
): { x: number; y: number; z: number } {
  return unit(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u);
}

/**
 * グリップを軸に、構えから打球点へ振る。インパクトは tPlate。
 * 空振りは球の 0.55 ft 下を通す。振り終わると構えに戻る。
 */
export function swingDirection(args: {
  bats: "R" | "L";
  t: number;
  tPlate: number | null;
  duration: number;
  miss: boolean;
  ball: { x: number; y: number; z: number } | null;
}): { x: number; y: number; z: number } {
  const ready = gripDirection(args.bats);
  if (args.tPlate == null || args.ball == null) return ready;
  const hand = handBottom(args.bats);
  const aim = unit(
    args.ball.x - hand.x,
    args.ball.y - hand.y,
    args.ball.z - (args.miss ? 0.55 : 0) - hand.z,
  );
  const start = args.tPlate - Math.max(args.duration, 0.04);
  if (args.t < start) return ready;
  if (args.t <= args.tPlate) {
    return mix(ready, aim, smooth((args.t - start) / (args.tPlate - start)));
  }
  if (args.t <= args.tPlate + FOLLOW_S) {
    const u = (args.t - args.tPlate) / FOLLOW_S;
    const follow = unit(aim.x * 0.35 + ready.x, aim.y * 0.2 + 0.45, aim.z * 0.35 + ready.z * 0.35);
    if (u < 0.35) return mix(aim, follow, u / 0.35);
    return mix(follow, ready, (u - 0.35) / 0.65);
  }
  return ready;
}

export type MittPlace = {
  x: number;
  y: number;
  z: number;
  close: number;
  opacity: number;
};

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function smooth(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

/**
 * 構えは配球のコース。捕る結果だけ、プレートの手前で実際の到達位置へ寄せ、Close を上げる。
 */
export function mittPlace(args: {
  t: number;
  tStart: number;
  tPlate: number | null;
  calledX: number;
  calledZ: number;
  arriveX: number;
  arriveY: number;
  arriveZ: number;
  outcome: string | null;
  drop: boolean;
  ghost: boolean;
  catches: boolean;
}): MittPlace {
  const { t, tStart, tPlate } = args;
  const inFlight = tPlate != null && t > tStart + 1e-3 && t < tPlate - 1e-3;
  const dropped = args.drop && inFlight;
  const setup = {
    x: args.calledX,
    y: MITT_SETUP_Y_FT,
    z: args.calledZ - (dropped ? MITT_DROP_FT : 0),
  };
  let place = setup;
  let close = 0;
  if (args.catches && tPlate != null) {
    const start = tPlate - MOVE_S;
    if (t >= tPlate) {
      place = { x: args.arriveX, y: args.arriveY, z: args.arriveZ };
      close = 1;
    } else if (t > start) {
      const u = smooth((t - start) / MOVE_S);
      place = {
        x: lerp(setup.x, args.arriveX, u),
        y: lerp(setup.y, args.arriveY, u),
        z: lerp(setup.z, args.arriveZ, u),
      };
      if (t > tPlate - CLOSE_S) close = Math.min(1, Math.max(0, (t - (tPlate - CLOSE_S)) / CLOSE_S));
    }
  }
  const fading = args.ghost && inFlight && close < 1;
  return { ...place, close, opacity: fading ? MITT_GHOST_OPACITY : 1 };
}
