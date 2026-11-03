"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { CAMERA_PRESETS, type CameraPreset, type StadiumReport } from "@/lib/field";
import { getClip } from "@/lib/clips";
import { getSim, setSim } from "@/lib/sim";
import { Button } from "@/components/ui/button";
import { Hud, selectClip } from "./hud";
import { FieldScene } from "./scene";

export default function Viewer() {
  const [clipId, setClipId] = useState("ff");
  const [preset, setPreset] = useState<CameraPreset>("catcher");
  const [night, setNight] = useState(false);
  const [showZone, setShowZone] = useState(true);
  const [showAxis, setShowAxis] = useState(false);
  const [report, setReport] = useState<StadiumReport | null>(null);
  const [shiftRubber, setShiftRubber] = useState(0);
  const [dayHdri, setDayHdri] = useState(false);
  const [nightHdri, setNightHdri] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const booted = useRef(false);
  if (!booted.current) {
    booted.current = true;
    setSim({ t: getClip("ff").tStart, playing: false, clipId: "ff" });
  }

  const clip = getClip(clipId);
  const onReport = useCallback((next: StadiumReport) => setReport(next), []);

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
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
            onCreated={({ gl }) => {
              gl.toneMappingExposure = 1;
              gl.shadowMap.type = THREE.PCFShadowMap;
            }}
          >
            <FieldScene
              clip={clip}
              preset={preset}
              night={night}
              showZone={showZone}
              showAxis={showAxis}
              shiftRubber={shiftRubber}
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
            <h1 className="text-base font-medium">プレート先端</h1>
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
      <Hud
        clip={clip}
        report={report}
        night={night}
        dayHdri={dayHdri}
        nightHdri={nightHdri}
        showZone={showZone}
        showAxis={showAxis}
        onClip={(id) => selectClip(id, setClipId)}
        onNight={setNight}
        onZone={setShowZone}
        onAxis={setShowAxis}
      />
    </div>
  );
}
