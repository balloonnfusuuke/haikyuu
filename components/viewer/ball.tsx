"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { statcastToWorld, worldToStatcast, type FieldFrame } from "@/lib/coords";
import type { Clip } from "@/lib/clips";
import { sampleAt } from "@/lib/clips";
import { ballWorld, getSim, setReadout, setSim } from "@/lib/sim";
import { rpmToRadPerSec, spinAxisWorld } from "@/lib/spin";
import { createBaseball, fitBall, loadGltf } from "./props";

export const propSource = {
  ball: "procedural" as "loading" | "file" | "procedural",
  bat: "procedural" as "loading" | "file" | "procedural",
  mitt: "procedural" as "loading" | "file" | "procedural",
  vrm: "procedural" as "loading" | "file" | "procedural",
};

export function PitchBall({
  clip,
  frame,
  showAxis,
}: {
  clip: Clip;
  frame: FieldFrame;
  showAxis: boolean;
}) {
  const ballRef = useRef<THREE.Group>(null);
  const axisRef = useRef<THREE.Mesh>(null);
  const spin = useRef(new THREE.Vector3(0, 1, 0));
  const upAxis = useRef(new THREE.Vector3(0, 1, 0));
  const axisDir = useRef(new THREE.Vector3());
  const worldPoint = useRef(new THREE.Vector3());
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const [model, setModel] = useState<THREE.Object3D | null>(null);

  const axis = useMemo(() => {
    if (clip.spinAxisDeg == null) return null;
    return spinAxisWorld(frame, clip.spinAxisDeg);
  }, [clip.spinAxisDeg, frame]);

  useEffect(() => {
    let cancelled = false;
    setModel(createBaseball());
    propSource.ball = "procedural";
    (async () => {
      const loaded = await loadGltf("/models/ball.glb");
      if (cancelled || !loaded) return;
      propSource.ball = "file";
      setModel(fitBall(loaded));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useFrame((_, delta) => {
    const current = clipRef.current;
    const sim = getSim();
    let t = sim.t;
    let playing = sim.playing;
    if (playing) {
      const step = Math.min(delta, 0.05) * sim.speed;
      const next = t + step;
      if (sim.holdAtPlate && current.tPlate != null && t < current.tPlate && next >= current.tPlate) {
        t = current.tPlate;
        playing = false;
      } else if (next >= current.tEnd) {
        t = current.tEnd;
        playing = false;
      } else {
        t = next;
      }
      if (t !== sim.t || playing !== sim.playing) setSim({ t, playing });
    }

    const sample = sampleAt(current.samples, t);
    const world = statcastToWorld(frame, sample.x, sample.y, sample.z);
    const group = ballRef.current;
    if (group) {
      group.position.set(world.x, world.y, world.z);
      if (axis && current.spinRpm != null) {
        const angle = rpmToRadPerSec(current.spinRpm) * (t - current.tStart);
        spin.current.set(axis.x, axis.y, axis.z);
        group.quaternion.setFromAxisAngle(spin.current, angle);
      } else {
        group.quaternion.identity();
      }
      group.updateWorldMatrix(true, false);
      group.getWorldPosition(worldPoint.current);
    } else {
      worldPoint.current.set(world.x, world.y, world.z);
    }
    const placed = worldPoint.current;
    if (axisRef.current) {
      axisRef.current.visible = Boolean(showAxis && axis);
      if (axis) {
        axisRef.current.position.copy(placed);
        axisDir.current.set(axis.x, axis.y, axis.z);
        axisRef.current.quaternion.setFromUnitVectors(upAxis.current, axisDir.current);
      }
    }
    const feet = worldToStatcast(frame, { x: placed.x, y: placed.y, z: placed.z });
    setReadout({
      valid: true,
      x: feet.x,
      y: feet.y,
      z: feet.z,
      worldX: placed.x,
      worldY: placed.y,
      worldZ: placed.z,
    });
    ballWorld.x = placed.x;
    ballWorld.y = placed.y;
    ballWorld.z = placed.z;
    ballWorld.ready = true;
  });

  return (
    <>
      <group ref={ballRef}>{model && <primitive object={model} />}</group>
      <mesh ref={axisRef} visible={false}>
        <cylinderGeometry args={[0.0035, 0.0035, 0.2, 10]} />
        <meshBasicMaterial color="#7ee0f2" />
      </mesh>
    </>
  );
}
