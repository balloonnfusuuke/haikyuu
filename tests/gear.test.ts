import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { alignPointDirection } from "../lib/align";
import { mittCatches } from "../lib/gear";
import { gripDirection, handBottom, mittPlace, MITT_DROP_FT, MITT_GHOST_OPACITY } from "../lib/stance";
import { cellCenter } from "../lib/zone-grid";
import { createMitt, setMorph } from "../components/viewer/props";

test("グリップの両端は、手の位置とマーカーの間隔に合う", () => {
  const bottom = new THREE.Vector3(0.2, -0.4, 0.1);
  const top = new THREE.Vector3(0.2, -0.25, 0.1);
  const hand = new THREE.Vector3(1, 2, 3);
  const forward = new THREE.Vector3(0, 0, 1);
  const pose = alignPointDirection(bottom, top.clone().sub(bottom), new THREE.Vector3(1, 0, 0), hand, forward, new THREE.Vector3(0, 1, 0));
  const placedBottom = bottom.clone().applyQuaternion(pose.quaternion).add(pose.position);
  const placedTop = top.clone().applyQuaternion(pose.quaternion).add(pose.position);
  assert.ok(placedBottom.distanceTo(hand) < 1e-6);
  assert.ok(Math.abs(placedTop.z - (hand.z + 0.15)) < 1e-6);
  assert.ok(Math.abs(placedTop.distanceTo(placedBottom) - 0.15) < 1e-6);
});

test("ポケットは到達位置に重なり、開口は投手を向く", () => {
  const point = new THREE.Vector3(0.05, -0.02, 0.08);
  const target = new THREE.Vector3(4, 1.2, -0.4);
  const forward = new THREE.Vector3(0, 0, -1);
  const pose = alignPointDirection(
    point,
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 1, 0),
    target,
    forward,
    new THREE.Vector3(0, 1, 0),
  );
  const placed = point.clone().applyQuaternion(pose.quaternion).add(pose.position);
  const opened = new THREE.Vector3(0, 0, 1).applyQuaternion(pose.quaternion);
  assert.ok(placed.distanceTo(target) < 1e-6);
  assert.ok(opened.normalize().dot(forward.clone().normalize()) > 0.999);
});

test("左打者の手は右打者と左右が逆", () => {
  const right = handBottom("R");
  const left = handBottom("L");
  assert.ok(right.x < 0);
  assert.ok(left.x > 0);
  assert.equal(left.x, -right.x);
  assert.ok(gripDirection("R").x < 0);
  assert.ok(gripDirection("L").x > 0);
});

test("真ん中のマスはプレートの中央", () => {
  const [x, z] = cellCenter(12, 1.5, 3.5);
  assert.ok(Math.abs(x) < 1e-9);
  assert.ok(Math.abs(z - 2.5) < 1e-9);
});

test("見逃し・空振り・ボールだけ捕り、ファウルとインプレーは構えたまま", () => {
  assert.equal(mittCatches("ball"), true);
  assert.equal(mittCatches("called_strike"), true);
  assert.equal(mittCatches("swinging_strike"), true);
  assert.equal(mittCatches("foul"), false);
  assert.equal(mittCatches("in_play"), false);
  assert.equal(mittCatches(null), false);

  const shared = {
    tStart: 0,
    tPlate: 0.4,
    calledX: 0.2,
    calledZ: 2.4,
    arriveX: -0.6,
    arriveY: 1.4,
    arriveZ: 1.8,
    drop: true,
    ghost: false,
  };
  const ready = mittPlace({ ...shared, t: 0, outcome: null, catches: false });
  assert.equal(ready.x, 0.2);
  assert.equal(ready.z, 2.4);
  assert.equal(ready.close, 0);

  const flight = mittPlace({ ...shared, t: 0.1, outcome: "called_strike", catches: true });
  assert.equal(flight.x, 0.2);
  assert.ok(Math.abs(flight.z - (2.4 - MITT_DROP_FT)) < 1e-9);
  assert.equal(flight.close, 0);

  const caught = mittPlace({ ...shared, t: 0.4, outcome: "swinging_strike", catches: true });
  assert.equal(caught.x, -0.6);
  assert.equal(caught.y, 1.4);
  assert.equal(caught.z, 1.8);
  assert.equal(caught.close, 1);

  const foul = mittPlace({ ...shared, t: 0.4, outcome: "foul", catches: false });
  assert.equal(foul.x, 0.2);
  assert.equal(foul.z, 2.4);
  assert.equal(foul.close, 0);

  const mitt = createMitt();
  assert.equal(setMorph(mitt, "Close", 1), true);
  const pocket = mitt.children[0] as THREE.Mesh;
  assert.equal(pocket.morphTargetInfluences?.[0], 1);

  const ghost = mittPlace({ ...shared, t: 0.1, outcome: "ball", catches: true, drop: false, ghost: true });
  assert.equal(ghost.opacity, MITT_GHOST_OPACITY);
  const solid = mittPlace({ ...shared, t: 0.4, outcome: "ball", catches: true, drop: false, ghost: true });
  assert.equal(solid.opacity, 1);
});
