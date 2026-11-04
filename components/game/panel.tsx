"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { clipFromPitch } from "@/lib/game-clip";
import type { Clip } from "@/lib/clips";
import {
  fetchCalibration,
  fetchRoster,
  percent,
  throwToApi,
  type BatterCard,
  type Calibration,
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
  onSnapshot: (snapshot: { matchup: string; balls: number; strikes: number; banner: string | null }) => void;
}) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pitcherId, setPitcherId] = useState<number | null>(null);
  const [batterId, setBatterId] = useState<number | null>(null);
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
  const [calibration, setCalibration] = useState<Calibration | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRoster()
      .then((next) => {
        if (cancelled) return;
        setRoster(next);
        setPitcherId(next.pitchers[0]?.id ?? null);
        setBatterId(next.batters[0]?.id ?? null);
        setAlpha(next.repeatAlpha);
        setPitchType(next.pitchers[0]?.arsenal[0]?.code ?? null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "名簿を読めませんでした");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pitcher = roster?.pitchers.find((item) => item.id === pitcherId) ?? null;
  const batter = roster?.batters.find((item) => item.id === batterId) ?? null;
  const columns = batter?.bats === "L" ? roster?.columnsLeft : roster?.columnsRight;

  useEffect(() => {
    if (!pitcher) return;
    if (!pitcher.arsenal.some((item) => item.code === pitchType)) {
      setPitchType(pitcher.arsenal[0]?.code ?? null);
    }
  }, [pitcher, pitchType]);

  useEffect(() => {
    const name = pitcher && batter ? `${batter.name} 対 ${pitcher.name}` : "対戦カードを選んでください";
    onSnapshot({
      matchup: name,
      balls,
      strikes,
      banner: over ?? last?.result.label ?? null,
    });
  }, [pitcher, batter, balls, strikes, over, last, onSnapshot]);

  useEffect(() => {
    if (!batter) return;
    let cancelled = false;
    setCalibration(null);
    fetchCalibration(batter.id, seed, alpha)
      .then((next) => {
        if (!cancelled) setCalibration(next);
      })
      .catch(() => {
        if (!cancelled) setCalibration(null);
      });
    return () => {
      cancelled = true;
    };
  }, [batter, seed, alpha]);

  const cells = useMemo(() => Array.from({ length: 25 }, (_, index) => index), []);

  async function throwPitch() {
    if (!pitcher || !batter || !pitchType || over) return;
    setBusy(true);
    setError(null);
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
        pitchIndex: history.length,
        repeatAlpha: alpha,
      });
      onClip(clipFromPitch(thrown.pitch));
      setLast(thrown);
      setBalls(thrown.result.balls);
      setStrikes(thrown.result.strikes);
      setHistory((items) => [...items, thrown.historyItem]);
      setOver(thrown.result.paLabel);
      setLog((rows) => [
        ...rows,
        {
          index: rows.length + 1,
          typeName: thrown.pitch.pitchName,
          call: thrown.call.label,
          actual: thrown.call.actualLabel,
          speed: thrown.pitch.releaseSpeed == null ? "—" : `${thrown.pitch.releaseSpeed.toFixed(1)} mph`,
          result: thrown.result.label,
          count: `${thrown.result.balls}-${thrown.result.strikes}`,
          swing: `${percent(thrown.decision.pSwing)} / 空振り ${percent(thrown.decision.pWhiff)}`,
        },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "投球に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  function nextPlateAppearance() {
    setBalls(0);
    setStrikes(0);
    setHistory([]);
    setLog([]);
    setOver(null);
    setLast(null);
  }

  return (
    <aside className="flex h-[48dvh] w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-[#2a342c] bg-[#121714] p-4 md:h-dvh md:w-[400px] md:border-l md:border-t-0">
      <div>
        <h2 className="text-base font-medium">1打席</h2>
        <p className="text-xs leading-relaxed text-[#8b968c]">
          捕手として球種とコースを選びます。飛んでくる球は、その投手の公式戦から、狙いに近い実在の1球です。
        </p>
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
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[#8b968c]">投手</span>
            <select
              aria-label="投手"
              className="w-full rounded-md border border-[#2a342c] bg-[#0e1210] px-2 py-2"
              value={pitcherId ?? ""}
              onChange={(event) => {
                setPitcherId(Number(event.target.value));
                nextPlateAppearance();
              }}
            >
              {roster.pitchers.map((item) => (
                <option key={item.id} value={item.id}>
                  {personLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[#8b968c]">打者</span>
            <select
              aria-label="打者"
              className="w-full rounded-md border border-[#2a342c] bg-[#0e1210] px-2 py-2"
              value={batterId ?? ""}
              onChange={(event) => {
                setBatterId(Number(event.target.value));
                nextPlateAppearance();
              }}
            >
              {roster.batters.map((item) => (
                <option key={item.id} value={item.id}>
                  {personLabel(item)}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <CountFigure label="ボール" value={balls} />
            <CountFigure label="ストライク" value={strikes} />
          </div>

          <div>
            <p className="mb-1 text-xs text-[#8b968c]">球種（この投手が公式戦で投げたもの）</p>
            <div className="flex flex-wrap gap-1.5">
              {pitcher?.arsenal.map((item) => (
                <Button
                  key={item.code}
                  type="button"
                  size="sm"
                  variant={pitchType === item.code ? "default" : "outline"}
                  onClick={() => setPitchType(item.code)}
                >
                  {item.name}
                  <span className="text-[10px] opacity-80">{Math.round(item.usage * 100)}%</span>
                </Button>
              ))}
            </div>
          </div>

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
                    onClick={() => setCell(index)}
                    className={`h-9 rounded text-[10px] leading-tight ${
                      cell === index
                        ? "bg-[#e24b4b] text-white"
                        : strike
                          ? "bg-[#2a3424] text-[#f4f1ea]"
                          : "bg-[#1a201c] text-[#aeb8ad]"
                    }`}
                  >
                    {columns?.[col]?.replace("ボール", "B")}
                    <span className="block text-[9px] opacity-80">{roster.rows[row].replace("ボール", "B")}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <label>
              <span className="mb-1 block text-xs text-[#8b968c]">乱数の種</span>
              <input
                aria-label="乱数の種"
                className="w-full rounded-md border border-[#2a342c] bg-[#0e1210] px-2 py-1.5 font-mono"
                type="number"
                value={seed}
                onChange={(event) => setSeed(Number(event.target.value))}
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
                onChange={(event) => setAlpha(Number(event.target.value))}
              />
            </label>
          </div>

          <div className="flex gap-2">
            <Button type="button" disabled={busy || Boolean(over) || !pitchType} onClick={() => void throwPitch()}>
              {busy ? "選球中" : "投げる"}
            </Button>
            <Button type="button" variant="secondary" onClick={nextPlateAppearance}>
              次の打席
            </Button>
          </div>

          {last && (
            <div className="rounded-md bg-[#1b221c] px-3 py-2 text-sm">
              <p className="font-medium">{over ?? last.result.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-[#c5cdc4]">
                狙い {last.call.label}、実際 {last.call.actualLabel}
                {last.call.inZone ? "（ゾーン内）" : "（ゾーン外）"}。スイング {percent(last.decision.pSwing)}
                、空振り {percent(last.decision.pWhiff)}。この組み合わせの実数は {last.decision.swingSamples} 球。
                {last.decision.repeatStreak > 0 ? ` 同じ球が ${last.decision.repeatStreak} 球続いています。` : ""}
              </p>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs text-[#8b968c]">配球</p>
            {log.length === 0 ? (
              <p className="text-sm text-[#8b968c]">まだ一球も投げていません。</p>
            ) : (
              <ol className="space-y-1.5 text-xs">
                {log.map((row) => (
                  <li key={row.index} className="rounded bg-[#0e1210] px-2 py-1.5">
                    <span className="font-mono text-[#f0d48a]">{row.index}</span> {row.typeName} → {row.call}
                    <span className="mt-0.5 block text-[#c5cdc4]">
                      実際 {row.actual} · {row.speed} · {row.result} · {row.count} · {row.swing}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {calibration && (
            <div className="rounded-md border border-[#2a342c] px-3 py-2 text-xs leading-relaxed text-[#c5cdc4]">
              <p className="text-sm text-[#f4f1ea]">{calibration.name} の 1,000 打席</p>
              <p>
                実際のスイング率 {percent(calibration.actual.swingRate)}、AI {percent(calibration.simulated.swingRate)}（差{" "}
                {signed(calibration.swingRateGap)}）
              </p>
              <p>
                実際の空振り率 {percent(calibration.actual.whiffRate)}、AI {percent(calibration.simulated.whiffRate)}（差{" "}
                {signed(calibration.whiffRateGap)}）
              </p>
              <p className="mt-1">
                空振り率はスイングしたうちの空振りです。比較は、この打者が公式戦で見た球の分布で配球しています。
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant={night ? "outline" : "secondary"} onClick={() => onNight(false)}>
              昼
            </Button>
            <Button type="button" size="sm" variant={night ? "secondary" : "outline"} onClick={() => onNight(true)}>
              ナイター
            </Button>
            <Button type="button" size="sm" variant={showZone ? "secondary" : "outline"} onClick={() => onZone(!showZone)}>
              ゾーン
            </Button>
            <Button type="button" size="sm" variant={showAxis ? "secondary" : "outline"} onClick={() => onAxis(!showAxis)}>
              回転軸
            </Button>
          </div>
        </>
      )}
    </aside>
  );
}

function personLabel(person: PitcherCard | BatterCard): string {
  if ("throws" in person) return `${person.name}（${person.throws === "L" ? "左投" : "右投"}）`;
  return `${person.name}（${person.bats === "L" ? "左打" : "右打"}）`;
}

function CountFigure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-[#0e1210] px-3 py-2">
      <p className="text-xs text-[#8b968c]">{label}</p>
      <p className="font-mono text-2xl">{value}</p>
    </div>
  );
}

function signed(value: number): string {
  const points = value * 100;
  const text = `${points >= 0 ? "+" : ""}${points.toFixed(1)} pt`;
  return text;
}
