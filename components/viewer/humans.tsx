"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { alignPointDirection } from "@/lib/align";
import { FEET_TO_METERS, statcastDirToWorld, statcastToWorld, type FieldFrame } from "@/lib/coords";
import type { Clip } from "@/lib/clips";
import type { CameraPreset } from "@/lib/field";
import { MOUND_HEIGHT_FT } from "@/lib/field-constants";
import { getGear } from "@/lib/gear";
import {
  BAT_LEFTY_HANDOFF_S,
  BATTER_RUNNER_V0,
  basePoint,
  batClipTime,
  batGripBlend,
  batHandoffDelay,
  batterIsCamera,
  HUMAN_CLIP,
  HUMAN_URL,
  headingAlong,
  leadOffPoint,
  loopDrift,
  pathLengthFt,
  pitchClipTime,
  pitcherFeet,
  pointAlong,
  runDistance,
  runDuration,
  runnerPath,
  runnerRuns,
  runPhase,
  runSpeed,
  sampleKeys,
  type LoopDrift,
  type Point,
  type RunnerRun,
} from "@/lib/mixamo";
import { getSim } from "@/lib/sim";
import { batterFeet } from "@/lib/stance";
import { createBaseball, loadGltfAsset, type MarkerFrame } from "./props";

/** 投手が球を持っているあいだ、PitchBall はリリース位置の球を隠す。 */
export const pitcherHold = { active: false };

/** 右手の骨（mixamorig:RightHand）から見た拳の中心。指の付け根と手首の間で、手のひら側へ寄せる。 */
const FIST_LOCAL = new THREE.Vector3(0.0, 0.07, 0.02);
/** 握ったバットの軸（グリップから先端へ）。人差し指と小指の付け根を結ぶ向き。 */
const BAT_AXIS_LOCAL = new THREE.Vector3(0.226, -0.034, 0.973).normalize();
/** インパクトでバットがほぼ水平に、投球線と直交して本塁の上へ出る握り。 */
const BAT_CONTACT_AXIS_LOCAL = new THREE.Vector3(0.092, 0.622, 0.778).normalize();
const BAT_UP_LOCAL = new THREE.Vector3(0, 1, 0);
/** 投手の球は拳の中、少し指先側。 */
const BALL_LOCAL = new THREE.Vector3(0.0, 0.1, 0.03);

/** 塁上で待つ姿勢。MixamoPitch の最初のフレームは、足を開いて手を下ろした構えになっている。 */
const IDLE = { clip: HUMAN_CLIP.pitchSpare, time: 0, yaw: THREE.MathUtils.degToRad(76) };
const RUN_BLEND_S = 0.2;
const STOP_BLEND_S = 0.3;

export type HumanTemplate = {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  drift: LoopDrift;
  hipsName: string;
};

let templateLoad: Promise<HumanTemplate | null> | null = null;

export function loadHumanTemplate(): Promise<HumanTemplate | null> {
  templateLoad ??= (async () => {
    const asset = await loadGltfAsset(HUMAN_URL).catch((error: unknown) => {
      console.warn("[plate-tip] human_mixamo.glb を読めませんでした。", error);
      return null;
    });
    if (!asset) return null;
    const clips = new Map(asset.animations.map((clip) => [clip.name, clip]));
    const missing = Object.values(HUMAN_CLIP).filter((name) => !clips.has(name));
    if (missing.length > 0) {
      console.warn(`[plate-tip] human_mixamo.glb にクリップ ${missing.join(", ")} がありません。`);
      return null;
    }
    const hips = findBone(asset.scene, "Hips");
    const run = clips.get(HUMAN_CLIP.run)!;
    const track = hips ? run.tracks.find((item) => item.name === `${hips.name}.position`) : undefined;
    if (!hips || !track) {
      console.warn("[plate-tip] MixamoRun に Hips の移動がありません。");
      return null;
    }
    const forward = Array.from({ length: track.times.length }, (_, index) => track.values[index * 3 + 2]);
    return { scene: asset.scene, clips, drift: loopDrift(track.times, forward), hipsName: hips.name };
  })();
  return templateLoad;
}

function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(`mixamorig${name}`) ?? root.getObjectByName(`mixamorig:${name}`) ?? null;
}

type HumanRig = {
  root: THREE.Group;
  mirror: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  hips: THREE.Object3D | null;
  head: THREE.Object3D | null;
  rightHand: THREE.Object3D | null;
  skins: THREE.SkinnedMesh[];
};

/**
 * GLTFLoader も SkeletonUtils.clone もメッシュごとに骨格を作るので、同じ骨と逆行列のものを 1 つにまとめる。
 * 骨格ごとに毎フレームの行列計算とボーンテクスチャの転送があり、人数分だと重い。
 */
function shareSkeletons(model: THREE.Object3D): void {
  const shared: THREE.Skeleton[] = [];
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const same = shared.find((skeleton) => sameSkeleton(skeleton, mesh.skeleton));
    if (same) mesh.bind(same, mesh.bindMatrix);
    else shared.push(mesh.skeleton);
  });
}

function sameSkeleton(a: THREE.Skeleton, b: THREE.Skeleton): boolean {
  if (a.bones.length !== b.bones.length) return false;
  return a.bones.every((bone, index) => bone === b.bones[index] && a.boneInverses[index].equals(b.boneInverses[index]));
}

function makeRig(template: HumanTemplate): HumanRig {
  const model = cloneSkinned(template.scene);
  shareSkeletons(model);
  const skins: THREE.SkinnedMesh[] = [];
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = castsShadow(mesh);
    mesh.boundingSphere = new THREE.Sphere();
    if (/Teeth|Tongue/.test(`${mesh.name} ${mesh.parent?.name ?? ""}`)) mesh.visible = false;
    else skins.push(mesh);
  });
  const mirror = new THREE.Group();
  mirror.add(model);
  const root = new THREE.Group();
  root.add(mirror);
  return {
    root,
    mirror,
    model,
    mixer: new THREE.AnimationMixer(model),
    actions: new Map(),
    hips: findBone(model, "Hips"),
    head: findBone(model, "Head"),
    rightHand: findBone(model, "RightHand"),
    skins,
  };
}

/** 影は体と服だけが落とす。目や帽子の小物まで影に描くと、人数分だけ描画が増える。 */
function castsShadow(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.some((material) => material.transparent)) return false;
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z) >= 0.25;
}

/** StrictMode の仮アンマウントのあとにも呼ばれるので、何度でも張り直せる。 */
function bindActions(rig: HumanRig, template: HumanTemplate): void {
  for (const [name, clip] of template.clips) {
    const action = rig.mixer.clipAction(clip);
    action.play();
    action.enabled = false;
    rig.actions.set(name, action);
  }
}

function unbindActions(rig: HumanRig): void {
  rig.mixer.stopAllAction();
  rig.mixer.uncacheRoot(rig.model);
  rig.actions.clear();
}

type Layer = { name: string; time: number; weight: number };

/** クリップの時刻を直接置く。mixer は時間を進めず、その時刻の姿勢だけを当てる。 */
function poseRig(rig: HumanRig, layers: Layer[]): void {
  for (const [name, action] of rig.actions) {
    const layer = layers.find((item) => item.name === name && item.weight > 1e-3);
    if (!layer) {
      action.enabled = false;
      continue;
    }
    action.enabled = true;
    action.setEffectiveWeight(layer.weight);
    action.time = Math.min(Math.max(layer.time, 0), action.getClip().duration - 1e-4);
  }
  rig.mixer.update(0);
}

const scratch = new THREE.Vector3();
const gripAxis = new THREE.Vector3();

/** 打者視点のようにカメラが頭の中に入るときは、体を消してバットだけ残す。 */
function hideNearCamera(rig: HumanRig, camera: THREE.Camera): void {
  if (!rig.head) return;
  rig.head.updateWorldMatrix(true, false);
  rig.head.getWorldPosition(scratch);
  const inside = scratch.distanceTo(camera.position) < 0.45;
  for (const skin of rig.skins) skin.visible = !inside;
}

/** 腰からこの半径に、腕を伸ばした姿勢や大きな踏み出しまで収まる。 */
const BODY_RADIUS_M = 1.8;
const toLocal = new THREE.Matrix4();

/**
 * 骨で動く体はジオメトリから境界球を出せないので、腰を中心にした球を毎フレーム与えて画面外の人を省く。
 * 影もライトから見て同じ球で省かれる。
 */
function updateBounds(rig: HumanRig): void {
  if (!rig.hips) return;
  rig.hips.updateWorldMatrix(true, false);
  rig.hips.getWorldPosition(scratch);
  for (const skin of rig.skins) {
    skin.updateWorldMatrix(true, false);
    const sphere = skin.boundingSphere!;
    sphere.center.copy(scratch).applyMatrix4(toLocal.copy(skin.matrixWorld).invert());
    sphere.radius = BODY_RADIUS_M / skin.matrixWorld.getMaxScaleOnAxis();
  }
}

/** モデルの +Z を Statcast の水平方向へ、+Y を上へ向ける。 */
function faceQuaternion(frame: FieldFrame, direction: Point, yaw = 0): THREE.Quaternion {
  const forward = statcastDirToWorld(frame, { x: direction.x, y: direction.y, z: 0 });
  const f = new THREE.Vector3(forward.x, forward.y, forward.z);
  const up = new THREE.Vector3(frame.up.x, frame.up.y, frame.up.z);
  const side = new THREE.Vector3().crossVectors(up, f).normalize();
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, f));
  if (yaw !== 0) quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
  return quaternion;
}

function placeOnField(rig: HumanRig, frame: FieldFrame, at: Point, zFt: number): void {
  const world = statcastToWorld(frame, at.x, at.y, zFt);
  rig.root.position.set(world.x, world.y, world.z);
}

/**
 * 人の動きに使う時刻。投球が終わって再生が止まったあとも、打者走者が塁へ着くまで
 * 同じ速さで進める。巻き戻すと 0 に戻る。
 */
const actorClock = { key: Number.NaN, clipId: "", t: 0, after: 0 };

function actorTime(clip: Clip, key: number, delta: number): number {
  if (actorClock.key === key && actorClock.clipId === clip.id) return actorClock.t;
  actorClock.key = key;
  const sim = getSim();
  if (actorClock.clipId !== clip.id || sim.t < clip.tEnd - 1e-6) {
    actorClock.after = 0;
    actorClock.clipId = clip.id;
  } else {
    actorClock.after = Math.min(actorClock.after + Math.min(delta, 0.05) * sim.speed, 60);
  }
  actorClock.t = sim.t + actorClock.after;
  return actorClock.t;
}

function useRig(template: HumanTemplate): HumanRig {
  const rig = useMemo(() => makeRig(template), [template]);
  useEffect(() => {
    bindActions(rig, template);
    return () => unbindActions(rig);
  }, [rig, template]);
  return rig;
}

export function HumanPitcher({ template, clip, frame }: { template: HumanTemplate; clip: Clip; frame: FieldFrame }) {
  const rig = useRig(template);
  const duration = template.clips.get(HUMAN_CLIP.pitch)!.duration;
  const ball = useMemo(() => {
    const held = createBaseball();
    held.position.copy(BALL_LOCAL);
    return held;
  }, []);

  useEffect(() => {
    rig.rightHand?.add(ball);
    pitcherHold.active = true;
    return () => {
      ball.removeFromParent();
      pitcherHold.active = false;
    };
  }, [rig, ball]);

  const placement = useMemo(() => {
    const feet = pitcherFeet(clip.release, clip.throws);
    return { feet, quaternion: faceQuaternion(frame, { x: 0, y: -1 }) };
  }, [clip.release, clip.throws, frame]);

  useFrame((state, delta) => {
    const t = actorTime(clip, state.clock.elapsedTime, delta);
    placeOnField(rig, frame, placement.feet, MOUND_HEIGHT_FT);
    rig.root.quaternion.copy(placement.quaternion);
    rig.mirror.scale.x = clip.throws === "L" ? -1 : 1;
    const time = clip.kind === "pitch" ? pitchClipTime(t, clip.tStart, duration) : duration;
    poseRig(rig, [{ name: HUMAN_CLIP.pitch, time, weight: 1 }]);
    ball.visible = clip.kind === "pitch" && t < clip.tStart;
    hideNearCamera(rig, state.camera);
    updateBounds(rig);
  });

  return <primitive object={rig.root} />;
}

export function HumanBatter({
  template,
  clip,
  frame,
  preset,
  bat,
  grip,
}: {
  template: HumanTemplate;
  clip: Clip;
  frame: FieldFrame;
  preset: CameraPreset;
  bat: THREE.Object3D;
  grip: { bottom: MarkerFrame; top: MarkerFrame } | null;
}) {
  const rig = useRig(template);
  const duration = template.clips.get(HUMAN_CLIP.bat)!.duration;

  const holder = useMemo(() => {
    const group = new THREE.Group();
    group.name = "BatInHand";
    group.add(bat.clone(true));
    return group;
  }, [bat]);

  useEffect(() => {
    if (!rig.rightHand || !grip) return;
    rig.rightHand.add(holder);
    return () => {
      holder.removeFromParent();
    };
  }, [rig, holder, grip]);

  useFrame((state, delta) => {
    const t = actorTime(clip, state.clock.elapsedTime, delta);
    const gear = getGear();
    const feet = batterFeet(gear.bats);
    placeOnField(rig, frame, feet, 0);
    rig.root.quaternion.copy(faceQuaternion(frame, { x: 0, y: 1 }));
    rig.mirror.scale.x = gear.bats === "L" ? -1 : 1;
    const fair = gear.outcome === "in_play";
    const handoff = batterHandoff(gear.bats, duration);
    const tPlate = clip.kind === "pitch" ? clip.tPlate : null;
    const time = batClipTime({ t, tPlate, swing: clip.swing ?? null, fair, duration, end: handoff });
    poseRig(rig, [{ name: HUMAN_CLIP.bat, time, weight: 1 }]);
    if (grip) {
      const axis = gripAxis.copy(BAT_AXIS_LOCAL).lerp(BAT_CONTACT_AXIS_LOCAL, batGripBlend(time)).normalize();
      const pose = alignPointDirection(
        grip.top.point,
        grip.top.point.clone().sub(grip.bottom.point),
        grip.top.up,
        FIST_LOCAL,
        axis,
        BAT_UP_LOCAL,
      );
      holder.position.copy(pose.position);
      holder.quaternion.copy(pose.quaternion);
    }
    const isCamera = batterIsCamera({ preset, bats: gear.bats, homeRun: gear.homeRun, tPlate, t });
    rig.root.visible = !isCamera && !(fair && tPlate != null && t >= tPlate + batHandoffDelay(handoff));
    hideNearCamera(rig, state.camera);
    updateBounds(rig);
  });

  return <primitive object={rig.root} />;
}

function batterHandoff(bats: "R" | "L", duration: number): number {
  return bats === "L" ? BAT_LEFTY_HANDOFF_S : duration;
}

/** 打者が走者に替わる瞬間の、Hips の真下（Statcast のフィート）。 */
function batterRunnerStart(template: HumanTemplate, bats: "R" | "L"): Point {
  const clip = template.clips.get(HUMAN_CLIP.bat)!;
  const track = clip.tracks.find((item) => item.name === `${template.hipsName}.position`);
  const feet = batterFeet(bats);
  if (!track) return { x: feet.x, y: feet.y };
  const hips = sampleKeys(track.times, track.values, 3, batterHandoff(bats, clip.duration));
  const side = bats === "L" ? 1 : -1;
  return { x: feet.x + (side * hips[0]) / FEET_TO_METERS, y: feet.y + hips[2] / FEET_TO_METERS };
}

function smooth(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

export function HumanRunners({
  template,
  clip,
  frame,
  preset,
}: {
  template: HumanTemplate;
  clip: Clip;
  frame: FieldFrame;
  preset: CameraPreset;
}) {
  const group = useMemo(() => new THREE.Group(), []);
  const pool = useMemo<HumanRig[]>(() => [], []);

  useEffect(
    () => () => {
      for (const rig of pool.splice(0)) {
        unbindActions(rig);
        rig.root.removeFromParent();
      }
    },
    [template, pool],
  );

  useFrame((state, delta) => {
    const t = actorTime(clip, state.clock.elapsedTime, delta);
    const gear = getGear();
    const tPlate = clip.kind === "pitch" ? clip.tPlate : null;
    const runs = runnerRuns(gear.bases, gear.advance, gear.outcome === "in_play" && tPlate != null);
    while (pool.length < runs.length) {
      const rig = makeRig(template);
      bindActions(rig, template);
      group.add(rig.root);
      pool.push(rig);
    }
    const isCamera = batterIsCamera({ preset, bats: gear.bats, homeRun: gear.homeRun, tPlate, t });
    pool.forEach((rig, index) => {
      const run = runs[index];
      rig.root.visible =
        run != null && !(isCamera && run.from === 0) && poseRunner(rig, run, template, frame, gear.bats, tPlate, t);
      if (!rig.root.visible) return;
      hideNearCamera(rig, state.camera);
      updateBounds(rig);
    });
  });

  return <primitive object={group} />;
}

/** 走者 1 人を置く。見えないときは false。 */
function poseRunner(
  rig: HumanRig,
  run: RunnerRun,
  template: HumanTemplate,
  frame: FieldFrame,
  bats: "R" | "L",
  tPlate: number | null,
  t: number,
): boolean {
  const batter = run.from === 0;
  const batDuration = template.clips.get(HUMAN_CLIP.bat)!.duration;
  const start = batter ? batterRunnerStart(template, bats) : leadOffPoint(run.from);
  const startTime =
    tPlate == null ? Number.POSITIVE_INFINITY : tPlate + (batter ? batHandoffDelay(batterHandoff(bats, batDuration)) : 0.05);
  const tau = t - startTime;
  if (batter && !(tau >= 0)) return false;

  const vmax = runSpeed(template.drift);
  const v0 = batter ? BATTER_RUNNER_V0 : 0;
  const path = runnerPath(start, run.from, run.to);
  const lengthFt = pathLengthFt(path);
  const lengthM = lengthFt * FEET_TO_METERS;
  const moving = run.to > run.from;
  const runM = moving ? runDistance(tau, lengthM, vmax, v0) : 0;
  const sinceStop = moving ? tau - runDuration(lengthM, vmax, v0) : Number.POSITIVE_INFINITY;
  if ((run.to === 4 || run.out) && sinceStop > 0.6) return false;

  const at = pointAlong(path, runM / FEET_TO_METERS);
  const heading = headingAlong(path, runM / FEET_TO_METERS);
  const home = basePoint(0);
  const toHome = { x: home.x - at.x, y: home.y - at.y };

  let runWeight = 0;
  if (moving && tau > 0) {
    const rampIn = batter ? 1 : smooth(tau / RUN_BLEND_S);
    const rampOut = sinceStop > 0 ? 1 - smooth(sinceStop / STOP_BLEND_S) : 1;
    runWeight = Math.min(rampIn, rampOut);
  }
  const phase = runPhase(runM, template.drift);
  poseRig(rig, [
    { name: HUMAN_CLIP.run, time: phase.time, weight: runWeight },
    { name: IDLE.clip, time: IDLE.time, weight: 1 - runWeight },
  ]);
  // mixer は値が変わらないフレームでは骨を書き直さないので、骨ではなくモデルごと戻す。
  rig.model.position.z = -phase.cancel * runWeight;

  placeOnField(rig, frame, at, 0);
  const idleFacing = faceQuaternion(frame, toHome, IDLE.yaw);
  const runFacing = faceQuaternion(frame, heading);
  rig.root.quaternion.copy(idleFacing).slerp(runFacing, runWeight);
  rig.mirror.scale.x = 1;
  return true;
}
