import { PLATE_FRONT_FT } from "./field-constants";

/**
 * Statcast の等加速度モデル。
 * vx0, vy0, vz0, ax, ay, az は y = 50 ft の時点。+y は投手方向なので、
 * ホームへ向かう球の vy0 は負、抗力の ay は正になる。
 * t = 0 が y = 50 ft。リリースは t < 0、プレート前端は t > 0。
 */

export type PitchKinematics = {
  releaseX: number;
  releaseY: number;
  releaseZ: number;
  vx0: number;
  vy0: number;
  vz0: number;
  ax: number;
  ay: number;
  az: number;
};

export type VecSample = { x: number; y: number; z: number };

/** y(t) = yRef + vy t + 0.5 ay t^2 が yTarget になる、y が減少している側の時刻。 */
export function timeAtY(yTarget: number, yRef: number, vy: number, ay: number): number {
  const a = 0.5 * ay;
  const b = vy;
  const c = yRef - yTarget;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-9) {
      throw new Error("この y に到達する時刻が決まりません");
    }
    return -c / b;
  }
  let disc = b * b - 4 * a * c;
  if (disc < 0 && disc > -1e-6) disc = 0;
  if (disc < 0) {
    throw new Error("指定の y を通る実数時刻がありません");
  }
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  // ay > 0 の放物線では、小さい方の根がホームへ向かって y が減る側。
  return Math.min(t1, t2);
}

export type PitchSolution = {
  tRelease: number;
  tPlate: number;
  x0: number;
  z0: number;
  position: (t: number) => VecSample;
  velocity: (t: number) => VecSample;
};

export function solvePitch(k: PitchKinematics): PitchSolution {
  const tRelease = timeAtY(k.releaseY, 50, k.vy0, k.ay);
  const x0 = k.releaseX - k.vx0 * tRelease - 0.5 * k.ax * tRelease * tRelease;
  const z0 = k.releaseZ - k.vz0 * tRelease - 0.5 * k.az * tRelease * tRelease;
  const position = (t: number): VecSample => ({
    x: x0 + k.vx0 * t + 0.5 * k.ax * t * t,
    y: 50 + k.vy0 * t + 0.5 * k.ay * t * t,
    z: z0 + k.vz0 * t + 0.5 * k.az * t * t,
  });
  const velocity = (t: number): VecSample => ({
    x: k.vx0 + k.ax * t,
    y: k.vy0 + k.ay * t,
    z: k.vz0 + k.az * t,
  });
  const tPlate = timeAtY(PLATE_FRONT_FT, 50, k.vy0, k.ay);
  return { tRelease, tPlate, x0, z0, position, velocity };
}

export const FT_PER_SEC_TO_MPH = 3600 / 5280;

export function speedMph(v: VecSample): number {
  return Math.hypot(v.x, v.y, v.z) * FT_PER_SEC_TO_MPH;
}
