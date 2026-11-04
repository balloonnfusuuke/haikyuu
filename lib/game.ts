import type { GamePitch } from "@/lib/game-clip";

export type ArsenalPitch = { code: string; name: string; count: number; usage: number };

export type PitcherCard = {
  id: number;
  name: string;
  throws: "R" | "L";
  pitches: number;
  arsenal: ArsenalPitch[];
};

export type BatterCard = {
  id: number;
  name: string;
  bats: "R" | "L";
  szTop: number;
  szBot: number;
  pitches: number;
};

export type Roster = {
  repeatAlpha: number;
  rows: string[];
  columnsRight: string[];
  columnsLeft: string[];
  strikeCells: number[];
  league: { from: string; to: string; pitches: number; note?: string };
  pitchers: PitcherCard[];
  batters: BatterCard[];
};

export type PitchCall = {
  cell: number;
  label: string;
  actualCell: number;
  actualLabel: string;
  inZone: boolean;
};

export type PitchDecision = {
  swing: boolean;
  whiff: boolean;
  foul: boolean;
  outcome: string;
  bip: string | null;
  bbType: string | null;
  pSwing: number;
  pWhiff: number;
  pFoul: number;
  swingSamples: number;
  whiffSamples: number;
  foulSamples: number;
  repeatStreak: number;
};

export type PitchResult = {
  code: string;
  label: string;
  pa: string | null;
  paLabel: string | null;
  balls: number;
  strikes: number;
  over: boolean;
};

export type HistoryItem = {
  pitchType: string;
  group: string;
  cell: number;
  label: string;
};

export type ThrownPitch = {
  pitch: GamePitch;
  call: PitchCall;
  decision: PitchDecision;
  result: PitchResult;
  historyItem: HistoryItem;
};

export type Calibration = {
  batterId: number;
  name: string;
  seed: number;
  repeatAlpha: number;
  actual: { pitches: number; swingRate: number; whiffRate: number };
  simulated: { plateAppearances: number; pitches: number; swingRate: number; whiffRate: number };
  swingRateGap: number;
  whiffRateGap: number;
};

export async function fetchRoster(): Promise<Roster> {
  const response = await fetch("/api/game/roster");
  if (!response.ok) throw new Error("名簿を読めませんでした");
  return response.json();
}

export async function throwToApi(body: {
  pitcherId: number;
  batterId: number;
  pitchType: string;
  cell: number;
  balls: number;
  strikes: number;
  history: HistoryItem[];
  seed: number;
  pitchIndex: number;
  repeatAlpha: number;
}): Promise<ThrownPitch> {
  const response = await fetch("/api/game/pitch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "投球を決められませんでした");
  }
  return response.json();
}

export async function fetchCalibration(batterId: number, seed: number, repeatAlpha: number): Promise<Calibration> {
  const params = new URLSearchParams({
    batterId: String(batterId),
    seed: String(seed),
    n: "1000",
    repeatAlpha: String(repeatAlpha),
  });
  const response = await fetch(`/api/game/calibration?${params}`);
  if (!response.ok) throw new Error("1000打席の比較を計算できませんでした");
  return response.json();
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
