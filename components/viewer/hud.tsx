"use client";

import { useEffect, useState } from "react";
import { magnusDirection } from "@/lib/spin";
import { CLIPS, getClip, type Clip } from "@/lib/clips";
import { PLATE_FRONT_FT, PLATE_HALF_WIDTH_FT } from "@/lib/field-constants";
import type { StadiumReport } from "@/lib/field";
import { getReadout, getSim, setSim } from "@/lib/sim";
import { propSource } from "./ball";
import { Button } from "@/components/ui/button";

function useAnimationFrame(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    let frame = 0;
    const loop = () => {
      setTick((value) => value + 1);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);
}

function feet(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const text = value.toFixed(digits);
  return text === "-0.00" || text === "-0.000" ? text.slice(1) : text;
}

function spinSentence(degrees: number): string {
  const force = magnusDirection(degrees);
  const vertical = force.z > 0.35 ? "上向き" : force.z < -0.35 ? "下向き" : "上下の変化は小さい";
  const horizontal =
    force.x > 0.35 ? "捕手から見て右" : force.x < -0.35 ? "捕手から見て左" : "左右の変化は小さい";
  return `${vertical}、${horizontal}に曲がる軸`;
}

function ZonePlot({
  plateX,
  plateZ,
  ballX,
  ballZ,
  szTop,
  szBot,
}: {
  plateX: number | null;
  plateZ: number | null;
  ballX: number;
  ballZ: number;
  szTop: number;
  szBot: number;
}) {
  const width = 220;
  const height = 248;
  const zMax = 6.5;
  const xOf = (x: number) => 26 + ((x + 2) / 4) * (width - 44);
  const zOf = (z: number) => 18 + ((zMax - z) / zMax) * (height - 36);
  const half = PLATE_HALF_WIDTH_FT;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="捕手から見た到達位置">
      <rect x="0" y="0" width={width} height={height} rx="8" fill="#0c100e" />
      <text x="12" y="16" fill="#8b968c" fontSize="11">
        三塁
      </text>
      <text x={width - 12} y="16" fill="#8b968c" fontSize="11" textAnchor="end">
        一塁
      </text>
      <line x1={xOf(0)} y1={18} x2={xOf(0)} y2={height - 16} stroke="#243028" />
      <rect
        x={xOf(-half)}
        y={zOf(szTop)}
        width={xOf(half) - xOf(-half)}
        height={zOf(szBot) - zOf(szTop)}
        fill="none"
        stroke="#f6e7a8"
        strokeWidth="1.5"
      />
      <polygon
        points={`${xOf(0)},${zOf(0)} ${xOf(half)},${zOf(half)} ${xOf(half)},${zOf(PLATE_FRONT_FT)} ${xOf(-half)},${zOf(PLATE_FRONT_FT)} ${xOf(-half)},${zOf(half)}`}
        fill="#f4f1ea"
      />
      <circle cx={xOf(ballX)} cy={zOf(ballZ)} r="5" fill="#e24b4b" />
      {plateX != null && plateZ != null && (
        <circle cx={xOf(plateX)} cy={zOf(plateZ)} r="7" fill="none" stroke="#f4f1ea" strokeWidth="1.5" />
      )}
    </svg>
  );
}

export function Hud({
  clip,
  report,
  night,
  dayHdri,
  nightHdri,
  showZone,
  showAxis,
  onClip,
  onNight,
  onZone,
  onAxis,
}: {
  clip: Clip;
  report: StadiumReport | null;
  night: boolean;
  dayHdri: boolean;
  nightHdri: boolean;
  showZone: boolean;
  showAxis: boolean;
  onClip: (id: string) => void;
  onNight: (night: boolean) => void;
  onZone: (value: boolean) => void;
  onAxis: (value: boolean) => void;
}) {
  useAnimationFrame();
  const sim = getSim();
  const readout = getReadout();
  const atPlate =
    clip.kind === "pitch" &&
    clip.plateX != null &&
    clip.plateZ != null &&
    readout.valid &&
    Math.abs(readout.y - PLATE_FRONT_FT) < 0.02;
  const dxCm = atPlate && clip.plateX != null ? (readout.x - clip.plateX) * 30.48 : null;
  const dzCm = atPlate && clip.plateZ != null ? (readout.z - clip.plateZ) * 30.48 : null;
  const gapCm = dxCm != null && dzCm != null ? Math.hypot(dxCm, dzCm) : null;
  const matched = gapCm != null && gapCm < 0.5;
  const elapsedMs = (sim.t - clip.tStart) * 1000;
  const plateMs = clip.tPlate == null ? null : (clip.tPlate - clip.tStart) * 1000;

  return (
    <aside className="flex h-[42dvh] w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-[#2a342c] bg-[#121714] p-4 md:h-dvh md:w-[390px] md:border-l md:border-t-0">
      <div>
        <p className="text-xs tracking-widest text-[#8b968c]">到達位置</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <h2 className="text-lg font-medium">{clip.kind === "pitch" ? "プレート前端" : "打球の落下点"}</h2>
          {clip.kind === "pitch" && (
            <p
              className={`font-mono text-2xl ${matched ? "text-[#8fd0a8]" : atPlate ? "text-[#ff6b5a]" : "text-[#8b968c]"}`}
            >
              {matched ? "一致" : atPlate ? "ずれ" : "通過前"}
            </p>
          )}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-[#c5cdc4]">
          {clip.kind === "pitch"
            ? "データの plate_x / plate_z と、3D のボール中心を逆変換した値です。正の x は捕手から見て右、一塁側です。"
            : "落下点も同じ座標変換を通しています。原点はプレート先端、y は投手方向です。"}
        </p>
      </div>

      {clip.kind === "pitch" && clip.plateX != null && clip.plateZ != null ? (
        <div className="grid grid-cols-2 gap-3">
          <Metric label="plate_x" value={feet(clip.plateX, 3)} unit="ft" />
          <Metric label="plate_z" value={feet(clip.plateZ, 3)} unit="ft" />
          <Metric label="ボールの x" value={feet(readout.x, 3)} unit="ft" />
          <Metric label="ボールの z" value={feet(readout.z, 3)} unit="ft" />
          <Metric label="ボールの y" value={feet(readout.y, 3)} unit="ft" />
          <Metric
            label="差"
            value={gapCm == null ? "—" : gapCm.toFixed(2)}
            unit={gapCm == null ? undefined : "cm"}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Metric label="落下 x" value={feet(clip.landing?.x, 1)} unit="ft" />
          <Metric label="落下 y" value={feet(clip.landing?.y, 1)} unit="ft" />
        </div>
      )}

      <ZonePlot
        plateX={clip.plateX}
        plateZ={clip.plateZ}
        ballX={readout.valid ? readout.x : 0}
        ballZ={readout.valid ? readout.z : 0}
        szTop={clip.szTop}
        szBot={clip.szBot}
      />
      <p className="text-xs leading-relaxed text-[#8b968c]">
        白抜きがデータの到達位置、赤が今のボールです。下の白い五角形がプレート。黄枠がストライクゾーン（幅はプレート、高さ{" "}
        {feet(clip.szBot, 2)}–{feet(clip.szTop, 2)} ft）。
      </p>

      <div className="flex flex-wrap gap-2">
        {CLIPS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={item.id === clip.id ? "default" : "outline"}
            onClick={() => onClip(item.id)}
          >
            {item.name}
          </Button>
        ))}
      </div>
      <p className="text-sm text-[#c5cdc4]">
        {clip.detail}
        {clip.release ? `・リリース ${clip.release.mph.toFixed(1)} mph` : ""}
        {clip.plateMph ? ` / プレート ${clip.plateMph.toFixed(1)} mph` : ""}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setSim({ playing: !sim.playing })}>
          {sim.playing ? "一時停止" : "再生"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setSim({ t: clip.tStart, playing: false })}>
          最初へ
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={clip.tPlate == null}
          onClick={() => {
            if (clip.tPlate != null) setSim({ t: clip.tPlate, playing: false });
          }}
        >
          プレート通過へ
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[#e24b4b]"
          checked={sim.holdAtPlate}
          onChange={(event) => setSim({ holdAtPlate: event.target.checked })}
        />
        通過で止める
      </label>

      <div>
        <div className="mb-1 flex justify-between text-xs text-[#8b968c]">
          <span>リリースから {elapsedMs.toFixed(0)} ms</span>
          {plateMs != null && <span>プレート {plateMs.toFixed(0)} ms</span>}
        </div>
        <input
          aria-label="再生位置"
          className="w-full"
          type="range"
          min={clip.tStart}
          max={clip.tEnd}
          step={0.001}
          value={Math.min(clip.tEnd, Math.max(clip.tStart, sim.t))}
          onChange={(event) => setSim({ t: Number(event.target.value), playing: false })}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {[0.1, 0.25, 0.5, 1].map((speed) => (
          <Button
            key={speed}
            type="button"
            size="sm"
            variant={sim.speed === speed ? "default" : "outline"}
            onClick={() => setSim({ speed })}
          >
            {speed}x
          </Button>
        ))}
      </div>

      {clip.spinRpm != null && clip.spinAxisDeg != null && (
        <div className="grid grid-cols-2 gap-3">
          <Metric label="release_spin_rate" value={String(clip.spinRpm)} unit="rpm" />
          <Metric label="spin_axis" value={String(clip.spinAxisDeg)} unit="°" />
          <p className="col-span-2 text-sm text-[#c5cdc4]">{spinSentence(clip.spinAxisDeg)}。ジャイロ成分は軸に含まれないので、この軸のまわりに回転数すべてで回しています。</p>
        </div>
      )}

      {clip.release && (
        <p className="font-mono text-xs leading-relaxed text-[#8b968c]">
          リリース ({feet(clip.release.x, 2)}, {feet(clip.release.y, 2)}, {feet(clip.release.z, 2)}) ft
          <br />
          Three.js ({feet(readout.worldX, 3)}, {feet(readout.worldY, 3)}, {feet(readout.worldZ, 3)}) m
        </p>
      )}

      <div className="flex flex-wrap gap-2">
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

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[#aeb8ad]">
        <dt>球場</dt>
        <dd>{report == null ? "読み込み中" : report.source === "glb" ? "stadium.glb" : "仮の球場"}</dd>
        <dt>ボール</dt>
        <dd>{propSource.ball === "file" ? "ball.glb" : "手続きの縫い目"}</dd>
        <dt>バット</dt>
        <dd>{propSource.bat === "file" ? "bat.glb" : "手続き"}</dd>
        <dt>ミット</dt>
        <dd>{propSource.mitt === "file" ? "mitt.glb" : "手続き"}</dd>
        <dt>人物</dt>
        <dd>{propSource.vrm === "file" ? "player.vrm" : "手続き"}</dd>
        <dt>環境光</dt>
        <dd>
          {night
            ? nightHdri
              ? "night.hdr"
              : "HDRI なし"
            : dayHdri
              ? "day.hdr"
              : "HDRI なし"}
        </dd>
      </dl>

      <details className="rounded-md border border-[#2a342c] px-3 py-2 text-sm">
        <summary className="cursor-pointer">確認手順</summary>
        <ol className="mt-2 list-decimal space-y-2 pl-4 leading-relaxed text-[#d5ddd4]">
          <li>左上に赤い警告が無く、「プレート先端から投手板前縁まで」が 18.44 m 前後なら目印は合っています。</li>
          <li>フォーシームを選び、「プレート通過へ」を押す。途中を見るなら「通過で止める」をオンにして「再生」。</li>
          <li>plate_x / plate_z とボールの x / z の差が 0.5 cm 未満なら「一致」です。</li>
          <li>捕手視点で、琥珀色のリングの中にボールがあること。一塁側に切り替えても同じリングの中です。</li>
          <li>上の図で白抜きと赤点が重なります。正の x は図の右、一塁側です。</li>
          <li>縫い目は「ボール」視点、速度 0.1x。回転は release_spin_rate と spin_axis です。</li>
        </ol>
      </details>
    </aside>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <div className="text-[11px] text-[#8b968c]">{label}</div>
      <div className="font-mono text-xl tabular-nums">
        {value}
        {unit && <span className="ml-1 text-xs text-[#8b968c]">{unit}</span>}
      </div>
    </div>
  );
}

export function selectClip(id: string, onClip: (id: string) => void) {
  const next = getClip(id);
  setSim({ t: next.tStart, playing: false, clipId: id });
  onClip(id);
}
