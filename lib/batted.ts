export type BattedSample = { t: number; x: number; y: number; z: number };

export type BattedBallInput = {
  x: number;
  y: number;
  z: number;
  speedMph: number;
  /** 水平面から上への角度。 */
  launchDeg: number;
  /** 0 が投手方向。正が捕手から見て右（一塁・右翼側）。 */
  sprayDeg: number;
};

const GRAVITY_FT = -32.174;
/** 速度に比例する抗力係数。|a| = k |v|^2。100mph・仰角 15° 前後で外野まで届く値。 */
const DRAG_K = 0.00128;
const FTPS_PER_MPH = 5280 / 3600;

/**
 * 打球を Statcast フィートで積分する。描画側が statcastToWorld に通す。
 * 着地は z = 0 を跨いだサンプル。
 */
export function integrateBattedBall(input: BattedBallInput): {
  samples: BattedSample[];
  landing: BattedSample;
} {
  const speed = input.speedMph * FTPS_PER_MPH;
  const launch = (input.launchDeg * Math.PI) / 180;
  const spray = (input.sprayDeg * Math.PI) / 180;
  const horizontal = speed * Math.cos(launch);
  let x = input.x;
  let y = input.y;
  let z = input.z;
  let vx = horizontal * Math.sin(spray);
  let vy = horizontal * Math.cos(spray);
  let vz = speed * Math.sin(launch);
  const dt = 0.01;
  const samples: BattedSample[] = [];

  for (let t = 0; t <= 8; t += dt) {
    samples.push({ t, x, y, z: z < 0 ? 0 : z });
    if (t > 0 && z <= 0) break;
    const v = Math.hypot(vx, vy, vz);
    const drag = DRAG_K * v;
    vx += -drag * vx * dt;
    vy += -drag * vy * dt;
    vz += (-drag * vz + GRAVITY_FT) * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
  }

  const landing = samples[samples.length - 1] ?? { t: 0, x: input.x, y: input.y, z: 0 };
  if (landing.z < 0) landing.z = 0;
  return { samples, landing };
}
