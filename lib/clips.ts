import { integrateBattedBall } from "./batted";
import { PLATE_FRONT_FT, SZ_BOT_FT, SZ_TOP_FT } from "./field-constants";
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
  plateX: number | null;
  plateZ: number | null;
  spinRpm: number | null;
  spinAxisDeg: number | null;
  release: { x: number; y: number; z: number; mph: number } | null;
  plateMph: number | null;
  szTop: number;
  szBot: number;
  landing: { x: number; y: number; t: number } | null;
};

export type PitchDef = PitchKinematics & {
  id: string;
  name: string;
  detail: string;
  color: string;
  spinRpm: number;
  spinAxisDeg: number;
  szTop?: number;
  szBot?: number;
};

const PITCHES: PitchDef[] = [
  {
    id: "ff",
    name: "フォーシーム",
    detail: "右投手",
    color: "#f4f1ea",
    releaseX: -1.85,
    releaseY: 54.05,
    releaseZ: 5.9,
    vx0: 5.15,
    vy0: -139.2,
    vz0: -6.4,
    ax: -5.6,
    ay: 27.5,
    az: -15.2,
    spinRpm: 2380,
    spinAxisDeg: 221,
    szTop: 3.48,
    szBot: 1.55,
  },
  {
    id: "sl",
    name: "スライダー",
    detail: "右投手",
    color: "#f0a35e",
    releaseX: -1.95,
    releaseY: 54.0,
    releaseZ: 5.65,
    vx0: 4.8,
    vy0: -125.5,
    vz0: -3,
    ax: 8.8,
    ay: 23.5,
    az: -34,
    spinRpm: 2520,
    spinAxisDeg: 84,
    szTop: 3.48,
    szBot: 1.55,
  },
  {
    id: "cu",
    name: "カーブ",
    detail: "右投手",
    color: "#d7c4ff",
    releaseX: -1.7,
    releaseY: 53.7,
    releaseZ: 5.75,
    vx0: 3,
    vy0: -113.5,
    vz0: 1,
    ax: 4.8,
    ay: 19.5,
    az: -50.5,
    spinRpm: 2710,
    spinAxisDeg: 16,
    szTop: 3.48,
    szBot: 1.55,
  },
];

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
    plateX: plate.x,
    plateZ: plate.z,
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
    spinRpm: null,
    spinAxisDeg: null,
    release: null,
    plateMph: null,
    szTop: SZ_TOP_FT,
    szBot: SZ_BOT_FT,
    landing: { x: flight.landing.x, y: flight.landing.y, t: flight.landing.t },
  };
}

export const CLIPS: Clip[] = [...PITCHES.map(buildPitchClip), buildLiner()];

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
