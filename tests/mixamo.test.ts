import assert from "node:assert/strict";
import test from "node:test";
import { advanceRunners, type AdvanceKind, type Bases } from "../lib/bases";
import { FEET_TO_METERS } from "../lib/coords";
import { RUBBER_FRONT_FT } from "../lib/field-constants";
import {
  BAT_CONTACT_S,
  BAT_FOLLOW_END_S,
  BAT_SWING_START_S,
  BAT_TAKE_HOLD_S,
  basePoint,
  batClipTime,
  batGripBlend,
  batterIsCamera,
  leadIn,
  loopDrift,
  pathLengthFt,
  PITCH_PIVOT_BACK_M,
  PITCH_RELEASE_S,
  pitchClipTime,
  pitcherFeet,
  pointAlong,
  runDistance,
  runDuration,
  runnerPath,
  runnerRuns,
  runPhase,
  sampleKeys,
} from "../lib/mixamo";

/** human_mixamo.glb の MixamoRun、Hips の +Z（1/30 秒ごと）。 */
const RUN_TIMES = Array.from({ length: 20 }, (_, index) => (index + 1) / 30);
const RUN_HIPS_Z = [
  0.019, 0.241, 0.446, 0.647, 0.838, 1.03, 1.226, 1.395, 1.586, 1.813, 2.059, 2.275, 2.481, 2.673, 2.872, 3.06, 3.258,
  3.453, 3.643, 3.868,
];

test("走りのループは継ぎ目で Hips が戻らない", () => {
  const drift = loopDrift(RUN_TIMES, RUN_HIPS_Z);
  assert.ok(Math.abs(drift.stride - 3.849) < 1e-9);
  const hipsWorld = (distance: number) => {
    const phase = runPhase(distance, drift);
    const raw = sampleKeys(RUN_TIMES, RUN_HIPS_Z, 1, phase.time)[0];
    return distance + raw - phase.cancel;
  };
  const step = 0.01;
  let previous = hipsWorld(0);
  for (let distance = step; distance < drift.stride * 3; distance += step) {
    const next = hipsWorld(distance);
    assert.ok(Math.abs(next - previous - step) < 0.01, `${distance.toFixed(2)} m で ${(next - previous).toFixed(3)} m 跳んだ`);
    previous = next;
  }
  const seam = drift.stride * 2;
  assert.ok(Math.abs(hipsWorld(seam + 1e-6) - hipsWorld(seam - 1e-6)) < 1e-3);
});

test("走者の行き先は advanceRunners の塁と同じ", () => {
  const kinds: AdvanceKind[] = ["single", "double", "triple", "home_run", "out"];
  for (let mask = 0; mask < 8; mask += 1) {
    const bases: Bases = { first: Boolean(mask & 1), second: Boolean(mask & 2), third: Boolean(mask & 4) };
    for (const kind of kinds) {
      const runs = runnerRuns(bases, kind, true);
      const after = advanceRunners(bases, kind);
      const standing = (base: number) => runs.some((run) => run.to === base && !run.out);
      assert.deepEqual({ first: standing(1), second: standing(2), third: standing(3) }, after.bases, `${mask} ${kind}`);
      assert.equal(runs.some((run) => run.out), kind === "out");
      if (kind !== "out") assert.equal(runs.filter((run) => run.to === 4).length, after.runs);
    }
  }
  assert.deepEqual(runnerRuns({ first: true, second: false, third: false }, "walk", false), [{ from: 1, to: 1 }]);
});

test("走る距離は加速して最高速に乗り、塁で止まる", () => {
  const length = 27.43;
  const vmax = 6;
  const done = runDuration(length, vmax);
  assert.ok(Math.abs(runDistance(done, length, vmax) - length) < 1e-6);
  assert.ok(runDistance(done - 0.5, length, vmax) < length);
  assert.equal(runDistance(done + 3, length, vmax), length);
  const a = runDistance(0.9 - 1e-6, length, vmax);
  const b = runDistance(0.9 + 1e-6, length, vmax);
  assert.ok(Math.abs(a - b) < 1e-4);
  const withStart = runDuration(length, vmax, 2.5);
  assert.ok(withStart < done);
});

test("塁間の経路は塁を順にたどる", () => {
  const path = runnerPath(basePoint(1), 1, 4);
  assert.equal(path.length, 4);
  assert.ok(Math.abs(pathLengthFt(path.slice(0, 3)) - 180) < 1e-6);
  assert.ok(Math.abs(pathLengthFt(path) - 270) < 1.5);
  const second = pointAlong(path, 90);
  assert.ok(Math.abs(second.x - basePoint(2).x) < 1e-6 && Math.abs(second.y - basePoint(2).y) < 1e-6);
});

test("Pitch のリリースは tStart、打者のインパクトは tPlate に合う", () => {
  const tStart = 0.42;
  assert.equal(leadIn({ kind: "pitch", tStart }), tStart - PITCH_RELEASE_S);
  assert.equal(leadIn({ kind: "batted", tStart: 0 }), 0);
  assert.ok(Math.abs(pitchClipTime(tStart, tStart, 3.77) - PITCH_RELEASE_S) < 1e-12);
  assert.equal(pitchClipTime(leadIn({ kind: "pitch", tStart }), tStart, 3.77), 0);

  const tPlate = 0.82;
  const swing = { duration: 0.15 };
  assert.ok(Math.abs(batClipTime({ t: tPlate, tPlate, swing, fair: true, duration: 2.93 }) - BAT_CONTACT_S) < 1e-12);
  assert.equal(batClipTime({ t: tPlate + 5, tPlate, swing: null, fair: false, duration: 2.93 }), BAT_TAKE_HOLD_S);
  assert.equal(batClipTime({ t: tPlate + 5, tPlate, swing, fair: false, duration: 2.93 }), BAT_FOLLOW_END_S);
  assert.ok(batClipTime({ t: tPlate + 5, tPlate, swing, fair: true, duration: 2.93 }) > 2.9);
  let previous = -1;
  for (let t = tPlate - 3; t < tPlate + 3; t += 0.005) {
    const time = batClipTime({ t, tPlate, swing, fair: true, duration: 2.93 });
    assert.ok(time >= previous - 1e-12);
    previous = time;
  }
});

test("バットの握りはインパクトの前後だけ切り替わり、途中で跳ばない", () => {
  assert.equal(batGripBlend(0.5), 0);
  assert.equal(batGripBlend(BAT_SWING_START_S), 0);
  assert.equal(batGripBlend(BAT_CONTACT_S), 1);
  assert.equal(batGripBlend(BAT_FOLLOW_END_S), 0);
  let previous = batGripBlend(0);
  for (let time = 0; time <= 2.9; time += 0.001) {
    const weight = batGripBlend(time);
    assert.ok(Math.abs(weight - previous) < 0.03, `${time.toFixed(3)} 秒で跳んだ`);
    previous = weight;
  }
});

test("投手の軸足は投手板の前縁に付き、投手板から外れない", () => {
  const right = pitcherFeet({ x: -2 }, "R");
  const pivotY = right.y + PITCH_PIVOT_BACK_M / FEET_TO_METERS;
  assert.ok(pivotY < RUBBER_FRONT_FT && pivotY > RUBBER_FRONT_FT - 0.5);
  assert.ok(right.x > -1.2 && right.x < 0);
  const left = pitcherFeet({ x: 2 }, "L");
  assert.ok(left.x < 1.2 && left.x > 0);
  assert.equal(pitcherFeet({ x: -9 }, "R").x, -1.2);
});

test("本塁打で自分の打席の目線になっているときだけ、打った後の打者を消す", () => {
  const base = { preset: "lhh", bats: "L" as const, homeRun: true, tPlate: 0.4, t: 1 };
  assert.equal(batterIsCamera(base), true);
  assert.equal(batterIsCamera({ ...base, t: 0.3 }), false);
  assert.equal(batterIsCamera({ ...base, homeRun: false }), false);
  assert.equal(batterIsCamera({ ...base, preset: "rhh" }), false);
  assert.equal(batterIsCamera({ ...base, preset: "catcher" }), false);
  assert.equal(batterIsCamera({ ...base, tPlate: null }), false);
  assert.equal(batterIsCamera({ ...base, preset: "rhh", bats: "R" }), true);
});
