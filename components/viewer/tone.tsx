"use client";

import { useLayoutEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

export function ToneMap({ tone }: { tone: "agx" | "aces" }) {
  const gl = useThree((state) => state.gl);
  useLayoutEffect(() => {
    gl.toneMapping = tone === "aces" ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
    gl.toneMappingExposure = 0.82;
  }, [gl, tone]);
  return null;
}
