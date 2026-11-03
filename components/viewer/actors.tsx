"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { statcastToWorld, type FieldFrame, type Vec3 } from "@/lib/coords";
import type { Clip } from "@/lib/clips";
import { sampleNearY } from "@/lib/clips";
import { PLATE_FRONT_FT, PLATE_HALF_WIDTH_FT } from "@/lib/field-constants";
import { propSource } from "./ball";
import { createMitt, fitLength, loadGltf } from "./props";

function toVector(point: Vec3): [number, number, number] {
  return [point.x, point.y, point.z];
}

export function TrajectoryLine({ clip, frame }: { clip: Clip; frame: FieldFrame }) {
  const points = useMemo(() => {
    return clip.samples.map((sample) => toVector(statcastToWorld(frame, sample.x, sample.y, sample.z)));
  }, [clip, frame]);
  return <Line points={points} color={clip.color} lineWidth={2} transparent opacity={0.9} />;
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
  const bodyRadius = crouched ? 0.18 : 0.2;
  const bodyLength = crouched ? 0.28 : 0.82;
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

export function Actors({ clip, frame }: { clip: Clip; frame: FieldFrame }) {
  const [batModel, setBatModel] = useState<THREE.Object3D | null>(null);
  const [mittModel, setMittModel] = useState<THREE.Object3D | null>(null);
  const [vrm, setVrm] = useState<THREE.Object3D | null>(null);
  const proceduralMitt = useMemo(() => createMitt(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [bat, mitt] = await Promise.all([loadGltf("/models/bat.glb"), loadGltf("/models/mitt.glb")]);
      if (cancelled) return;
      if (bat) {
        propSource.bat = "file";
        setBatModel(fitLength(bat, 0.864));
      } else {
        propSource.bat = "procedural";
      }
      if (mitt) {
        propSource.mitt = "file";
        setMittModel(mitt);
      } else {
        propSource.mitt = "procedural";
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
      propSource.vrm = "file";
      setVrm(scene);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const batterAt: [number, number, number] = [-3.15, 0.45, 0];
  const batterWorld = statcastToWorld(frame, batterAt[0], batterAt[1], batterAt[2]);
  const face = useMemo(() => facing(frame), [frame]);

  const knob = statcastToWorld(frame, -2.4, 0.2, 3.2);
  const barrel = statcastToWorld(frame, -0.45, 1.45, 4.7);
  const batDir = new THREE.Vector3(barrel.x - knob.x, barrel.y - knob.y, barrel.z - knob.z);
  const batLength = batDir.length() || 1;
  const batMid = new THREE.Vector3(
    (knob.x + barrel.x) / 2,
    (knob.y + barrel.y) / 2,
    (knob.z + barrel.z) / 2,
  );
  const batQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    batDir.clone().normalize(),
  );

  const receive = clip.kind === "pitch" ? sampleNearY(clip.samples, -1.2) : { x: 0.4, y: -1.2, z: 2.2 };
  // 到達位置のリングと重ならないよう、ミットは軌道の脇（捕手から見て右、やや下）に出す。
  const mittAt = statcastToWorld(frame, receive.x + 0.85, receive.y, Math.max(1.3, receive.z - 0.55));

  return (
    <>
      {vrm ? (
        <primitive object={vrm} position={[batterWorld.x, batterWorld.y, batterWorld.z]} quaternion={face} />
      ) : (
        <Figure kind="batter" frame={frame} at={batterAt} />
      )}
      <Figure kind="catcher" frame={frame} at={[1.45, -5.6, 0]} />
      {batModel ? (
        <primitive object={batModel} position={[knob.x, knob.y, knob.z]} quaternion={batQuat} />
      ) : (
        <mesh position={batMid} quaternion={batQuat} castShadow>
          <cylinderGeometry args={[0.033, 0.016, batLength, 16]} />
          <meshStandardMaterial color="#c9a36a" roughness={0.55} />
        </mesh>
      )}
      {mittModel ? (
        <primitive object={mittModel} position={[mittAt.x, mittAt.y, mittAt.z]} quaternion={face} />
      ) : (
        <group position={[mittAt.x, mittAt.y, mittAt.z]} quaternion={face}>
          <primitive object={proceduralMitt} />
        </group>
      )}
    </>
  );
}
