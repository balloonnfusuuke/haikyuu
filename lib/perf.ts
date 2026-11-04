export const perf = {
  loadMs: null as number | null,
  fps: 0,
};

export function markStadiumReady(): void {
  if (perf.loadMs != null) return;
  perf.loadMs = performance.now();
}

export function noteFps(fps: number): void {
  if (Number.isFinite(fps)) perf.fps = fps;
}
