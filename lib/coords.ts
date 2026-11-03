/**
 * Statcast のフィート座標を Three.js のメートルへ移す、唯一の変換。
 *
 * 入力（このアプリが「Statcast の値」と呼ぶもの）:
 *   原点 … ホームプレートの捕手側の先端、地面の高さ
 *   +x   … 捕手から見て右（一塁側）
 *   +y   … 投手・マウンド方向
 *   +z   … 上
 *   単位 … フィート
 *
 * Blender も同じ軸で単位だけメートル。glTF の標準書き出し（+Y up）では
 * Blender の (x, y, z) が Three.js の (x, z, -y) になる。フィートを
 * 0.3048 倍してから同じ軸の入れ替えをする。
 *
 *   three = (xFt * 0.3048, zFt * 0.3048, -yFt * 0.3048)
 *
 * 球場を差し替えても動くよう、実行時は目印から作った基底に同じ式を載せる
 * （statcastToWorld）。プレートが原点で軸が規定どおりなら、statcastToThree と一致する。
 * 投球軌道、到達位置、打球、カメラ、仮球場の寸法はすべてここを通す。
 */

export const FEET_TO_METERS = 0.3048;

export type Vec3 = { x: number; y: number; z: number };

export type FieldFrame = {
  /** Marker_PlateTip のワールド座標（メートル、Three.js）。 */
  plate: Vec3;
  /** 捕手から見て右。Statcast の +x。 */
  right: Vec3;
  /** 上。Statcast の +z。 */
  up: Vec3;
  /** 投手方向の水平成分。Statcast の +y。 */
  forward: Vec3;
  /** プレートと投手板が水平に離れていない。規定軸へ退避している。 */
  degenerate: boolean;
};

export const IDENTITY_FRAME: FieldFrame = {
  plate: { x: 0, y: 0, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
  degenerate: false,
};

/** 目印の基底で Statcast フィートを Three.js メートルにする。変換式はここだけ。 */
export function statcastToWorld(
  frame: FieldFrame,
  xFt: number,
  yFt: number,
  zFt: number,
): Vec3 {
  const x = xFt * FEET_TO_METERS;
  const y = yFt * FEET_TO_METERS;
  const z = zFt * FEET_TO_METERS;
  return {
    x: frame.plate.x + frame.right.x * x + frame.forward.x * y + frame.up.x * z,
    y: frame.plate.y + frame.right.y * x + frame.forward.y * y + frame.up.y * z,
    z: frame.plate.z + frame.right.z * x + frame.forward.z * y + frame.up.z * z,
  };
}

/**
 * プレート先端がワールド原点、+x が一塁、+y が投手、+z が上、のときの変換。
 * Three.js では (x, z, -y) * 0.3048。
 */
export function statcastToThree(xFt: number, yFt: number, zFt: number): Vec3 {
  return statcastToWorld(IDENTITY_FRAME, xFt, yFt, zFt);
}

export function worldToStatcast(frame: FieldFrame, world: Vec3): Vec3 {
  const dx = world.x - frame.plate.x;
  const dy = world.y - frame.plate.y;
  const dz = world.z - frame.plate.z;
  return {
    x: (dx * frame.right.x + dy * frame.right.y + dz * frame.right.z) / FEET_TO_METERS,
    y: (dx * frame.forward.x + dy * frame.forward.y + dz * frame.forward.z) / FEET_TO_METERS,
    z: (dx * frame.up.x + dy * frame.up.y + dz * frame.up.z) / FEET_TO_METERS,
  };
}

export function threeToStatcast(world: Vec3): Vec3 {
  return worldToStatcast(IDENTITY_FRAME, world);
}

/**
 * 向きベクトル。位置と同じ変換の線形部分を使い、長さ 1 に戻す。
 * スピン軸もここを通す（ジャイロ成分は Statcast の spin_axis に含まれない）。
 */
export function statcastDirToWorld(frame: FieldFrame, direction: Vec3): Vec3 {
  const pointed = statcastToWorld(frame, direction.x, direction.y, direction.z);
  const dx = pointed.x - frame.plate.x;
  const dy = pointed.y - frame.plate.y;
  const dz = pointed.z - frame.plate.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

export function frameFromMarkers(plate: Vec3, rubber: Vec3): FieldFrame {
  const dx = rubber.x - plate.x;
  const dz = rubber.z - plate.z;
  const horizontal = Math.hypot(dx, dz);
  if (horizontal < 1e-4) {
    return {
      plate: { ...plate },
      right: { ...IDENTITY_FRAME.right },
      up: { ...IDENTITY_FRAME.up },
      forward: { ...IDENTITY_FRAME.forward },
      degenerate: true,
    };
  }
  const forward = { x: dx / horizontal, y: 0, z: dz / horizontal };
  const up = { x: 0, y: 1, z: 0 };
  // right = forward × up。規定配置 (forward = -Z) では +X（一塁側）になる。
  const right = {
    x: forward.y * up.z - forward.z * up.y,
    y: forward.z * up.x - forward.x * up.z,
    z: forward.x * up.y - forward.y * up.x,
  };
  return { plate: { ...plate }, right, up, forward, degenerate: false };
}

export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** メートルの相対位置。中身は statcastToWorld だけ。 */
export function offsetMeters(
  frame: FieldFrame,
  right: number,
  forward: number,
  up: number,
): Vec3 {
  return statcastToWorld(
    frame,
    right / FEET_TO_METERS,
    forward / FEET_TO_METERS,
    up / FEET_TO_METERS,
  );
}
