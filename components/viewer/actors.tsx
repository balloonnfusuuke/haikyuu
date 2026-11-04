"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { alignPointDirection } from "@/lib/align";
import { statcastDirToWorld, statcastToWorld, type FieldFrame, type Vec3 } from "@/lib/coords";
import type { Clip } from "@/lib/clips";
import { sampleAt } from "@/lib/clips";
import { getGear, mittCatches, subscribeGear } from "@/lib/gear";
import { getSim, trailEnabled } from "@/lib/sim";
import { PLATE_FRONT_FT, PLATE_HALF_WIDTH_FT } from "@/lib/field-constants";
import {
  batterFeet,
  FIGURE_BODY_LENGTH_M,
  FIGURE_BODY_RADIUS_M,
  gripDirection,
  handBottom,
  MITT_SETUP_Y_FT,
  mittPlace,
  swingDirection,
} from "@/lib/stance";
import { propSource } from "./ball";
import { createBat, createMitt, loadGltf, localMarker, setMorph, setTreeOpacity, type MarkerFrame } from "./props";

function toVector(point: Vec3): [number, number, number] {
  return [point.x, point.y, point.z];
}

const TRAIL_S = 0.45;

/** 今の位置から TRAIL_S 秒だけ後ろへ、球種の色の点を置く。未来の軌道は描かない。 */
export function BallTrail({ clip, frame }: { clip: Clip; frame: FieldFrame }) {
  const mesh = useMemo(() => {
    const geometry = new THREE.SphereGeometry(0.09, 10, 8);
    const material = new THREE.MeshBasicMaterial({ color: clip.color });
    const object = new THREE.InstancedMesh(geometry, material, 64);
    object.count = 0;
    object.frustumCulled = false;
    return object;
  }, [clip.color]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const clipRef = useRef(clip);
  const frameRef = useRef(frame);
  clipRef.current = clip;
  frameRef.current = frame;

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    };
  }, [mesh]);

  useFrame(() => {
    const current = clipRef.current;
    const field = frameRef.current;
    if (!trailEnabled()) {
      mesh.count = 0;
      return;
    }
    const t = getSim().t;
    let count = 0;
    let index = 0;
    for (const sample of current.samples) {
      if (sample.t < t - TRAIL_S) continue;
      if (sample.t > t + 1e-4) break;
      if (index++ % 5 !== 0) continue;
      const world = statcastToWorld(field, sample.x, sample.y, sample.z + 0.06);
      dummy.position.set(world.x, world.y, world.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(count, dummy.matrix);
      count += 1;
      if (count >= 64) break;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}

export function StrikeZone({ clip, frame }: { clip: Clip; frame: FieldFrame }) {
  const points = useMemo(() => {
    const y = PLATE_FRONT_FT;
    const corners = [
      statcastToWorld(frame, -PLATE_HALF_WIDTH_FT, y, clip.szBot),
      statcastToWorld(frame, PLATE_HALF_WIDTH_FT, y, clip.szBot),
      statcastToWorld(frame, PLATE_HALF_WIDTH_FT, y, clip.szTop),
      statcastToWorld(frame, -PLATE_HALF_WIDTH_FT, y, clip.szTop),
    ];
    return [...corners, corners[0]].map(toVector);
  }, [clip.szBot, clip.szTop, frame]);
  return <Line points={points} color="#f6e7a8" lineWidth={2} />;
}

export function ArrivalRing({ clip, frame }: { clip: Clip; frame: FieldFrame }) {
  const pose = useMemo(() => {
    if (clip.plateX == null || clip.plateZ == null) return null;
    const point = statcastToWorld(frame, clip.plateX, PLATE_FRONT_FT, clip.plateZ);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(frame.forward.x, frame.forward.y, frame.forward.z),
    );
    return { point, quaternion };
  }, [clip.plateX, clip.plateZ, frame]);
  if (!pose) return null;
  return (
    <group position={[pose.point.x, pose.point.y, pose.point.z]} quaternion={pose.quaternion}>
      <mesh>
        <ringGeometry args={[0.052, 0.07, 48]} />
        <meshBasicMaterial color="#ffb703" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export function LandingMark({ clip, frame }: { clip: Clip; frame: FieldFrame }) {
  const point = useMemo(() => {
    if (!clip.landing) return null;
    return statcastToWorld(frame, clip.landing.x, clip.landing.y, 0.05);
  }, [clip.landing, frame]);
  if (!point) return null;
  return (
    <mesh position={[point.x, point.y, point.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.35, 0.5, 32]} />
      <meshBasicMaterial color="#ffd166" side={THREE.DoubleSide} />
    </mesh>
  );
}

function facing(frame: FieldFrame): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(frame.forward.x, frame.forward.y, frame.forward.z),
  );
}

function Figure({
  kind,
  frame,
  at,
}: {
  kind: "batter" | "catcher";
  frame: FieldFrame;
  at: [number, number, number];
}) {
  const position = statcastToWorld(frame, at[0], at[1], at[2]);
  const quaternion = useMemo(() => facing(frame), [frame]);
  const crouched = kind === "catcher";
  const uniform = kind === "batter" ? "#1d2a44" : "#8d98a3";
  const bodyRadius = crouched ? 0.18 : FIGURE_BODY_RADIUS_M;
  const bodyLength = crouched ? 0.28 : FIGURE_BODY_LENGTH_M;
  const bodyCenter = bodyLength / 2 + bodyRadius;
  const headY = bodyLength + bodyRadius * 2 + (crouched ? 0.01 : 0.08);
  return (
    <group position={[position.x, position.y, position.z]} quaternion={quaternion}>
      <mesh position={[0, bodyCenter, 0]} castShadow>
        <capsuleGeometry args={[bodyRadius, bodyLength, 6, 12]} />
        <meshStandardMaterial color={uniform} roughness={0.75} />
      </mesh>
      <mesh position={[0, headY, 0]} castShadow>
        <sphereGeometry args={[crouched ? 0.13 : 0.14, 24, 16]} />
        <meshStandardMaterial color={kind === "batter" ? "#1a2744" : "#2c3138"} roughness={0.45} />
      </mesh>
    </group>
  );
}

function filesAllowed(): boolean {
  return typeof window === "undefined" || new URLSearchParams(window.location.search).get("props") !== "procedural";
}

function rememberProps(): void {
  window.__plateProps = propSource;
}

export function Actors({ clip, frame }: { clip: Clip; frame: FieldFrame }) {
  const [batModel, setBatModel] = useState<THREE.Object3D>(() => anchored(createBat()));
  const [mittModel, setMittModel] = useState<THREE.Object3D>(() => anchored(createMitt()));
  const [vrm, setVrm] = useState<THREE.Object3D | null>(null);
  const [catcherVrm, setCatcherVrm] = useState<THREE.Object3D | null>(null);
  const batRig = useRef<THREE.Group>(null);
  const mittRig = useRef<THREE.Group>(null);
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const [, setGearTick] = useState(0);

  useEffect(() => subscribeGear(() => setGearTick((value) => value + 1)), []);

  useEffect(() => {
    let cancelled = false;
    propSource.bat = "procedural";
    propSource.mitt = "procedural";
    rememberProps();
    (async () => {
      if (filesAllowed()) {
        const [bat, mitt] = await Promise.all([loadGltf("/models/bat.glb"), loadGltf("/models/mitt.glb")]);
        if (cancelled) return;
        if (bat && localMarker(bat, "Marker_GripBottom") && localMarker(bat, "Marker_GripTop")) {
          propSource.bat = "file";
          setBatModel(anchored(bat));
        } else if (bat) {
          console.warn("[plate-tip] bat.glb に Marker_GripBottom と Marker_GripTop がありません。手続きのバットを使います。");
        }
        if (mitt && localMarker(mitt, "Marker_Pocket")) {
          propSource.mitt = "file";
          setMittModel(anchored(mitt));
          if (!setMorph(mitt, "Close", 0)) {
            console.warn("[plate-tip] mitt.glb にモーフ Close がありません。");
          }
        } else if (mitt) {
          console.warn("[plate-tip] mitt.glb に Marker_Pocket がありません。手続きのミットを使います。");
        }
        rememberProps();
      }
      const response = await fetch("/models/player.vrm");
      if (cancelled || !response.ok) {
        propSource.vrm = "procedural";
        return;
      }
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const { VRMLoaderPlugin, VRMUtils } = await import("@pixiv/three-vrm");
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.parseAsync(await response.arrayBuffer(), "");
      if (cancelled || !gltf.userData.vrm) {
        propSource.vrm = "procedural";
        return;
      }
      VRMUtils.rotateVRM0(gltf.userData.vrm);
      const scene = gltf.scene;
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.frustumCulled = false;
        }
      });
      const bounds = new THREE.Box3().setFromObject(scene);
      const height = bounds.max.y - bounds.min.y;
      if (height > 0.05 && (height < 1.3 || height > 2.3)) {
        scene.scale.multiplyScalar(1.8 / height);
      }
      scene.position.y -= new THREE.Box3().setFromObject(scene).min.y;
      const { clone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
      const catcher = clone(scene);
      propSource.vrm = "file";
      setVrm(scene);
      setCatcherVrm(catcher);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grip = useMemo(() => readGrip(batModel), [batModel]);
  const pocket = useMemo(() => localMarker(mittModel, "Marker_Pocket"), [mittModel]);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  useFrame(() => {
    const current = clipRef.current;
    const field = frameRef.current;
    const gear = getGear();
    const t = getSim().t;
    poseBat(batRig.current, grip, field, gear.bats, current, t);
    poseMitt(mittRig.current, mittModel, pocket, field, current, gear, t);
  });

  const feet = batterFeet(getGear().bats);
  const face = useMemo(() => facing(frame), [frame]);
  const catcherAt: [number, number, number] = [1.85, MITT_SETUP_Y_FT - 0.85, 0];

  return (
    <>
      {vrm ? (
        <BatterVrm vrm={vrm} frame={frame} face={face} />
      ) : (
        <Figure kind="batter" frame={frame} at={[feet.x, feet.y, feet.z]} />
      )}
      {catcherVrm ? (
        <CatcherVrm vrm={catcherVrm} frame={frame} face={face} at={catcherAt} />
      ) : (
        <Figure kind="catcher" frame={frame} at={catcherAt} />
      )}
      <group ref={batRig}>
        <primitive object={batModel} />
      </group>
      <group ref={mittRig}>
        <primitive object={mittModel} />
      </group>
    </>
  );
}

function BatterVrm({
  vrm,
  frame,
  face,
}: {
  vrm: THREE.Object3D;
  frame: FieldFrame;
  face: THREE.Quaternion;
}) {
  const feet = batterFeet(getGear().bats);
  const at = statcastToWorld(frame, feet.x, feet.y, feet.z);
  return (
    <group position={[at.x, at.y, at.z]} quaternion={face}>
      <primitive object={vrm} />
    </group>
  );
}

function CatcherVrm({
  vrm,
  frame,
  face,
  at,
}: {
  vrm: THREE.Object3D;
  frame: FieldFrame;
  face: THREE.Quaternion;
  at: [number, number, number];
}) {
  const position = statcastToWorld(frame, at[0], at[1], at[2]);
  return (
    <group position={[position.x, position.y, position.z]} quaternion={face}>
      <primitive object={vrm} />
    </group>
  );
}

function anchored(model: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  group.add(model);
  return group;
}

function readGrip(root: THREE.Object3D): { bottom: MarkerFrame; top: MarkerFrame } | null {
  const bottom = localMarker(root, "Marker_GripBottom");
  const top = localMarker(root, "Marker_GripTop");
  if (!bottom || !top) return null;
  return { bottom, top };
}

function poseBat(
  rig: THREE.Group | null,
  grip: { bottom: MarkerFrame; top: MarkerFrame } | null,
  frame: FieldFrame,
  bats: "R" | "L",
  clip: Clip,
  t: number,
): void {
  if (!rig || !grip) return;
  const hand = handBottom(bats);
  const arrival = clip.tPlate == null ? null : sampleAt(clip.samples, clip.tPlate);
  const dir = clip.swing
    ? swingDirection({
        bats,
        t,
        tPlate: clip.tPlate,
        duration: clip.swing.duration,
        miss: clip.swing.miss,
        ball: arrival,
      })
    : gripDirection(bats);
  const bottom = statcastToWorld(frame, hand.x, hand.y, hand.z);
  const pose = alignPointDirection(
    grip.bottom.point,
    grip.top.point.clone().sub(grip.bottom.point),
    grip.top.up,
    new THREE.Vector3(bottom.x, bottom.y, bottom.z),
    vector(statcastDirToWorld(frame, dir)),
    new THREE.Vector3(frame.up.x, frame.up.y, frame.up.z),
  );
  rig.position.copy(pose.position);
  rig.quaternion.copy(pose.quaternion);
}

function poseMitt(
  rig: THREE.Group | null,
  model: THREE.Object3D,
  pocket: MarkerFrame | null,
  frame: FieldFrame,
  clip: Clip,
  gear: ReturnType<typeof getGear>,
  t: number,
): void {
  if (!rig || !pocket) return;
  const arrival = clip.tPlate == null ? null : sampleAt(clip.samples, clip.tPlate);
  const calledX = gear.calledX ?? arrival?.x ?? clip.modelPlateX ?? 0;
  const calledZ = gear.calledZ ?? arrival?.z ?? (clip.szTop + clip.szBot) / 2;
  const place = mittPlace({
    t,
    tStart: clip.tStart,
    tPlate: clip.kind === "pitch" ? clip.tPlate : null,
    calledX,
    calledZ,
    arriveX: arrival?.x ?? calledX,
    arriveY: arrival?.y ?? PLATE_FRONT_FT,
    arriveZ: arrival?.z ?? calledZ,
    outcome: gear.outcome,
    drop: gear.mittView === "down",
    ghost: gear.mittView === "clear",
    catches: mittCatches(gear.outcome),
  });
  const target = statcastToWorld(frame, place.x, place.y, place.z);
  const pose = alignPointDirection(
    pocket.point,
    pocket.forward,
    pocket.up,
    new THREE.Vector3(target.x, target.y, target.z),
    vector(statcastDirToWorld(frame, { x: 0, y: 1, z: 0 })),
    new THREE.Vector3(frame.up.x, frame.up.y, frame.up.z),
  );
  rig.position.copy(pose.position);
  rig.quaternion.copy(pose.quaternion);
  setMorph(model, "Close", place.close);
  setTreeOpacity(model, place.opacity);
}

function vector(value: Vec3): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}
