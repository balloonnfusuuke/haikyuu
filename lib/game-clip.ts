import { hcToFeet, integrateContact } from "@/lib/batted";
import { buildPitchClip, PLATE_FRONT_FT, type Clip } from "@/lib/clips";

export type GamePitch = {
  id: string;
  pitcher: string;
  throws: "R" | "L";
  pitchType: string;
  pitchName: string;
  gameDate: string;
  plateX: number;
  plateZ: number;
  releaseX: number;
  releaseY: number;
  releaseZ: number;
  vx0: number;
  vy0: number;
  vz0: number;
  ax: number;
  ay: number;
  az: number;
  spinRpm: number | null;
  spinAxis: number | null;
  releaseSpeed: number | null;
  szTop: number;
  szBot: number;
};

const COLOR: Record<string, string> = {
  FF: "#f4f1ea",
  SI: "#d7c4a3",
  FC: "#9fd4c4",
  SL: "#f0a35e",
  ST: "#e07a3d",
  CU: "#d7c4ff",
  KC: "#b9a6e8",
  CH: "#8fd0a8",
  FS: "#6fbf9a",
};

export type ContactFlight = {
  exitSpeed: number;
  launchAngle: number;
  spray: number;
  hcX?: number | null;
  hcY?: number | null;
  hitDistance?: number | null;
  bbType?: string | null;
  /** 空振りは球の下を通す。ファウルとインプレーは球へ向ける。 */
  miss?: boolean;
  /** 見逃しは false。空振り・ファウル・インプレーは true。 */
  swing?: boolean;
  batSpeed?: number | null;
  swingLength?: number | null;
  noise?: "catch" | "hit" | null;
};

function swingSeconds(batSpeedMph: number | null | undefined, swingLengthFt: number | null | undefined): number {
  if (batSpeedMph == null || swingLengthFt == null || batSpeedMph < 10 || swingLengthFt <= 0) return 0.22;
  const feetPerSecond = batSpeedMph * (5280 / 3600);
  return Math.min(0.55, Math.max(0.08, swingLengthFt / feetPerSecond));
}

export function clipFromPitch(pitch: GamePitch, contact?: ContactFlight | null): Clip {
  const clip = buildPitchClip({
    id: pitch.id,
    name: `${pitch.pitchName} · ${pitch.pitcher}`,
    detail: `${pitch.throws === "L" ? "左投手" : "右投手"} · ${pitch.gameDate}`,
    color: COLOR[pitch.pitchType] ?? "#f4f1ea",
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
    szTop: pitch.szTop,
    szBot: pitch.szBot,
  });
  const swing =
    contact == null || contact.swing === false
      ? null
      : { duration: swingSeconds(contact.batSpeed, contact.swingLength), miss: Boolean(contact.miss) };
  const withSwing = { ...clip, swing, noise: contact?.noise ?? null };
  if (!contact || clip.tPlate == null || clip.modelPlateX == null || clip.modelPlateZ == null) return withSwing;
  const target =
    contact.hcX != null && contact.hcY != null
      ? hcToFeet(contact.hcX, contact.hcY)
      : null;
  if (!target) return withSwing;
  const flight = integrateContact({
    x: clip.modelPlateX,
    y: PLATE_FRONT_FT,
    z: clip.modelPlateZ,
    speedMph: contact.exitSpeed,
    launchDeg: contact.launchAngle,
    targetX: target.x,
    targetY: target.y,
    ground: contact.bbType === "ground_ball",
  });
  const tPlate = clip.tPlate;
  const kept = clip.samples.filter((sample) => sample.t <= tPlate + 1e-4);
  const flown = flight.samples.filter((sample) => sample.t > 0.001).map((sample) => ({ ...sample, t: sample.t + tPlate }));
  const end = flown[flown.length - 1];
  return {
    ...withSwing,
    samples: end ? [...kept, ...flown] : kept,
    tEnd: end ? end.t : tPlate,
    landing: { x: flight.landing.x, y: flight.landing.y, t: flight.landing.t + tPlate },
  };
}
