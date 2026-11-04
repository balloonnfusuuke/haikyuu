import assert from "node:assert/strict";
import test from "node:test";
import { IDENTITY_FRAME } from "../lib/coords";
import {
  CONVICTION_DELAY_S,
  CONVICTION_DISTANCE_M,
  convictionOffset,
  convictionTravel,
} from "../lib/walk";

const hit = { preset: "rhh", homeRun: true, hit: true, tContact: 0.4 };

test("本塁打の打者目線だけ、接触のあと一塁へ歩く", () => {
  assert.equal(convictionTravel({ ...hit, t: 0.4 }).distanceM, 0);
  assert.equal(convictionTravel({ ...hit, t: 0.4 + CONVICTION_DELAY_S - 0.05 }).distanceM, 0);
  assert.equal(convictionTravel({ ...hit, preset: "catcher", t: 3 }).distanceM, 0);
  assert.equal(convictionTravel({ ...hit, homeRun: false, t: 3 }).distanceM, 0);
  assert.equal(convictionTravel({ ...hit, hit: false, t: 3 }).distanceM, 0);
  assert.equal(convictionTravel({ ...hit, preset: "lhh", t: 4 }).distanceM > 1, true);
});

test("歩きは一塁側のファウルライン方向で、距離は頭打ち", () => {
  const early = convictionTravel({ ...hit, t: 2.5 });
  const later = convictionTravel({ ...hit, t: 4.5 });
  assert.ok(later.distanceM > early.distanceM);
  const done = convictionTravel({ ...hit, t: 30 });
  assert.equal(done.distanceM, CONVICTION_DISTANCE_M);
  assert.equal(done.bobM, 0);
  const shift = convictionOffset(IDENTITY_FRAME, later.distanceM, 0);
  assert.ok(shift.x > 0.8);
  assert.ok(shift.z < -0.8);
  assert.ok(Math.abs(shift.x + shift.z) < 1e-9);
});

test("足の上下は途中だけで、立ち位置では消える", () => {
  assert.equal(convictionTravel({ ...hit, t: 0.5 }).bobM, 0);
  let peak = 0;
  for (let t = 1.2; t < 6; t += 0.05) {
    peak = Math.max(peak, Math.abs(convictionTravel({ ...hit, t }).bobM));
  }
  assert.ok(peak > 0.008);
  assert.ok(peak <= 0.02);
  assert.equal(convictionTravel({ ...hit, t: 40 }).bobM, 0);
});
