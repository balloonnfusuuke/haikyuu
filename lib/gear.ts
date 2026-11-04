import { EMPTY_BASES, type AdvanceKind, type Bases } from "@/lib/bases";

export type MittView = "down" | "clear" | "full";

export type Gear = {
  bats: "R" | "L";
  calledX: number | null;
  calledZ: number | null;
  /** ゲームの結果。null はまだ投球していない。 */
  outcome: string | null;
  mittView: MittView;
  /** 投げる前の走者。 */
  bases: Bases;
  /** この球で打席が終わったときの進塁。 */
  advance: AdvanceKind | null;
};

const CATCH_OUTCOMES = new Set(["ball", "called_strike", "swinging_strike"]);

let gear: Gear = {
  bats: "R",
  calledX: null,
  calledZ: null,
  outcome: null,
  mittView: "down",
  bases: EMPTY_BASES,
  advance: null,
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
