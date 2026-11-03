import assert from "node:assert/strict";
import test from "node:test";
import {
  FEET_TO_METERS,
  distance3,
  frameFromMarkers,
  statcastDirToWorld,
  statcastToThree,
  statcastToWorld,
  threeToStatcast,
  worldToStatcast,
} from "../lib/coords";
import {
  assessRubberDistance,
  regulationFrame,
  regulationMarkerPositions,
  rubberDistanceOfRegulation,
} from "../lib/field";
import { CATCHER_CAM_BACK_M, CATCHER_CAM_HEIGHT_M, RUBBER_FRONT_FT } from "../lib/field-constants";

test("statcastToThree は (x, z, -y) に 0.3048 を掛ける", () => {
  const x = statcastToThree(1, 0, 0);
  const y = statcastToThree(0, 1, 0);
  const z = statcastToThree(0, 0, 1);
  assert.deepEqual(x, { x: FEET_TO_METERS, y: 0, z: 0 });
  assert.deepEqual(y, { x: 0, y: 0, z: -FEET_TO_METERS });
  assert.deepEqual(z, { x: 0, y: FEET_TO_METERS, z: 0 });
  assert.deepEqual(statcastToThree(0, 0, 0), { x: 0, y: 0, z: 0 });
});

test("threeToStatcast は往復する", () => {
  const back = threeToStatcast(statcastToThree(2.25, 54.5, 6.1));
  assert.ok(Math.abs(back.x - 2.25) < 1e-9);
  assert.ok(Math.abs(back.y - 54.5) < 1e-9);
  assert.ok(Math.abs(back.z - 6.1) < 1e-9);
});

test("捕手カメラの規定位置は Three.js で (0, 1.1, 2.5)", () => {
  const cam = statcastToThree(0, -CATCHER_CAM_BACK_M / FEET_TO_METERS, CATCHER_CAM_HEIGHT_M / FEET_TO_METERS);
  assert.ok(Math.abs(cam.x) < 1e-9);
  assert.ok(Math.abs(cam.y - 1.1) < 1e-9);
  assert.ok(Math.abs(cam.z - 2.5) < 1e-9);
});

test("投手板前縁は水平距離 60.5 ft で、3D 距離は 18.44 m ± 5 cm", () => {
  const markers = regulationMarkerPositions();
  const horizontal = Math.hypot(markers.rubber.x, markers.rubber.z);
  assert.ok(Math.abs(horizontal - RUBBER_FRONT_FT * FEET_TO_METERS) < 1e-9);
  const distance = rubberDistanceOfRegulation();
  const assessment = assessRubberDistance(distance);
  assert.equal(assessment.ok, true);
  assert.ok(Math.abs(distance - 18.44) <= 0.05);
});

test("ずらした投手板は警告になる", () => {
  const bad = assessRubberDistance(18.44 + 0.08);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /警告/);
});

test("回転した球場でも Statcast 座標は往復する", () => {
  const plate = { x: 4, y: 1, z: -2 };
  // プレートを動かし、投手方向をワールドの +X に向けた目印。
  const movedRubber = { x: plate.x + 18.44, y: plate.y + 0.25, z: plate.z };
  const frame = frameFromMarkers(plate, movedRubber);
  assert.equal(frame.degenerate, false);
  const world = statcastToWorld(frame, -1.5, 54, 6);
  const back = worldToStatcast(frame, world);
  assert.ok(Math.abs(back.x + 1.5) < 1e-9);
  assert.ok(Math.abs(back.y - 54) < 1e-9);
  assert.ok(Math.abs(back.z - 6) < 1e-9);
  const axis = statcastDirToWorld(frame, { x: 0, y: 0, z: 1 });
  assert.ok(Math.abs(axis.y - 1) < 1e-9);
  assert.ok(distance3(plate, movedRubber) > 18);
  assert.ok(Math.abs(regulationFrame().forward.z + 1) < 1e-9);
  assert.ok(Math.abs(regulationFrame().right.x - 1) < 1e-9);
});
