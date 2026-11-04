import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BALL_RADIUS_M } from "@/lib/field-constants";

class SeamCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private readonly radius: number) {
    super();
  }

  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const phi = t * Math.PI * 2;
    const x = Math.sin(phi) + 2 * Math.sin(2 * phi);
    const y = Math.cos(phi) - 2 * Math.cos(2 * phi);
    const z = -Math.sin(3 * phi);
    return target.set(x, y, z).normalize().multiplyScalar(this.radius);
  }
}

/** 縫い目付きの球。中心が原点、半径は公式球。 */
export function createBaseball(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Ball";
  const leather = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS_M, 48, 32),
    new THREE.MeshStandardMaterial({ color: "#f6f3ee", roughness: 0.4, metalness: 0.02 }),
  );
  leather.castShadow = true;
  leather.name = "BallLeather";

  const seamRadius = BALL_RADIUS_M * 1.015;
  const seams = new THREE.Mesh(
    new THREE.TubeGeometry(new SeamCurve(seamRadius), 240, BALL_RADIUS_M * 0.055, 8, true),
    new THREE.MeshStandardMaterial({ color: "#c4312e", roughness: 0.48 }),
  );
  seams.castShadow = true;
  seams.name = "BallSeams";
  group.add(leather, seams);
  return group;
}

/** グリップ端が原点、+Y が先端。長さ 34 インチ。 */
export function createBat(): THREE.Group {
  const length = 0.864;
  const group = new THREE.Group();
  group.name = "Bat";
  const geometry = new THREE.CylinderGeometry(0.033, 0.015, length, 20);
  geometry.translate(0, length / 2, 0);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: "#c9a36a", roughness: 0.55 }),
  );
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}

/** 捕球点が原点のミット。 */
export function createMitt(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Mitt";
  const pocket = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 24, 16),
    new THREE.MeshStandardMaterial({ color: "#7a3b22", roughness: 0.72 }),
  );
  pocket.scale.set(1.15, 0.42, 0.95);
  pocket.castShadow = true;
  const wrist = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.05, 0.1, 12),
    new THREE.MeshStandardMaterial({ color: "#5c2e1a", roughness: 0.8 }),
  );
  wrist.rotation.x = Math.PI / 2;
  wrist.position.z = -0.08;
  wrist.castShadow = true;
  group.add(pocket, wrist);
  return group;
}

export async function fetchExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

export async function loadGltf(url: string): Promise<THREE.Group | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const buffer = await response.arrayBuffer();
  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  try {
    const gltf = await loader.parseAsync(buffer, "");
    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return gltf.scene;
  } finally {
    draco.dispose();
  }
}

/** 縫い目が遠くで点線にならないよう、球のテクスチャは異方性フィルタを最大にする。 */
export function maxAnisotropy(root: THREE.Object3D, anisotropy: number): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"] as const) {
        const texture = standard[key];
        if (!texture) continue;
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
      }
    }
  });
}

/** 読み込んだ球を公式半径に合わせ、中心を原点へ戻す。 */
export function fitBall(root: THREE.Object3D): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.name = "BallFile";
  wrapper.add(root);
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(root);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const radius = sphere.radius || BALL_RADIUS_M;
  root.scale.multiplyScalar(BALL_RADIUS_M / radius);
  root.updateWorldMatrix(true, true);
  const recentered = new THREE.Box3().setFromObject(root);
  const center = recentered.getCenter(new THREE.Vector3());
  root.position.sub(center);
  return wrapper;
}

/** バットの長い軸がおよそ 0.86 m になるよう合わせる。センチ単位の書き出しも受ける。 */
export function fitLength(root: THREE.Object3D, targetMeters: number): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.add(root);
  root.updateWorldMatrix(true, true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (longest > 1e-4 && (longest > targetMeters * 1.4 || longest < targetMeters * 0.6)) {
    root.scale.multiplyScalar(targetMeters / longest);
  }
  return wrapper;
}
