import assert from "node:assert/strict";
import test from "node:test";
import { getClip, sampleAt } from "../lib/clips";
import { PLATE_FRONT_FT } from "../lib/field-constants";
import { magnusDirection, spinAxisStatcast } from "../lib/spin";
import { solvePitch, speedMph } from "../lib/trajectory";
import { statcastToThree } from "../lib/coords";

test("等速の球はプレート前端でリリースの x, z を保つ", () => {
  const solved = solvePitch({
    releaseX: 1,
    releaseY: 54,
    releaseZ: 3,
    vx0: 0,
    vy0: -100,
    vz0: 0,
    ax: 0,
    ay: 0,
    az: 0,
  });
  const atPlate = solved.position(solved.tPlate);
  const atRelease = solved.position(solved.tRelease);
  assert.ok(Math.abs(atRelease.x - 1) < 1e-9);
  assert.ok(Math.abs(atRelease.y - 54) < 1e-9);
  assert.ok(Math.abs(atRelease.z - 3) < 1e-9);
  assert.ok(Math.abs(atPlate.y - PLATE_FRONT_FT) < 1e-9);
  assert.ok(Math.abs(atPlate.x - 1) < 1e-9);
  assert.ok(Math.abs(atPlate.z - 3) < 1e-9);

  const three = statcastToThree(atPlate.x, atPlate.y, atPlate.z);
  assert.ok(Math.abs(three.x - 0.3048) < 1e-9);
  assert.ok(Math.abs(three.y - 0.9144) < 1e-9);
  assert.ok(Math.abs(three.z + PLATE_FRONT_FT * 0.3048) < 1e-9);
});

test("フォーシームはストライクゾーンを通り、到達位置が軌道と一致する", () => {
  const clip = getClip("ff");
  assert.ok(clip.tPlate != null && clip.plateX != null && clip.plateZ != null);
  const atPlate = sampleAt(clip.samples, clip.tPlate);
  assert.ok(Math.abs(atPlate.y - PLATE_FRONT_FT) < 1e-6);
  assert.ok(Math.abs(atPlate.x - clip.plateX) < 1e-6);
  assert.ok(Math.abs(atPlate.z - clip.plateZ) < 1e-6);
  assert.ok(Math.abs(clip.plateX) < 8.5 / 12);
  assert.ok(clip.plateZ > clip.szBot && clip.plateZ < clip.szTop);
  assert.ok(clip.release != null && clip.release.mph > 90 && clip.release.mph < 100);
});

test("スピン軸 180° はバックスピンで真上に力が出る", () => {
  const back = spinAxisStatcast(180);
  assert.ok(Math.abs(back.x + 1) < 1e-12);
  assert.ok(Math.abs(back.y) < 1e-12);
  assert.ok(Math.abs(back.z) < 1e-12);
  const up = magnusDirection(180);
  assert.ok(Math.abs(up.x) < 1e-12);
  assert.ok(Math.abs(up.z - 1) < 1e-12);
  const topspin = magnusDirection(0);
  assert.ok(Math.abs(topspin.z + 1) < 1e-12);
  const glove = magnusDirection(90);
  assert.ok(Math.abs(glove.x - 1) < 1e-12);
  assert.ok(Math.abs(glove.z) < 1e-12);
  const fastball = magnusDirection(221);
  assert.ok(fastball.x < 0);
  assert.ok(fastball.z > 0);
});

test("速度の単位換算", () => {
  assert.ok(Math.abs(speedMph({ x: 0, y: -146.667, z: 0 }) - 100) < 0.01);
});
