"use client";

import { Suspense, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { Environment } from "@react-three/drei";
import { FEET_TO_METERS, offsetMeters, statcastToWorld, type FieldFrame } from "@/lib/coords";

/**
 * 環境光は Poly Haven の HDRI（public/hdri/day.hdr, night.hdr）。
 * 影を落とすライトは太陽光 1 本。シャドウマップはバッテリー（プレートからマウンド）にだけ張る。
 */
export function FieldLighting({
  frame,
  night,
  dayHdri,
  nightHdri,
}: {
  frame: FieldFrame;
  night: boolean;
  dayHdri: boolean;
  nightHdri: boolean;
}) {
  const file = night ? (nightHdri ? "/hdri/night.hdr" : null) : dayHdri ? "/hdri/day.hdr" : null;
  const skyBackground = Boolean(file) && !night;

  return (
    <>
      {!skyBackground && <color attach="background" args={[night ? "#071018" : "#9ec4e4"]} />}
      {file ? (
        <Suspense fallback={null}>
          <Environment files={file} background={skyBackground} environmentIntensity={night ? 0.22 : 0.38} />
        </Suspense>
      ) : (
        <hemisphereLight
          args={[night ? "#243044" : "#e7f2ff", night ? "#1c281c" : "#4e754c", night ? 0.45 : 0.8]}
        />
      )}
      <KeyLight frame={frame} night={night} />
    </>
  );
}

function KeyLight({ frame, night }: { frame: FieldFrame; night: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useRef<THREE.Object3D>(null);

  useLayoutEffect(() => {
    const sun = light.current;
    const aim = target.current;
    if (!sun || !aim) return;
    const position = night
      ? offsetMeters(frame, -8, 14, 24)
      : offsetMeters(frame, 16, 18, 26);
    const look = statcastToWorld(frame, 0, 28, 1 / FEET_TO_METERS);
    sun.position.set(position.x, position.y, position.z);
    aim.position.set(look.x, look.y, look.z);
    sun.target = aim;
    const camera = sun.shadow.camera;
    camera.left = -6.5;
    camera.right = 6.5;
    camera.top = 14;
    camera.bottom = -14;
    camera.near = 6;
    camera.far = 90;
    camera.updateProjectionMatrix();
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.00018;
    sun.shadow.normalBias = 0.028;
    sun.shadow.needsUpdate = true;
  }, [frame, night]);

  return (
    <>
      <directionalLight
        ref={light}
        castShadow
        intensity={night ? 0.55 : 0.85}
        color={night ? "#d5e2ff" : "#fff2d8"}
      />
      <object3D ref={target} />
    </>
  );
}
