export type MittView = "down" | "clear" | "full";

export type Gear = {
  bats: "R" | "L";
  calledX: number | null;
  calledZ: number | null;
  /** ゲームの結果。null はまだ投球していない。 */
  outcome: string | null;
  /** この打球が甲子園のフェンスを越えた本塁打か。 */
  homeRun: boolean;
  mittView: MittView;
};

const CATCH_OUTCOMES = new Set(["ball", "called_strike", "swinging_strike"]);

let gear: Gear = {
  bats: "R",
  calledX: null,
  calledZ: null,
  outcome: null,
  homeRun: false,
  mittView: "down",
};

const listeners = new Set<() => void>();

export function getGear(): Gear {
  return gear;
}

export function setGear(patch: Partial<Gear>): void {
  gear = { ...gear, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeGear(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 見逃し・空振り・ボールだけ捕る。ファウルとインプレーは捕らない。 */
export function mittCatches(outcome: string | null): boolean {
  return outcome != null && CATCH_OUTCOMES.has(outcome);
}
