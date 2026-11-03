import file from "@/data/statcast-100.json";
import { solvePitch } from "@/lib/trajectory";

/** Baseball Savant の1球。vx0 から az は y = 50 ft の時点の値。 */
export type StatcastPitch = {
  id: string;
  pitchType: "FF" | "SL" | "CU";
  pitchName: string | null;
  throws: "R" | "L";
  pitcher: string;
  pitcherId: number | null;
  gameDate: string;
  gamePk: number | null;
  atBat: number | null;
  pitchNumber: number | null;
  home: string | null;
  away: string | null;
  releaseX: number;
  releaseY: number;
  releaseZ: number;
  vx0: number;
  vy0: number;
  vz0: number;
  ax: number;
  ay: number;
  az: number;
  plateX: number;
  plateZ: number;
  spinRpm: number | null;
  spinAxis: number | null;
  releaseSpeed: number | null;
  szTop: number | null;
  szBot: number | null;
};

export type PlateResidual = {
  pitch: StatcastPitch;
  calcX: number;
  calcZ: number;
  dxFt: number;
  dzFt: number;
  distanceFt: number;
  distanceCm: number;
};

export const STATCAST_FILE = file;

export const STATCAST_PITCHES = file.pitches as StatcastPitch[];

const FT_TO_CM = 30.48;

/**
 * プレート前端の計算位置。入力はリリース位置と、y = 50 ft での vx0, vy0, vz0, ax, ay, az だけ。
 * 記録の plate_x / plate_z は使わない。
 */
export function plateFromKinematics(pitch: StatcastPitch): { x: number; z: number; y: number } {
  const solved = solvePitch({
    releaseX: pitch.releaseX,
    releaseY: pitch.releaseY,
    releaseZ: pitch.releaseZ,
    vx0: pitch.vx0,
    vy0: pitch.vy0,
    vz0: pitch.vz0,
    ax: pitch.ax,
    ay: pitch.ay,
    az: pitch.az,
  });
  const atPlate = solved.position(solved.tPlate);
  return { x: atPlate.x, y: atPlate.y, z: atPlate.z };
}

export function plateResiduals(pitches: StatcastPitch[] = STATCAST_PITCHES): PlateResidual[] {
  return pitches.map((pitch) => {
    const calc = plateFromKinematics(pitch);
    const dxFt = calc.x - pitch.plateX;
    const dzFt = calc.z - pitch.plateZ;
    const distanceFt = Math.hypot(dxFt, dzFt);
    return {
      pitch,
      calcX: calc.x,
      calcZ: calc.z,
      dxFt,
      dzFt,
      distanceFt,
      distanceCm: distanceFt * FT_TO_CM,
    };
  });
}

export type ResidualSummary = {
  count: number;
  meanCm: number;
  maxCm: number;
  meanDxFt: number;
  meanDzFt: number;
  top: PlateResidual[];
};

export function summarizeResiduals(rows: PlateResidual[]): ResidualSummary {
  const count = rows.length;
  const meanCm = rows.reduce((sum, row) => sum + row.distanceCm, 0) / count;
  const maxCm = rows.reduce((best, row) => Math.max(best, row.distanceCm), 0);
  const meanDxFt = rows.reduce((sum, row) => sum + row.dxFt, 0) / count;
  const meanDzFt = rows.reduce((sum, row) => sum + row.dzFt, 0) / count;
  const top = [...rows].sort((a, b) => b.distanceCm - a.distanceCm).slice(0, 5);
  return { count, meanCm, maxCm, meanDxFt, meanDzFt, top };
}

export const STATCAST_RESIDUALS = plateResiduals();
export const STATCAST_SUMMARY = summarizeResiduals(STATCAST_RESIDUALS);
