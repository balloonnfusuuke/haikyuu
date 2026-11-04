import assert from "node:assert/strict";
import test from "node:test";
import type { Clip } from "../lib/clips";
import { gazeSample, gazeTracking, lookAngleDeg, stepGaze, type GazePoint } from "../lib/gaze";

const camera: GazePoint = { x: 0, y: 2, z: 8 };
const rest: GazePoint = { x: 0, y: 1, z: 0 };
const fly: GazePoint = { x: 14, y: 9, z: -24 };

function pitch(noise: Clip["noise"], tPlate = 0.45): Pick<Clip, "kind" | "noise" | "tPlate" | "tStart" | "tEnd" | "samples"> {
  return {
    kind: "pitch",
    noise,
    tPlate,
    tStart: 0,
    tEnd: 4,
    samples: [
      { t: tPlate, x: 0, y: 1.7, z: 2.5 },
      { t: tPlate + 1, x: 20, y: 180, z: 40 },
    ],
  };
}

test("接触前と見逃しでは視線を動かさない", () => {
  const hit = pitch("hit");
  assert.equal(gazeTracking(hit, 0.45), false);
  assert.equal(gazeTracking(hit, 0.45 + 0.15 - 0.01), false);
  assert.equal(gazeSample(hit, 0.5), null);
  assert.equal(gazeTracking(pitch("catch"), 2), false);
  assert.equal(gazeTracking(pitch(null), 2), false);
  const stayed = stepGaze({ camera, target: rest, rest, focus: null, dt: 1 / 60 });
  assert.ok(lookAngleDeg(camera, stayed, rest) < 0.05);
});

test("打球の少し先へ向き、1フレームの回転は上限を超えない", () => {
  assert.equal(gazeTracking(pitch("hit"), 0.45 + 0.15), true);
  const sample = gazeSample(pitch("hit"), 0.45 + 0.15);
  assert.ok(sample);
  assert.ok(sample.t > 0.45 + 0.15);

  let target = rest;
  let previous = rest;
  const dt = 1 / 60;
  for (let i = 0; i < 90; i += 1) {
    target = stepGaze({ camera, target, rest, focus: fly, dt });
    const turned = lookAngleDeg(camera, previous, target);
    assert.ok(turned <= 120 * dt + 0.05, `frame ${i} turned ${turned}`);
    previous = target;
  }
  const left = lookAngleDeg(camera, target, fly);
  assert.ok(left < 8, `still ${left} deg off the fly`);
});

test("長いフレームでも頭は一周しない", () => {
  const next = stepGaze({ camera, target: rest, rest, focus: fly, dt: 0.5 });
  const turned = lookAngleDeg(camera, rest, next);
  assert.ok(turned <= 60.2, `turned ${turned}`);
  assert.ok(turned > 20);
});

test("打球が終わるとプレートへ戻る", () => {
  let target = fly;
  const dt = 1 / 60;
  for (let i = 0; i < 120; i += 1) {
    const previous = target;
    target = stepGaze({ camera, target, rest, focus: null, dt });
    assert.ok(lookAngleDeg(camera, previous, target) <= 120 * dt + 0.05);
  }
  assert.ok(lookAngleDeg(camera, target, rest) < 2);
});

test("単体の打球クリップも反応のあとから追う", () => {
  const liner = {
    kind: "batted" as const,
    noise: null,
    tPlate: null,
    tStart: 0,
    tEnd: 3,
    samples: [
      { t: 0, x: 0, y: 2, z: 3 },
      { t: 3, x: 10, y: 200, z: 8 },
    ],
  };
  assert.equal(gazeTracking(liner, 0.1), false);
  assert.equal(gazeTracking(liner, 0.15), true);
});
