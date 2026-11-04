import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { seamAxis, seamKind } from "../lib/seam";

test("フォーシームは +X、ツーシームは +Y を spin_axis に合わせる", () => {
  assert.equal(seamKind("FF"), "four");
  assert.equal(seamKind("SL"), "four");
  assert.equal(seamKind("CU"), "four");
  assert.equal(seamKind("SI"), "two");
  assert.equal(seamKind("FT"), "two");
  assert.deepEqual(seamAxis("FF"), { x: 1, y: 0, z: 0 });
  assert.deepEqual(seamAxis("SI"), { x: 0, y: 1, z: 0 });

  const local = new THREE.Vector3(1, 0, 0);
  const world = new THREE.Vector3(0.2, 0.9, 0.3).normalize();
  const align = new THREE.Quaternion().setFromUnitVectors(local, world);
  const spin = new THREE.Quaternion().setFromAxisAngle(local, 0.4);
  const posed = local.clone().applyQuaternion(align.clone().multiply(spin));
  assert.ok(posed.distanceTo(world) < 1e-6);
});
