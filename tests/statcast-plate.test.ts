import assert from "node:assert/strict";
import test from "node:test";
import { getClip, PITCH_CLIPS } from "../lib/clips";
import { PLATE_FRONT_FT } from "../lib/field-constants";
import {
  plateFromKinematics,
  STATCAST_PITCHES,
  STATCAST_RESIDUALS,
  STATCAST_SUMMARY,
} from "../lib/statcast";

test("Statcast 100球は記録の plate_x plate_z と、y=50 ft 起点の計算を比べる", () => {
  assert.equal(STATCAST_PITCHES.length, 100);
  assert.equal(PITCH_CLIPS.length, 100);
  const hands = new Set(STATCAST_PITCHES.map((pitch) => pitch.throws));
  const types = new Set(STATCAST_PITCHES.map((pitch) => pitch.pitchType));
  assert.deepEqual([...hands].sort(), ["L", "R"]);
  assert.deepEqual([...types].sort(), ["CU", "FF", "SL"]);

  for (const pitch of STATCAST_PITCHES) {
    const calc = plateFromKinematics(pitch);
    assert.ok(Math.abs(calc.y - PLATE_FRONT_FT) < 1e-9);
    const clip = getClip(pitch.id);
    assert.equal(clip.plateX, pitch.plateX);
    assert.equal(clip.plateZ, pitch.plateZ);
    assert.ok(clip.modelPlateX != null && Math.abs(clip.modelPlateX - calc.x) < 1e-9);
    assert.ok(clip.modelPlateZ != null && Math.abs(clip.modelPlateZ - calc.z) < 1e-9);
  }

  assert.equal(STATCAST_SUMMARY.count, 100);
  assert.equal(STATCAST_SUMMARY.top.length, 5);
  assert.ok(STATCAST_SUMMARY.meanCm > 0.05 && STATCAST_SUMMARY.meanCm < 0.5);
  assert.ok(STATCAST_SUMMARY.maxCm >= STATCAST_SUMMARY.meanCm);
  assert.ok(Math.abs(STATCAST_SUMMARY.meanDxFt) < 0.01);
  assert.ok(Math.abs(STATCAST_SUMMARY.meanDzFt) < 0.01);
  const largest = STATCAST_RESIDUALS.reduce((best, row) => (row.distanceCm > best.distanceCm ? row : best));
  assert.equal(STATCAST_SUMMARY.top[0].pitch.id, largest.pitch.id);
  assert.equal(STATCAST_SUMMARY.maxCm, largest.distanceCm);

  console.log(
    JSON.stringify(
      {
        date: "2025-06-15",
        count: STATCAST_SUMMARY.count,
        origin: "t = 0 at y = 50 ft",
        meanCm: STATCAST_SUMMARY.meanCm,
        maxCm: STATCAST_SUMMARY.maxCm,
        meanDxFt: STATCAST_SUMMARY.meanDxFt,
        meanDzFt: STATCAST_SUMMARY.meanDzFt,
        top: STATCAST_SUMMARY.top.map((row) => ({
          pitcher: row.pitch.pitcher,
          throws: row.pitch.throws,
          pitchType: row.pitch.pitchType,
          date: row.pitch.gameDate,
          recorded: [row.pitch.plateX, row.pitch.plateZ],
          calculated: [row.calcX, row.calcZ],
          dxFt: row.dxFt,
          dzFt: row.dzFt,
          distanceCm: row.distanceCm,
        })),
      },
      null,
      2,
    ),
  );
});
