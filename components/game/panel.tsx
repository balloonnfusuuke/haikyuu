"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { advanceRunners, basesLabel, EMPTY_BASES, playKind, type Bases } from "@/lib/bases";
import { setGear, type MittView } from "@/lib/gear";
import { clipFromPitch, type ContactFlight } from "@/lib/game-clip";
import { getSim, setSim, setTrail } from "@/lib/sim";
import { magnusDirection } from "@/lib/spin";
import { setCellPicker, setSign } from "@/lib/sign";
import { cellCenter } from "@/lib/zone-grid";
import type { Clip } from "@/lib/clips";
import {
  fetchHoldout,
  fetchRoster,
  percent,
  throwToApi,
  type BatterCard,
  type Holdout,
  type HoldoutBatter,
  type HistoryItem,
  type PitcherCard,
  type Roster,
  type ThrownPitch,
} from "@/lib/game";

type LogRow = {
  index: number;
  typeName: string;
  call: string;
  actual: string;
  speed: string;
  result: string;
  count: string;
  swing: string;
  contact: string;
};

type InningPlate = {
  spot: number;
  batter: string;
  result: string;
  runs: number;
  out: boolean;
  pitches: LogRow[];
};

type Snapshot = {
  matchup: string;
  balls: number;
  strikes: number;
  banner: string | null;
  inning: string | null;
};

export function GamePanel({
  night,
  showZone,
  showAxis,
  onNight,
  onZone,
  onAxis,
  onClip,
  onSnapshot,
}: {
  night: boolean;
  showZone: boolean;
  showAxis: boolean;
  onNight: (night: boolean) => void;
  onZone: (show: boolean) => void;
  onAxis: (show: boolean) => void;
  onClip: (clip: Clip) => void;
  onSnapshot: (snapshot: Snapshot) => void;
}) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"pa" | "inning">("pa");
  const [pitcherId, setPitcherId] = useState<number | null>(null);
  const [batterId, setBatterId] = useState<number | null>(null);
  const [lineup, setLineup] = useState<number[]>([]);
  const [spot, setSpot] = useState(0);
  const [pitchType, setPitchType] = useState<string | null>(null);
  const [cell, setCell] = useState(12);
  const [seed, setSeed] = useState(20250615);
  const [alpha, setAlpha] = useState(0.06);
  const [balls, setBalls] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ThrownPitch | null>(null);
  const [outs, setOuts] = useState(0);
  const [bases, setBases] = useState<Bases>(EMPTY_BASES);
  const [runs, setRuns] = useState(0);
  const [pitchCount, setPitchCount] = useState(0);
  const [plates, setPlates] = useState<InningPlate[]>([]);
  const [inningOver, setInningOver] = useState(false);
  const [holdout, setHoldout] = useState<Holdout | null>(null);
  const [holdoutError, setHoldoutError] = useState<string | null>(null);
  const [mittView, setMittView] = useState<MittView>("down");
  const [pending, setPending] = useState<ThrownPitch | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [trail, setTrailOn] = useState(true);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const serial = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetchRoster()
      .then((next) => {
        if (cancelled) return;
        setRoster(next);
        setPitcherId(next.pitchers[0]?.id ?? null);
        setBatterId(next.batters[0]?.id ?? null);
        setLineup(next.batters.slice(0, 3).map((batter) => batter.id));
        setAlpha(next.repeatAlpha);
        setPitchType(next.pitchers[0]?.arsenal[0]?.code ?? null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "名簿を読めませんでした");
      });
    fetchHoldout()
      .then((next) => {
        if (!cancelled) setHoldout(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setHoldoutError(cause instanceof Error ? cause.message : "比較を計算できませんでした");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pitcher = roster?.pitchers.find((item) => item.id === pitcherId) ?? null;
  const activeBatterId = mode === "inning" ? (lineup[spot] ?? null) : batterId;
  const batter = roster?.batters.find((item) => item.id === activeBatterId) ?? null;
  const columns = batter?.bats === "L" ? roster?.columnsLeft : roster?.columnsRight;
  const cells = useMemo(() => Array.from({ length: 25 }, (_, index) => index), []);

  useEffect(() => {
    if (!pitcher) return;
    if (!pitcher.arsenal.some((item) => item.code === pitchType)) {
      setPitchType(pitcher.arsenal[0]?.code ?? null);
    }
  }, [pitcher, pitchType]);

  useEffect(() => {
    const name = pitcher && batter ? `${batter.name} 対 ${pitcher.name}` : "対戦カードを選んでください";
    const inning =
      mode === "inning" ? `アウト ${outs} · ${basesLabel(bases)} · 失点 ${runs} · 球数 ${pitchCount}` : null;
    onSnapshot({
      matchup: name,
      balls,
      strikes,
      banner: pending ? pending.result.label : inningOver ? "イニング終了" : (over ?? last?.result.label ?? null),
      inning,
    });
  }, [pitcher, batter, balls, strikes, over, last, pending, onSnapshot, mode, outs, bases, runs, pitchCount, inningOver]);

  function clearPlate() {
    setBalls(0);
    setStrikes(0);
    setHistory([]);
    setLog([]);
    setOver(null);
    setLast(null);
    setPending(null);
  }

  function clearInning() {
    clearPlate();
    setSpot(0);
    setOuts(0);
    setBases(EMPTY_BASES);
    setRuns(0);
    setPitchCount(0);
    setPlates([]);
    setInningOver(false);
  }

  function pickMitt(next: MittView) {
    const value = mittView === next ? "full" : next;
    setMittView(value);
    setGear({ mittView: value });
  }

  function playThrown(thrown: ThrownPitch) {
    if (!batter) return;
    const [calledX, calledZ] = cellCenter(cell, batter.szBot, batter.szTop);
    setGear({ bats: batter.bats, calledX, calledZ, outcome: thrown.decision.outcome });
    onClip(clipFromPitch(thrown.pitch, contactFrom(thrown)));
  }

  async function throwPitch() {
    if (!pitcher || !batter || !pitchType || inningOver || pending) return;
    if (mode === "pa" && over) return;
    setBusy(true);
    setError(null);
    const pitchIndex = serial.current;
    serial.current += 1;
    try {
      const thrown = await throwToApi({
        pitcherId: pitcher.id,
        batterId: batter.id,
        pitchType,
        cell,
        balls,
        strikes,
        history,
        seed,
        pitchIndex,
        repeatAlpha: alpha,
      });
      setPending(thrown);
      playThrown(thrown);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "投球に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  function commitPending() {
    if (!pending || !batter) return;
    const thrown = pending;
    setPending(null);
    setLast(thrown);
    const row = rowFrom(log.length + 1, thrown);
    const nextLog = [...log, row];
    setHistory((items) => [...items, thrown.historyItem]);
    setLog(nextLog);
    if (mode === "inning") setPitchCount((count) => count + 1);

    if (!thrown.result.over) {
      setBalls(thrown.result.balls);
      setStrikes(thrown.result.strikes);
      return;
    }

    if (mode === "pa") {
      setBalls(thrown.result.balls);
      setStrikes(thrown.result.strikes);
      setOver(thrown.result.paLabel);
      return;
    }

    const kind = playKind(thrown.result.pa, thrown.decision.bip);
    const step = advanceRunners(bases, kind ?? "out");
    const nextOuts = outs + (step.out ? 1 : 0);
    setRuns((total) => total + step.runs);
    setBases(step.bases);
    setOuts(nextOuts);
    setPlates((items) => [
      ...items,
      {
        spot: spot + 1,
        batter: batter.name,
        result: plateResult(thrown.result.paLabel, step.runs),
        runs: step.runs,
        out: step.out,
        pitches: nextLog,
      },
    ]);
    if (nextOuts >= 3) {
      setBalls(thrown.result.balls);
      setStrikes(thrown.result.strikes);
      setOver(thrown.result.paLabel);
      setInningOver(true);
      return;
    }
    setSpot((index) => (index + 1) % Math.max(lineup.length, 1));
    setBalls(0);
    setStrikes(0);
    setHistory([]);
    setLog([]);
    setOver(null);
  }

  function setSpeed(speed: number) {
    setReplaySpeed(speed);
    setSim({ speed, holdAtPlate: false });
  }

  function togglePlay() {
    setSim({ playing: !getSim().playing, holdAtPlate: false });
  }

  function stepFrame() {
    const current = window.__plateClip;
    if (!current) return;
    setSim({ t: Math.min(current.tEnd, getSim().t + 1 / 60), playing: false, holdAtPlate: false });
  }

  function replayClip() {
    const current = window.__plateClip;
    if (!current) return;
    setSim({ t: current.tStart, playing: true, speed: replaySpeed, holdAtPlate: false });
  }

  function toggleTrail() {
    const next = !trail;
    setTrailOn(next);
    setTrail(next);
  }

  const report = holdout?.batters.find((item) => item.batterId === batter?.id) ?? null;

  useEffect(() => {
    if (!batter) return;
    const [calledX, calledZ] = cellCenter(cell, batter.szBot, batter.szTop);
    setGear({ bats: batter.bats, calledX, calledZ });
  }, [batter, cell]);

  useEffect(() => {
    setCellPicker(setCell);
    return () => setCellPicker(() => {});
  }, []);

  const calling = mode === "pa" || !inningOver;

  useEffect(() => {
    if (!roster || !batter) {
      setSign({ interactive: false });
      return;
    }
    setSign({
      cell,
      szTop: batter.szTop,
      szBot: batter.szBot,
      strikeCells: roster.strikeCells,
      interactive: calling,
    });
  }, [roster, batter, cell, calling]);

  const aimLabel =
    roster && columns ? `${roster.rows[Math.floor(cell / 5)]}・${columns[cell % 5] ?? ""}` : "真ん中";
  const shown = pending ?? last;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="pointer-events-auto absolute left-3 top-24 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-black/40 px-2 py-1.5 text-white shadow-lg backdrop-blur-md">
      <div className="flex gap-1.5" role="group" aria-label="遊び方">
        <Button type="button" size="sm" variant={mode === "pa" ? "default" : "outline"} onClick={() => { setMode("pa"); clearInning(); }}>
          1打席
        </Button>
        <Button type="button" size="sm" variant={mode === "inning" ? "default" : "outline"} onClick={() => { setMode("inning"); clearInning(); }}>
          1イニング
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-[#8f2d2d] px-3 py-2 text-sm text-white">
          {error}
        </p>
      )}

      {!roster ? (
        <p className="text-sm text-[#c5cdc4]">名簿を読み込んでいます。</p>
      ) : (
        <>
          <label className="block text-xs">
            <span className="sr-only">投手</span>
            <select
              aria-label="投手"
              className="max-w-40 rounded-md border border-white/15 bg-black/40 px-2 py-1"
              value={pitcherId ?? ""}
              disabled={mode === "inning" && pitchCount > 0}
              onChange={(event) => {
                setPitcherId(Number(event.target.value));
                if (mode === "inning") clearInning();
                else clearPlate();
              }}
            >
              {roster.pitchers.map((item) => (
                <option key={item.id} value={item.id}>
                  {personLabel(item)}
                </option>
              ))}
            </select>
          </label>

          {mode === "pa" ? (
            <label className="block text-xs">
              <span className="sr-only">打者</span>
              <select
                aria-label="打者"
                className="max-w-40 rounded-md border border-white/15 bg-black/40 px-2 py-1"
                value={batterId ?? ""}
                onChange={(event) => {
                  setBatterId(Number(event.target.value));
                  clearPlate();
                }}
              >
                {roster.batters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {personLabel(item)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {lineup.map((id, index) => (
                <label key={index} className="block text-sm">
                  <span className="mb-1 block text-xs text-[#8b968c]">{index + 1}番</span>
                  <select
                    aria-label={`${index + 1}番`}
                    className="w-full rounded-md border border-[#2a342c] bg-[#0e1210] px-1 py-2 text-xs"
                    value={id}
                    disabled={pitchCount > 0}
                    onChange={(event) => {
                      const next = [...lineup];
                      next[index] = Number(event.target.value);
                      setLineup(next);
                    }}
                  >
                    {roster.batters.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name.split(",")[0]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}

          {mode === "inning" && (
            <p className="text-xs text-white/80">
              {spot + 1}番 {batter?.name} · アウト {outs} · {basesLabel(bases)} · 失点 {runs} · {pitchCount}球
            </p>
          )}
          <p className="text-xs text-white/75">狙い {aimLabel}</p>
          <div className="sr-only">
            <ZoneGrid roster={roster} columns={columns} cells={cells} cell={cell} onPick={setCell} />
          </div>
        </>
      )}
      </div>

      {roster && calling && (
        <div className="pointer-events-auto absolute inset-x-3 bottom-16 flex flex-col gap-1.5 rounded-xl border border-white/10 bg-black/40 p-2 shadow-lg backdrop-blur-md">
          <p className="text-[11px] text-white/70">ゾーンのマスを押してコース。球種を選んで投げる。</p>
          <PitchPicker pitcher={pitcher} pitchType={pitchType} onPick={setPitchType} />
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              disabled={busy || pending != null || !pitchType || (mode === "pa" && Boolean(over)) || inningOver}
              onClick={() => void throwPitch()}
            >
              {busy ? "選球中" : "投げる"}
            </Button>
            <Button type="button" disabled={pending == null} onClick={commitPending}>
              次の球
            </Button>
            <Button type="button" variant="secondary" onClick={() => (mode === "inning" ? clearInning() : clearPlate())}>
              {mode === "inning" ? "イニングをやり直す" : "次の打席"}
            </Button>
            <Button type="button" size="sm" variant={replaySpeed === 1 ? "secondary" : "outline"} onClick={() => setSpeed(1)}>
              等速
            </Button>
            <Button type="button" size="sm" variant={replaySpeed === 0.25 ? "secondary" : "outline"} onClick={() => setSpeed(0.25)}>
              1/4
            </Button>
            <Button type="button" size="sm" variant={replaySpeed === 0.1 ? "secondary" : "outline"} onClick={() => setSpeed(0.1)}>
              1/10
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={togglePlay}>
              再生
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={stepFrame}>
              コマ送り
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={replayClip}>
              もう一度
            </Button>
            <Button type="button" size="sm" variant={trail ? "secondary" : "outline"} onClick={toggleTrail}>
              軌跡
            </Button>
            <Button type="button" size="sm" variant={night ? "secondary" : "outline"} onClick={() => onNight(!night)}>
              {night ? "ナイター" : "昼"}
            </Button>
            <Button type="button" size="sm" variant={showZone ? "secondary" : "outline"} onClick={() => onZone(!showZone)}>
              ゾーン
            </Button>
            <Button type="button" size="sm" variant={showAxis ? "secondary" : "outline"} onClick={() => onAxis(!showAxis)}>
              回転軸
            </Button>
            <Button type="button" size="sm" variant={mittView === "down" ? "secondary" : "outline"} onClick={() => pickMitt("down")}>
              ミットを下げる
            </Button>
            <Button type="button" size="sm" variant={mittView === "clear" ? "secondary" : "outline"} onClick={() => pickMitt("clear")}>
              ミットを透かす
            </Button>
            <Button type="button" size="sm" variant={recordsOpen ? "secondary" : "outline"} onClick={() => setRecordsOpen((open) => !open)}>
              記録
            </Button>
          </div>
        </div>
      )}

      {shown && batter && !recordsOpen && (
        <div className="absolute right-3 top-3 max-md:left-3 max-md:right-auto max-md:top-auto max-md:bottom-52">
          <PitchReadout last={shown} bats={batter.bats} />
        </div>
      )}

      {recordsOpen && roster && (
        <div className="pointer-events-auto absolute bottom-16 right-3 top-3 flex w-[min(22rem,calc(100%-1.5rem))] flex-col gap-3 overflow-y-auto rounded-xl border border-white/10 bg-black/50 p-3 text-white shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">記録</h2>
            <Button type="button" size="sm" variant="outline" onClick={() => setRecordsOpen(false)}>
              閉じる
            </Button>
          </div>
          {shown && batter && <PitchReadout last={shown} bats={batter.bats} />}
          <SeedAlpha seed={seed} alpha={alpha} onSeed={setSeed} onAlpha={setAlpha} />
          <PitchLog log={log} />
          {mode === "inning" && plates.length > 0 && (
            <InningReview plates={plates} runs={runs} pitchCount={pitchCount} done={inningOver} onAgain={clearInning} />
          )}
          {mode === "pa" && <HoldoutNote report={report} error={holdoutError} loading={holdout === null && !holdoutError} />}
        </div>
      )}
    </div>
  );
}

function contactFrom(thrown: ThrownPitch): ContactFlight {
  const decision = thrown.decision;
  const hit = decision.outcome === "foul" || decision.outcome === "in_play";
  return {
    exitSpeed: decision.exitSpeed ?? 0,
    launchAngle: decision.launchAngle ?? 0,
    spray: decision.spray ?? 0,
    hcX: decision.hcX,
    hcY: decision.hcY,
    hitDistance: decision.hitDistance,
    bbType: decision.bbType,
    miss: decision.whiff,
    swing: decision.swing,
    batSpeed: decision.batSpeed,
    swingLength: decision.swingLength,
    noise: hit ? "hit" : "catch",
    fair: decision.outcome === "in_play" || decision.outcome === "foul",
  };
}

function rowFrom(index: number, thrown: ThrownPitch): LogRow {
  const decision = thrown.decision;
  const contact =
    decision.exitSpeed == null ? "" : `${decision.exitSpeed.toFixed(1)} mph · 角度 ${decision.launchAngle?.toFixed(0) ?? "—"}°`;
  return {
    index,
    typeName: thrown.pitch.pitchName,
    call: thrown.call.label,
    actual: thrown.call.actualLabel,
    speed: thrown.pitch.releaseSpeed == null ? "—" : `${thrown.pitch.releaseSpeed.toFixed(1)} mph`,
    result: thrown.result.label,
    count: `${thrown.result.balls}-${thrown.result.strikes}`,
    swing: `${percent(decision.pSwing)} / 空振り ${percent(decision.pWhiff)}`,
    contact,
  };
}

function plateResult(label: string | null, runs: number): string {
  const base = label ?? "打席終了";
  return runs > 0 ? `${base}、${runs}点` : base;
}

function personLabel(person: PitcherCard | BatterCard): string {
  if ("throws" in person) return `${person.name}（${person.throws === "L" ? "左投" : "右投"}）`;
  return `${person.name}（${person.bats === "L" ? "左打" : "右打"}）`;
}

function PitchPicker({
  pitcher,
  pitchType,
  onPick,
}: {
  pitcher: PitcherCard | null;
  pitchType: string | null;
  onPick: (code: string) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {pitcher?.arsenal.map((item) => (
          <Button key={item.code} type="button" size="sm" variant={pitchType === item.code ? "default" : "outline"} onClick={() => onPick(item.code)}>
            {item.name}
            <span className="text-[10px] opacity-80">{Math.round(item.usage * 100)}%</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function ZoneGrid({
  roster,
  columns,
  cells,
  cell,
  onPick,
}: {
  roster: Roster;
  columns: string[] | undefined;
  cells: number[];
  cell: number;
  onPick: (cell: number) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-[#8b968c]">
        コース。内側の 3×3 がストライク、外周はボール。内角・外角は打者から見た呼び方です。
      </p>
      <div className="grid grid-cols-5 gap-1" role="group" aria-label="コース">
        {cells.map((index) => {
          const strike = roster.strikeCells.includes(index);
          const row = Math.floor(index / 5);
          const col = index % 5;
          const label = `${roster.rows[row]}・${columns?.[col] ?? ""}`;
          return (
            <button
              key={index}
              type="button"
              aria-label={label}
              aria-pressed={cell === index}
              onClick={() => onPick(index)}
              className={`h-9 rounded text-[10px] leading-tight ${
                cell === index ? "bg-[#e24b4b] text-white" : strike ? "bg-[#2a3424] text-[#f4f1ea]" : "bg-[#1a201c] text-[#aeb8ad]"
              }`}
            >
              {columns?.[col]?.replace("ボール", "B")}
              <span className="block text-[9px] opacity-80">{roster.rows[row].replace("ボール", "B")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SeedAlpha({
  seed,
  alpha,
  onSeed,
  onAlpha,
}: {
  seed: number;
  alpha: number;
  onSeed: (seed: number) => void;
  onAlpha: (alpha: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <label>
        <span className="mb-1 block text-xs text-[#8b968c]">乱数の種</span>
        <input
          aria-label="乱数の種"
          className="w-full rounded-md border border-[#2a342c] bg-[#0e1210] px-2 py-1.5 font-mono"
          type="number"
          value={seed}
          onChange={(event) => onSeed(Number(event.target.value))}
        />
      </label>
      <label>
        <span className="mb-1 block text-xs text-[#8b968c]">連続球の補正 {alpha.toFixed(2)}</span>
        <input
          aria-label="連続球の補正"
          className="w-full"
          type="range"
          min={0}
          max={0.3}
          step={0.01}
          value={alpha}
          onChange={(event) => onAlpha(Number(event.target.value))}
        />
      </label>
    </div>
  );
}

function mphPair(mph: number): string {
  return `${mph.toFixed(1)} mph · ${(mph * 1.609344).toFixed(1)} km/h`;
}

function axisPhrase(degrees: number): string {
  const force = magnusDirection(degrees);
  const vertical = force.z > 0.35 ? "上向き" : force.z < -0.35 ? "下向き" : "";
  const horizontal = force.x > 0.35 ? "捕手から右" : force.x < -0.35 ? "捕手から左" : "";
  return [vertical, horizontal].filter(Boolean).join("・");
}

function sprayWords(spray: number | null, bats: "R" | "L"): string {
  if (spray == null) return "";
  const pull = bats === "L" ? spray > 15 : spray < -15;
  const oppo = bats === "L" ? spray < -15 : spray > 15;
  if (pull) return "引っ張り";
  if (oppo) return "逆方向";
  return "センター";
}

const BB_LABEL: Record<string, string> = {
  ground_ball: "ゴロ",
  line_drive: "ライナー",
  fly_ball: "フライ",
  popup: "ポップフライ",
};

function PitchReadout({ last, bats }: { last: ThrownPitch; bats: "R" | "L" }) {
  const pitch = last.pitch;
  const decision = last.decision;
  const direction = [sprayWords(decision.spray, bats), decision.bbType ? BB_LABEL[decision.bbType] ?? decision.bbType : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="pointer-events-none w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white shadow-lg backdrop-blur-md">
      <p className="text-sm font-medium">
        {pitch.pitchName}
        <span className="ml-2 font-normal text-white/75">{last.result.paLabel ?? last.result.label}</span>
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Stat label="球速" value={pitch.releaseSpeed == null ? "—" : mphPair(pitch.releaseSpeed)} wide />
        <Stat label="回転" value={pitch.spinRpm == null ? "—" : `${Math.round(pitch.spinRpm).toLocaleString("ja-JP")} rpm`} />
        <Stat
          label="回転軸"
          value={pitch.spinAxis == null ? "—" : `${Math.round(pitch.spinAxis)}° ${axisPhrase(pitch.spinAxis)}`.trim()}
        />
        <Stat label="狙い" value={last.call.label} />
        <Stat label="到達" value={`${last.call.actualLabel}${last.call.inZone ? " · ゾーン内" : " · ゾーン外"}`} />
      </dl>
      {decision.exitSpeed != null && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-white/15 pt-2">
          <Stat label="打球速度" value={mphPair(decision.exitSpeed)} wide />
          <Stat label="角度" value={decision.launchAngle == null ? "—" : `${decision.launchAngle.toFixed(1)}°`} />
          <Stat
            label="飛距離"
            value={
              decision.hitDistance == null
                ? "—"
                : `${Math.round(decision.hitDistance)} ft · ${Math.round(decision.hitDistance * 0.3048)} m`
            }
          />
          <Stat label="方向" value={direction || "—"} />
          {decision.batSpeed != null && <Stat label="バット速度" value={mphPair(decision.batSpeed)} wide />}
        </dl>
      )}
      {decision.park && <p className="mt-2 border-t border-white/15 pt-2 text-[12px] leading-snug text-white/80">{decision.park.note}</p>}
    </div>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-[10px] text-white/55">{label}</dt>
      <dd className="font-mono text-[13px] leading-tight">{value}</dd>
    </div>
  );
}

function PitchLog({ log }: { log: LogRow[] }) {
  return (
    <div>
      <p className="mb-1 text-xs text-[#8b968c]">この打席の配球</p>
      {log.length === 0 ? (
        <p className="text-sm text-[#8b968c]">まだ一球も投げていません。</p>
      ) : (
        <ol className="space-y-1.5 text-xs">
          {log.map((row) => (
            <li key={row.index} className="rounded bg-[#0e1210] px-2 py-1.5">
              <span className="font-mono text-[#f0d48a]">{row.index}</span> {row.typeName} → {row.call}
              <span className="mt-0.5 block text-[#c5cdc4]">
                実際 {row.actual} · {row.speed} · {row.result}
                {row.contact ? ` · ${row.contact}` : ""} · {row.count}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function InningReview({
  plates,
  runs,
  pitchCount,
  done,
  onAgain,
}: {
  plates: InningPlate[];
  runs: number;
  pitchCount: number;
  done: boolean;
  onAgain: () => void;
}) {
  const hits = plates.filter((plate) => /単打|二塁打|三塁打|本塁打/.test(plate.result)).length;
  const strikeouts = plates.filter((plate) => plate.result.includes("三振")).length;
  const walks = plates.filter((plate) => plate.result.includes("四球")).length;
  return (
    <div>
      <h3 className="text-sm font-medium">{done ? "イニングの振り返り" : "ここまでの打席"}</h3>
      {done && (
        <p className="mt-1 text-xs text-[#c5cdc4]">
          失点 {runs} · 安打 {hits} · 四球 {walks} · 三振 {strikeouts} · 球数 {pitchCount}
        </p>
      )}
      <ol className="mt-2 space-y-2">
        {plates.map((plate, index) => (
          <li key={`${plate.spot}-${index}`} className="rounded-md bg-[#0e1210] px-2 py-2 text-xs">
            <p>
              <span className="font-mono text-[#f0d48a]">{index + 1}</span> {plate.batter} · {plate.result}
            </p>
            <ol className="mt-1 space-y-1 text-[#c5cdc4]">
              {plate.pitches.map((pitch) => (
                <li key={pitch.index}>
                  {pitch.index}. {pitch.typeName} → {pitch.call} · {pitch.result}
                  {pitch.contact ? ` · ${pitch.contact}` : ""}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
      {done && (
        <Button type="button" className="mt-2" variant="secondary" onClick={onAgain}>
          もう1イニング
        </Button>
      )}
    </div>
  );
}

const HOLDOUT_ROWS: { key: keyof Omit<HoldoutBatter, "swingByCount" | "batterId" | "name" | "method" | "trainPitches" | "testPitches" | "testPlateAppearances" | "simulatedPlateAppearances">; label: string }[] = [
  { key: "swingRate", label: "スイング率" },
  { key: "whiffRate", label: "空振り率" },
  { key: "strikeoutRate", label: "三振率" },
  { key: "walkRate", label: "四球率" },
  { key: "groundRate", label: "ゴロ" },
  { key: "lineRate", label: "ライナー" },
  { key: "flyRate", label: "フライ" },
  { key: "hitRate", label: "安打" },
  { key: "extraBaseRate", label: "長打" },
  { key: "homeRunRate", label: "本塁打" },
];

function HoldoutNote({ report, error, loading }: { report: HoldoutBatter | null; error: string | null; loading: boolean }) {
  if (error) return <p className="text-xs text-[#ffb4ab]">{error}</p>;
  if (loading || !report) return <p className="text-xs text-[#8b968c]">2024年の判断と2025年の成績を比べています。</p>;
  return (
    <div className="rounded-md border border-[#2a342c] px-3 py-2 text-xs leading-relaxed text-[#c5cdc4]">
      <p className="text-sm text-[#f4f1ea]">{report.name}</p>
      <p className="mt-1">{report.method}。AI は 2,000 打席、種 7、補正 0.06。</p>
      <table className="mt-2 w-full">
        <thead>
          <tr className="text-left text-[#8b968c]">
            <th className="py-0.5 font-normal">項目</th>
            <th className="py-0.5 font-normal">2025</th>
            <th className="py-0.5 font-normal">AI差</th>
            <th className="py-0.5 font-normal">2024差</th>
          </tr>
        </thead>
        <tbody>
          {HOLDOUT_ROWS.map((row) => {
            const rate = report[row.key];
            return (
              <tr key={row.key}>
                <td className="py-0.5">{row.label}</td>
                <td className="font-mono">{percent(rate.actual)}</td>
                <td className="font-mono">{signed(rate.gap)}</td>
                <td className="font-mono">{signed(rate.baseline)}</td>
              </tr>
            );
          })}
          {(["0-0", "0-2", "3-2"] as const).map((count) => {
            const rate = report.swingByCount[count];
            return (
              <tr key={count}>
                <td className="py-0.5">スイング {count}</td>
                <td className="font-mono">{percent(rate.actual)}</td>
                <td className="font-mono">{signed(rate.gap)}</td>
                <td className="font-mono">{signed(rate.baseline)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2">
        2024差は、その年の成績をそのまま2025年に当てた差です。AI差がこれと同じくらいなら、ずれは選手の変化です。空振りは球種と、ゾーンの内と外で分け、ライナーは同じ結果の実際の打球の種類を使っています。
      </p>
    </div>
  );
}

function signed(value: number): string {
  const points = value * 100;
  return `${points >= 0 ? "+" : ""}${points.toFixed(1)} pt`;
}
