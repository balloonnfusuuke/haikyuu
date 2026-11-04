export type Bases = { first: boolean; second: boolean; third: boolean };

export const EMPTY_BASES: Bases = { first: false, second: false, third: false };

export type AdvanceKind = "walk" | "single" | "double" | "triple" | "home_run" | "out";

export function playKind(pa: string | null, bip: string | null): AdvanceKind | null {
  if (pa === "walk") return "walk";
  if (pa === "strikeout_looking" || pa === "strikeout_swinging") return "out";
  if (pa !== "in_play") return null;
  if (bip === "single" || bip === "double" || bip === "triple" || bip === "home_run") return bip;
  return "out";
}

/** 四球は押し出し。安打は走者をその塁数だけ進める。アウトでは走者は動かない。 */
export function advanceRunners(bases: Bases, kind: AdvanceKind): { bases: Bases; runs: number; out: boolean } {
  if (kind === "out") return { bases: { ...bases }, runs: 0, out: true };
  if (kind === "walk") {
    const runs = bases.first && bases.second && bases.third ? 1 : 0;
    return {
      bases: {
        first: true,
        second: bases.first ? true : bases.second,
        third: bases.first && bases.second ? true : bases.third,
      },
      runs,
      out: false,
    };
  }
  if (kind === "single") {
    return {
      bases: { first: true, second: bases.first, third: bases.second },
      runs: bases.third ? 1 : 0,
      out: false,
    };
  }
  if (kind === "double") {
    return {
      bases: { first: false, second: true, third: bases.first },
      runs: (bases.second ? 1 : 0) + (bases.third ? 1 : 0),
      out: false,
    };
  }
  if (kind === "triple") {
    return {
      bases: { first: false, second: false, third: true },
      runs: (bases.first ? 1 : 0) + (bases.second ? 1 : 0) + (bases.third ? 1 : 0),
      out: false,
    };
  }
  return {
    bases: { ...EMPTY_BASES },
    runs: 1 + (bases.first ? 1 : 0) + (bases.second ? 1 : 0) + (bases.third ? 1 : 0),
    out: false,
  };
}

export function basesLabel(bases: Bases): string {
  const names = [
    bases.first ? "一塁" : null,
    bases.second ? "二塁" : null,
    bases.third ? "三塁" : null,
  ].filter(Boolean);
  return names.length ? names.join("・") : "走者なし";
}
