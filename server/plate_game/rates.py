"""球種・コース・カウントの成績を、球数が少ないほどリーグ平均へ寄せる。"""

from __future__ import annotations

from dataclasses import dataclass, field

from plate_game.zone import is_strike_cell

PITCH_GROUP = {
    "FF": "FF",
    "FA": "FF",
    "SI": "SI",
    "FT": "SI",
    "FC": "FC",
    "SL": "SL",
    "ST": "SL",
    "SV": "SL",
    "CU": "CU",
    "KC": "CU",
    "CS": "CU",
    "CH": "CH",
    "FS": "CH",
    "FO": "CH",
    "SC": "CH",
    "KN": "KN",
}

SWING = {
    "swinging_strike",
    "swinging_strike_blocked",
    "foul",
    "foul_tip",
    "foul_bunt",
    "bunt_foul_tip",
    "missed_bunt",
    "hit_into_play",
    "hit_into_play_no_out",
    "hit_into_play_score",
}
WHIFF = {"swinging_strike", "swinging_strike_blocked", "missed_bunt"}
FOUL = {"foul", "foul_tip", "foul_bunt", "bunt_foul_tip"}
IN_PLAY = {"hit_into_play", "hit_into_play_no_out", "hit_into_play_score"}
TAKE = {"ball", "blocked_ball", "called_strike"}
SKIP = {"pitchout", "intent_ball", "hit_by_pitch", "automatic_ball"}

K_EVENTS = {"strikeout", "strikeout_double_play"}
BB_EVENTS = {"walk", "intent_walk"}

OUT_EVENTS = {
    "field_out",
    "force_out",
    "grounded_into_double_play",
    "double_play",
    "triple_play",
    "sac_fly",
    "sac_bunt",
    "sac_fly_double_play",
    "fielders_choice",
    "fielders_choice_out",
}

# その組み合わせの実数がこの球数分のリーグ平均と同じ重みになる。少ないほど平均に寄る。
PRIOR_SWING = 48
PRIOR_WHIFF = 36
PRIOR_FOUL = 30
PRIOR_BIP = 24

BIP_KEYS = ("out", "single", "double", "triple", "home_run")


@dataclass
class Bucket:
    n: int = 0
    swing: int = 0
    whiff: int = 0
    contact: int = 0
    foul: int = 0
    in_play: int = 0
    out: int = 0
    single: int = 0
    double: int = 0
    triple: int = 0
    home_run: int = 0

    def add(self, other: "Bucket") -> None:
        for key in self.__dataclass_fields__:
            setattr(self, key, getattr(self, key) + getattr(other, key))

    def as_dict(self) -> dict[str, int]:
        return {key: getattr(self, key) for key in self.__dataclass_fields__}


def pitch_group(pitch_type: str | None) -> str:
    if not pitch_type:
        return "OT"
    return PITCH_GROUP.get(pitch_type, "OT")


def bip_result(events: str | None) -> str | None:
    if events in OUT_EVENTS or events in {None, ""}:
        return "out" if events else None
    if events == "single":
        return "single"
    if events == "double":
        return "double"
    if events == "triple":
        return "triple"
    if events == "home_run":
        return "home_run"
    return "out"


def observe(description: str | None, events: str | None) -> Bucket | None:
    if description in SKIP or description is None:
        return None
    bucket = Bucket(n=1)
    if description in SWING:
        bucket.swing = 1
        if description in WHIFF:
            bucket.whiff = 1
        elif description in FOUL:
            bucket.contact = 1
            bucket.foul = 1
        elif description in IN_PLAY:
            bucket.contact = 1
            bucket.in_play = 1
            setattr(bucket, bip_result(events) or "out", 1)
        else:
            return None
    elif description in TAKE:
        pass
    else:
        return None
    return bucket


def bucket_key(group: str | None, cell: int | None, count: str | None) -> str:
    return f"{group or '*'}|{'' if cell is None else cell}|{count or '*'}"


def parse_key(key: str) -> tuple[str | None, int | None, str | None]:
    group, cell, count = key.split("|")
    return (
        None if group == "*" else group,
        None if cell in {"", "*"} else int(cell),
        None if count == "*" else count,
    )


@dataclass
class Table:
    buckets: dict[str, Bucket] = field(default_factory=dict)
    _cache: dict[tuple, Bucket] = field(default_factory=dict, repr=False)

    def add(self, group: str, cell: int, count: str, observed: Bucket) -> None:
        self._cache.clear()
        key = bucket_key(group, cell, count)
        slot = self.buckets.get(key)
        if slot is None:
            slot = Bucket()
            self.buckets[key] = slot
        slot.add(observed)

    def sum_matching(self, group: str | None, cell: int | None, count: str | None) -> Bucket:
        cache_key = (group, cell, count)
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached
        total = Bucket()
        for key, bucket in self.buckets.items():
            key_group, key_cell, key_count = parse_key(key)
            if group is not None and key_group != group:
                continue
            if cell is not None and key_cell != cell:
                continue
            if count is not None and key_count != count:
                continue
            total.add(bucket)
        self._cache[cache_key] = total
        return total


def _ratio(numerator: int, denominator: int, fallback: float) -> float:
    if denominator <= 0:
        return fallback
    return numerator / denominator


def league_swing(table: Table, group: str, cell: int, count: str) -> float:
    return _backed(table, group, cell, count, "swing")


def league_whiff(table: Table, group: str, cell: int, count: str) -> float:
    return _backed(table, group, cell, count, "whiff")


def league_foul(table: Table, group: str, cell: int, count: str) -> float:
    return _backed(table, group, cell, count, "foul")


def league_bip(table: Table, group: str, cell: int, count: str) -> dict[str, float]:
    ladder = _ladder(group, cell, count)
    for item_group, item_cell, item_count in ladder:
        bucket = table.sum_matching(item_group, item_cell, item_count)
        if bucket.in_play >= 20:
            return _bip_share(bucket)
    return _bip_share(table.sum_matching(None, None, None))


def _bip_share(bucket: Bucket) -> dict[str, float]:
    total = bucket.out + bucket.single + bucket.double + bucket.triple + bucket.home_run
    if total <= 0:
        return {"out": 0.68, "single": 0.18, "double": 0.06, "triple": 0.01, "home_run": 0.07}
    return {key: getattr(bucket, key) / total for key in BIP_KEYS}


def _ladder(group: str, cell: int, count: str) -> list[tuple[str | None, int | None, str | None]]:
    return [
        (group, cell, count),
        (group, cell, None),
        (group, None, count),
        (None, cell, count),
        (group, None, None),
        (None, cell, None),
        (None, None, count),
        (None, None, None),
    ]


def _read_rate(kind: str, bucket: Bucket) -> tuple[float, int]:
    if kind == "swing":
        return _ratio(bucket.swing, bucket.n, 0.46), bucket.n
    if kind == "whiff":
        return _ratio(bucket.whiff, bucket.swing, 0.24), bucket.swing
    return _ratio(bucket.foul, bucket.contact, 0.45), bucket.contact


def _backed(table: Table, group: str, cell: int, count: str, kind: str) -> float:
    minimum = {"swing": 40, "whiff": 25, "foul": 20}[kind]
    for item_group, item_cell, item_count in _ladder(group, cell, count):
        rate, support = _read_rate(kind, table.sum_matching(item_group, item_cell, item_count))
        broad = item_group is None and item_cell is None and item_count is None
        if broad or support >= minimum:
            return rate
    rate, _support = _read_rate(kind, table.sum_matching(None, None, None))
    return rate


def shrink(successes: int, trials: int, league_p: float, prior: int) -> float:
    """trials が 0 ならリーグ平均、増えるほど打者自身の率になる。"""
    return (successes + prior * league_p) / (trials + prior)


def _steps(group: str, cell: int, count: str, priors: tuple[int, int, int, int, int]):
    """全体 → カウント → コース → コース×カウント → 球種×コース×カウント。

    コースを球種より先に置く。マスの中と外で振らないかが、球種の細かい差より先に残る。
    """
    return (
        (None, None, None, priors[0]),
        (None, None, count, priors[1]),
        (None, cell, None, priors[2]),
        (None, cell, count, priors[3]),
        (group, cell, count, priors[4]),
    )


def _zone_sum(table: Table, group: str | None, cell: int, count: str | None) -> Bucket:
    """同じ球種の、ゾーンの内か外か。外周の1マスは球が少なく、外角の空振りが平均に消える。"""
    inside = is_strike_cell(cell)
    total = Bucket()
    for other in range(25):
        if is_strike_cell(other) == inside:
            total.add(table.sum_matching(group, other, count))
    return total


def _nested(
    batter: Table,
    league_rate_for,
    group: str,
    cell: int,
    count: str,
    steps: tuple,
    numerator: str,
    denominator: str,
) -> tuple[float, int]:
    estimate = league_rate_for(group, cell, count)
    for item_group, item_cell, item_count, prior in steps:
        bucket = batter.sum_matching(item_group, item_cell, item_count)
        estimate = shrink(getattr(bucket, numerator), getattr(bucket, denominator), estimate, prior)
    exact = batter.sum_matching(group, cell, count)
    return estimate, getattr(exact, denominator)


def batter_swing(batter: Table, league: Table, group: str, cell: int, count: str) -> tuple[float, int]:
    return _nested(
        batter,
        lambda g, c, k: league_swing(league, g, c, k),
        group,
        cell,
        count,
        _steps(group, cell, count, (36, 18, 12, 8, 6)),
        "swing",
        "n",
    )


def batter_whiff(batter: Table, league: Table, group: str, cell: int, count: str) -> tuple[float, int]:
    """球種のあと、ゾーンの内と外。1マスまで細かくすると、外の空振りが球種の平均まで下がる。"""
    estimate = league_whiff(league, group, cell, count)
    for bucket, prior in (
        (batter.sum_matching(group, None, None), 14),
        (_zone_sum(batter, group, cell, None), 10),
        (_zone_sum(batter, group, cell, count), 8),
    ):
        estimate = shrink(bucket.whiff, bucket.swing, estimate, prior)
    exact = batter.sum_matching(group, cell, None)
    estimate = shrink(exact.whiff, exact.swing, estimate, 20)
    return estimate, batter.sum_matching(group, cell, count).swing


def batter_foul(batter: Table, league: Table, group: str, cell: int, count: str) -> tuple[float, int]:
    return _nested(
        batter,
        lambda g, c, k: league_foul(league, g, c, k),
        group,
        cell,
        count,
        _steps(group, cell, count, (24, 14, 12, 8, 6)),
        "foul",
        "contact",
    )


def batter_bip(batter: Table, league: Table, group: str, cell: int, count: str) -> dict[str, float]:
    """安打の内訳も、全体の成績が残るように段を重ねる。1マスだけだと本塁打が平均に消える。"""
    share = league_bip(league, group, cell, count)
    for item_group, item_cell, item_count, prior in _steps(group, cell, count, (24, 16, 14, 10, 8)):
        bucket = batter.sum_matching(item_group, item_cell, item_count)
        mixed = {key: getattr(bucket, key) + prior * share[key] for key in BIP_KEYS}
        total = sum(mixed.values())
        share = {key: value / total for key, value in mixed.items()}
    return share
