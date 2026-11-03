import * as THREE from "three";
import { statcastToThree, type Vec3 } from "@/lib/coords";
import {
  BASE_DISTANCE_FT,
  BOX_BACK_Y_FT,
  BOX_FRONT_Y_FT,
  BOX_INSIDE_FT,
  BOX_WIDTH_FT,
  MARKER,
  MOUND_CENTER_Y_FT,
  MOUND_HEIGHT_FT,
  MOUND_RADIUS_FT,
  PLATE_FRONT_FT,
  RUBBER_DEPTH_FT,
  RUBBER_FRONT_FT,
  RUBBER_WIDTH_FT,
} from "@/lib/field-constants";
import { regulationMarkerPositions } from "@/lib/field";

function empty(name: string, position: Vec3): THREE.Object3D {
  const marker = new THREE.Object3D();
  marker.name = name;
  marker.position.set(position.x, position.y, position.z);
  return marker;
}

function moundHeightFt(radiusFt: number): number {
  const plateau = 1.25;
  if (radiusFt <= plateau) return MOUND_HEIGHT_FT;
  if (radiusFt >= MOUND_RADIUS_FT) return 0;
  const t = (radiusFt - plateau) / (MOUND_RADIUS_FT - plateau);
  return MOUND_HEIGHT_FT * 0.5 * (1 + Math.cos(Math.PI * t));
}

function buildMound(): THREE.BufferGeometry {
  const segments = 80;
  const rings = 28;
  const positions: number[] = [];
  const indices: number[] = [];
  const push = (xFt: number, yFt: number, zFt: number) => {
    const point = statcastToThree(xFt, yFt, zFt + 0.01);
    positions.push(point.x, point.y, point.z);
  };

  push(0, MOUND_CENTER_Y_FT, moundHeightFt(0));
  for (let ring = 1; ring <= rings; ring += 1) {
    const radius = (MOUND_RADIUS_FT * ring) / rings;
    const height = moundHeightFt(radius);
    for (let step = 0; step < segments; step += 1) {
      const theta = (step / segments) * Math.PI * 2;
      push(
        Math.cos(theta) * radius,
        MOUND_CENTER_Y_FT + Math.sin(theta) * radius,
        height,
      );
    }
  }

  for (let step = 0; step < segments; step += 1) {
    const next = (step + 1) % segments;
    indices.push(0, 1 + step, 1 + next);
  }
  for (let ring = 1; ring < rings; ring += 1) {
    const inner = 1 + (ring - 1) * segments;
    const outer = 1 + ring * segments;
    for (let step = 0; step < segments; step += 1) {
      const next = (step + 1) % segments;
      indices.push(inner + step, outer + step, outer + next);
      indices.push(inner + step, outer + next, inner + next);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function pushGroundQuad(
  vertices: number[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  widthFt: number,
  zFt: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy) || 1;
  const px = (-dy / length) * (widthFt / 2);
  const py = (dx / length) * (widthFt / 2);
  const corners: [number, number][] = [
    [ax + px, ay + py],
    [bx + px, by + py],
    [bx - px, by - py],
    [ax - px, ay - py],
  ];
  const points = corners.map(([x, y]) => statcastToThree(x, y, zFt));
  for (const index of [0, 2, 1, 0, 3, 2]) {
    const point = points[index];
    vertices.push(point.x, point.y, point.z);
  }
}

function fanFromStatcast(points: [number, number][], zFt: number): THREE.BufferGeometry {
  const vertices: number[] = [];
  const converted = points.map(([x, y]) => statcastToThree(x, y, zFt));
  for (let index = 1; index < converted.length - 1; index += 1) {
    for (const point of [converted[0], converted[index], converted[index + 1]]) {
      vertices.push(point.x, point.y, point.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function chalkGeometry(): THREE.BufferGeometry {
  const vertices: number[] = [];
  const line = (ax: number, ay: number, bx: number, by: number, width = 0.18) => {
    pushGroundQuad(vertices, ax, ay, bx, by, width, 0.012);
  };

  const foul = 320 * Math.SQRT1_2;
  line(0, 0, foul, foul, 0.2);
  line(0, 0, -foul, foul, 0.2);

  const base = BASE_DISTANCE_FT * Math.SQRT1_2;
  const second = BASE_DISTANCE_FT * Math.SQRT2;
  line(base, base, 0, second, 0.16);
  line(0, second, -base, base, 0.16);

  const addBox = (sign: number) => {
    const inside = sign * BOX_INSIDE_FT;
    const outside = sign * (BOX_INSIDE_FT + BOX_WIDTH_FT);
    const x0 = Math.min(inside, outside);
    const x1 = Math.max(inside, outside);
    line(x0, BOX_BACK_Y_FT, x1, BOX_BACK_Y_FT, 0.14);
    line(x1, BOX_BACK_Y_FT, x1, BOX_FRONT_Y_FT, 0.14);
    line(x1, BOX_FRONT_Y_FT, x0, BOX_FRONT_Y_FT, 0.14);
    line(x0, BOX_FRONT_Y_FT, x0, BOX_BACK_Y_FT, 0.14);
  };
  addBox(-1);
  addBox(1);

  const catcherHalf = 21.5 / 12;
  line(-catcherHalf, 0, catcherHalf, 0, 0.12);
  line(catcherHalf, 0, catcherHalf, -8, 0.12);
  line(catcherHalf, -8, -catcherHalf, -8, 0.12);
  line(-catcherHalf, -8, -catcherHalf, 0, 0.12);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function flatDisc(radiusM: number, color: string, y: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radiusM, radiusM > 20 ? 80 : 48),
    new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * stadium.glb が無いあいだ使う仮の球場。
 * 地面、プレート、マウンド、投手板、白線だけ。寸法はルールブックのフィートを
 * statcastToThree に通している。目印の名前は Blender 側の仕様と同じ。
 */
export function buildPlaceholder(): THREE.Group {
  const root = new THREE.Group();
  root.name = "PlaceholderStadium";

  const grassCenter = statcastToThree(0, 140, 0);
  const grass = flatDisc(170, "#3f7a46", 0);
  grass.position.x = grassCenter.x;
  grass.position.z = grassCenter.z;
  grass.name = "Field_Grass";
  root.add(grass);

  const dirt = flatDisc(4.6, "#b4835a", 0.006);
  dirt.name = "Field_Dirt";
  root.add(dirt);

  const mound = new THREE.Mesh(
    buildMound(),
    new THREE.MeshStandardMaterial({ color: "#c49262", roughness: 0.96, metalness: 0 }),
  );
  mound.name = "Mound";
  mound.receiveShadow = true;
  mound.castShadow = true;
  root.add(mound);

  const chalk = new THREE.Mesh(
    chalkGeometry(),
    new THREE.MeshStandardMaterial({
      color: "#f4f1e8",
      roughness: 0.8,
      emissive: "#2a2924",
      emissiveIntensity: 0.35,
      side: THREE.DoubleSide,
    }),
  );
  chalk.name = "Chalk";
  chalk.receiveShadow = true;
  root.add(chalk);

  const half = 8.5 / 12;
  const plate = new THREE.Mesh(
    fanFromStatcast(
      [
        [0, 0],
        [half, half],
        [half, PLATE_FRONT_FT],
        [-half, PLATE_FRONT_FT],
        [-half, half],
      ],
      0.03,
    ),
    new THREE.MeshStandardMaterial({
      color: "#f7f7f4",
      roughness: 0.45,
      side: THREE.DoubleSide,
    }),
  );
  plate.name = "HomePlate";
  plate.receiveShadow = true;
  root.add(plate);

  const rubberHalf = RUBBER_WIDTH_FT / 2;
  const rubber = new THREE.Mesh(
    fanFromStatcast(
      [
        [-rubberHalf, RUBBER_FRONT_FT],
        [rubberHalf, RUBBER_FRONT_FT],
        [rubberHalf, RUBBER_FRONT_FT + RUBBER_DEPTH_FT],
        [-rubberHalf, RUBBER_FRONT_FT + RUBBER_DEPTH_FT],
      ],
      MOUND_HEIGHT_FT + 0.02,
    ),
    new THREE.MeshStandardMaterial({
      color: "#fbfbf8",
      roughness: 0.4,
      side: THREE.DoubleSide,
    }),
  );
  rubber.name = "Rubber";
  rubber.receiveShadow = true;
  rubber.castShadow = true;
  root.add(rubber);

  const bagMaterial = new THREE.MeshStandardMaterial({ color: "#f4f4f0", roughness: 0.7 });
  const bagSize = 18 * 0.0254;
  const placeBag = (name: string, xFt: number, yFt: number) => {
    const point = statcastToThree(xFt, yFt, 0);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(bagSize, 0.08, bagSize), bagMaterial);
    bag.name = name;
    bag.position.set(point.x, 0.04, point.z);
    bag.rotation.y = Math.PI / 4;
    bag.castShadow = true;
    bag.receiveShadow = true;
    root.add(bag);
  };
  const corner = BASE_DISTANCE_FT * Math.SQRT1_2;
  placeBag("Base_1B", corner, corner);
  placeBag("Base_2B", 0, BASE_DISTANCE_FT * Math.SQRT2);
  placeBag("Base_3B", -corner, corner);

  const markers = regulationMarkerPositions();
  root.add(empty(MARKER.plate, markers.plate));
  root.add(empty(MARKER.rubber, markers.rubber));
  root.add(empty(MARKER.catcherCam, markers.catcherCam));

  const bases = new THREE.Group();
  bases.name = MARKER.bases;
  bases.add(empty("Marker_FirstBase", statcastToThree(corner, corner, 0)));
  bases.add(empty("Marker_SecondBase", statcastToThree(0, BASE_DISTANCE_FT * Math.SQRT2, 0)));
  bases.add(empty("Marker_ThirdBase", statcastToThree(-corner, corner, 0)));
  root.add(bases);

  const boxY = (BOX_FRONT_Y_FT + BOX_BACK_Y_FT) / 2;
  const boxX = BOX_INSIDE_FT + BOX_WIDTH_FT / 2;
  root.add(empty("BattersBox_L", statcastToThree(-boxX, boxY, 0)));
  root.add(empty("BattersBox_R", statcastToThree(boxX, boxY, 0)));

  return root;
}
