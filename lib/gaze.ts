import { sampleAt, type Clip } from "./clips";

/** 打球の少し先を見る。単位は秒。 */
export const GAZE_LEAD_S = 0.16;
/** 当たってから顔を向け始めるまでの間。 */
export const GAZE_REACTION_S = 0.15;
/** 顔を向ける速さの上限。度/秒。 */
export const GAZE_MAX_DEG_PER_S = 120;

const GAZE_EASE = 5.5;
const GAZE_MIN_M = 2.5;
const GAZE_MAX_M = 150;

export type GazePoint = { x: number; y: number; z: number };

type GazeClip = Pick<Clip, "kind" | "noise" | "tPlate" | "tStart" | "tEnd" | "samples">;

/** インプレーとファウルの打球だけを追う。投球中・見逃し・空振りは追わない。 */
export function gazeTracking(clip: GazeClip, t: number): boolean {
  if (clip.kind === "batted") return t + 1e-9 >= clip.tStart + GAZE_REACTION_S;
  if (clip.noise !== "hit" || clip.tPlate == null) return false;
  return t + 1e-9 >= clip.tPlate + GAZE_REACTION_S;
}

/** 今の打球位置より少し先。止まったあとは落下点。 */
export function gazeSample(clip: GazeClip, t: number) {
  if (!gazeTracking(clip, t) || clip.samples.length === 0) return null;
  return sampleAt(clip.samples, Math.min(clip.tEnd, t + GAZE_LEAD_S));
}

function sub(a: GazePoint, b: GazePoint): GazePoint {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: GazePoint, b: GazePoint): GazePoint {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: GazePoint, s: number): GazePoint {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: GazePoint, b: GazePoint): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function len(a: GazePoint): number {
  return Math.hypot(a.x, a.y, a.z);
}

function norm(a: GazePoint): GazePoint {
  const l = len(a) || 1;
  return scale(a, 1 / l);
}

function cross(a: GazePoint, b: GazePoint): GazePoint {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** カメラから見た2点のなす角（度）。 */
export function lookAngleDeg(camera: GazePoint, from: GazePoint, to: GazePoint): number {
  const a = sub(from, camera);
  const b = sub(to, camera);
  const la = len(a);
  const lb = len(b);
  if (la < 1e-8 || lb < 1e-8) return 0;
  const cos = Math.min(1, Math.max(-1, dot(a, b) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * カメラの位置は動かさず、見ている点だけを目的へ回す。
 * focus が null のときは rest（プレート）へ戻す。
 * 1フレームの回転は maxDegPerSec を超えない。
 */
export function stepGaze(args: {
  camera: GazePoint;
  target: GazePoint;
  rest: GazePoint;
  focus: GazePoint | null;
  dt: number;
  maxDegPerSec?: number;
}): GazePoint {
  const dt = Math.min(Math.max(args.dt, 0), 0.5);
  const desired = args.focus ?? args.rest;
  const from = sub(args.target, args.camera);
  const to = sub(desired, args.camera);
  const fromLen = len(from);
  const toLen = len(to);
  if (toLen < 1e-5) return { ...args.rest };
  if (fromLen < 1e-5) {
    if (len(sub(args.rest, args.camera)) < 1e-5) return { ...desired };
    return stepGaze({ ...args, target: args.rest });
  }
  const a = scale(from, 1 / fromLen);
  const b = scale(to, 1 / toLen);
  const cos = Math.min(1, Math.max(-1, dot(a, b)));
  const angle = Math.acos(cos);
  const maxDeg = args.maxDegPerSec ?? GAZE_MAX_DEG_PER_S;
  const maxRad = ((maxDeg * Math.PI) / 180) * dt;
  const eased = angle * (1 - Math.exp(-GAZE_EASE * dt));
  const step = Math.min(angle, maxRad, eased);
  let dir: GazePoint;
  if (angle < 1e-4) {
    dir = b;
  } else {
    const along = step / angle;
    const sin = Math.sin(angle);
    if (sin < 1e-5) {
      const axis = Math.abs(a.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      const perp = norm(cross(a, axis));
      dir = norm(add(scale(a, Math.cos(step)), scale(perp, Math.sin(step))));
    } else {
      const w1 = Math.sin((1 - along) * angle) / sin;
      const w2 = Math.sin(along * angle) / sin;
      dir = norm(add(scale(a, w1), scale(b, w2)));
    }
  }
  const distWant = Math.min(Math.max(toLen, GAZE_MIN_M), GAZE_MAX_M);
  const along = angle < 1e-4 ? 1 : step / angle;
  const dist = Math.min(Math.max(fromLen + (distWant - fromLen) * along, GAZE_MIN_M), GAZE_MAX_M);
  return add(args.camera, scale(dir, dist));
}
