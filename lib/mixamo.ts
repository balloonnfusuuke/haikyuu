import type { AdvanceKind, Bases } from "@/lib/bases";
import { BASE_DISTANCE_FT, PLATE_SQUARE_CENTER_Y_FT, RUBBER_FRONT_FT } from "@/lib/field-constants";
import { FEET_TO_METERS } from "@/lib/coords";

export const HUMAN_URL = "/models/human_mixamo.glb";

export const HUMAN_CLIP = {
  pitch: "Pitch",
  pitchSpare: "MixamoPitch",
  bat: "MixamoBat",
  run: "MixamoRun",
} as const;

/** Pitch で球が手を離れる時刻。腕が最も速く、手が最も前に出たところ。 */
export const PITCH_RELEASE_S = 1.93;

/** Pitch のリリースで、右拳が足元の原点からどれだけ離れているか（メートル、モデルの +X 左・+Y 上・+Z 正面）。 */
export const PITCH_RELEASE_HAND_M = { x: -0.48, y: 1.59, z: 1.49 };

/** Pitch の軸足（右足）は原点の 0.12 m 後ろ。ここを投手板の前縁に付ける。 */
export const PITCH_PIVOT_BACK_M = 0.12;

/** MixamoBat でバットが投球線と直交する時刻。ここを tPlate に合わせる。 */
export const BAT_CONTACT_S = 1.4;
/** 振り始め。ここから BAT_CONTACT_S までを、データのスイング時間に伸び縮みさせる。 */
export const BAT_SWING_START_S = 1.2;
/** 見逃しは踏み込んだところで止める。 */
export const BAT_TAKE_HOLD_S = 1.12;
/** 空振りとファウルはフォロースルーで止め、走り出さない。 */
export const BAT_FOLLOW_END_S = 1.75;
/** 左打者は鏡に映すので、クリップの走り出しが三塁側へ向く。走り出す前に走者へ渡す。 */
export const BAT_LEFTY_HANDOFF_S = 1.9;

/** 帰塁から次の塁へ出ておく距離。 */
export const LEAD_OFF_M = 2.5;
/** 走り出してから最高速に乗るまで。 */
export const RUN_ACCEL_S = 0.9;
/** 打者走者はクリップの走り出しを引き継ぐので、少し速さを持って始まる。 */
export const BATTER_RUNNER_V0 = 2.5;

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** 投球なら、リリースより PITCH_RELEASE_S 前から再生する。打球だけのクリップはそのまま。 */
export function leadIn(clip: { kind: "pitch" | "batted"; tStart: number }): number {
  return clip.kind === "pitch" ? clip.tStart - PITCH_RELEASE_S : clip.tStart;
}

export function pitchClipTime(t: number, tStart: number, duration: number): number {
  return clamp(PITCH_RELEASE_S + (t - tStart), 0, Math.max(0, duration - 1e-4));
}

/**
 * MixamoBat の時刻。インパクトを tPlate に合わせ、振り始めからインパクトまでは
 * スイング時間に合わせて伸び縮みさせる。見逃しは踏み込みで止め、ファウルと空振りは
 * フォロースルーで止める。フェアのときだけ最後の走り出しまで流す。
 */
export function batClipTime(args: {
  t: number;
  tPlate: number | null;
  swing: { duration: number } | null;
  fair: boolean;
  duration: number;
  end?: number;
}): number {
  const last = Math.max(0, args.duration - 1e-4);
  if (args.tPlate == null) return 0;
  const rel = args.t - args.tPlate;
  if (!args.swing) {
    return clamp(BAT_CONTACT_S + rel, 0, BAT_TAKE_HOLD_S);
  }
  const swingClip = BAT_CONTACT_S - BAT_SWING_START_S;
  const swingData = Math.max(args.swing.duration, 0.04);
  const stop = args.fair ? Math.min(args.end ?? last, last) : BAT_FOLLOW_END_S;
  let time: number;
  if (rel < -swingData) time = BAT_SWING_START_S + (rel + swingData);
  else if (rel <= 0) time = BAT_CONTACT_S + rel * (swingClip / swingData);
  else time = BAT_CONTACT_S + rel;
  return clamp(time, 0, stop);
}

/**
 * MixamoBat の手首はスイングの途中で本物のバットほど返らない。構えとフォロースルーは
 * 指の付け根に沿って握り、インパクトの前後だけ投球線と直交する握りへ移す。その重み（0〜1）。
 */
export const BAT_GRIP_BLEND = { inStart: 1.3, inEnd: 1.38, outStart: 1.45, outEnd: 1.56 } as const;

export function batGripBlend(clipTime: number): number {
  const { inStart, inEnd, outStart, outEnd } = BAT_GRIP_BLEND;
  const smooth = (u: number) => {
    const x = clamp(u, 0, 1);
    return x * x * (3 - 2 * x);
  };
  if (clipTime <= outStart) return smooth((clipTime - inStart) / (inEnd - inStart));
  return 1 - smooth((clipTime - outStart) / (outEnd - outStart));
}

/** バットのクリップの時刻 handoff に着くのは、tPlate から何秒後か。 */
export function batHandoffDelay(handoff: number): number {
  return handoff - BAT_CONTACT_S;
}

/** キーフレームの値を時刻で線形補間する。size は 1 キーあたりの成分数。 */
export function sampleKeys(times: ArrayLike<number>, values: ArrayLike<number>, size: number, time: number): number[] {
  const count = times.length;
  const pick = (index: number) => Array.from({ length: size }, (_, k) => values[index * size + k]);
  if (count === 0) return new Array(size).fill(0);
  if (time <= times[0]) return pick(0);
  if (time >= times[count - 1]) return pick(count - 1);
  let hi = 1;
  while (times[hi] < time) hi += 1;
  const lo = hi - 1;
  const u = (time - times[lo]) / (times[hi] - times[lo] || 1);
  return Array.from({ length: size }, (_, k) => values[lo * size + k] + (values[hi * size + k] - values[lo * size + k]) * u);
}

/** ループするクリップの、根元の骨（Hips）の前進。時刻とその前進方向の値から作る。 */
export type LoopDrift = {
  /** 最初のキーの時刻。ループはここから始める。 */
  start: number;
  /** 1 周期の長さ（最初のキーから最後のキーまで）。 */
  period: number;
  /** 最初のキーでの前進方向の値。 */
  origin: number;
  /** 1 周期で進む距離。 */
  stride: number;
};

export function loopDrift(times: ArrayLike<number>, forward: ArrayLike<number>): LoopDrift {
  const last = times.length - 1;
  return {
    start: times[0],
    period: Math.max(times[last] - times[0], 1e-6),
    origin: forward[0],
    stride: forward[last] - forward[0],
  };
}

/**
 * 進んだ距離から、クリップの時刻と、その時刻で Hips から引く前進量を出す。
 * cancel を引いた Hips は 1 周期のあいだ同じ場所で揺れるだけになり、継ぎ目で戻らない。
 */
export function runPhase(distance: number, drift: LoopDrift): { time: number; cancel: number } {
  const stride = Math.abs(drift.stride) > 1e-6 ? Math.abs(drift.stride) : 1;
  const cycles = Math.max(0, distance) / stride;
  const u = cycles - Math.floor(cycles);
  return { time: drift.start + u * drift.period, cancel: drift.stride * u };
}

export function runSpeed(drift: LoopDrift): number {
  return Math.abs(drift.stride) / drift.period;
}

/** 走り出してから tau 秒で進む距離。v0 から vmax まで RUN_ACCEL_S かけて上げ、length で止まる。 */
export function runDistance(tau: number, length: number, vmax: number, v0 = 0): number {
  if (tau <= 0) return 0;
  const accel = Math.max(RUN_ACCEL_S * (1 - v0 / Math.max(vmax, 1e-6)), 0);
  let s: number;
  if (accel <= 1e-6 || tau >= accel) {
    const a = accel > 1e-6 ? (vmax - v0) / accel : 0;
    const ramp = v0 * accel + 0.5 * a * accel * accel;
    s = ramp + vmax * (tau - accel);
  } else {
    const a = (vmax - v0) / accel;
    s = v0 * tau + 0.5 * a * tau * tau;
  }
  return Math.min(s, length);
}

/** runDistance で length に着くまでの秒数。 */
export function runDuration(length: number, vmax: number, v0 = 0): number {
  const accel = Math.max(RUN_ACCEL_S * (1 - v0 / Math.max(vmax, 1e-6)), 0);
  const a = accel > 1e-6 ? (vmax - v0) / accel : 0;
  const ramp = v0 * accel + 0.5 * a * accel * accel;
  if (length >= ramp) return accel + (length - ramp) / vmax;
  if (a > 1e-9) return (-v0 + Math.sqrt(v0 * v0 + 2 * a * length)) / a;
  return length / Math.max(v0, 1e-6);
}

export type Point = { x: number; y: number };

/** 塁の位置（Statcast のフィート、地面）。0 と 4 はホーム。 */
export function basePoint(base: number): Point {
  const corner = BASE_DISTANCE_FT * Math.SQRT1_2;
  switch (base) {
    case 1:
      return { x: corner, y: corner };
    case 2:
      return { x: 0, y: BASE_DISTANCE_FT * Math.SQRT2 };
    case 3:
      return { x: -corner, y: corner };
    default:
      return { x: 0, y: PLATE_SQUARE_CENTER_Y_FT };
  }
}

/** 塁から次の塁へ LEAD_OFF_M 出た位置。 */
export function leadOffPoint(base: number): Point {
  const from = basePoint(base);
  const to = basePoint(base + 1);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const lead = LEAD_OFF_M / FEET_TO_METERS;
  return { x: from.x + (dx / length) * lead, y: from.y + (dy / length) * lead };
}

export type RunnerRun = {
  /** 0 は打者。1〜3 は塁上の走者。 */
  from: number;
  /** 着く塁。4 は本塁。 */
  to: number;
  /** 凡打の打者走者。一塁に着いたらベンチへ下がる。 */
  out?: true;
};

const HIT_BASES: Partial<Record<AdvanceKind, number>> = {
  single: 1,
  double: 2,
  triple: 3,
  home_run: 4,
};

/**
 * 打球が出たときの走者の動き。安打は全員がその塁数だけ進み、凡打は打者だけが一塁へ走る。
 * 四球と三振は投球のあとすぐ終わるので、走る場面を作らない。
 */
export function runnerRuns(bases: Bases, advance: AdvanceKind | null, inPlay: boolean): RunnerRun[] {
  const onBase = [bases.first ? 1 : 0, bases.second ? 2 : 0, bases.third ? 3 : 0].filter((base) => base > 0);
  if (!inPlay || advance == null || advance === "walk") return onBase.map((base) => ({ from: base, to: base }));
  const step = HIT_BASES[advance];
  if (step == null) return [...onBase.map((base) => ({ from: base, to: base })), { from: 0, to: 1, out: true }];
  return [...onBase.map((base) => ({ from: base, to: Math.min(base + step, 4) })), { from: 0, to: step }];
}

/** 出発点から、通る塁を順にたどる折れ線。 */
export function runnerPath(start: Point, from: number, to: number): Point[] {
  const points = [start];
  for (let base = Math.max(from, 0) + 1; base <= to; base += 1) points.push(basePoint(base));
  return points;
}

export function pathLengthFt(points: Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return total;
}

export function pointAlong(points: Point[], distanceFt: number): Point {
  if (points.length === 1) return points[0];
  let left = Math.max(0, distanceFt);
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= length || index === points.length - 1) {
      const u = length > 1e-9 ? Math.min(left / length, 1) : 1;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
    left -= length;
  }
  return points[points.length - 1];
}

/** 角で急に向きを変えないよう、前後を少し見て進む向きを決める。 */
export function headingAlong(points: Point[], distanceFt: number, lookFt = 4): Point {
  const total = pathLengthFt(points);
  const behind = pointAlong(points, Math.max(0, Math.min(distanceFt, total) - lookFt));
  const ahead = pointAlong(points, Math.min(total, distanceFt + lookFt));
  const dx = ahead.x - behind.x;
  const dy = ahead.y - behind.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    const last = points[points.length - 1];
    const prev = points[Math.max(0, points.length - 2)];
    const fx = last.x - prev.x;
    const fy = last.y - prev.y;
    const fl = Math.hypot(fx, fy) || 1;
    return { x: fx / fl, y: fy / fl };
  }
  return { x: dx / length, y: dy / length };
}

/**
 * 投手の足元（モデルの原点）を置く Statcast の位置。軸足を投手板の前縁に付け、
 * 左右はリリースの手が記録のリリース位置に来るよう寄せる。投手板からは外さない。
 */
export function pitcherFeet(release: { x: number } | null, throws: "R" | "L" | null): Point {
  const side = throws === "L" ? -1 : 1;
  const handX = (PITCH_RELEASE_HAND_M.x / FEET_TO_METERS) * side;
  const x = release ? clamp(release.x - handX, -1.2, 1.2) : 0;
  const footHalf = 0.16;
  return { x, y: RUBBER_FRONT_FT - footHalf - PITCH_PIVOT_BACK_M / FEET_TO_METERS };
}
