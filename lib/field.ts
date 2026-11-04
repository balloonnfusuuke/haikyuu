import {
  CATCHER_CAM_BACK_M,
  CATCHER_CAM_HEIGHT_M,
  MOUND_HEIGHT_FT,
  PLATE_FRONT_FT,
  RUBBER_DISTANCE_M,
  RUBBER_FRONT_FT,
  RUBBER_TOLERANCE_M,
} from "./field-constants";
import {
  FEET_TO_METERS,
  IDENTITY_FRAME,
  distance3,
  frameFromMarkers,
  statcastToThree,
  statcastToWorld,
  type FieldFrame,
  type Vec3,
} from "./coords";

export type CameraPreset =
  | "catcher"
  | "backnet"
  | "infield"
  | "outfield"
  | "broadcast"
  | "rhh"
  | "lhh"
  | "side1b"
  | "side3b"
  | "ball"
  | "chase";

export const CAMERA_PRESETS: { id: CameraPreset; label: string }[] = [
  { id: "catcher", label: "捕手" },
  { id: "backnet", label: "バックネット裏" },
  { id: "infield", label: "内野席" },
  { id: "outfield", label: "外野席" },
  { id: "broadcast", label: "中継" },
  { id: "side1b", label: "一塁側" },
  { id: "chase", label: "打球" },
  { id: "rhh", label: "右打者" },
  { id: "lhh", label: "左打者" },
  { id: "side3b", label: "三塁側" },
  { id: "ball", label: "ボール" },
];

/** 視点と見ている点の間に入ったら、見た目だけ透かす外殻。 */
export function isViewShell(name: string): boolean {
  return /^(Wall_|Stand_|Backstop_|Roof_|Scoreboard|BackScreen)/.test(name);
}

export type CameraPose = { position: Vec3; target: Vec3 };

/**
 * 視点は目印の基底に載せた Statcast フィート。捕手だけは Marker_CatcherCam そのもの。
 * 右打者は捕手から見て左（三塁側）の打者席に立つ。
 */
export function cameraPose(
  preset: Exclude<CameraPreset, "ball" | "chase">,
  frame: FieldFrame,
  catcherCam: Vec3 | null,
): CameraPose {
  const zone = statcastToWorld(frame, 0, PLATE_FRONT_FT, 2.5);
  if (preset === "catcher") {
    const fallback = statcastToWorld(
      frame,
      0,
      -CATCHER_CAM_BACK_M / FEET_TO_METERS,
      CATCHER_CAM_HEIGHT_M / FEET_TO_METERS,
    );
    return { position: catcherCam ?? fallback, target: zone };
  }
  if (preset === "rhh") {
    return {
      position: statcastToWorld(frame, -3.15, 0.35, 5.15),
      target: statcastToWorld(frame, 0, 50, 5.4),
    };
  }
  if (preset === "lhh") {
    return {
      position: statcastToWorld(frame, 3.15, 0.35, 5.15),
      target: statcastToWorld(frame, 0, 50, 5.4),
    };
  }
  if (preset === "backnet") {
    // ネットの直後、目の高さ。ネットの外縁は three の z ≈ 18.4 m。
    return {
      position: statcastToWorld(frame, 0, -70, 14),
      target: zone,
    };
  }
  if (preset === "infield") {
    // 一塁側の内野席。ファウル側からプレートを見る。
    return {
      position: statcastToWorld(frame, 70, 30, 22),
      target: zone,
    };
  }
  if (preset === "outfield") {
    // 右中間の外野席。中堅のバックスクリーン（|x| < 17 m）の外側。
    return {
      position: statcastToWorld(frame, 78, 405, 26),
      target: zone,
    };
  }
  if (preset === "broadcast") {
    return {
      position: statcastToWorld(frame, 1.2, 68, 7),
      target: zone,
    };
  }
  if (preset === "side1b") {
    return {
      position: statcastToWorld(frame, 16, 10, 5.6),
      target: zone,
    };
  }
  return {
    position: statcastToWorld(frame, -16, 10, 5.6),
    target: zone,
  };
}

/** 打球の後ろ、一塁側の上から追う。位置は毎フレーム更新する。 */
export function chaseCamera(frame: FieldFrame, ball: Vec3): CameraPose {
  const back = 5;
  const up = 2;
  const side = 2.4;
  return {
    position: {
      x: ball.x - frame.forward.x * back + frame.up.x * up + frame.right.x * side,
      y: ball.y - frame.forward.y * back + frame.up.y * up + frame.right.y * side,
      z: ball.z - frame.forward.z * back + frame.up.z * up + frame.right.z * side,
    },
    target: ball,
  };
}

/** ボール視点。ボール中心から捕手側へ 55 cm。位置は毎フレーム更新する。 */
export function ballCamera(frame: FieldFrame, ball: Vec3): CameraPose {
  const back = 0.55;
  const up = 0.08;
  const side = 0.02;
  return {
    position: {
      x: ball.x - frame.forward.x * back + frame.up.x * up + frame.right.x * side,
      y: ball.y - frame.forward.y * back + frame.up.y * up + frame.right.y * side,
      z: ball.z - frame.forward.z * back + frame.up.z * up + frame.right.z * side,
    },
    target: ball,
  };
}

export function regulationMarkerPositions(): {
  plate: Vec3;
  rubber: Vec3;
  catcherCam: Vec3;
} {
  return {
    plate: statcastToThree(0, 0, 0),
    rubber: statcastToThree(0, RUBBER_FRONT_FT, MOUND_HEIGHT_FT),
    catcherCam: statcastToThree(
      0,
      -CATCHER_CAM_BACK_M / FEET_TO_METERS,
      CATCHER_CAM_HEIGHT_M / FEET_TO_METERS,
    ),
  };
}

export function assessRubberDistance(distanceM: number | null): {
  ok: boolean;
  message: string;
} {
  if (distanceM == null || !Number.isFinite(distanceM)) {
    return {
      ok: false,
      message:
        "警告: Marker_PlateTip または Marker_Rubber がありません。プレートから投手板前縁までの距離を確認できません。",
    };
  }
  const shown = distanceM.toFixed(3);
  const deltaCm = (distanceM - RUBBER_DISTANCE_M) * 100;
  const ok = Math.abs(distanceM - RUBBER_DISTANCE_M) <= RUBBER_TOLERANCE_M + 1e-9;
  if (ok) {
    return {
      ok: true,
      message: `プレート先端から投手板前縁まで ${shown} m（基準 ${RUBBER_DISTANCE_M.toFixed(2)} m ± 5 cm）`,
    };
  }
  const sign = deltaCm >= 0 ? "+" : "";
  return {
    ok: false,
    message: `警告: プレート先端から投手板前縁まで ${shown} m です（基準 ${RUBBER_DISTANCE_M.toFixed(2)} m から ${sign}${deltaCm.toFixed(1)} cm）。Marker_PlateTip と Marker_Rubber を確認してください。許容は ±5 cm です。`,
  };
}

export function rubberDistanceOfRegulation(): number {
  const markers = regulationMarkerPositions();
  return distance3(markers.plate, markers.rubber);
}

export function regulationFrame(): FieldFrame {
  const markers = regulationMarkerPositions();
  return frameFromMarkers(markers.plate, markers.rubber);
}

export type StadiumSource = "glb" | "placeholder";

export type StadiumReport = {
  source: StadiumSource;
  error: string | null;
  distanceM: number | null;
  ok: boolean;
  message: string;
  note: string | null;
  frame: FieldFrame;
  catcherCam: Vec3 | null;
  markerNames: string[];
};

export function reportFromMarkers(args: {
  source: StadiumSource;
  error: string | null;
  plate: Vec3 | null;
  rubber: Vec3 | null;
  catcherCam: Vec3 | null;
  markerNames: string[];
}): StadiumReport {
  const { plate, rubber, catcherCam } = args;
  let frame: FieldFrame = IDENTITY_FRAME;
  let distanceM: number | null = null;
  let assessment = assessRubberDistance(null);

  if (plate && rubber) {
    frame = frameFromMarkers(plate, rubber);
    distanceM = distance3(plate, rubber);
    assessment = frame.degenerate
      ? {
          ok: false,
          message:
            "警告: Marker_PlateTip と Marker_Rubber が重なっていて、投手方向が取れません。",
        }
      : assessRubberDistance(distanceM);
  } else if (plate) {
    frame = {
      plate: { ...plate },
      right: { ...IDENTITY_FRAME.right },
      up: { ...IDENTITY_FRAME.up },
      forward: { ...IDENTITY_FRAME.forward },
      degenerate: true,
    };
  }

  const notes: string[] = [];
  if (args.error) notes.push(args.error);
  if (!catcherCam) {
    notes.push(
      "Marker_CatcherCam が無いので、プレート先端から 2.5 m 後ろ、高さ 1.1 m を捕手カメラにしています。",
    );
  }

  return {
    source: args.source,
    error: args.error,
    distanceM,
    ok: assessment.ok,
    message: assessment.message,
    note: notes.length > 0 ? notes.join(" ") : null,
    frame,
    catcherCam,
    markerNames: args.markerNames,
  };
}
