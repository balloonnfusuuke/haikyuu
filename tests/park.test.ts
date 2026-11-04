import assert from "node:assert/strict";
import test from "node:test";
import { fenceDistance, FENCE_HEIGHT_FT } from "../lib/fence";
import { resolveFairBall } from "../lib/park";

function at(angle: number, distance = 300) {
  const rad = (angle * Math.PI) / 180;
  return { x: Math.sin(rad) * distance, y: Math.cos(rad) * distance };
}

function play(partial: {
  ev: number;
  la: number;
  angle: number;
  carry: number;
  ground?: boolean;
}) {
  const aim = at(partial.angle);
  return resolveFairBall({
    x: 0.1,
    y: 17 / 12,
    z: 2.6,
    speedMph: partial.ev,
    launchDeg: partial.la,
    aimX: aim.x,
    aimY: aim.y,
    carryFt: partial.carry,
    ground: partial.ground ?? false,
    bbType: partial.ground ? "ground_ball" : "fly_ball",
  });
}

test("甲子園は中堅が両翼より深く、左右は同じ", () => {
  assert.ok(fenceDistance(0) > fenceDistance(45) + 50);
  assert.ok(Math.abs(fenceDistance(-20) - fenceDistance(20)) < 0.2);
  assert.ok(fenceDistance(45) < 320);
  assert.ok(fenceDistance(0) > 380);
  assert.ok(FENCE_HEIGHT_FT > 9 && FENCE_HEIGHT_FT < 9.4);
});

test("飛距離が壁を越える高いフライは本塁打で、壁の外まで飛ぶ", () => {
  const flown = play({ ev: 110, la: 28, angle: 0, carry: 430 });
  assert.equal(flown.play.bip, "home_run");
  assert.equal(flown.play.cleared, true);
  assert.ok((flown.play.heightFt ?? 0) > FENCE_HEIGHT_FT);
  const end = flown.samples[flown.samples.length - 1];
  assert.ok(Math.hypot(end.x, end.y) > fenceDistance(0));
});

test("中堅の前に落ちるフライは本塁打にしない", () => {
  const flown = play({ ev: 102, la: 26, angle: -13, carry: 360 });
  assert.notEqual(flown.play.bip, "home_run");
  assert.equal(flown.play.cleared, false);
  assert.equal(flown.play.how, "catch");
  assert.equal(flown.play.fielder, "左翼");
});

test("壁に届くが越えない球は二塁打で、壁の中には入らない", () => {
  const flown = play({ ev: 100, la: 24, angle: 0, carry: 400 });
  assert.equal(flown.play.bip, "double");
  assert.equal(flown.play.how, "wall");
  const end = flown.samples[flown.samples.length - 1];
  assert.ok(Math.hypot(end.x, end.y) < fenceDistance(0) + 1);
});

test("ファウルラインの外は本塁打にせず、ライン上はフェア", () => {
  const outside = play({ ev: 108, la: 32, angle: 47, carry: 400 });
  assert.equal(outside.play.fair, false);
  assert.notEqual(outside.play.bip, "home_run");
  assert.match(outside.play.note, /ファウル/);
  const onTheLine = play({ ev: 105, la: 32, angle: 45, carry: 380 });
  assert.equal(onTheLine.play.fair, true);
  assert.equal(onTheLine.play.bip, "home_run");
  const downTheLine = play({ ev: 100, la: 35, angle: 40, carry: 360 });
  assert.equal(downTheLine.play.fair, true);
  assert.equal(downTheLine.play.bip, "home_run");
  const ground = play({ ev: 95, la: -6, angle: 50, carry: 160, ground: true });
  assert.equal(ground.play.how, "foul");
  assert.equal(ground.play.label, "ファウル");
});

test("遊撃の前のゴロはアウト、三遊間は単打、遅いゴロは投手が取る", () => {
  const atShort = play({ ev: 90, la: -8, angle: -16, carry: 140, ground: true });
  assert.equal(atShort.play.bip, "out");
  assert.equal(atShort.play.fielder, "遊撃");
  const hole = play({ ev: 98, la: -6, angle: -28, carry: 160, ground: true });
  assert.equal(hole.play.bip, "single");
  assert.equal(hole.play.label, "ゴロの単打");
  const slow = play({ ev: 68, la: -18, angle: 2, carry: 40, ground: true });
  assert.equal(slow.play.bip, "out");
  assert.equal(slow.play.fielder, "投手");
});
