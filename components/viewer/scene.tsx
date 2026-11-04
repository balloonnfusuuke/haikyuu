"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { Vec3 } from "@/lib/coords";
import type { Clip } from "@/lib/clips";
import { statcastToWorld } from "@/lib/coords";
import { ballCamera, cameraPose, chaseCamera, type CameraPreset, type StadiumReport } from "@/lib/field";
import { ballWorld, getSim } from "@/lib/sim";
import { Actors, ArrivalRing, BallTrail, LandingMark, StrikeZone } from "./actors";
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
    const orbit = controls as { enabled?: boolean; target: THREE.Vector3 };
    const followBall = (preset === "ball" || preset === "chase") && ballWorld.ready;
    if (followBall) {
      orbit.enabled = false;
      const pose = preset === "chase" ? chaseCamera(frame, ballWorld) : ballCamera(frame, ballWorld);
      goalPos.current.set(pose.position.x, pose.position.y, pose.position.z);
      goalTarget.current.set(pose.target.x, pose.target.y, pose.target.z);
      const alpha = 1 - Math.exp(-14 * Math.min(delta, 0.05));
      camera.position.lerp(goalPos.current, alpha);
      camera.lookAt(goalTarget.current);
      orbit.target.copy(goalTarget.current);
      return;
    }
    if (orbit.enabled === false) orbit.enabled = true;
    if (blend.current <= 0) return;
    const pose = cameraPose(preset === "ball" || preset === "chase" ? "catcher" : preset, frame, catcher);
    goalPos.current.set(pose.position.x, pose.position.y, pose.position.z);
    goalTarget.current.set(pose.target.x, pose.target.y, pose.target.z);
    const alpha = 1 - Math.exp(-8 * Math.min(delta, 0.05));
    camera.position.lerp(goalPos.current, alpha);
    orbit.target.lerp(goalTarget.current, alpha);
    if (camera.position.distanceTo(goalPos.current) < 0.03 && orbit.target.distanceTo(goalTarget.current) < 0.03) {
      blend.current = 0;
    }
  }, -2);

  return null;
}

function ContactSound({ clip }: { clip: Clip }) {
  const catchAudio = useRef<HTMLAudioElement | null>(null);
  const hitAudio = useRef<HTMLAudioElement | null>(null);
  const played = useRef<string | null>(null);

  useEffect(() => {
    catchAudio.current = new Audio("/sounds/catch.wav");
    hitAudio.current = new Audio("/sounds/hit.wav");
  }, []);

  useFrame(() => {
    const noise = clip.noise;
    const tPlate = clip.tPlate;
    if (!noise || tPlate == null) return;
    const t = getSim().t;
    const key = `${clip.id}:${noise}:${tPlate}`;
    if (t + 1e-3 < tPlate) {
      if (played.current === key) played.current = null;
      return;
    }
    if (played.current === key) return;
    played.current = key;
    const node = noise === "hit" ? hitAudio.current : catchAudio.current;
    if (!node) return;
    node.currentTime = 0;
    void node.play().catch(() => undefined);
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
          <BallTrail clip={clip} frame={report.frame} />
          <ContactSound clip={clip} />
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
