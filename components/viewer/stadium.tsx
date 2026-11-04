"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MARKER } from "@/lib/field-constants";
import { reportFromMarkers, type StadiumReport } from "@/lib/field";
import type { Vec3 } from "@/lib/coords";
import { markStadiumShown, noteDracoSpan, noteFetch, noteLoadStart, noteParse } from "@/lib/perf";
import { buildPlaceholder } from "./placeholder";

function worldVec(object: THREE.Object3D): Vec3 {
  const world = object.getWorldPosition(new THREE.Vector3());
  return { x: world.x, y: world.y, z: world.z };
}

function offsetRubber(root: THREE.Object3D, meters: number) {
  const rubber = root.getObjectByName(MARKER.rubber);
  const plate = root.getObjectByName(MARKER.plate);
  if (!rubber || !plate) return;
  const base = rubber.userData.basePosition as THREE.Vector3 | undefined;
  if (!base) {
    rubber.userData.basePosition = rubber.position.clone();
  }
  rubber.position.copy(rubber.userData.basePosition as THREE.Vector3);
  rubber.updateWorldMatrix(true, true);
  if (meters === 0) return;

  const plateWorld = plate.getWorldPosition(new THREE.Vector3());
  const rubberWorld = rubber.getWorldPosition(new THREE.Vector3());
  const direction = rubberWorld.sub(plateWorld);
  const length = direction.length() || 1;
  const target = rubber.getWorldPosition(new THREE.Vector3()).add(direction.multiplyScalar(meters / length));
  const parent = rubber.parent ?? root;
  parent.worldToLocal(target);
  rubber.position.copy(target);
}

function enableShadows(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
}

/** AO は glTF の 2 つ目の UV（Three.js の uv1、channel 1）に入っている。 */
export function applyAo(root: THREE.Object3D, intensity: number): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (!standard.aoMap) continue;
      standard.aoMap.channel = 1;
      standard.aoMapIntensity = intensity;
      standard.needsUpdate = true;
    }
  });
}

function timeDraco(draco: DRACOLoader) {
  const loader = draco as DRACOLoader & {
    decodeGeometry: (buffer: ArrayBuffer, taskConfig: unknown) => Promise<THREE.BufferGeometry>;
  };
  const original = loader.decodeGeometry.bind(loader);
  loader.decodeGeometry = (buffer, taskConfig) => {
    const start = performance.now();
    return original(buffer, taskConfig).then((geometry) => {
      noteDracoSpan(start, performance.now());
      return geometry;
    });
  };
}

/** メッシュをシーンに入れたフレームの描画が終わってから、表示完了にする。 */
function ShownMark() {
  const marked = useRef(false);
  useFrame(() => {
    if (marked.current) return;
    marked.current = true;
    requestAnimationFrame(() => markStadiumShown());
  });
  return null;
}

export function Stadium({
  shiftRubber,
  aoMapIntensity,
  onReport,
}: {
  shiftRubber: number;
  aoMapIntensity: number;
  onReport: (report: StadiumReport) => void;
}) {
  const [root, setRoot] = useState<THREE.Object3D | null>(null);
  const [source, setSource] = useState<"glb" | "placeholder">("placeholder");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    noteLoadStart();
    const draco = new DRACOLoader();
    draco.setDecoderPath("/draco/");
    timeDraco(draco);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    (async () => {
      try {
        const fetchStart = performance.now();
        const response = await fetch("/models/stadium.glb");
        if (cancelled) return;
        if (!response.ok) {
          setRoot(buildPlaceholder());
          setSource("placeholder");
          setError(null);
          return;
        }
        const buffer = await response.arrayBuffer();
        noteFetch(performance.now() - fetchStart);
        if (cancelled) return;
        const parseStart = performance.now();
        const gltf = await loader.parseAsync(buffer, "");
        noteParse(performance.now() - parseStart);
        if (cancelled) return;
        enableShadows(gltf.scene);
        setRoot(gltf.scene);
        setSource("glb");
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : "stadium.glb を解釈できませんでした";
        console.error("[plate-tip]", cause);
        setRoot(buildPlaceholder());
        setSource("placeholder");
        setError(`stadium.glb を読めなかったので仮の球場に戻しました。${message}`);
      }
    })();

    return () => {
      cancelled = true;
      draco.dispose();
    };
  }, []);

  useEffect(() => {
    if (!root) return;
    offsetRubber(root, shiftRubber);
    root.updateWorldMatrix(true, true);
    const names: string[] = [];
    const seen = new Set<string>();
    root.traverse((object) => {
      if (!object.name.startsWith("Marker_")) return;
      if (seen.has(object.name)) {
        console.warn(`[plate-tip] 目印 ${object.name} が複数あります。最初のものを使います。`);
        return;
      }
      seen.add(object.name);
      names.push(object.name);
    });
    const plate = root.getObjectByName(MARKER.plate);
    const rubber = root.getObjectByName(MARKER.rubber);
    const catcher = root.getObjectByName(MARKER.catcherCam);
    const report = reportFromMarkers({
      source,
      error,
      plate: plate ? worldVec(plate) : null,
      rubber: rubber ? worldVec(rubber) : null,
      catcherCam: catcher ? worldVec(catcher) : null,
      markerNames: names,
    });
    if (report.ok) console.info(`[plate-tip] ${report.message}`);
    else console.warn(`[plate-tip] ${report.message}`);
    if (report.note) console.info(`[plate-tip] ${report.note}`);
    applyAo(root, aoMapIntensity);
    onReport(report);
  }, [root, source, error, shiftRubber, aoMapIntensity, onReport]);

  if (!root) return null;
  return (
    <>
      <primitive object={root} />
      <ShownMark />
    </>
  );
}
