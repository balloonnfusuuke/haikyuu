import { integrateBattedBall } from "@/lib/batted";
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

export type ContactFlight = { exitSpeed: number; launchAngle: number; spray: number };

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
  if (!contact || clip.tPlate == null || clip.modelPlateX == null || clip.modelPlateZ == null) return clip;
  const flight = integrateBattedBall({
    x: clip.modelPlateX,
    y: PLATE_FRONT_FT,
    z: clip.modelPlateZ,
    speedMph: contact.exitSpeed,
    launchDeg: contact.launchAngle,
    sprayDeg: contact.spray,
  });
  const tPlate = clip.tPlate;
  const kept = clip.samples.filter((sample) => sample.t <= tPlate + 1e-4);
  const flown = flight.samples.filter((sample) => sample.t > 0.001).map((sample) => ({ ...sample, t: sample.t + tPlate }));
  const end = flown[flown.length - 1];
  return {
    ...clip,
    samples: end ? [...kept, ...flown] : kept,
    tEnd: end ? end.t : tPlate,
    landing: { x: flight.landing.x, y: flight.landing.y, t: flight.landing.t + tPlate },
  };
}
