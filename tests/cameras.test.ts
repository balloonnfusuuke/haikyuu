import assert from "node:assert/strict";
import test from "node:test";
import { IDENTITY_FRAME, statcastToThree } from "../lib/coords";
import { cameraPose, isViewShell } from "../lib/field";

test("外殻の名前だけを透かす対象にする", () => {
  assert.equal(isViewShell("Wall_Outfield"), true);
  assert.equal(isViewShell("Stand_Infield"), true);
  assert.equal(isViewShell("Backstop_Net"), true);
  assert.equal(isViewShell("Roof_Ginsan"), true);
  assert.equal(isViewShell("Scoreboard"), true);
  assert.equal(isViewShell("BackScreen"), true);
  assert.equal(isViewShell("Field_Grass"), false);
  assert.equal(isViewShell("HomePlate"), false);
  assert.equal(isViewShell("LightTower_01"), false);
});

test("席の視点はプレーを挟んで壁の向こうにある", () => {
  const backnet = cameraPose("backnet", IDENTITY_FRAME, null);
  const outfield = cameraPose("outfield", IDENTITY_FRAME, null);
  const infield = cameraPose("infield", IDENTITY_FRAME, null);
  const behind = statcastToThree(0, -70, 14);
  assert.ok(Math.abs(backnet.position.z - behind.z) < 1e-6);
  assert.ok(backnet.position.z > 18.5);
  assert.ok(outfield.position.z < -110);
  assert.ok(outfield.position.x > 18);
  assert.ok(infield.position.x > 15);
  assert.ok(infield.position.y > 4);
  assert.ok(infield.position.z < 0);
});
