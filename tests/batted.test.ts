import assert from "node:assert/strict";
import test from "node:test";
import { hcToFeet, integrateContact } from "../lib/batted";
import { gripDirection, handBottom, swingDirection } from "../lib/stance";

function flat(x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot(x1 - x0, y1 - y0);
}

test("フライは初速と角度のまま、落下距離だけ hc に合う", () => {
  const target = hcToFeet(160, 90);
  const start = { x: 0.2, y: 17 / 12, z: 2.6 };
  const flown = integrateContact({
    ...start,
    speedMph: 104,
    launchDeg: 28,
    targetX: target.x,
    targetY: target.y,
    ground: false,
  });
  const want = flat(start.x, start.y, target.x, target.y);
  const got = flat(start.x, start.y, flown.landing.x, flown.landing.y);
  assert.ok(Math.abs(got - want) < 6, `落下 ${got.toFixed(1)} ft、hc ${want.toFixed(1)} ft`);
  const along = (flown.landing.x - start.x) * (target.x - start.x) + (flown.landing.y - start.y) * (target.y - start.y);
  assert.ok(along > 0);
});

test("ゴロは hc の距離で止まる", () => {
  const target = hcToFeet(145, 160);
  const start = { x: -0.1, y: 17 / 12, z: 2.4 };
  const flown = integrateContact({
    ...start,
    speedMph: 88,
    launchDeg: -4,
    targetX: target.x,
    targetY: target.y,
    ground: true,
  });
  const want = flat(start.x, start.y, target.x, target.y);
  const got = flat(start.x, start.y, flown.landing.x, flown.landing.y);
  assert.ok(Math.abs(got - want) < 1.5, `停止 ${got.toFixed(1)} ft、hc ${want.toFixed(1)} ft`);
  assert.ok(flown.samples.some((sample) => sample.z > 0.2));
});

test("インパクトでバットの軸が球を向き、その後構えに戻る", () => {
  const ready = gripDirection("R");
  const ball = { x: 0.15, y: 1.42, z: 2.7 };
  const before = swingDirection({ bats: "R", t: 0.1, tPlate: 0.46, duration: 0.2, miss: false, ball });
  assert.ok(Math.abs(before.x - ready.x) < 1e-9);
  const impact = swingDirection({ bats: "R", t: 0.46, tPlate: 0.46, duration: 0.2, miss: false, ball });
  const hand = handBottom("R");
  const toward = { x: ball.x - hand.x, y: ball.y - hand.y, z: ball.z - hand.z };
  const dot = impact.x * toward.x + impact.y * toward.y + impact.z * toward.z;
  assert.ok(dot / Math.hypot(toward.x, toward.y, toward.z) > 0.98);
  const miss = swingDirection({ bats: "R", t: 0.46, tPlate: 0.46, duration: 0.2, miss: true, ball });
  assert.ok(miss.z < impact.z);
  const back = swingDirection({ bats: "R", t: 1.2, tPlate: 0.46, duration: 0.2, miss: false, ball });
  assert.ok(Math.abs(back.x - ready.x) < 1e-9 && Math.abs(back.z - ready.z) < 1e-9);
});
