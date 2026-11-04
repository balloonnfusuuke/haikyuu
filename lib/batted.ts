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
const HC_ORIGIN_X = 125.42;
const HC_ORIGIN_Y = 198.27;
const HC_FEET_PER_UNIT = 2.5;

/** Statcast の hc_x / hc_y を、本塁を原点にしたフィートにする。 */
export function hcToFeet(hcX: number, hcY: number): { x: number; y: number } {
  return {
    x: HC_FEET_PER_UNIT * (hcX - HC_ORIGIN_X),
    y: HC_FEET_PER_UNIT * (HC_ORIGIN_Y - hcY),
  };
}
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

export type ContactFlightInput = {
  x: number;
  y: number;
  z: number;
  speedMph: number;
  launchDeg: number;
  /** 落下させたい地点。hc をフィートにしたもの。 */
  targetX: number;
  targetY: number;
  /** ゴロは跳ねて、この地点まで転がす。 */
  ground: boolean;
};

function horizontalDistance(x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot(x1 - x0, y1 - y0);
}

function fly(input: ContactFlightInput, drag: number, rollTo: number | null): { samples: BattedSample[]; landing: BattedSample } {
  const speed = input.speedMph * FTPS_PER_MPH;
  const launch = (input.launchDeg * Math.PI) / 180;
  const dx = input.targetX - input.x;
  const dy = input.targetY - input.y;
  const flat = Math.hypot(dx, dy) || 1;
  const horizontal = speed * Math.cos(launch);
  let x = input.x;
  let y = input.y;
  let z = input.z;
  let vx = (horizontal * dx) / flat;
  let vy = (horizontal * dy) / flat;
  let vz = speed * Math.sin(launch);
  const dt = 0.01;
  const samples: BattedSample[] = [];
  let bounced = false;
  let airborne = true;
  const goal = rollTo ?? horizontalDistance(input.x, input.y, input.targetX, input.targetY);

  for (let t = 0; t <= 8; t += dt) {
    const traveled = horizontalDistance(input.x, input.y, x, y);
    if (rollTo != null && bounced && traveled >= goal) {
      const scale = goal / traveled;
      x = input.x + (x - input.x) * scale;
      y = input.y + (y - input.y) * scale;
      z = 0;
      samples.push({ t, x, y, z });
      break;
    }
    samples.push({ t, x, y, z: z < 0 ? 0 : z });
    if (t > 0 && z <= 0 && rollTo == null) break;
    const v = Math.hypot(vx, vy, vz);
    const dragA = drag * v;
    vx += -dragA * vx * dt;
    vy += -dragA * vy * dt;
    vz += (-dragA * vz + GRAVITY_FT) * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    if (rollTo != null && z <= 0) {
      z = 0;
      if (airborne) {
        airborne = false;
        if (!bounced) {
          const remain = Math.max(0, goal - horizontalDistance(input.x, input.y, x, y));
          const pace = Math.max(18, remain / 1.8);
          const flat = Math.hypot(vx, vy) || 1;
          vx = (vx / flat) * pace;
          vy = (vy / flat) * pace;
          vz = Math.abs(vz) * 0.55;
          bounced = true;
        } else {
          vz = Math.abs(vz) * 0.35;
          vx *= 0.9;
          vy *= 0.9;
        }
      } else {
        vz = 0;
      }
    } else if (z > 0) {
      airborne = true;
    }
  }
  const landing = samples[samples.length - 1] ?? { t: 0, x: input.x, y: input.y, z: 0 };
  landing.z = Math.max(0, landing.z);
  return { samples, landing };
}

function airRange(input: ContactFlightInput, drag: number): number {
  const flown = fly({ ...input, ground: false }, drag, null);
  return horizontalDistance(input.x, input.y, flown.landing.x, flown.landing.y);
}

/** 初速と角度は実測のまま、抗力だけを変えて落下距離を hc に合わせる。 */
export function dragForDistance(input: ContactFlightInput, targetFt: number): number {
  let low = 0.00004;
  let high = 0.008;
  for (let step = 0; step < 18; step += 1) {
    const mid = (low + high) / 2;
    if (airRange(input, mid) > targetFt) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * 実測の落下点へ飛ばす。ゴロは一度落としてから hc まで転がす。
 * 初速・角度・方向は実測で、変えるのは抗力だけ。
 */
export function integrateContact(input: ContactFlightInput): { samples: BattedSample[]; landing: BattedSample } {
  const target = horizontalDistance(input.x, input.y, input.targetX, input.targetY);
  if (input.ground) return fly(input, DRAG_K, Math.max(target, 1));
  const drag = dragForDistance(input, Math.max(target, 1));
  return fly(input, drag, null);
}
