"""フェアの打球を甲子園のフェンスと定位置の守備で判定する。lib/park.ts と同じ式。"""

from __future__ import annotations

import math

from plate_game.fence import fence_distance, fence_height_ft, spray_angle

GRAVITY_FT = -32.174
DRAG_K = 0.00128
FTPS_PER_MPH = 5280 / 3600

INFIELD = (
    {"name": "投手", "x": 0.0, "y": 55.0, "speed": 24.0, "reaction": 0.18, "cap": 70.0},
    {"name": "捕手", "x": 0.0, "y": -3.0, "speed": 17.0, "reaction": 0.25, "cap": 48.0},
    {"name": "一塁", "x": 58.0, "y": 78.0, "speed": 27.0, "reaction": 0.28, "cap": 85.0},
    {"name": "二塁", "x": 46.0, "y": 148.0, "speed": 28.0, "reaction": 0.3, "cap": 100.0},
    {"name": "遊撃", "x": -46.0, "y": 148.0, "speed": 28.0, "reaction": 0.3, "cap": 100.0},
    {"name": "三塁", "x": -58.0, "y": 78.0, "speed": 27.0, "reaction": 0.28, "cap": 85.0},
)
OUTFIELD_ANGLES = ({"name": "左翼", "angle": -22.0}, {"name": "中堅", "angle": 0.0}, {"name": "右翼", "angle": 22.0})

BB_LABEL = {"ground_ball": "ゴロ", "line_drive": "ライナー", "fly_ball": "フライ", "popup": "ポップフライ"}
HIT_LABEL = {"out": "アウト", "single": "単打", "double": "二塁打", "triple": "三塁打", "home_run": "本塁打"}


def _outfielders() -> list[dict]:
    spots = []
    for spot in OUTFIELD_ANGLES:
        depth = fence_distance(spot["angle"]) * 0.72
        rad = math.radians(spot["angle"])
        spots.append(
            {
                "name": spot["name"],
                "x": math.sin(rad) * depth,
                "y": math.cos(rad) * depth,
                "speed": 29.0,
                "reaction": 0.38,
                "cap": 125.0,
            }
        )
    return spots


def _fielders() -> list[dict]:
    return [*INFIELD, *_outfielders()]


def _radius(sample: dict) -> float:
    return math.hypot(sample["x"], sample["y"])


def _horizontal(x0: float, y0: float, x1: float, y1: float) -> float:
    return math.hypot(x1 - x0, y1 - y0)


def _fly(start: dict, drag: float, roll_to: float | None) -> dict:
    speed = start["speedMph"] * FTPS_PER_MPH
    launch = math.radians(start["launchDeg"])
    dx = start["targetX"] - start["x"]
    dy = start["targetY"] - start["y"]
    flat = math.hypot(dx, dy) or 1.0
    horizontal = speed * math.cos(launch)
    x, y, z = start["x"], start["y"], start["z"]
    vx = horizontal * dx / flat
    vy = horizontal * dy / flat
    vz = speed * math.sin(launch)
    dt = 0.01
    samples: list[dict] = []
    bounced = False
    airborne = True
    goal = roll_to if roll_to is not None else _horizontal(start["x"], start["y"], start["targetX"], start["targetY"])
    t = 0.0
    while t <= 8 + 1e-12:
        traveled = _horizontal(start["x"], start["y"], x, y)
        if roll_to is not None and bounced and traveled >= goal:
            scale = goal / traveled
            x = start["x"] + (x - start["x"]) * scale
            y = start["y"] + (y - start["y"]) * scale
            z = 0.0
            samples.append({"t": t, "x": x, "y": y, "z": z})
            break
        samples.append({"t": t, "x": x, "y": y, "z": 0.0 if z < 0 else z})
        if t > 0 and z <= 0 and roll_to is None:
            break
        v = math.hypot(vx, vy, vz)
        drag_a = drag * v
        vx += -drag_a * vx * dt
        vy += -drag_a * vy * dt
        vz += (-drag_a * vz + GRAVITY_FT) * dt
        x += vx * dt
        y += vy * dt
        z += vz * dt
        if roll_to is not None and z <= 0:
            z = 0.0
            if airborne:
                airborne = False
                if not bounced:
                    remain = max(0.0, goal - _horizontal(start["x"], start["y"], x, y))
                    pace = max(18.0, remain / 1.8)
                    flat_v = math.hypot(vx, vy) or 1.0
                    vx = vx / flat_v * pace
                    vy = vy / flat_v * pace
                    vz = abs(vz) * 0.55
                    bounced = True
                else:
                    vz = abs(vz) * 0.35
                    vx *= 0.9
                    vy *= 0.9
            else:
                vz = 0.0
        elif z > 0:
            airborne = True
        t += dt
    landing = samples[-1] if samples else {"t": 0.0, "x": start["x"], "y": start["y"], "z": 0.0}
    landing["z"] = max(0.0, landing["z"])
    return {"samples": samples, "landing": landing}


def _air_range(start: dict, drag: float) -> float:
    flown = _fly(start, drag, None)
    landing = flown["landing"]
    return _horizontal(start["x"], start["y"], landing["x"], landing["y"])


def _drag_for_distance(start: dict, target_ft: float) -> float:
    low, high = 0.00004, 0.008
    for _ in range(18):
        mid = (low + high) / 2
        if _air_range(start, mid) > target_ft:
            low = mid
        else:
            high = mid
    return (low + high) / 2


def _integrate(start: dict, ground: bool) -> dict:
    target = _horizontal(start["x"], start["y"], start["targetX"], start["targetY"])
    if ground:
        return _fly(start, DRAG_K, max(target, 1.0))
    return _fly(start, _drag_for_distance(start, max(target, 1.0)), None)


def _find_crossing(samples: list[dict], ground: bool) -> dict:
    height = fence_height_ft()
    for index in range(1, len(samples)):
        before, after = samples[index - 1], samples[index]
        near, far = _radius(before), _radius(after)
        fence_ft = fence_distance(spray_angle(after["x"], after["y"]))
        if near < fence_ft <= far and far > near:
            span = (fence_ft - near) / (far - near)
            at = {
                "t": before["t"] + (after["t"] - before["t"]) * span,
                "x": before["x"] + (after["x"] - before["x"]) * span,
                "y": before["y"] + (after["y"] - before["y"]) * span,
                "z": before["z"] + (after["z"] - before["z"]) * span,
            }
            clears = (not ground) and at["z"] > height
            return {"kind": "clear" if clears else "wall", "index": index, "at": at, "fenceFt": fence_ft}
    return {"kind": "none"}


def _play_clock(sample: dict, ground: bool, speed_mph: float) -> float:
    if not ground:
        return sample["t"]
    return _radius(sample) / max(40.0, speed_mph * 1.4667 * 0.82)


def _can_reach(fielder: dict, reach: float, clock: float, ground: bool) -> bool:
    if clock < fielder["reaction"] or reach > fielder["cap"]:
        return False
    if ground:
        return reach <= 4 + fielder["speed"] * 0.42 * (clock - fielder["reaction"])
    return fielder["reaction"] + reach / fielder["speed"] <= clock


def _charge_slow_roller(end: dict) -> str | None:
    if _radius(end) > 70:
        return None
    best = None
    for fielder in INFIELD:
        if fielder["name"] not in {"投手", "捕手"}:
            continue
        reach = math.hypot(end["x"] - fielder["x"], end["y"] - fielder["y"])
        if reach > 18:
            continue
        if best is None or reach < best[0]:
            best = (reach, fielder["name"])
    return None if best is None else best[1]


def _first_play(samples: list[dict], fence_ft: float | None, ground: bool, speed_mph: float) -> dict | None:
    for index, sample in enumerate(samples):
        if sample["z"] > 8:
            continue
        if fence_ft is not None and _radius(sample) > fence_ft - 2:
            continue
        clock = _play_clock(sample, ground, speed_mph)
        if clock < 0.2:
            continue
        for fielder in _fielders():
            reach = math.hypot(sample["x"] - fielder["x"], sample["y"] - fielder["y"])
            if _can_reach(fielder, reach, clock, ground):
                return {"name": fielder["name"], "index": index}
    return None


def _outfield_late(point: dict, ground: bool, speed_mph: float) -> float:
    clock = _play_clock(point, ground, speed_mph)
    best = math.inf
    for fielder in _outfielders():
        reach = math.hypot(point["x"] - fielder["x"], point["y"] - fielder["y"])
        best = min(best, fielder["reaction"] + reach / fielder["speed"] - clock)
    return best


def _label(bip: str, how: str, fielder: str | None, bb_type: str | None) -> str:
    if bip == "home_run":
        return "本塁打"
    if how == "wall" and bip == "triple":
        return "フェンス際の三塁打"
    if how == "wall":
        return "フェンス直撃の二塁打"
    if how == "catch":
        return f"{fielder}がゴロを処理" if bb_type == "ground_ball" else f"{fielder}が捕球"
    contact = BB_LABEL.get(bb_type or "", "")
    hit = HIT_LABEL.get(bip, "安打")
    return f"{contact}の{hit}" if contact else hit


def _note(cleared: bool, how: str, fence_ft: float, height_ft: float | None, landing_ft: float) -> str:
    fence = round(fence_ft)
    landing = round(landing_ft)
    if cleared and height_ft is not None:
        return f"フェンス {fence} ft を高さ {round(height_ft)} ft で越えた"
    if how == "wall" and height_ft is not None:
        return f"フェンス {fence} ft に高さ {height_ft:.1f} ft で当たった"
    short = max(0, fence - landing)
    if how == "catch":
        return f"本塁から {landing} ft で処理。フェンスまで {short} ft"
    return f"落下 {landing} ft。フェンスまで {short} ft"


def resolve_fair_ball(
    *,
    x: float,
    y: float,
    z: float,
    speed_mph: float,
    launch_deg: float,
    aim_x: float,
    aim_y: float,
    carry_ft: float,
    ground: bool,
    bb_type: str | None,
) -> dict:
    angle = spray_angle(aim_x, aim_y)
    fence_ft = fence_distance(angle)
    travel = min(max(carry_ft, 1.0), fence_ft - 1.5) if ground else max(carry_ft, 1.0)
    rad = math.radians(angle)
    flown = _integrate(
        {
            "x": x,
            "y": y,
            "z": z,
            "speedMph": speed_mph,
            "launchDeg": launch_deg,
            "targetX": math.sin(rad) * travel,
            "targetY": math.cos(rad) * travel,
        },
        ground,
    )
    samples = flown["samples"]
    crossing = _find_crossing(samples, ground)
    limit = None if crossing["kind"] == "none" else crossing["fenceFt"]
    catch = _first_play(samples, limit, ground, speed_mph)
    end = samples[-1] if samples else flown["landing"]
    end_radius = _radius(end)
    reached_wall = end_radius >= fence_ft - 8
    charger = _charge_slow_roller(end) if ground else None

    height_ft = None
    cleared = False
    landing = end
    if catch or charger:
        how, bip = "catch", "out"
        fielder = catch["name"] if catch else charger
        landing = samples[catch["index"]] if catch else end
    elif crossing["kind"] == "clear":
        how, bip, fielder = "home_run", "home_run", None
        cleared = True
        height_ft = crossing["at"]["z"]
        landing = end
    elif crossing["kind"] == "wall" or reached_wall:
        at = crossing["at"] if crossing["kind"] == "wall" else end
        height_ft = crossing["at"]["z"] if crossing["kind"] == "wall" else max(0.0, end["z"])
        late = _outfield_late(at, ground, speed_mph)
        corner = abs(spray_angle(at["x"], at["y"])) >= 33 and late >= 1.5
        how, bip, fielder = "wall", ("triple" if corner else "double"), None
        landing = at
    else:
        how, fielder = "hit", None
        late = _outfield_late(end, ground, speed_mph)
        bip = "double" if end_radius >= 230 and late >= 0.4 else "single"
        landing = end

    landing_ft = _radius(landing)
    return {
        "bip": bip,
        "how": how,
        "fielder": fielder,
        "cleared": cleared,
        "carryFt": carry_ft,
        "fenceFt": fence_ft,
        "heightFt": None if height_ft is None else round(height_ft, 2),
        "landingFt": round(landing_ft, 2),
        "note": _note(cleared, how, fence_ft, height_ft, landing_ft),
        "label": _label(bip, how, fielder, bb_type),
    }


def _aim(decision: dict) -> tuple[float, float]:
    if decision.get("hcX") is not None and decision.get("hcY") is not None:
        return 2.5 * (decision["hcX"] - 125.42), 2.5 * (198.27 - decision["hcY"])
    spray = decision.get("spray") or 0.0
    rad = math.radians(spray)
    return math.sin(rad) * 250.0, math.cos(rad) * 250.0


def apply_park(decision: dict, plate_x: float, plate_z: float) -> dict:
    """インプレーだけ、MLB の記録を甲子園のフェンスと守備で置き換える。"""
    decision["mlbBip"] = decision.get("bip")
    decision["park"] = None
    if decision.get("outcome") != "in_play":
        return decision
    if decision.get("exitSpeed") is None or decision.get("launchAngle") is None:
        return decision
    aim_x, aim_y = _aim(decision)
    ground = decision.get("bbType") == "ground_ball"
    hc = math.hypot(aim_x, aim_y)
    hit = decision.get("hitDistance")
    carry = hc if ground or hit is None or hit <= 20 else float(hit)
    play = resolve_fair_ball(
        x=plate_x,
        y=17 / 12,
        z=plate_z,
        speed_mph=float(decision["exitSpeed"]),
        launch_deg=float(decision["launchAngle"]),
        aim_x=aim_x,
        aim_y=aim_y,
        carry_ft=max(carry, 1.0),
        ground=ground,
        bb_type=decision.get("bbType"),
    )
    if decision.get("mlbBip") == "home_run" and play["bip"] != "home_run":
        play["note"] = "MLB では本塁打。" + play["note"]
    decision["bip"] = play["bip"]
    decision["park"] = play
    return decision
