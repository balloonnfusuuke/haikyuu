import { buildPitchClip, type Clip } from "@/lib/clips";

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

export function clipFromPitch(pitch: GamePitch): Clip {
  return buildPitchClip({
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
}
