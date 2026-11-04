"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { CAMERA_PRESETS, type CameraPreset, type StadiumReport } from "@/lib/field";
import { DEFAULT_CLIP_ID, getClip, type Clip } from "@/lib/clips";
import { beginPlaySample, noteGpu, perf } from "@/lib/perf";
import { getGear, setGear } from "@/lib/gear";
import { getSim, setSim } from "@/lib/sim";
import { propSource } from "./ball";
import { Button } from "@/components/ui/button";
import { GamePanel } from "@/components/game/panel";
import { FieldScene } from "./scene";

export default function Viewer() {
  const [clip, setClip] = useState<Clip>(() => getClip(DEFAULT_CLIP_ID));
  const [snapshot, setSnapshot] = useState({
    matchup: "対戦カードを選んでください",
    balls: 0,
    strikes: 0,
    banner: null as string | null,
    inning: null as string | null,
  });
  const [preset, setPreset] = useState<CameraPreset>("catcher");
  const [night, setNight] = useState(false);
  const [showZone, setShowZone] = useState(true);
  const [showAxis, setShowAxis] = useState(false);
  const ao = 1;
  const tone = "agx" as const;
  const [report, setReport] = useState<StadiumReport | null>(null);
  const [shiftRubber, setShiftRubber] = useState(0);
  const [dayHdri, setDayHdri] = useState(false);
  const [nightHdri, setNightHdri] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const booted = useRef(false);
  if (!booted.current) {
    booted.current = true;
    setSim({ t: getClip(DEFAULT_CLIP_ID).tStart, playing: false, clipId: DEFAULT_CLIP_ID });
  }

  const onReport = useCallback((next: StadiumReport) => {
    setReport(next);
  }, []);

  const onSnapshot = useCallback(
    (next: { matchup: string; balls: number; strikes: number; banner: string | null; inning: string | null }) => {
      setSnapshot(next);
    },
    [],
  );

  function play(next: Clip) {
    setClip(next);
    setSim({ t: next.tStart, playing: true, speed: 1, holdAtPlate: false, clipId: next.id });
  }

  useEffect(() => {
    window.__platePerf = perf;
    window.__plateControl = { getSim, setSim, beginPlaySample };
    window.__plateGear = { getGear, setGear };
    window.__plateProps = propSource;
  }, []);

  useEffect(() => {
    window.__plateClip = { tStart: clip.tStart, tPlate: clip.tPlate, tEnd: clip.tEnd };
  }, [clip]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shift = Number(params.get("shiftRubber"));
    if (Number.isFinite(shift)) setShiftRubber(shift);
    let cancelled = false;
    Promise.all([
      fetch("/hdri/day.hdr", { method: "HEAD" }).then((response) => response.ok),
      fetch("/hdri/night.hdr", { method: "HEAD" }).then((response) => response.ok),
    ])
      .then(([day, nightFile]) => {
        if (cancelled) return;
        setDayHdri(day);
        setNightHdri(nightFile);
      })
      .catch(() => {
        if (!cancelled) {
          setDayHdri(false);
          setNightHdri(false);
        }
      });
    try {
      const probe = document.createElement("canvas");
      setWebgl(Boolean(probe.getContext("webgl2") || probe.getContext("webgl")));
    } catch {
      setWebgl(false);
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLButtonElement
      ) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setSim({ playing: !getSim().playing });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#0e1210] text-[#f4f1ea] md:flex-row">
      <div className="relative min-h-0 flex-1">
        {webgl ? (
          <Canvas
            className="absolute inset-0"
            shadows
            dpr={[1, 1.75]}
            camera={{ position: [0, 1.1, 2.5], fov: 38, near: 0.05, far: 420 }}
            gl={{ antialias: true, toneMapping: THREE.AgXToneMapping }}
            onCreated={({ gl }) => {
              gl.toneMapping = THREE.AgXToneMapping;
              gl.toneMappingExposure = 0.82;
              gl.shadowMap.type = THREE.PCFShadowMap;
              const context = gl.getContext();
              const debug = context.getExtension("WEBGL_debug_renderer_info");
              const vendor = debug
                ? String(context.getParameter(debug.UNMASKED_VENDOR_WEBGL))
                : String(context.getParameter(context.VENDOR));
              const gpu = debug
                ? String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL))
                : String(context.getParameter(context.RENDERER));
              noteGpu(vendor, gpu);
            }}
          >
            <FieldScene
              clip={clip}
              preset={preset}
              night={night}
              showZone={showZone}
              showAxis={showAxis}
              shiftRubber={shiftRubber}
              aoMapIntensity={ao}
              tone={tone}
              dayHdri={dayHdri}
              nightHdri={nightHdri}
              report={report}
              onReport={onReport}
            />
          </Canvas>
        ) : (
          <div className="grid h-full place-items-center px-6 text-center">
            このブラウザでは WebGL が使えず、球場を表示できません。
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
          <div className="pointer-events-auto max-w-xl rounded-lg bg-[#101410]/80 px-3 py-2 backdrop-blur-sm">
            <h1 className="text-base font-medium">{snapshot.matchup}</h1>
            <p className="font-mono text-sm">
              {snapshot.balls}-{snapshot.strikes}
              {snapshot.banner ? ` · ${snapshot.banner}` : ""}
            </p>
            {snapshot.inning && <p className="font-mono text-xs text-[#c5cdc4]">{snapshot.inning}</p>}
            <p className="text-xs text-[#c5cdc4]">
              {report == null
                ? "球場を読み込んでいます"
                : report.source === "placeholder"
                  ? "stadium.glb が無いので、同じ寸法の仮球場です"
                  : "stadium.glb を表示しています"}
            </p>
            {report && (
              <p className={`mt-1 text-sm ${report.ok ? "text-[#8fd0a8]" : "text-[#ffb4ab]"}`}>{report.message}</p>
            )}
          </div>
          {report && !report.ok && (
            <div role="alert" className="pointer-events-auto max-w-xl rounded-lg bg-[#8f2d2d] px-3 py-2 text-sm text-white">
              {report.message}
            </div>
          )}
          {report?.note && (
            <p className="pointer-events-auto max-w-xl rounded-lg bg-[#3a3420]/90 px-3 py-2 text-sm text-[#f6e7a8]">
              {report.note}
            </p>
          )}
        </div>

        <div className="absolute inset-x-3 bottom-3 flex flex-wrap gap-1.5">
          {CAMERA_PRESETS.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={preset === item.id ? "default" : "outline"}
              onClick={() => setPreset(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
      <GamePanel
        night={night}
        showZone={showZone}
        showAxis={showAxis}
        onNight={setNight}
        onZone={setShowZone}
        onAxis={setShowAxis}
        onClip={play}
        onSnapshot={onSnapshot}
      />
    </div>
  );
}
