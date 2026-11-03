import { statcastDirToWorld, type FieldFrame, type Vec3 } from "./coords";

/**
 * Statcast の spin_axis（度）。
 * 180° が真のバックスピン、0° が真のトップスピン。
 * 90° のマグヌス力は捕手から見て右（左打者の側）、270° は捕手から見て左。
 *
 * 軸は進行方向（Statcast の y）に垂直な成分だけ。ジャイロ回転は
 * release_spin_rate とは別に測れないので、報告された軸のまわりに
 * release_spin_rate 全部で回す。
 *
 * 速度がおよそ (0, -1, 0) のとき ω × v がマグヌスの向きになるよう、
 *   ω = (cos θ, 0, sin θ)
 * とする。180° なら ω = (-1, 0, 0) で、力は真上。
 */
export function spinAxisStatcast(degrees: number): Vec3 {
  const rad = (degrees * Math.PI) / 180;
  return { x: Math.cos(rad), y: 0, z: Math.sin(rad) };
}

/** マグヌス加速度の水平・鉛直成分の向き（長さ 1）。x は捕手から見て右。 */
export function magnusDirection(degrees: number): { x: number; z: number } {
  const rad = (degrees * Math.PI) / 180;
  return { x: Math.sin(rad), z: -Math.cos(rad) };
}

export function spinAxisWorld(frame: FieldFrame, degrees: number): Vec3 {
  return statcastDirToWorld(frame, spinAxisStatcast(degrees));
}

export function rpmToRadPerSec(rpm: number): number {
  return (rpm * 2 * Math.PI) / 60;
}
