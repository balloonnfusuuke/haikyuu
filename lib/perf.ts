import * as THREE from "three";

export type PlatePerf = {
  /** ページを開いてから、球場を描いたフレームの直後まで。 */
  loadMs: number | null;
  /** 球場の読み込みを始めた時刻。ページ開始からのミリ秒。 */
  loadStartMs: number | null;
  fetchMs: number | null;
  parseMs: number | null;
  /** 最初の Draco 展開開始から、最後のメッシュ展開が終わるまでの実時間。 */
  dracoMs: number | null;
  /** 各メッシュの展開時間の合計。並列なので実時間より長くなる。 */
  dracoCpuMs: number | null;
  dracoMeshes: number;
  fps: number;
  playAvgFps: number | null;
  playMinFps: number | null;
  playFrames: number;
  playSeconds: number;
  calls: number;
  callsMin: number | null;
  callsMax: number | null;
  triangles: number;
  lines: number;
  textures: number;
  geometries: number;
  /** renderer.info は枚数だけを持つ。こちらは画像の寸法から積んだ容量。 */
  textureBytes: number;
  textureImages: number;
  gpu: string;
  glVendor: string;
  environmentReady: boolean;
};

export const perf: PlatePerf = {
  loadMs: null,
  loadStartMs: null,
  fetchMs: null,
  parseMs: null,
  dracoMs: null,
  dracoCpuMs: null,
  dracoMeshes: 0,
  fps: 0,
  playAvgFps: null,
  playMinFps: null,
  playFrames: 0,
  playSeconds: 0,
  calls: 0,
  callsMin: null,
  callsMax: null,
  triangles: 0,
  lines: 0,
  textures: 0,
  geometries: 0,
  textureBytes: 0,
  textureImages: 0,
  gpu: "",
  glVendor: "",
  environmentReady: false,
};

const dracoClock = {
  wallStart: null as number | null,
  wallEnd: null as number | null,
  cpuMs: 0,
  meshes: 0,
};

const play = {
  frames: 0,
  seconds: 0,
  maxDt: 0,
  warmup: 0,
};

export function noteLoadStart(): void {
  if (perf.loadStartMs == null) perf.loadStartMs = performance.now();
}

export function noteFetch(ms: number): void {
  perf.fetchMs = ms;
}

export function noteParse(ms: number): void {
  perf.parseMs = ms;
}

/** 1 メッシュの Draco 展開。開始と終了は performance.now()。 */
export function noteDracoSpan(start: number, end: number): void {
  if (dracoClock.wallStart == null || start < dracoClock.wallStart) dracoClock.wallStart = start;
  if (dracoClock.wallEnd == null || end > dracoClock.wallEnd) dracoClock.wallEnd = end;
  dracoClock.cpuMs += Math.max(0, end - start);
  dracoClock.meshes += 1;
  perf.dracoMeshes = dracoClock.meshes;
  perf.dracoCpuMs = dracoClock.cpuMs;
  if (dracoClock.wallStart != null && dracoClock.wallEnd != null) {
    perf.dracoMs = dracoClock.wallEnd - dracoClock.wallStart;
  }
}

/** 球場のメッシュを描いた次のフレームで一度だけ呼ぶ。 */
export function markStadiumShown(): void {
  if (perf.loadMs != null) return;
  perf.loadMs = performance.now();
}

export function noteFps(fps: number): void {
  if (Number.isFinite(fps)) perf.fps = fps;
}

export function beginPlaySample(): void {
  play.frames = 0;
  play.seconds = 0;
  play.maxDt = 0;
  play.warmup = 0;
  perf.playFrames = 0;
  perf.playSeconds = 0;
  perf.playAvgFps = null;
  perf.playMinFps = null;
  perf.callsMin = null;
  perf.callsMax = null;
}

export function noteFrameInfo(calls: number, triangles: number, lines: number): void {
  if (calls <= 0) return;
  perf.calls = calls;
  perf.triangles = triangles;
  perf.lines = lines;
  if (perf.callsMin == null || calls < perf.callsMin) perf.callsMin = calls;
  if (perf.callsMax == null || calls > perf.callsMax) perf.callsMax = calls;
}

/** 再生中のフレームだけを積む。クリック直後の 1 フレームは捨てる。 */
export function notePlayFrame(delta: number, calls: number, triangles: number, lines: number): void {
  noteFrameInfo(calls, triangles, lines);
  if (play.warmup < 1) {
    play.warmup += 1;
    return;
  }
  if (!(delta > 0) || delta > 2) return;
  play.frames += 1;
  play.seconds += delta;
  if (delta > play.maxDt) play.maxDt = delta;
  perf.playFrames = play.frames;
  perf.playSeconds = play.seconds;
  perf.playAvgFps = play.seconds > 0 ? play.frames / play.seconds : null;
  perf.playMinFps = play.maxDt > 0 ? 1 / play.maxDt : null;
  perf.calls = calls;
  perf.triangles = triangles;
  perf.lines = lines;
  if (perf.callsMin == null || calls < perf.callsMin) perf.callsMin = calls;
  if (perf.callsMax == null || calls > perf.callsMax) perf.callsMax = calls;
}

export function noteRendererMemory(textures: number, geometries: number): void {
  perf.textures = textures;
  perf.geometries = geometries;
}

const TEXTURE_KEYS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
  "bumpMap",
  "displacementMap",
  "alphaMap",
  "lightMap",
] as const;

function oneImageBytes(
  texture: THREE.Texture,
  image: { width?: number; height?: number; data?: ArrayBufferView } | undefined,
): number {
  if (!image) return 0;
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  if (!width || !height) return image.data?.byteLength ?? 0;

  let bytesPerPixel = 4;
  if (texture.type === THREE.UnsignedByteType) {
    if (texture.format === THREE.RedFormat) bytesPerPixel = 1;
    else if (texture.format === THREE.RGFormat) bytesPerPixel = 2;
    else bytesPerPixel = 4;
  } else if (texture.type === THREE.HalfFloatType) {
    bytesPerPixel = texture.format === THREE.RedFormat ? 2 : 8;
  } else if (texture.type === THREE.FloatType) {
    bytesPerPixel = texture.format === THREE.RedFormat ? 4 : 16;
  } else if (texture.type === THREE.UnsignedIntType || texture.type === THREE.UnsignedInt248Type) {
    bytesPerPixel = 4;
  }
  const mip = texture.generateMipmaps ? 4 / 3 : 1;
  return Math.round(width * height * bytesPerPixel * mip);
}

function textureBytes(texture: THREE.Texture): number {
  const compressed = texture as THREE.CompressedTexture;
  if (compressed.isCompressedTexture && compressed.mipmaps?.length) {
    return compressed.mipmaps.reduce((sum, mip) => sum + (mip.data?.byteLength ?? 0), 0);
  }
  const image = texture.image as
    | { width?: number; height?: number; data?: ArrayBufferView }
    | Array<{ width?: number; height?: number; data?: ArrayBufferView }>
    | undefined;
  if (Array.isArray(image)) return image.reduce((sum, face) => sum + oneImageBytes(texture, face), 0);
  return oneImageBytes(texture, image);
}

/** シーンに載っているテクスチャ、環境マップ、シャドウマップの容量。 */
export function estimateSceneTextureBytes(scene: THREE.Object3D): { bytes: number; images: number } {
  const seen = new Set<THREE.Texture>();
  const add = (texture: THREE.Texture | null | undefined) => {
    if (texture?.isTexture) seen.add(texture);
  };

  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        const record = material as unknown as Record<string, THREE.Texture | undefined>;
        for (const key of TEXTURE_KEYS) add(record[key]);
      }
    }
    const light = object as THREE.DirectionalLight;
    if (light.isLight && light.shadow?.map) add(light.shadow.map.texture);
    const sceneObject = object as THREE.Scene;
    if (sceneObject.isScene) {
      add(sceneObject.environment);
      if ((sceneObject.background as THREE.Texture | null)?.isTexture) {
        add(sceneObject.background as THREE.Texture);
      }
    }
  });

  let bytes = 0;
  for (const texture of seen) bytes += textureBytes(texture);
  return { bytes, images: seen.size };
}

export function noteTextureEstimate(bytes: number, images: number): void {
  perf.textureBytes = bytes;
  perf.textureImages = images;
}

export function noteGpu(vendor: string, renderer: string): void {
  perf.glVendor = vendor;
  perf.gpu = renderer;
}

export function noteEnvironment(ready: boolean): void {
  perf.environmentReady = ready;
}

declare global {
  interface Window {
    __platePerf?: PlatePerf;
  }
}
