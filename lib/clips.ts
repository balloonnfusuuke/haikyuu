import { integrateBattedBall } from "./batted";
import { PLATE_FRONT_FT, SZ_BOT_FT, SZ_TOP_FT } from "./field-constants";
import { STATCAST_PITCHES, type StatcastPitch } from "./statcast";
import { solvePitch, speedMph, timeAtY, type PitchKinematics } from "./trajectory";

export type Sample = { t: number; x: number; y: number; z: number };

export type Clip = {
  id: string;
  name: string;
  detail: string;
  kind: "pitch" | "batted";
  color: string;
  samples: Sample[];
  tStart: number;
  tEnd: number;
  tPlate: number | null;
  /** Statcast に記録された plate_x。計算値ではない。 */
  plateX: number | null;
  /** Statcast に記録された plate_z。計算値ではない。 */
  plateZ: number | null;
  /** y = 50 ft の初速・加速度とリリース位置から出したプレート前端。 */
  modelPlateX: number | null;
  modelPlateZ: number | null;
  pitcher: string | null;
  gameDate: string | null;
  throws: "R" | "L" | null;
  pitchType: string | null;
  spinRpm: number | null;
  spinAxisDeg: number | null;
  release: { x: number; y: number; z: number; mph: number } | null;
  plateMph: number | null;
  szTop: number;
  szBot: number;
  landing: { x: number; y: number; t: number } | null;
  /** バットを振る時間。見逃しは null。 */
  swing?: { duration: number; miss: boolean } | null;
  noise?: "catch" | "hit" | null;
};

export type PitchDef = PitchKinematics & {
  id: string;
  name: string;
  detail: string;
  color: string;
  recordedPlateX: number;
  recordedPlateZ: number;
  pitcher: string;
  gameDate: string;
  throws: "R" | "L";
  pitchType: string;
  spinRpm: number | null;
  spinAxisDeg: number | null;
  szTop?: number;
  szBot?: number;
};

const PITCH_LABEL: Record<StatcastPitch["pitchType"], string> = {
  FF: "フォーシーム",
  SL: "スライダー",
  CU: "カーブ",
};
const HAND_LABEL: Record<StatcastPitch["throws"], string> = {
  R: "右投手",
  L: "左投手",
};
const PITCH_COLOR: Record<StatcastPitch["pitchType"], string> = {
  FF: "#f4f1ea",
  SL: "#f0a35e",
  CU: "#d7c4ff",
};

function pitchFromStatcast(pitch: StatcastPitch): PitchDef {
  const hand = HAND_LABEL[pitch.throws];
  const name = PITCH_LABEL[pitch.pitchType];
  return {
    id: pitch.id,
    name: `${name} · ${pitch.pitcher}`,
    detail: `${hand} · ${pitch.gameDate}`,
    color: PITCH_COLOR[pitch.pitchType] ?? "#f4f1ea",
    recordedPlateX: pitch.plateX,
    recordedPlateZ: pitch.plateZ,
    pitcher: pitch.pitcher,
    gameDate: pitch.gameDate,
    throws: pitch.throws,
    pitchType: pitch.pitchType,
    releaseX: pitch.releaseX,
    releaseY: pitch.releaseY,
    releaseZ: pitch.releaseZ,
    vx0: pitch.vx0,
    vy0: pitch.vy0,
    vz0: pitch.vz0,
    ax: pitch.ax,
    ay: pitch.ay,
    az: pitch.az,
    spinRpm: pitch.spinRpm,
    spinAxisDeg: pitch.spinAxis,
    szTop: pitch.szTop ?? undefined,
    szBot: pitch.szBot ?? undefined,
  };
}

const PITCHES: PitchDef[] = STATCAST_PITCHES.map(pitchFromStatcast);

function dedupeSamples(samples: Sample[]): Sample[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const out: Sample[] = [];
  for (const sample of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.t - sample.t) < 1e-6) {
      out[out.length - 1] = sample;
    } else {
      out.push(sample);
    }
  }
  return out;
}

export function buildPitchClip(def: PitchDef): Clip {
  const solved = solvePitch(def);
  const tCatch = timeAtY(-2.2, 50, def.vy0, def.ay);
  const samples: Sample[] = [];
  for (let t = solved.tRelease; t <= tCatch + 1e-9; t += 0.003) {
    samples.push({ t, ...solved.position(t) });
  }
  for (const t of [solved.tRelease, solved.tPlate, tCatch]) {
    samples.push({ t, ...solved.position(t) });
  }
  const plate = solved.position(solved.tPlate);
  const release = solved.position(solved.tRelease);
  return {
    id: def.id,
    name: def.name,
    detail: def.detail,
    kind: "pitch",
    color: def.color,
    samples: dedupeSamples(samples),
    tStart: solved.tRelease,
    tEnd: tCatch,
    tPlate: solved.tPlate,
    plateX: def.recordedPlateX,
    plateZ: def.recordedPlateZ,
    modelPlateX: plate.x,
    modelPlateZ: plate.z,
    pitcher: def.pitcher,
    gameDate: def.gameDate,
    throws: def.throws,
    pitchType: def.pitchType,
    spinRpm: def.spinRpm,
    spinAxisDeg: def.spinAxisDeg,
    release: {
      x: release.x,
      y: release.y,
      z: release.z,
      mph: speedMph(solved.velocity(solved.tRelease)),
    },
    plateMph: speedMph(solved.velocity(solved.tPlate)),
    szTop: def.szTop ?? SZ_TOP_FT,
    szBot: def.szBot ?? SZ_BOT_FT,
    landing: null,
  };
}

function buildLiner(): Clip {
  const flight = integrateBattedBall({
    x: -0.35,
    y: 1.7,
    z: 2.65,
    speedMph: 102,
    launchDeg: 12,
    sprayDeg: -16,
  });
  return {
    id: "liner",
    name: "ライナー",
    detail: "右打者の打球",
    kind: "batted",
    color: "#ffd166",
    samples: flight.samples,
    tStart: 0,
    tEnd: flight.landing.t,
    tPlate: null,
    plateX: null,
    plateZ: null,
    modelPlateX: null,
    modelPlateZ: null,
    pitcher: null,
    gameDate: null,
    throws: null,
    pitchType: null,
    spinRpm: null,
    spinAxisDeg: null,
    release: null,
    plateMph: null,
    szTop: SZ_TOP_FT,
    szBot: SZ_BOT_FT,
    landing: { x: flight.landing.x, y: flight.landing.y, t: flight.landing.t },
  };
}

export const PITCH_CLIPS: Clip[] = PITCHES.map(buildPitchClip);

export const DEFAULT_CLIP_ID = PITCH_CLIPS[0]?.id ?? "liner";

export const CLIPS: Clip[] = [...PITCH_CLIPS, buildLiner()];

export function getClip(id: string): Clip {
  return CLIPS.find((clip) => clip.id === id) ?? CLIPS[0];
}

export function sampleAt(samples: Sample[], t: number): Sample {
  const count = samples.length;
  if (count === 0) return { t, x: 0, y: 0, z: 0 };
  if (t <= samples[0].t) return samples[0];
  const last = samples[count - 1];
  if (t >= last.t) return last;
  let lo = 0;
  let hi = count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const span = b.t - a.t || 1;
  const u = (t - a.t) / span;
  return {
    t,
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    z: a.z + (b.z - a.z) * u,
  };
}

export function sampleNearY(samples: Sample[], y: number): Sample {
  let best = samples[0];
  let bestDistance = Infinity;
  for (const sample of samples) {
    const distance = Math.abs(sample.y - y);
    if (distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }
  return best ?? { t: 0, x: 0, y, z: 0 };
}

export { PLATE_FRONT_FT };
