"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { Vec3 } from "@/lib/coords";
import type { Clip } from "@/lib/clips";
import { statcastToWorld } from "@/lib/coords";
import { ballCamera, cameraPose, type CameraPreset, type StadiumReport } from "@/lib/field";
import { ballWorld } from "@/lib/sim";
import { Actors, ArrivalRing, LandingMark, StrikeZone, TrajectoryLine } from "./actors";
import { PitchBall } from "./ball";
import { FieldLighting } from "./lighting";
import { Stadium } from "./stadium";
import { ToneMap } from "./tone";

function CameraRig({
  preset,
  frame,
  catcher,
}: {
  preset: CameraPreset;
  frame: NonNullable<StadiumReport["frame"]>;
  catcher: Vec3 | null;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target: THREE.Vector3 } | null;
  const blend = useRef(1);
  const goalPos = useRef(new THREE.Vector3());
  const goalTarget = useRef(new THREE.Vector3());

  useEffect(() => {
    blend.current = 1;
  }, [preset, frame, catcher]);

  useFrame((_, delta) => {
    if (!controls) return;
    const followBall = preset === "ball" && ballWorld.ready;
    if (!followBall && blend.current <= 0) return;
    const pose = followBall
      ? ballCamera(frame, ballWorld)
      : cameraPose(preset === "ball" ? "catcher" : preset, frame, catcher);
    goalPos.current.set(pose.position.x, pose.position.y, pose.position.z);
    goalTarget.current.set(pose.target.x, pose.target.y, pose.target.z);
    const alpha = 1 - Math.exp(-(followBall ? 12 : 8) * Math.min(delta, 0.05));
    camera.position.lerp(goalPos.current, alpha);
    controls.target.lerp(goalTarget.current, alpha);
    if (
      !followBall &&
      camera.position.distanceTo(goalPos.current) < 0.03 &&
      controls.target.distanceTo(goalTarget.current) < 0.03
    ) {
      blend.current = 0;
    }
  });

  return null;
}

function ReleaseMark({ clip, frame }: { clip: Clip; frame: StadiumReport["frame"] }) {
  const first = clip.samples[0];
  if (!first) return null;
  const point = statcastToWorld(frame, first.x, first.y, first.z);
  return (
    <mesh position={[point.x, point.y, point.z]}>
      <sphereGeometry args={[0.045, 16, 12]} />
      <meshBasicMaterial color={clip.color} />
    </mesh>
  );
}

export function FieldScene({
  clip,
  preset,
  night,
  showZone,
  showAxis,
  shiftRubber,
  aoMapIntensity,
  tone,
  dayHdri,
  nightHdri,
  report,
  onReport,
}: {
  clip: Clip;
  preset: CameraPreset;
  night: boolean;
  showZone: boolean;
  showAxis: boolean;
  shiftRubber: number;
  aoMapIntensity: number;
  tone: "agx" | "aces";
  dayHdri: boolean;
  nightHdri: boolean;
  report: StadiumReport | null;
  onReport: (report: StadiumReport) => void;
}) {
  return (
    <>
      <ToneMap tone={tone} />
      <Stadium shiftRubber={shiftRubber} aoMapIntensity={aoMapIntensity} onReport={onReport} />
      {report && (
        <>
          <FieldLighting frame={report.frame} night={night} dayHdri={dayHdri} nightHdri={nightHdri} />
          <TrajectoryLine clip={clip} frame={report.frame} />
          <ReleaseMark clip={clip} frame={report.frame} />
          {showZone && clip.kind === "pitch" && <StrikeZone clip={clip} frame={report.frame} />}
          {clip.kind === "pitch" && <ArrivalRing clip={clip} frame={report.frame} />}
          <LandingMark clip={clip} frame={report.frame} />
          <Actors clip={clip} frame={report.frame} />
          <PitchBall clip={clip} frame={report.frame} showAxis={showAxis} />
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            maxPolarAngle={Math.PI / 2 + 0.45}
            minDistance={0.15}
            maxDistance={90}
          />
          <CameraRig preset={preset} frame={report.frame} catcher={report.catcherCam} />
        </>
      )}
    </>
  );
}
