"""Export D-019 (format SWOD v1) : plages sans perte, règles aller / retour, format creux, trajets vers soi-même,
postes par pôle, et lecteur TypeScript de référence du contrat (exécuté avec Node s'il est installé).

Les durées utilisées ici sont des FIXTURES de test (synthétiques), pas des résultats r5py.
"""

from __future__ import annotations

import gzip
import json
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from starway import od_export as ox
from starway import od_table as od
from starway.config import MAX_TRIP_MIN, OUTBOUND_STEP_MIN, REPO_ROOT

H = 60
NT, NS, NC = od.SENTINEL_NO_TRIP, od.SENTINEL_NOT_SNAPPED, ox.SENTINEL_NOT_COMPUTED
GRID = od.departure_grid(3 * H, 22 * H)
CONTRACT = REPO_ROOT / "docs" / "contrats-donnees.md"


def random_series(rng: np.random.Generator, n: int, p_none: float = 0.3) -> np.ndarray:
    """Série plausible : trains toutes les k minutes (arrivées constantes), trous, valeurs > 120, sentinelles."""
    s = np.empty(n, dtype=np.uint8)
    k = 0
    while k < n:
        L = int(rng.integers(1, 12))
        if rng.random() < p_none:
            s[k:k + L] = rng.choice([NT, NT, NT, 121, 122, NS])
        else:
            v = int(rng.integers(0, 140))
            s[k:k + L] = np.clip(v - OUTBOUND_STEP_MIN * np.arange(min(L, n - k)), 0, 253)[:min(L, n - k)]
        k += L
    return s


# --------------------------------------------------------------------------- plages
def test_runs_constant_arrival_and_sentinels() -> None:
    s = np.array([40, 35, 30, 50, 45, NT, NT, 121, 10], dtype=np.uint8)
    L, v = ox.encode_runs(ox.cap_series(s))
    assert L.tolist() == [3, 2, 3, 1] and v.tolist() == [40, 50, NT, 10]  # 121 publié 255, fusionné avec les 255
    assert ox.decode_runs(L, v).tolist() == [40, 35, 30, 50, 45, NT, NT, NT, 10]


def test_runs_zero_ends_a_run() -> None:
    s = np.array([5, 0, 0, 3], dtype=np.uint8)
    L, v = ox.encode_runs(s)
    assert L.tolist() == [2, 1, 1] and ox.decode_runs(L, v).tolist() == [5, 0, 0, 3]


def test_encode_refuses_uncapped_series_and_splits_long_runs() -> None:
    with pytest.raises(ValueError):
        ox.encode_runs(np.array([121], dtype=np.uint8))
    L, v = ox.encode_runs(np.zeros(256, dtype=np.uint8))  # 256 zéros : une plage de 255 puis une de 1 (D-040)
    assert L.max() <= 255 and L.sum() == 256
    assert ox.decode_runs(L, v).tolist() == [0] * 256


def test_round_trip_random_series_is_lossless() -> None:
    rng = np.random.default_rng(7)
    for _ in range(300):
        s = ox.cap_series(random_series(rng, len(GRID)))
        L, v = ox.encode_runs(s)
        assert L.sum() == len(GRID)
        np.testing.assert_array_equal(ox.decode_runs(L, v), s)


# --------------------------------------------------------------------------- règles = od_table (04c)
def test_outbound_and_inbound_equal_od_table_for_every_start_and_end() -> None:
    rng = np.random.default_rng(11)
    starts, ends = od.servable_starts(GRID), od.servable_ends(GRID)
    for _ in range(40):
        s = random_series(rng, len(GRID))
        c = ox.cap_series(s)
        for S in starts:
            ref, dep = od.outbound_at(s[None, :], GRID, S)
            leg = ox.outbound(c, int(GRID[0]), S)
            want, reason = od.decode_minutes(int(ref[0]))
            assert leg.minutes == want and leg.reason == reason
            assert (leg.departure if leg.departure is not None else -1) == int(dep[0])
            if leg.minutes is not None:
                assert leg.departure + leg.minutes <= S  # arrivée avant le début du poste
        for E in ends:
            ref = od.inbound_at(s[None, :], GRID, E)
            leg = ox.inbound(c, int(GRID[0]), E)
            assert (leg.minutes, leg.reason) == od.decode_minutes(int(ref[0]))


def test_outbound_refuses_incomplete_window_and_off_grid() -> None:
    c = np.full(len(GRID), 30, dtype=np.uint8)
    for S in (4 * H + 55, 22 * H + 10, 6 * H + 2):
        with pytest.raises(ValueError):
            ox.outbound(c, int(GRID[0]), S)
    with pytest.raises(ValueError):
        ox.inbound(c, int(GRID[0]), 22 * H + 5)


def test_not_computed_and_not_snapped_reasons() -> None:
    assert ox.outbound(np.full(len(GRID), NC, np.uint8), int(GRID[0]), 9 * H).reason == "not_computed"
    assert ox.outbound(np.full(len(GRID), NS, np.uint8), int(GRID[0]), 9 * H).reason == "origin_not_snapped"
    assert ox.inbound(np.full(len(GRID), NC, np.uint8), int(GRID[0]), 17 * H).reason == "not_computed"
    assert ox.scalar_leg(NT).reason == "no_trip_within_120" and ox.scalar_leg(120).minutes == 120


# --------------------------------------------------------------------------- fichier : format creux, soi-même
def toy_tables(rng: np.random.Generator, n: int = 6) -> tuple[np.ndarray, np.ndarray]:
    t = np.full((n, n, len(GRID)), NT, dtype=np.uint8)
    for i in range(n):
        for j in range(n):
            t[i, j] = random_series(rng, len(GRID), p_none=0.5)
        t[i, i] = 0  # même point au départ et à l'arrivée : r5py rend 0
    t[0, 4] = NT  # 0 vers 4 : aucun aller, mais un retour 4 vers 0
    t[4, 0] = 40
    t[0, 5] = NT
    t[5, 0] = NT  # 0 vers 5 : rien dans les deux sens -> omis
    scal = np.full((n, n, 1), NT, dtype=np.uint8)
    scal[0, 1, 0], scal[1, 0, 0], scal[0, 2, 0] = 33, 35, 121
    return t, scal


def test_file_round_trip_sparse_rule_and_self_pair() -> None:
    t, scal = toy_tables(np.random.default_rng(3))
    x = 0
    ret = t[:, x, :].copy()
    ret[3] = NC  # lot de la commune 3 non calculé : retour inconnu
    secs = [ox.series_section(0, x, t[x], ret), ox.scalar_section(1, x, scal[x, :, 0], scal[:, x, 0])]
    buf = ox.pack_file(x, int(GRID[0]), len(GRID), secs)
    assert buf[:4] == b"SWOD"
    pf = ox.parse_file(buf)
    assert (pf.origin, pf.step, pf.first, pf.n_slots, pf.max_trip) == (x, 5, 180, 229, MAX_TRIP_MIN)
    tr = pf.series[0]
    assert x not in tr  # règle des trajets vers soi-même
    assert 4 in tr and 5 not in tr  # retour seul : publié ; rien dans les deux sens : omis
    for y, (o, r) in tr.items():
        np.testing.assert_array_equal(o, ox.cap_series(t[x, y]))
        np.testing.assert_array_equal(r, ox.cap_series(ret[y]))
    if 3 in tr:
        assert (tr[3][1] == NC).all()
    assert pf.scalars[1] == {1: (33, 35)}  # 121 -> 255 : la destination 2 n'a plus de durée, omise


def test_parse_rejects_bad_magic_and_trailing_bytes() -> None:
    buf = ox.pack_file(0, 180, 229, [])
    with pytest.raises(ValueError):
        ox.parse_file(b"XXXX" + buf[4:])
    with pytest.raises(ValueError):
        ox.parse_file(buf + b"\0")


# --------------------------------------------------------------------------- postes et pôles
def test_pole_of_and_reached_by_pole() -> None:
    codes = ["75101", "75102", "92050", "93048"]
    poles = [{"id": "A", "communes": ["75101", "75102"]}, {"id": "B", "communes": ["92050"]}]
    idx = ox.pole_of(codes, poles)
    assert idx == [0, 0, 1, None]
    jobs = [100, 50, 30, 7]
    r = ox.reached_by_pole({1: True, 2: False}, jobs, idx, 2, origin=0)
    assert r == {"reached": [50, 0], "unmeasured": [100, 0], "total": [150, 30]}
    with pytest.raises(ValueError):
        ox.pole_of(codes, poles + [{"id": "C", "communes": ["92050"]}])
    with pytest.raises(ValueError):
        ox.pole_of(codes, [{"id": "D", "communes": ["99999"]}])


# --------------------------------------------------------------------------- lecteur TypeScript du contrat
def contract_reader() -> str:
    text = CONTRACT.read_text(encoding="utf-8")
    m = re.search(r"<!-- swod-reader:begin -->\s*```ts\n(.*?)```\s*<!-- swod-reader:end -->", text, re.DOTALL)
    assert m, "bloc du lecteur SWOD absent du contrat"
    return m.group(1)


@pytest.mark.skipif(shutil.which("node") is None, reason="Node absent")
def test_coverage_block_announces_modes_not_exported() -> None:
    """06d --transit-only : TC complet, marche / vélo / voiture annoncés « non calculés », jamais omis ni remplis."""
    codes = ["75101", "75102", "77001"]
    cov = ox.coverage_block({"transit": {0, 1, 2}}, codes, ("transit", "walk", "bike", "car"))
    assert cov["transit"] == {"origins": 3, "complete": True}
    for m in ("walk", "bike", "car"):
        assert cov[m]["origins"] == 0 and cov[m]["complete"] is False and cov[m]["computed"] == []
        assert cov[m]["status"] == "not_computed" and cov[m]["reason"]
    assert cov["walk"]["computed"] is not cov["bike"]["computed"]  # pas de liste partagée entre modes
    partial = ox.coverage_block({"transit": {0, 2}}, codes, ("transit",))
    assert partial["transit"] == {"origins": 2, "complete": False, "computed": ["75101", "77001"]}


def test_typescript_reader_of_the_contract_matches_python(tmp_path: Path) -> None:
    t, scal = toy_tables(np.random.default_rng(5))
    x = 0
    secs = [ox.series_section(0, x, t[x], t[:, x, :]), ox.scalar_section(3, x, scal[x, :, 0], scal[:, x, 0])]
    raw = ox.pack_file(x, int(GRID[0]), len(GRID), secs)
    (tmp_path / "f.bin").write_bytes(raw)
    (tmp_path / "f.bin.gz").write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    (tmp_path / "reader.ts").write_text(contract_reader(), encoding="utf-8")
    starts = [5 * H, 6 * H, 9 * H, 14 * H, 22 * H + 5]
    ends = [3 * H, 14 * H, 17 * H, 22 * H]
    (tmp_path / "run.ts").write_text(f"""
import {{ readFileSync }} from "node:fs";
import {{ parseSwod, decodeSwodBytes, outboundAt, inboundAt }} from "./reader.ts";
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const f = parseSwod(ab(readFileSync({json.dumps(str(tmp_path / "f.bin"))})));
const g = await decodeSwodBytes(ab(readFileSync({json.dumps(str(tmp_path / "f.bin.gz"))})));
if (JSON.stringify([...g.sections.keys()]) !== JSON.stringify([...f.sections.keys()]) ||
    g.sections.get(0)!.outSeries!.length !== f.sections.get(0)!.outSeries!.length) throw new Error("gzip");
const res: Record<string, unknown> = {{ origin: f.origin, scalars: {{}}, series: {{}} }};
for (const [code, sec] of f.sections) {{
  for (let i = 0; i < sec.dest.length; i++) {{
    if (sec.kind === "scalar") {{
      (res.scalars as any)[`${{code}}:${{sec.dest[i]}}`] = [sec.out![i], sec.ret![i]];
    }} else {{
      const o = {json.dumps(starts)}.map((S) => outboundAt(f, sec.outSeries![i], S, 120));
      const r = {json.dumps(ends)}.map((E) => inboundAt(f, sec.retSeries![i], E));
      (res.series as any)[`${{code}}:${{sec.dest[i]}}`] = {{ o, r }};
    }}
  }}
}}
console.log(JSON.stringify(res));
""", encoding="utf-8")
    p = subprocess.run(["node", str(tmp_path / "run.ts")], check=False, capture_output=True, text=True,
                       timeout=60)
    assert p.returncode == 0, p.stderr
    got = json.loads(p.stdout)
    pf = ox.parse_file((tmp_path / "f.bin").read_bytes())
    assert got["origin"] == x
    assert got["scalars"] == {f"3:{y}": list(v) for y, v in pf.scalars[3].items()}
    want = {}
    for y, (o, r) in pf.series[0].items():
        legs_o = [ox.outbound(o, pf.first, S) for S in starts]
        legs_r = [ox.inbound(r, pf.first, E) for E in ends]
        want[f"0:{y}"] = {"o": [{"minutes": g.minutes, "reason": g.reason, "dep": g.departure} for g in legs_o],
                          "r": [{"minutes": g.minutes, "reason": g.reason} for g in legs_r]}
    assert got["series"] == want
