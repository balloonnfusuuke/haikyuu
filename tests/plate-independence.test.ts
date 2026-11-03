import assert from "node:assert/strict";
import test from "node:test";
import { PLATE_FRONT_FT } from "../lib/field-constants";
import { solvePitch, timeAtY, type PitchKinematics } from "../lib/trajectory";

/**
 * 等加速度のステップ積分。plate_x / plate_z は見ない。
 * y がプレート前端をまたいだ区間を線形補間して (x, z) を返す。
 */
function plateByStepping(k: PitchKinematics, dt = 1e-4): { x: number; z: number; y: number } {
  const tRelease = timeAtY(k.releaseY, 50, k.vy0, k.ay);
  let x = k.releaseX;
  let y = k.releaseY;
  let z = k.releaseZ;
  let vx = k.vx0 + k.ax * tRelease;
  let vy = k.vy0 + k.ay * tRelease;
  let vz = k.vz0 + k.az * tRelease;
  let guard = 0;
  while (y > PLATE_FRONT_FT && guard < 20000) {
    const prev = { x, y, z };
    x += vx * dt + 0.5 * k.ax * dt * dt;
    y += vy * dt + 0.5 * k.ay * dt * dt;
    z += vz * dt + 0.5 * k.az * dt * dt;
    vx += k.ax * dt;
    vy += k.ay * dt;
    vz += k.az * dt;
    guard += 1;
    if (y <= PLATE_FRONT_FT) {
      const span = prev.y - y || 1;
      const u = (prev.y - PLATE_FRONT_FT) / span;
      return { x: prev.x + (x - prev.x) * u, y: PLATE_FRONT_FT, z: prev.z + (z - prev.z) * u };
    }
  }
  throw new Error("プレート前端まで届かない球です");
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

function randomPitch(rng: () => number): PitchKinematics {
  const lefty = rng() < 0.5;
  return {
    releaseX: between(rng, lefty ? 0.6 : -2.9, lefty ? 2.9 : -0.6),
    releaseY: between(rng, 53.1, 55.9),
    releaseZ: between(rng, 4.7, 6.7),
    vx0: between(rng, -14, 14),
    vy0: between(rng, -148, -108),
    vz0: between(rng, -10, 8),
    ax: between(rng, -28, 28),
    ay: between(rng, 12, 38),
    az: between(rng, -52, 18),
  };
}

test("100球のプレート位置は vx vy vz と ax ay az だけで決まり、plate_x plate_z には合わせない", () => {
  const rng = mulberry32(20261104);
  const gapsFt: number[] = [];
  const ignoredTargetFt: number[] = [];
  const pitches: PitchKinematics[] = [];

  while (pitches.length < 100) {
    const kinematics = randomPitch(rng);
    try {
      const solved = solvePitch(kinematics);
      const atPlate = solved.position(solved.tPlate);
      if (!Number.isFinite(atPlate.x) || !Number.isFinite(atPlate.z)) continue;
      if (solved.tPlate <= solved.tRelease) continue;
      const stepped = plateByStepping(kinematics);
      const dx = stepped.x - atPlate.x;
      const dz = stepped.z - atPlate.z;
      gapsFt.push(Math.hypot(dx, dz));

      const decoy = { ...kinematics, plateX: atPlate.x + 0.5, plateZ: atPlate.z - 0.4 };
      const again = solvePitch(decoy);
      const againAtPlate = again.position(again.tPlate);
      assert.ok(Math.abs(againAtPlate.x - atPlate.x) < 1e-9);
      assert.ok(Math.abs(againAtPlate.z - atPlate.z) < 1e-9);
      ignoredTargetFt.push(Math.hypot(againAtPlate.x - decoy.plateX, againAtPlate.z - decoy.plateZ));
      pitches.push(kinematics);
    } catch {
      continue;
    }
  }

  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const max = (values: number[]) => values.reduce((best, value) => Math.max(best, value), 0);
  const toCm = (feet: number) => feet * 30.48;

  const meanCm = toCm(mean(gapsFt));
  const maxCm = toCm(max(gapsFt));
  const ignoredMeanFt = mean(ignoredTargetFt);
  const ignoredMaxFt = max(ignoredTargetFt);

  console.log(
    JSON.stringify(
      {
        pitches: pitches.length,
        inputs: "release, vx0, vy0, vz0, ax, ay, az",
        plateUsedAsInput: false,
        meanGapCm: meanCm,
        maxGapCm: maxCm,
        unusedPlateTargetOffsetFt: Math.hypot(0.5, 0.4),
        meanDistanceToUnusedPlateFt: Number(ignoredMeanFt.toFixed(6)),
        maxDistanceToUnusedPlateFt: Number(ignoredMaxFt.toFixed(6)),
      },
      null,
      2,
    ),
  );

  assert.equal(pitches.length, 100);
  assert.ok(meanCm < 0.05, `平均 ${meanCm} cm`);
  assert.ok(maxCm < 0.2, `最大 ${maxCm} cm`);
  assert.ok(Math.abs(ignoredMeanFt - Math.hypot(0.5, 0.4)) < 1e-6);
  assert.ok(Math.abs(ignoredMaxFt - Math.hypot(0.5, 0.4)) < 1e-6);
});
