import * as THREE from "three";

/**
 * モデル空間の1点と、その点から出る前方向・上方向を、ワールドの点と方向へ重ねる。
 * 長さや原点はマーカーから渡す。ここにはモデルの寸法を書かない。
 */
export function alignPointDirection(
  pointLocal: THREE.Vector3,
  forwardLocal: THREE.Vector3,
  upLocal: THREE.Vector3,
  pointWorld: THREE.Vector3,
  forwardWorld: THREE.Vector3,
  upWorld: THREE.Vector3,
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const forwardL = forwardLocal.clone();
  const forwardW = forwardWorld.clone();
  if (forwardL.lengthSq() < 1e-10 || forwardW.lengthSq() < 1e-10) {
    return { position: pointWorld.clone().sub(pointLocal), quaternion: new THREE.Quaternion() };
  }
  forwardL.normalize();
  forwardW.normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(forwardL, forwardW);

  const upL = upLocal.clone();
  if (upL.lengthSq() < 1e-10 || Math.abs(upL.normalize().dot(forwardL)) > 0.95) {
    const ref = Math.abs(forwardL.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    upL.crossVectors(forwardL, ref).normalize();
  }
  const upAfter = upL.applyQuaternion(quaternion);
  const upW = upWorld.clone();
  if (upW.lengthSq() > 1e-10) upW.normalize();
  upAfter.addScaledVector(forwardW, -upAfter.dot(forwardW));
  const upTarget = upW.clone().addScaledVector(forwardW, -upW.dot(forwardW));
  if (upAfter.lengthSq() > 1e-8 && upTarget.lengthSq() > 1e-8) {
    upAfter.normalize();
    upTarget.normalize();
    quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(upAfter, upTarget));
  }

  const rotated = pointLocal.clone().applyQuaternion(quaternion);
  return { position: pointWorld.clone().sub(rotated), quaternion };
}
