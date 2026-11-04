import { integrateContact, type BattedSample } from "@/lib/batted";
import { FENCE_HEIGHT_FT, fenceDistance, sprayAngle } from "@/lib/fence";

export type ParkHow = "home_run" | "catch" | "wall" | "hit";

export type ParkPlay = {
  bip: "out" | "single" | "double" | "triple" | "home_run";
  how: ParkHow;
  fielder: string | null;
  cleared: boolean;
  carryFt: number;
  fenceFt: number;
  heightFt: number | null;
  landingFt: number;
  note: string;
  label: string;
};

export type FairBallInput = {
  x: number;
  y: number;
  z: number;
  speedMph: number;
  launchDeg: number;
  /** 本塁を原点にした落下方向。ゴロはここまで、フライは距離だけ carryFt に伸ばす。 */
  aimX: number;
  aimY: number;
  carryFt: number;
  ground: boolean;
  bbType?: string | null;
};

type Fielder = { name: string; x: number; y: number; speed: number; reaction: number; cap: number };

const INFIELD: Fielder[] = [
  { name: "投手", x: 0, y: 55, speed: 24, reaction: 0.18, cap: 70 },
  { name: "捕手", x: 0, y: -3, speed: 17, reaction: 0.25, cap: 48 },
  { name: "一塁", x: 58, y: 78, speed: 27, reaction: 0.28, cap: 85 },
  { name: "二塁", x: 46, y: 148, speed: 28, reaction: 0.3, cap: 100 },
  { name: "遊撃", x: -46, y: 148, speed: 28, reaction: 0.3, cap: 100 },
  { name: "三塁", x: -58, y: 78, speed: 27, reaction: 0.28, cap: 85 },
];

const OUTFIELD_ANGLES = [
  { name: "左翼", angle: -22 },
  { name: "中堅", angle: 0 },
  { name: "右翼", angle: 22 },
];

const BB_LABEL: Record<string, string> = {
  ground_ball: "ゴロ",
  line_drive: "ライナー",
  fly_ball: "フライ",
  popup: "ポップフライ",
};

const HIT_LABEL: Record<string, string> = {
  out: "アウト",
  single: "単打",
  double: "二塁打",
  triple: "三塁打",
  home_run: "本塁打",
};

function outfielders(): Fielder[] {
  return OUTFIELD_ANGLES.map((spot) => {
    const depth = fenceDistance(spot.angle) * 0.72;
    const rad = (spot.angle * Math.PI) / 180;
    return {
      name: spot.name,
      x: Math.sin(rad) * depth,
      y: Math.cos(rad) * depth,
      speed: 29,
      reaction: 0.38,
      cap: 125,
    };
  });
}

function fielders(): Fielder[] {
  return [...INFIELD, ...outfielders()];
}

function radiusOf(sample: BattedSample): number {
  return Math.hypot(sample.x, sample.y);
}

type Crossing = { kind: "clear" | "wall"; index: number; at: BattedSample; fenceFt: number } | { kind: "none" };

/** 半径がフェンスを跨いだサンプル。地面より上なら越え、壁の高さ以下なら直撃。 */
function findCrossing(samples: BattedSample[], ground: boolean): Crossing {
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1];
    const after = samples[index];
    const near = radiusOf(before);
    const far = radiusOf(after);
    const fenceFt = fenceDistance(sprayAngle(after.x, after.y));
    if (near < fenceFt && far >= fenceFt && far > near) {
      const span = (fenceFt - near) / (far - near);
      const at = {
        t: before.t + (after.t - before.t) * span,
        x: before.x + (after.x - before.x) * span,
        y: before.y + (after.y - before.y) * span,
        z: before.z + (after.z - before.z) * span,
      };
      const clears = !ground && at.z > FENCE_HEIGHT_FT;
      return { kind: clears ? "clear" : "wall", index, at, fenceFt };
    }
  }
  return { kind: "none" };
}

/** ゴロの見た目はゆっくり転がすが、守備の時間は打った速度で数える。 */
function playClock(sample: BattedSample, ground: boolean, speedMph: number): number {
  if (!ground) return sample.t;
  const feetPerSecond = Math.max(40, speedMph * 1.4667 * 0.82);
  return radiusOf(sample) / feetPerSecond;
}

function canReach(fielder: Fielder, reach: number, clock: number, ground: boolean): boolean {
  if (clock < fielder.reaction || reach > fielder.cap) return false;
  if (ground) return reach <= 4 + fielder.speed * 0.42 * (clock - fielder.reaction);
  return fielder.reaction + reach / fielder.speed <= clock;
}

/** マウンドの前で止まったゴロは、投手か捕手が取りにいく。 */
function chargeSlowRoller(end: BattedSample): string | null {
  if (radiusOf(end) > 70) return null;
  let best: { name: string; reach: number } | null = null;
  for (const fielder of INFIELD) {
    if (fielder.name !== "投手" && fielder.name !== "捕手") continue;
    const reach = Math.hypot(end.x - fielder.x, end.y - fielder.y);
    if (reach > 18) continue;
    if (!best || reach < best.reach) best = { name: fielder.name, reach };
  }
  return best?.name ?? null;
}

function firstPlay(
  samples: BattedSample[],
  fenceFt: number | null,
  ground: boolean,
  speedMph: number,
): { name: string; index: number } | null {
  const roster = fielders();
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.z > 8) continue;
    if (fenceFt != null && radiusOf(sample) > fenceFt - 2) continue;
    const clock = playClock(sample, ground, speedMph);
    if (clock < 0.2) continue;
    for (const fielder of roster) {
      const reach = Math.hypot(sample.x - fielder.x, sample.y - fielder.y);
      if (canReach(fielder, reach, clock, ground)) return { name: fielder.name, index };
    }
  }
  return null;
}

function outfieldLate(point: BattedSample, ground: boolean, speedMph: number): number {
  const clock = playClock(point, ground, speedMph);
  let best = Infinity;
  for (const fielder of outfielders()) {
    const reach = Math.hypot(point.x - fielder.x, point.y - fielder.y);
    best = Math.min(best, fielder.reaction + reach / fielder.speed - clock);
  }
  return best;
}

function sliceTo(samples: BattedSample[], at: BattedSample, index: number): BattedSample[] {
  const kept = samples.slice(0, index);
  kept.push(at);
  return kept;
}

function dropDown(at: BattedSample): BattedSample[] {
  const extra: BattedSample[] = [];
  let z = at.z;
  let t = at.t;
  while (z > 0.05 && extra.length < 16) {
    t += 0.04;
    z = Math.max(0, z - 16 * 0.04);
    extra.push({ t, x: at.x, y: at.y, z });
  }
  return extra;
}

function playLabel(bip: ParkPlay["bip"], how: ParkHow, fielder: string | null, bbType: string | null | undefined): string {
  if (bip === "home_run") return "本塁打";
  if (how === "wall" && bip === "triple") return "フェンス際の三塁打";
  if (how === "wall") return "フェンス直撃の二塁打";
  if (how === "catch") {
    return bbType === "ground_ball" ? `${fielder}がゴロを処理` : `${fielder}が捕球`;
  }
  const contact = bbType ? BB_LABEL[bbType] ?? "" : "";
  const hit = HIT_LABEL[bip] ?? "安打";
  return contact ? `${contact}の${hit}` : hit;
}

function playNote(input: {
  cleared: boolean;
  how: ParkHow;
  fenceFt: number;
  heightFt: number | null;
  landingFt: number;
}): string {
  const fence = Math.round(input.fenceFt);
  const landing = Math.round(input.landingFt);
  if (input.cleared && input.heightFt != null) {
    return `フェンス ${fence} ft を高さ ${Math.round(input.heightFt)} ft で越えた`;
  }
  if (input.how === "wall" && input.heightFt != null) {
    return `フェンス ${fence} ft に高さ ${input.heightFt.toFixed(1)} ft で当たった`;
  }
  const short = Math.max(0, fence - landing);
  if (input.how === "catch") return `本塁から ${landing} ft で処理。フェンスまで ${short} ft`;
  return `落下 ${landing} ft。フェンスまで ${short} ft`;
}

/**
 * 打球の速度・角度・方向で飛ばし、甲子園のフェンスと守備位置で結果を決める。
 * ゴロは hc で止め、フライの飛距離は Statcast の距離。越えた球だけ本塁打。
 */
export function resolveFairBall(input: FairBallInput): { samples: BattedSample[]; landing: BattedSample; play: ParkPlay } {
  const angle = sprayAngle(input.aimX, input.aimY);
  const fenceFt = fenceDistance(angle);
  const travel = input.ground ? Math.min(Math.max(input.carryFt, 1), fenceFt - 1.5) : Math.max(input.carryFt, 1);
  const rad = (angle * Math.PI) / 180;
  const flown = integrateContact({
    x: input.x,
    y: input.y,
    z: input.z,
    speedMph: input.speedMph,
    launchDeg: input.launchDeg,
    targetX: Math.sin(rad) * travel,
    targetY: Math.cos(rad) * travel,
    ground: input.ground,
  });
  const crossing = findCrossing(flown.samples, input.ground);
  const limit = crossing.kind === "none" ? null : crossing.fenceFt;
  const catchPlay = firstPlay(flown.samples, limit, input.ground, input.speedMph);
  const end = flown.samples[flown.samples.length - 1] ?? flown.landing;
  const endRadius = radiusOf(end);
  const reachedWall = endRadius >= fenceFt - 8;

  let samples = flown.samples;
  let how: ParkHow;
  let bip: ParkPlay["bip"];
  let fielder: string | null = null;
  let heightFt: number | null = null;
  let cleared = false;
  let landing = end;

  const charger = input.ground ? chargeSlowRoller(end) : null;
  if (catchPlay || charger) {
    how = "catch";
    bip = "out";
    fielder = catchPlay?.name ?? charger;
    landing = catchPlay ? flown.samples[catchPlay.index] : end;
    samples = catchPlay ? flown.samples.slice(0, catchPlay.index + 1) : flown.samples;
  } else if (crossing.kind === "clear") {
    how = "home_run";
    bip = "home_run";
    cleared = true;
    heightFt = crossing.at.z;
    landing = end;
  } else if (crossing.kind === "wall" || reachedWall) {
    const at = crossing.kind === "wall" ? crossing.at : end;
    heightFt = crossing.kind === "wall" ? crossing.at.z : Math.max(0, end.z);
    const late = outfieldLate(at, input.ground, input.speedMph);
    const corner = Math.abs(sprayAngle(at.x, at.y)) >= 33 && late >= 1.5;
    how = "wall";
    bip = corner ? "triple" : "double";
    if (crossing.kind === "wall") {
      samples = [...sliceTo(flown.samples, crossing.at, crossing.index), ...dropDown(crossing.at)];
      landing = samples[samples.length - 1];
    }
  } else {
    how = "hit";
    const late = outfieldLate(end, input.ground, input.speedMph);
    bip = endRadius >= 230 && late >= 0.4 ? "double" : "single";
  }

  const landingFt = radiusOf(landing);
  const play: ParkPlay = {
    bip,
    how,
    fielder,
    cleared,
    carryFt: input.carryFt,
    fenceFt,
    heightFt,
    landingFt,
    note: playNote({ cleared, how, fenceFt, heightFt, landingFt }),
    label: playLabel(bip, how, fielder, input.bbType),
  };
  return { samples, landing, play };
}
