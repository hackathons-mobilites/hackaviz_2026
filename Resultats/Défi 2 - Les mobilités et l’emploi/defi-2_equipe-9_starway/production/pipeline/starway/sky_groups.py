"""D-030 : astres du ciel = bassins d'emploi France Travail 2026 (GEO04), Paris en 20 arrondissements.

Demande de Nicolas (03/11/2026, soir) : les astres doivent couvrir les 1 285 origines d'Île-de-France. Découpage
choisi : les bassins d'emploi de France Travail 2026. Paris forme un seul bassin (« T1 Paris ») : il reste découpé.
Choix de Nicolas du 04/11 : Paris en 20 arrondissements (44 astres), noms courts sur le ciel (commune qui compte le
plus de postes dans l'astre), noms officiels dans le panneau, position au barycentre des postes. Le découpage en
3 pôles parisiens (27 astres) reste calculé pour comparaison.

Ce module est sans r5py ni Java. `scripts/03b_sky_groups.py` écrit data/processed/poles_d030.json (44 astres) et,
avec --publish (alias --preview), le poles.json des 44 astres dans config.FRONT_SKY44_DIR (preview-d030/ avant la bascule :
le poles.json des 15 pôles ne change pas).

Il contient aussi un portage Python de l'agrégation du front (`frontend/src/data/od/compute.ts` : `destStatus`,
`poleShares`) pour mesurer, depuis la table OD publiée, la part des postes atteinte par groupe.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from pyproj import Transformer

from starway import od_export as ox
from starway.config import PARIS_ARRONDISSEMENTS, RAW_DIR
from starway.geo import _TO_L93, round_sky, sky_project
from starway.poles import POLE_DEFS

GEO04_XLSX = RAW_DIR / "GEO04" / "Bassins_d_emploi_2026_lu_2026-11-03.xlsx"
GEO04_COLUMNS = ("region", "dep", "code_commune", "lib_commune", "code_bassin_2026", "lib_bassin_2026")
IDF_REGION = "11"  # code région INSEE de l'Île-de-France (colonne `region` du fichier)
PARIS_BASSIN = "1107"  # « T1 Paris » : les 20 arrondissements
PARIS_SPLITS = ("poles3", "arrondissements")
FORBIDDEN_DASHES = {chr(0x2013): "-", chr(0x2014): "-"}  # règle du dépôt : jamais de tiret demi-cadratin ni cadratin


# --------------------------------------------------------------------------- lecture du fichier GEO04
def clean_label(s: str) -> tuple[str, bool]:
    """Remplace les tirets U+2013 / U+2014 par « - » (règle du dépôt). Renvoie (libellé, remplacement fait)."""
    out = s
    for bad, good in FORBIDDEN_DASHES.items():
        out = out.replace(bad, good)
    return out, out != s


def read_bassins(path: Path = GEO04_XLSX) -> pd.DataFrame:
    """Lignes IDF (region 11) du fichier commune -> bassin. Colonnes : insee, lib_commune, dep, bassin_code,
    bassin_name, name_dash_replaced. Erreur si l'en-tête diffère de celui inspecté le 03/11/2026."""
    raw = pd.read_excel(path, dtype=str)
    if tuple(raw.columns) != GEO04_COLUMNS:
        raise ValueError(f"colonnes inattendues dans {path.name} : {list(raw.columns)}")
    idf = raw[raw["region"] == IDF_REGION].copy()
    if idf["code_commune"].duplicated().any():
        raise ValueError("code commune présent deux fois dans le fichier des bassins")
    cleaned = idf["lib_bassin_2026"].map(clean_label)
    return pd.DataFrame({
        "insee": idf["code_commune"].str.strip(), "lib_commune": idf["lib_commune"], "dep": idf["dep"],
        "bassin_code": idf["code_bassin_2026"].str.strip(), "bassin_name": [c[0] for c in cleaned],
        "name_dash_replaced": [c[1] for c in cleaned],
    }).sort_values("insee").reset_index(drop=True)


def norm_name(s: str) -> str:
    """Libellé comparable : sans accents ni ligatures, majuscules, « Saint(e) » abrégé, sans ponctuation ;
    « PARIS 01 » = « Paris 1er Arrondissement »."""
    s = str(s).replace("œ", "oe").replace("Œ", "OE").replace("æ", "ae").replace("Æ", "AE")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().upper()
    s = re.sub(r"\bSAINTE\b", "STE", s)
    s = re.sub(r"\bSAINT\b", "ST", s)
    s = s.replace("ARRONDISSEMENT", " ")
    s = re.sub(r"\b0*(\d+)(?:ER|E)?\b", r"\1", s)
    return re.sub(r"[^A-Z0-9]", "", s)


# --------------------------------------------------------------------------- rattachement des origines
@dataclass(frozen=True)
class Attachment:
    bassin_of: dict[str, str]  # origine -> code bassin
    bassin_names: dict[str, str]  # code bassin -> libellé (tirets nettoyés)
    report: pd.DataFrame  # une ligne par code du fichier ou par origine : statut, écarts


def attach_origins(origins: pd.DataFrame, bassins: pd.DataFrame, passage: Mapping[str, str]) -> Attachment:
    """Rattache chaque origine (colonnes insee, name) à son bassin.

    - origine absente du fichier : erreur (aucun rattachement deviné) ;
    - code du fichier qui n'est pas une origine : commune déléguée / associée connue de `passage` (signalée, avec
      contrôle « même bassin que son chef-lieu »), sinon écart de code (signalé) ;
    - libellé de commune différent de celui de l'API Géo après normalisation (accents, casse, « Saint ») : signalé.
    """
    b = bassins.set_index("insee")
    names = dict(zip(origins["insee"], origins["name"]))
    missing = sorted(set(names) - set(b.index))
    if missing:
        raise ValueError(f"origines sans bassin dans GEO04 : {missing}")
    bassin_of = {c: str(b.at[c, "bassin_code"]) for c in names}
    bassin_names = dict(zip(bassins["bassin_code"], bassins["bassin_name"]))
    rows = []
    for code, r in b.iterrows():
        row = {"insee_geo04": code, "lib_commune_geo04": r["lib_commune"], "bassin_code": r["bassin_code"],
               "bassin_name": r["bassin_name"], "status": "", "insee_origin": None, "name_origin": None,
               "same_bassin_as_chef_lieu": None, "name_differs": None}
        if code in names:
            row.update(status="origin", insee_origin=code, name_origin=names[code],
                       name_differs=norm_name(r["lib_commune"]) != norm_name(names[code]))
        elif code in passage and passage[code] in names:
            chef = passage[code]
            row.update(status="delegated_commune", insee_origin=chef, name_origin=names[chef],
                       same_bassin_as_chef_lieu=bassin_of[chef] == r["bassin_code"])
        else:
            row.update(status="code_not_in_origins")
        rows.append(row)
    return Attachment(bassin_of, bassin_names, pd.DataFrame(rows))


# --------------------------------------------------------------------------- groupes (astres)
@dataclass(frozen=True)
class Group:
    id: str
    name: str
    bassin_code: str
    bassin_name: str
    communes: tuple[str, ...]
    jobs: int | None = None
    missing_jobs: tuple[str, ...] = field(default_factory=tuple)


def paris_groups(split: str, bassin_name: str) -> list[tuple[str, str, tuple[str, ...]]]:
    """Découpage du bassin T1 Paris : (id, nom, arrondissements)."""
    if split == "poles3":
        out = [(p.id, p.name, p.communes) for p in POLE_DEFS if p.id.startswith("P_PARIS_")]
        covered = sorted(c for _, _, cs in out for c in cs)
        if covered != sorted(PARIS_ARRONDISSEMENTS):
            raise ValueError("les pôles parisiens actuels ne couvrent pas exactement les 20 arrondissements")
        return out
    if split == "arrondissements":
        return [(f"BE_{PARIS_BASSIN}_{c}", f"{bassin_name} - {int(c[-2:])}{'er' if c.endswith('01') else 'e'} arrondissement",
                 (c,)) for c in PARIS_ARRONDISSEMENTS]
    raise ValueError(f"découpage de Paris inconnu : {split}")


def build_groups(att: Attachment, jobs: Mapping[str, int | None], paris_split: str = "poles3") -> list[Group]:
    """Un groupe par bassin d'emploi, sauf T1 Paris découpé (`paris_split`). Ordre : Paris d'abord, puis les bassins
    par code croissant. Postes = somme des communes membres ; `None` si l'une manque (jamais 0)."""
    by_bassin: dict[str, list[str]] = {}
    for c, bcode in sorted(att.bassin_of.items()):
        by_bassin.setdefault(bcode, []).append(c)
    defs: list[tuple[str, str, str, tuple[str, ...]]] = []
    if PARIS_BASSIN in by_bassin:
        if sorted(by_bassin[PARIS_BASSIN]) != sorted(PARIS_ARRONDISSEMENTS):
            raise ValueError("le bassin T1 Paris ne contient pas exactement les 20 arrondissements")
        for gid, name, communes in paris_groups(paris_split, att.bassin_names[PARIS_BASSIN]):
            defs.append((gid, name, PARIS_BASSIN, tuple(communes)))
    for bcode in sorted(by_bassin, key=int):
        if bcode == PARIS_BASSIN:
            continue
        defs.append((f"BE_{bcode}", att.bassin_names[bcode], bcode, tuple(by_bassin[bcode])))
    groups = []
    for gid, name, bcode, communes in defs:
        vals = [jobs.get(c) for c in communes]
        miss = tuple(c for c, v in zip(communes, vals) if v is None or pd.isna(v))
        total = None if miss else int(sum(int(v) for v in vals if v is not None))
        groups.append(Group(gid, name, bcode, att.bassin_names[bcode], communes, total, miss))
    return groups


def check_partition(groups: Sequence[Group], origins: Sequence[str]) -> list[str]:
    """Écarts à « chaque origine dans exactement un groupe » (liste vide = partition exacte)."""
    seen: dict[str, str] = {}
    errs = []
    for g in groups:
        for c in g.communes:
            if c in seen:
                errs.append(f"{c} dans {seen[c]} et {g.id}")
            seen[c] = g.id
    errs += [f"{c} dans aucun groupe" for c in sorted(set(origins) - set(seen))]
    errs += [f"{c} n'est pas une origine" for c in sorted(set(seen) - set(origins))]
    return errs


# --------------------------------------------------------------------------- arrêt d'affichage (règle des pôles)
def anchor_rows(groups: Sequence[Group], located: pd.DataFrame, top_n: int = 2) -> list[dict]:
    """Même règle que les pôles (03) : arrêt parent le plus desservi situé dans les communes du groupe ; égalité :
    stop_id croissant. `located` : départs par arrêt parent + colonne `insee` (jointure spatiale déjà faite)."""
    rows = []
    for g in groups:
        cand = located[located["insee"].isin(g.communes)]
        top = cand.sort_values(["departures", "stop_id"], ascending=[False, True]).head(top_n)
        if top.empty:
            rows.append({"group_id": g.id, "stop_id": None, "candidates": 0})
            continue
        a = top.iloc[0]
        b = top.iloc[1] if len(top) > 1 else None
        rows.append({"group_id": g.id, "stop_id": a["stop_id"], "stop_name": a["stop_name"], "insee": a["insee"],
                     "lon": float(a["lon"]), "lat": float(a["lat"]), "departures": int(a["departures"]),
                     "second_stop_id": None if b is None else b["stop_id"],
                     "second_stop_name": None if b is None else b["stop_name"],
                     "second_departures": None if b is None else int(b["departures"]),
                     "candidates": len(cand)})
    return rows


def weighted_median(values: Sequence[float], weights: Sequence[float]) -> float:
    """Médiane pondérée (plus petite valeur dont le poids cumulé atteint la moitié du total)."""
    v = np.asarray(values, dtype=float)
    w = np.asarray(weights, dtype=float)
    order = np.argsort(v, kind="stable")
    cum = np.cumsum(w[order])
    return float(v[order][np.searchsorted(cum, cum[-1] / 2.0)])


def min_pair_distance(xy: np.ndarray) -> float:
    d = np.hypot(*(xy[:, None, :] - xy[None, :, :]).transpose(2, 0, 1))
    d[np.diag_indices(len(xy))] = np.inf
    return float(d.min())


# --------------------------------------------------------------------------- poles.json D-030 (44 astres)
D030_SPLIT = "arrondissements"  # choix de Nicolas du 04/11/2026 : Paris en 20 arrondissements
GEO04_SOURCE = "GEO04, France Travail, bassins d'emploi 2026"
_FROM_L93 = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)


def ordinal_fr(n: int) -> str:
    """Numéro d'arrondissement en français : 1er, 2e, ..., 20e."""
    return "1er" if n == 1 else f"{n}e"


def expected_group_count(att: Attachment, split: str) -> int:
    """Nombre d'astres dérivé de la source : bassins IDF de GEO04 rattachés aux origines, T1 Paris remplacé par son
    découpage (20 arrondissements, ou les 3 pôles parisiens actuels)."""
    n_bassins = len(set(att.bassin_of.values()))
    return n_bassins - 1 + len(paris_groups(split, att.bassin_names.get(PARIS_BASSIN, "")))


def short_name(g: Group, names: Mapping[str, str], jobs: Mapping[str, int | None]) -> tuple[str, str]:
    """Nom court du ciel (choix de Nicolas du 04/11) : commune de l'astre qui compte le plus de postes Flores (égalité :
    code INSEE croissant). Un astre arrondissement porte son numéro (« 1er » à « 20e »). Renvoie (nom, code)."""
    best = min(g.communes, key=lambda c: (-int(jobs[c] or 0), c))
    if best in PARIS_ARRONDISSEMENTS:
        return ordinal_fr(int(best[-2:])), best
    return names[best], best


def official_name(g: Group, names: Mapping[str, str]) -> str:
    """Nom du panneau : libellé GEO04 du bassin ; astre arrondissement : nom officiel de l'arrondissement (API Géo)."""
    if g.bassin_code == PARIS_BASSIN and len(g.communes) == 1:
        return names[g.communes[0]]
    return g.bassin_name


def jobs_barycentre(groups: Sequence[Group], lonlat: Mapping[str, tuple[float, float]],
                    jobs: Mapping[str, int | None]) -> np.ndarray:
    """Barycentre (lon, lat) des centres API Géo des communes du groupe, pondérés par les postes Flores, en Lambert-93."""
    out = []
    for g in groups:
        cs = list(g.communes)
        w = np.array([float(jobs[c] or 0) for c in cs])
        if w.sum() <= 0:
            raise ValueError(f"{g.id} : aucun poste, barycentre impossible")
        x, y = _TO_L93.transform([lonlat[c][0] for c in cs], [lonlat[c][1] for c in cs])
        out.append(_FROM_L93.transform(float((np.asarray(x) * w).sum() / w.sum()),
                                       float((np.asarray(y) * w).sum() / w.sum())))
    return np.array(out)


def build_sky_poles(att: Attachment, origins: pd.DataFrame, jobs: Mapping[str, int | None], located: pd.DataFrame,
                    jobs_year: int, service_date: str, split: str = D030_SPLIT) -> list[dict]:
    """Entrées de poles.json pour le découpage `split` (contrat « D-030 »), sans aléa : mêmes entrées, même fichier.

    `origins` : colonnes insee, name, lon, lat (centre API Géo). `located` : départs par arrêt parent avec `insee`.
    Position du ciel = sky_project(barycentre des postes), sans relaxation (choix de Nicolas du 04/11 : colonnes
    alt_sky_*). Erreur si la partition n'est pas exacte ou si un groupe n'a pas de postes ou pas d'arrêt.
    """
    groups = build_groups(att, jobs, split)
    errs = check_partition(groups, origins["insee"].tolist())
    if errs:
        raise ValueError(f"partition fausse : {errs[:5]}")
    if any(g.jobs is None or g.jobs <= 0 for g in groups):
        raise ValueError(f"groupes sans postes Flores : {[g.id for g in groups if not g.jobs]}")
    names = dict(zip(origins["insee"], origins["name"]))
    lonlat = {r.insee: (float(r.lon), float(r.lat)) for r in origins.itertuples()}
    anchors = {a["group_id"]: a for a in anchor_rows(groups, located)}
    if any(a["stop_id"] is None for a in anchors.values()):
        raise ValueError(f"groupes sans arrêt desservi : {[k for k, a in anchors.items() if a['stop_id'] is None]}")
    bary = jobs_barycentre(groups, lonlat, jobs)
    sx, sy = sky_project(bary[:, 0], bary[:, 1])
    out = []
    for i, g in enumerate(groups):
        a = anchors[g.id]
        short, short_insee = short_name(g, names, jobs)
        off = official_name(g, names)
        out.append({
            "id": g.id, "name": off, "name_short": short, "name_official": off, "name_short_insee": short_insee,
            "communes": list(g.communes), "jobs": g.jobs, "jobs_year": jobs_year, "jobs_source": "EMP01",
            "point": {"lon": round(a["lon"], 5), "lat": round(a["lat"], 5),
                      "method": (f"arrêt d'affichage : arrêt parent le plus desservi le {service_date} "
                                 f"({a['departures']} départs) dans les communes de l'astre : {a['stop_name']} "
                                 f"({a['stop_id']}, GTFS IDFM)"),
                      "stop_id": a["stop_id"], "stop_name": a["stop_name"], "insee": a["insee"],
                      "departures": a["departures"]},
            "sky": {"x": round_sky(sx[i]), "y": round_sky(sy[i])},
            "bassin": {"code": g.bassin_code, "name": g.bassin_name, "source": GEO04_SOURCE},
        })
    return out


def located_departures() -> pd.DataFrame:
    """Départs par arrêt parent (cache de 03) rattachés à une origine par jointure spatiale (comme 03 et 07)."""
    import geopandas as gpd

    from starway.config import INTERIM_DIR, PARIS_COMMUNE, SERVICE_DATE

    cache = INTERIM_DIR / f"gtfs_departures_{SERVICE_DATE:%Y%m%d}.csv"
    if not cache.exists():
        raise FileNotFoundError(cache)
    deps = pd.read_csv(cache, dtype={"stop_id": str})
    contours = gpd.read_file(INTERIM_DIR / "communes_idf_2026.gpkg")[["insee", "geometry"]]
    contours = contours[contours["insee"] != PARIS_COMMUNE]
    pts = gpd.GeoDataFrame(deps, geometry=gpd.points_from_xy(deps["lon"], deps["lat"]), crs="EPSG:4326")
    return pd.DataFrame(gpd.sjoin(pts, contours.to_crs("EPSG:4326"), predicate="within", how="inner")
                        .drop(columns=["geometry", "index_right"]))


def pole_set_kind(poles: Sequence[Mapping]) -> str:
    """« pole_defs » (15 pôles de poles.POLE_DEFS), « d030 » (astres bassins d'emploi : champ `bassin`) ou « unknown »."""
    if poles and all(isinstance(p.get("bassin"), Mapping) for p in poles):
        return "d030"
    if [p["id"] for p in poles] == [d.id for d in POLE_DEFS]:
        return "pole_defs"
    return "unknown"


def d030_split(poles: Sequence[Mapping]) -> str:
    """Découpage de Paris d'un jeu D-030, lu dans les identifiants."""
    return "arrondissements" if any(p["id"].startswith(f"BE_{PARIS_BASSIN}_") for p in poles) else "poles3"


# --------------------------------------------------------------------------- mesure du ciel à l'écran (front)
@dataclass(frozen=True)
class FrontSky:
    """Réglages du ciel du front recopiés de frontend/src/theme/tokens.ts le 04/11/2026 (`skyLayout`, `poleLook`) et
    règles de frontend/src/sky/layout.ts (`computeFrame` sans barre mesurée, `toScreen`, `makeRadius`). Choix de rendu
    du front, pas des données : ils servent seulement à MESURER les chevauchements « à l'échelle actuelle »."""
    margin_top: float = 104
    margin_bottom: float = 190
    margin_side: float = 0.07
    max_pole_radius: float = 0.05
    min_pole_radius: float = 4
    bounds_pad: float = 0.03
    ring_gap: float = 4
    ring_width: float = 1.25


def screen_geometry(sky_xy: np.ndarray, jobs: Sequence[int], bounds_xy: np.ndarray, width: int, height: int,
                    fs: FrontSky | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Centres (px) et rayons (px) des astres comme les calcule le front, sans zoom ni relaxation (écran large)."""
    fs = fs or FrontSky()
    side = max(24.0, width * fs.margin_side)
    w, h = max(100.0, width - 2 * side), max(100.0, height - fs.margin_top - fs.margin_bottom)
    x0, y0 = bounds_xy.min(axis=0) - fs.bounds_pad
    x1, y1 = bounds_xy.max(axis=0) + fs.bounds_pad
    bw, bh = x1 - x0, y1 - y0
    s = min(w / bw, h / bh)
    px = side + (w - s * bw) / 2 + (sky_xy[:, 0] - x0) * s
    py = fs.margin_top + (h - s * bh) / 2 + (sky_xy[:, 1] - y0) * s
    j = np.asarray(jobs, dtype=float)
    r_screen = max(14.0, min(w, h) * fs.max_pole_radius)
    r_max = max(r_screen, fs.min_pole_radius * float(np.sqrt(j.max() / j.min())))
    return np.column_stack([px, py]), r_max * np.sqrt(j / j.max())


def overlapping_pairs(xy: np.ndarray, r: np.ndarray, extra: float = 0.0) -> list[tuple[int, int, float, float]]:
    """Couples (i, j, distance, distance nécessaire) dont les disques de rayon r + extra se recouvrent."""
    out = []
    for i in range(len(xy)):
        for j in range(i + 1, len(xy)):
            d = float(np.hypot(*(xy[j] - xy[i])))
            need = float(r[i] + r[j] + 2 * extra)
            if d < need:
                out.append((i, j, d, need))
    return out


def zoom_to_separate(xy: np.ndarray, r: np.ndarray, radius_law: str) -> float:
    """Facteur de zoom k (positions x k) à partir duquel plus aucun disque ne se recouvre, si les rayons à l'écran
    restent constants (`constant` : k >= (ri + rj) / d) ou suivent la racine du zoom (`sqrt` : k >= ((ri + rj) / d)²).
    Un zoom ordinaire (rayons x k) ne sépare jamais deux disques qui se recouvrent : renvoie inf dans ce cas."""
    pairs = overlapping_pairs(xy, r)
    if not pairs:
        return 1.0
    worst = max(need / d if d > 0 else float("inf") for _, _, d, need in pairs)
    if radius_law == "constant":
        return worst
    if radius_law == "sqrt":
        return worst ** 2
    if radius_law == "linear":
        return float("inf")
    raise ValueError(f"loi de rayon inconnue : {radius_law}")


# --------------------------------------------------------------------------- agrégation du front (portage)
NOT_MEASURED = {"not_computed", "origin_not_snapped"}


def dest_status(out: ox.Leg, ret: ox.Leg, budget: int) -> str:
    """Portage exact de `destStatus` (compute.ts) : accessible / out_only / none / unknown."""
    if out.minutes is None:
        return "unknown" if out.reason in NOT_MEASURED else "none"
    if out.minutes > budget:
        return "none"
    if ret.minutes is None:
        return "unknown" if ret.reason in NOT_MEASURED else "out_only"
    return "accessible" if ret.minutes <= budget else "out_only"


def od_states(pf: ox.ParsedFile, n_dest: int, mode_code: int, start: int, end: int, budget: int,
              lookback: int, return_computed: Sequence[bool] | None = None) -> list[str]:
    """État de chaque destination pour une origine (portage de `computeOd`, mode série) : enregistrement présent ->
    aller (`outbound`) et retour (`inbound`) ; origine -> « self » ; absente -> aucun trajet, sauf retour non
    calculé en export partiel (`return_computed[y]` faux)."""
    recs = pf.series.get(mode_code, {})
    states = []
    for y in range(n_dest):
        if y in recs:
            o, r = recs[y]
            out = ox.outbound(o, pf.first, start, pf.step, lookback, pf.max_trip)
            ret = ox.inbound(r, pf.first, end, pf.step, pf.max_trip)
            states.append(dest_status(out, ret, budget))
        elif y == pf.origin:
            states.append("self")
        else:
            computed = True if return_computed is None else bool(return_computed[y])
            out = ox.Leg(None, "no_trip_within_120")
            ret = ox.Leg(None, "no_trip_within_120" if computed else "not_computed")
            states.append(dest_status(out, ret, budget))
    return states


def group_shares(states: Sequence[str], jobs: Sequence[int], group_of: Sequence[int | None],
                 group_jobs: Sequence[int]) -> list[dict]:
    """Portage de `poleShares` : postes atteints, non atteints (dont aller seul), sans verdict, de la commune
    d'origine ; part = atteints / postes du groupe (`None` si le groupe n'a aucun poste)."""
    out = [{"jobs": int(j), "reached": 0, "not_reached": 0, "out_only": 0, "unknown": 0, "self": 0}
           for j in group_jobs]
    for y, g in enumerate(group_of):
        if g is None:
            continue
        s, j = states[y], int(jobs[y])
        if s == "accessible":
            out[g]["reached"] += j
        elif s == "self":
            out[g]["self"] += j
        elif s == "unknown":
            out[g]["unknown"] += j
        else:
            out[g]["not_reached"] += j
            if s == "out_only":
                out[g]["out_only"] += j
    for o in out:
        o["share"] = o["reached"] / o["jobs"] if o["jobs"] > 0 else None
    return out
