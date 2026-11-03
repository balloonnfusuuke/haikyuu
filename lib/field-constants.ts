/** ルールブック上の寸法。単位はフィート。仮球場はこれだけを statcastToThree に通して置く。 */

/** プレート先端から前端まで 17 インチ。plate_x / plate_z はこの平面。 */
export const PLATE_FRONT_FT = 17 / 12;

export const PLATE_HALF_WIDTH_FT = 8.5 / 12;

/** 投手板の前縁。60 フィート 6 インチ = 18.44 m。 */
export const RUBBER_FRONT_FT = 60.5;

export const RUBBER_DEPTH_FT = 6 / 12;

export const RUBBER_WIDTH_FT = 24 / 12;

/** マウンドの高さ 10 インチ。 */
export const MOUND_HEIGHT_FT = 10 / 12;

export const MOUND_RADIUS_FT = 9;

/** 投手板の前後の中央。マウンド円の中心にする。 */
export const MOUND_CENTER_Y_FT = RUBBER_FRONT_FT + RUBBER_DEPTH_FT / 2;

/** 画面とコンソールの基準。±5 cm。 */
export const RUBBER_DISTANCE_M = 18.44;

export const RUBBER_TOLERANCE_M = 0.05;

/** 捕手カメラの目印。Blender 側の仕様と同じ相対位置。 */
export const CATCHER_CAM_BACK_M = 2.5;

export const CATCHER_CAM_HEIGHT_M = 1.1;

export const BASE_DISTANCE_FT = 90;

/** 周長 9.125 インチ（9〜9.25 の中央）から求めた半径。 */
export const BALL_RADIUS_M = (9.125 * 0.0254) / (2 * Math.PI);

export const SZ_TOP_FT = 3.5;

export const SZ_BOT_FT = 1.5;

/** 打者席。内側はプレートの横から 6 インチ。中心はプレートの 17 インチ正方形の中心。 */
export const BOX_INSIDE_FT = (8.5 + 6) / 12;

export const BOX_WIDTH_FT = 4;

export const BOX_LENGTH_FT = 6;

export const PLATE_SQUARE_CENTER_Y_FT = 8.5 / 12;

export const BOX_FRONT_Y_FT = PLATE_SQUARE_CENTER_Y_FT + BOX_LENGTH_FT / 2;

export const BOX_BACK_Y_FT = PLATE_SQUARE_CENTER_Y_FT - BOX_LENGTH_FT / 2;

export const MARKER = {
  plate: "Marker_PlateTip",
  rubber: "Marker_Rubber",
  catcherCam: "Marker_CatcherCam",
  bases: "Marker_Bases",
} as const;
