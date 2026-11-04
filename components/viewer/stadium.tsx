"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MARKER } from "@/lib/field-constants";
import { isViewShell, reportFromMarkers, type StadiumReport } from "@/lib/field";
import type { Vec3 } from "@/lib/coords";
import { markStadiumShown, noteFetch, noteLoadStart, noteParse } from "@/lib/perf";
import { buildPlaceholder } from "./placeholder";
import { watchDraco } from "./props";

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

const SHELL_OPACITY = 0.14;

type Shell = { meshes: THREE.Mesh[] };

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** 複数プリミティブは Three.js が Name_1 のように分ける。先頭ゼロの番号（Post_00）は別物のまま。 */
function shellKey(name: string): string | null {
  if (!isViewShell(name)) return null;
  const stripped = name.replace(/_[1-9]\d*$/, "");
  if (stripped !== name && isViewShell(stripped)) return stripped;
  return name;
}

function prepareShells(root: THREE.Object3D): Shell[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && isViewShell(mesh.name)) meshes.push(mesh);
  });
  const groups = new Map<string, THREE.Mesh[]>();
  for (const mesh of meshes) {
    const key = shellKey(mesh.name);
    if (!key) continue;
    const clones = materialsOf(mesh).map((material) => {
      const clone = material.clone();
      const standard = clone as THREE.MeshStandardMaterial;
      clone.userData.shellBaseOpacity = "opacity" in standard ? standard.opacity : 1;
      clone.userData.shellBaseTransparent = clone.transparent;
      clone.userData.shellBaseDepthWrite = clone.depthWrite;
      clone.userData.shellAmount = 0;
      return clone;
    });
    mesh.material = Array.isArray(mesh.material) ? clones : clones[0];
    const group = groups.get(key);
    if (group) group.push(mesh);
    else groups.set(key, [mesh]);
  }
  return [...groups.values()].map((group) => ({ meshes: group }));
}

/** カメラと見ている点の間にある壁・スタンド・ネット・屋根だけを透かす。形は変えない。 */
function ShellFade({ root }: { root: THREE.Object3D }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target?: THREE.Vector3 } | null;
  const shells = useRef<Shell[]>([]);
  const blocking = useRef(new Set<Shell>());
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const origin = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const lastOrigin = useMemo(() => new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN), []);
  const lastTarget = useMemo(() => new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN), []);
  const ray = useMemo(() => new THREE.Ray(), []);
  const box = useMemo(() => new THREE.Box3(), []);
  const hitPoint = useMemo(() => new THREE.Vector3(), []);
  const side = useMemo(() => new THREE.Vector3(), []);
  const aim = useMemo(() => new THREE.Vector3(), []);
  const lastCast = useRef(0);
  const aims = useMemo(
    () =>
      [
        [0, 0],
        [0, 0.16],
        [0, 0.32],
        [-0.2, 0.08],
        [0.2, 0.08],
      ] as const,
    [],
  );

  useLayoutEffect(() => {
    shells.current = prepareShells(root);
    blocking.current = new Set();
  }, [root]);

  useFrame((_, delta) => {
    const groups = shells.current;
    if (groups.length === 0) return;
    origin.copy(camera.position);
    if (controls?.target) target.copy(controls.target);
    else camera.getWorldDirection(target).multiplyScalar(30).add(origin);
    const moved =
      !Number.isFinite(lastOrigin.x) ||
      origin.distanceToSquared(lastOrigin) > 1e-4 ||
      target.distanceToSquared(lastTarget) > 1e-4;
    const now = performance.now();
    if (moved && now - lastCast.current > 120) {
      lastCast.current = now;
      lastOrigin.copy(origin);
      lastTarget.copy(target);
      direction.subVectors(target, origin);
      const reach = direction.length();
      if (reach > 0.4) {
        direction.multiplyScalar(1 / reach);
        side.crossVectors(direction, camera.up);
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
        else side.normalize();
        const candidates: THREE.Mesh[] = [];
        const seen = new Set<THREE.Mesh>();
        for (const [ox, oy] of aims) {
          aim.copy(target).addScaledVector(side, ox * reach).addScaledVector(camera.up, oy * reach);
          direction.subVectors(aim, origin);
          const length = direction.length();
          if (length < 0.4) continue;
          direction.multiplyScalar(1 / length);
          ray.set(origin, direction);
          for (const group of groups) {
            for (const mesh of group.meshes) {
              if (seen.has(mesh)) continue;
              const geometry = mesh.geometry;
              if (!geometry.boundingBox) geometry.computeBoundingBox();
              if (!geometry.boundingBox) {
                seen.add(mesh);
                candidates.push(mesh);
                continue;
              }
              box.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
              const hit = ray.intersectBox(box, hitPoint);
              if (!hit) continue;
              if (!box.containsPoint(origin) && origin.distanceTo(hitPoint) > length) continue;
              seen.add(mesh);
              candidates.push(mesh);
            }
          }
        }
        const touched: THREE.Material[] = [];
        for (const mesh of candidates) {
          for (const material of materialsOf(mesh)) {
            material.userData.shellSide = material.side;
            material.side = THREE.DoubleSide;
            touched.push(material);
          }
        }
        const hits = new Set<THREE.Object3D>();
        try {
          for (const [ox, oy] of aims) {
            aim.copy(target).addScaledVector(side, ox * reach).addScaledVector(camera.up, oy * reach);
            direction.subVectors(aim, origin);
            const length = direction.length();
            if (length < 0.4) continue;
            direction.multiplyScalar(1 / length);
            raycaster.set(origin, direction);
            raycaster.far = length - 0.2;
            raycaster.near = 0.05;
            for (const hit of raycaster.intersectObjects(candidates, false)) hits.add(hit.object);
          }
        } finally {
          for (const material of touched) material.side = material.userData.shellSide as THREE.Side;
        }
        const next = new Set<Shell>();
        for (const group of groups) {
          if (group.meshes.some((mesh) => hits.has(mesh))) next.add(group);
        }
        blocking.current = next;
      }
    }

    for (const group of groups) {
      const goal = blocking.current.has(group) ? 1 : 0;
      for (const mesh of group.meshes) {
        for (const material of materialsOf(mesh)) {
          const current = (material.userData.shellAmount as number) ?? 0;
          const fade = 1 - Math.exp(-18 * Math.min(delta, 0.5));
          const step = current + (goal - current) * fade;
          const amount = Math.abs(step - goal) < 0.01 ? goal : step;
          material.userData.shellAmount = amount;
          const standard = material as THREE.MeshStandardMaterial;
          if (!("opacity" in standard)) continue;
          const base = material.userData.shellBaseOpacity as number;
          standard.opacity = base * (1 - amount) + SHELL_OPACITY * amount;
          const transparent = amount > 0.04 || Boolean(material.userData.shellBaseTransparent);
          if (standard.transparent !== transparent) {
            standard.transparent = transparent;
            standard.needsUpdate = true;
          }
          standard.depthWrite = amount < 0.45 && Boolean(material.userData.shellBaseDepthWrite);
        }
      }
    }
  });

  return null;
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
    watchDraco(draco);
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
      <ShellFade root={root} />
      <ShownMark />
    </>
  );
}
