export type SimState = {
  t: number;
  playing: boolean;
  speed: number;
  holdAtPlate: boolean;
  clipId: string;
};

export type BallReadout = {
  valid: boolean;
  x: number;
  y: number;
  z: number;
  worldX: number;
  worldY: number;
  worldZ: number;
};

type Listener = () => void;

const listeners = new Set<Listener>();

let state: SimState = {
  t: 0,
  playing: false,
  speed: 0.25,
  holdAtPlate: true,
  clipId: "ff",
};

let readout: BallReadout = {
  valid: false,
  x: 0,
  y: 0,
  z: 0,
  worldX: 0,
  worldY: 0,
  worldZ: 0,
};

export const ballWorld = { x: 0, y: 1.1, z: 2, ready: false };

let trail = true;

export function trailEnabled(): boolean {
  return trail;
}

export function setTrail(enabled: boolean): void {
  trail = enabled;
  listeners.forEach((listener) => listener());
}

export function getSim(): SimState {
  return state;
}

export function getReadout(): BallReadout {
  return readout;
}

export function setSim(patch: Partial<SimState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function setReadout(next: BallReadout): void {
  readout = next;
}

declare global {
  interface Window {
    __plateControl?: {
      getSim: () => SimState;
      setSim: (patch: Partial<SimState>) => void;
      beginPlaySample: () => void;
      showClip?: (id: string) => void;
    };
    __plateGaze?: {
      tracking: boolean;
      x: number;
      y: number;
      z: number;
      camX: number;
      camY: number;
      camZ: number;
    };
    __plateProps?: {
      ball: string;
      bat: string;
      mitt: string;
      vrm: string;
    };
    __plateGear?: {
      getGear: () => import("@/lib/gear").Gear;
      setGear: (patch: Partial<import("@/lib/gear").Gear>) => void;
    };
    __plateClip?: { tStart: number; tPlate: number | null; tEnd: number };
  }
}

export function subscribeSim(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
