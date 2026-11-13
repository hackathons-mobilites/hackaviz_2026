"""Péages des trajets voiture et deux-roues publiés pour le front (D-029, tolls.json et `car_trip.toll`).

Chaîne (aucune valeur saisie ici, tout vient de 04g, 04i et 04j) :
1. `resolve_cell` : nœuds de péage et chemins `toll=yes` traversés par le chemin R5 d'un sens (colonnes `toll_nodes`
   et `toll_ways` de 04g, relevées avec la troncature de R5, starway/tolls.py) -> passages tarifés (couples entrée,
   sortie du registre starway/toll_tariffs.py), ou un statut « inconnu » avec les points en cause ;
2. `build_tolls_json` : registre des points et grilles de prix du jour de service (mardi 17/11/2026), de la veille et
   du lendemain (une fenêtre de passage peut franchir minuit), par couple, classe et tarif ;
3. `toll_leg` : péage d'un sens dans une fenêtre de passage [début, fin) en minutes depuis minuit du jour de service :
   aller [S - T, S), retour [E, E + T), T = durée du sens affichée (route vide ou trafic moyen DiRIF). Un seul prix si
   la fenêtre tient dans une tranche, sinon une fourchette (min, max), jamais une moyenne. Le front fait le même calcul
   (frontend/src/data/tolls.ts, mêmes cas de test que tests/test_toll_publish.py).

Duplex A86 (sens de passage) : l'OSM porte une gare de péage par extrémité, sur la chaussée qui ENTRE dans le tunnel
(Rueil vers le sud, Vélizy vers le nord), et une à Vaucresson, sur la bretelle d'entrée venant de l'A13 (chemin
104030625, emprunté par les chemins R5 qui vont au nord comme au sud). Le sens vient des chemins OSM nommés
« Duplex A86 » que le trajet emprunte (autoroute à sens unique : sens de numérisation = sens de circulation) : latitude
de fin plus grande que celle de début = vers le nord (Rueil), sinon vers le sud (Vélizy). Sortie : l'extrémité si le
trajet emprunte un chemin « Duplex A86 » situé entièrement au-delà de la gare de Vaucresson dans ce sens, sinon
Vaucresson. Rien n'est deviné : un cas qui ne suit pas cette règle reste inconnu (`sens_requis`).

Systèmes fermés (APRR, Cofiroute) : 04g rend un ensemble de points, pas un ordre. Si la grille donne le même prix dans
les deux sens, l'ordre est sans effet. Sinon (la grille APRR lue ne publie parfois qu'un sens, par exemple Forges vers
Les Éprunes et pas l'inverse), l'ordre vient des extrémités du trajet : entrée = point le plus proche du départ ET
sortie = point le plus proche de l'arrivée ; si les deux conditions ne concordent pas, ou si le sens n'est pas dans la
grille, le péage reste inconnu.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from datetime import date, timedelta
from typing import Any

import pandas as pd

from starway import toll_tariffs as tt

CONTRACT = "tolls-1"
DAY_OFFSETS = (-1, 0, 1)  # veille, jour de service, lendemain
DUPLEX_WAY_NAME = "Duplex A86"
DUPLEX_VAUCRESSON_NODE = 1200571098  # seul nœud OSM de péage à Vaucresson (registre DUPLEX_VAUCRESSON)

STATUS_TEXTS = {
    "sans_peage": "aucun péage traversé",
    "non_trouve": "aucun tarif retenu dans la grille lue",
    "couple_indetermine": "gares d'entrée et de sortie non déterminées sur ce chemin",
    "sens_requis": "sens de passage dans le Duplex A86 non déterminé",
    "couple_asymetrique": "prix différents selon le sens, ordre de passage inconnu",
    "couple_absent": "trajet absent de la grille tarifaire",
    "tarif_absent": "tarif absent de la grille",
    "interdit": "interdit aux deux-roues",
    "jour_absent": "fenêtre de passage hors des jours publiés",
    "tranche_absente": "aucune tranche horaire ne couvre l'heure de passage",
    "retire_reutilisation": "tarif retiré : réutilisation non autorisée",
}

A14_NOTICE = ("Gratuité de l'A14 du lundi au vendredi annoncée à partir du 16/11/2026, pendant la fermeture partielle "
              "du tunnel de Saint-Cloud (courrier du Premier ministre du 21/10/2026, rapporté par la presse) : aucune "
              "grille ni aucun arrêté publié au 04/11/2026, modalités non confirmées par Sanef (une condition "
              "d'abonnement est évoquée). Non appliquée : le tarif affiché est celui de l'arrêté du 28/01/2026.")
NOTICES = {"SAPN_A14_MONTESSON": A14_NOTICE, "SAPN_A14_CHAMBOURCY": A14_NOTICE}


def duplex_ways(osm: dict[str, Any]) -> dict[int, dict[str, Any]]:
    """Chemins OSM « Duplex A86 » : identifiant -> sens (N ou S) et latitudes extrêmes."""
    out: dict[int, dict[str, Any]] = {}
    for w in osm["ways"]:
        if w.get("name") != DUPLEX_WAY_NAME:
            continue
        lats = [c[1] for c in w["coords"]]
        out[int(w["osm_id"])] = {"dir": "N" if lats[-1] > lats[0] else "S", "lat_min": min(lats),
                                 "lat_max": max(lats)}
    return out


def vaucresson_lat(osm: dict[str, Any]) -> float:
    return next(float(n["lat"]) for n in osm["nodes"] if int(n["osm_id"]) == DUPLEX_VAUCRESSON_NODE)


def duplex_passage(pids: Sequence[str], ways: Iterable[int], dways: dict[int, dict[str, Any]],
                   v_lat: float) -> tuple[str, str] | None:
    """Couple (entrée, sortie) du Duplex A86 (règle du module) ; None si le cas ne suit pas la règle."""
    used = [dways[w] for w in ways if w in dways]
    dirs = {u["dir"] for u in used}
    if len(dirs) != 1:
        return None
    d = dirs.pop()
    s = set(pids)
    r, v, z = "DUPLEX_RUEIL" in s, "DUPLEX_VAUCRESSON" in s, "DUPLEX_VELIZY" in s
    if d == "S":
        if z:
            return None  # la gare de Vélizy est sur la chaussée vers le nord
        entry = "DUPLEX_RUEIL" if r else ("DUPLEX_VAUCRESSON" if v else None)
        beyond = any(u["lat_max"] < v_lat for u in used)
        exit_ = "DUPLEX_VELIZY" if beyond else "DUPLEX_VAUCRESSON"
    else:
        if r:
            return None  # la gare de Rueil est sur la chaussée vers le sud
        entry = "DUPLEX_VELIZY" if z else ("DUPLEX_VAUCRESSON" if v else None)
        beyond = any(u["lat_min"] > v_lat for u in used)
        exit_ = "DUPLEX_RUEIL" if beyond else "DUPLEX_VAUCRESSON"
    if entry is None or entry == exit_:
        return None
    return entry, exit_


def _grid_prices(tariffs: pd.DataFrame, e: str, s: str) -> dict[tuple[int, str, str, str, str], float | None]:
    sel = tariffs[(tariffs["entree_point_id"] == e) & (tariffs["sortie_point_id"] == s)]
    return {(int(r.classe), str(r.tarif), str(r.type_jour), str(r.heure_debut), str(r.heure_fin)):
            (None if pd.isna(r.prix_ttc_eur) else float(r.prix_ttc_eur)) for r in sel.itertuples(index=False)}


def resolve_cell(nodes: Sequence[int], ways: Sequence[int], tariffs: pd.DataFrame, dways: dict[int, dict[str, Any]],
                 v_lat: float, index: dict[str, int],
                 ends: tuple[tuple[float, float], tuple[float, float]] | None = None,
                 coords: dict[str, tuple[float, float]] | None = None) -> list | dict:
    """Cellule `car_trip.toll` d'un sens : [] (aucun péage, sûr), [[entrée, sortie], ...] (indices de
    tolls.json.points), ou {"s": statut, "p": [indices des points en cause]}. `ends` : (départ, arrivée) du sens,
    (lon, lat) ; `coords` : position des points (`point_coords`) ; servent à ordonner un couple de système fermé
    dont la grille n'a pas le même prix dans les deux sens (`passage_order`)."""
    points = tt.points_from_osm_nodes(nodes)
    if not points:
        return []
    bad = [p for p in points if tt.POINTS_BY_ID[p].statut_tarif != tt.STATUT_OK]
    if bad:
        return {"s": tt.POINTS_BY_ID[bad[0]].statut_tarif, "p": [index[p] for p in bad]}
    by_sys: dict[str, list[str]] = {}
    for pid in points:
        by_sys.setdefault(tt.POINTS_BY_ID[pid].systeme, []).append(pid)
    out: list[list[int]] = []
    for systeme, pids in by_sys.items():
        kinds = {tt.POINTS_BY_ID[x].tarification for x in pids}
        if kinds == {"prix_fixe"}:
            out += [[index[x], index[x]] for x in pids]
            continue
        if systeme == "DUPLEX_A86":
            c = duplex_passage(pids, ways, dways, v_lat)
            if c is None:
                return {"s": "sens_requis", "p": [index[x] for x in pids]}
            out.append([index[c[0]], index[c[1]]])
            continue
        if len(pids) != 2:
            return {"s": "couple_indetermine", "p": [index[x] for x in pids]}
        a, b = pids
        ga, gb = _grid_prices(tariffs, a, b), _grid_prices(tariffs, b, a)
        if not ga and not gb:
            return {"s": "couple_absent", "p": [index[a], index[b]]}
        if ga == gb:  # même prix dans les deux sens : l'ordre de passage est sans effet
            out.append([index[a], index[b]])
            continue
        o = passage_order(a, b, ends, coords)
        if o is None:  # ordre de passage inconnu (04g rend un ensemble)
            return {"s": "couple_asymetrique" if ga and gb else "couple_absent", "p": [index[a], index[b]]}
        if not (ga if o == (a, b) else gb):
            return {"s": "couple_absent", "p": [index[o[0]], index[o[1]]]}
        out.append([index[o[0]], index[o[1]]])
    return out


def point_coords(osm: dict[str, Any]) -> dict[str, tuple[float, float]]:
    """Position de chaque point du registre : moyenne des nœuds OSM qui le portent (04i)."""
    by_node = {int(n["osm_id"]): (float(n["lon"]), float(n["lat"])) for n in osm["nodes"]}
    out: dict[str, tuple[float, float]] = {}
    for p in tt.POINTS:
        pts = [by_node[n] for n in p.osm_nodes if n in by_node]
        if pts:
            out[p.point_id] = (sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts))
    return out


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * k, a[1] - b[1])


def passage_order(a: str, b: str, ends: tuple[tuple[float, float], tuple[float, float]] | None,
                  coords: dict[str, tuple[float, float]] | None) -> tuple[str, str] | None:
    """Ordre de passage (entrée, sortie) de deux points d'un système fermé, d'après les extrémités du trajet : l'entrée
    est le point le plus proche du départ ET la sortie le plus proche de l'arrivée (à vol d'oiseau). Les deux
    conditions doivent concorder, sinon None (ordre inconnu, péage non chiffré)."""
    if not ends or not coords or a not in coords or b not in coords:
        return None
    start, end = ends
    pa, pb = coords[a], coords[b]
    if _dist(start, pa) < _dist(start, pb) and _dist(end, pb) < _dist(end, pa):
        return a, b
    if _dist(start, pb) < _dist(start, pa) and _dist(end, pa) < _dist(end, pb):
        return b, a
    return None


def trip_cells(dist: dict[str, dict], tariffs: pd.DataFrame, osm: dict[str, Any], index: dict[str, int],
               origin_pts: dict[str, tuple[float, float]], pole_pts: dict[str, tuple[float, float]],
               pole_ids: Sequence[str], directions: Sequence[str] = ("out", "ret")) -> tuple[dict[str, dict], dict]:
    """Cellules `car_trip.toll` de chaque commune (`dist` : sortie de `car_dist.load_corrected`) : ({insee: {sens:
    [cellule par pôle]}}, décompte des cellules par statut). Partagé par 06 et 06k, jamais deux copies de la règle."""
    dways, v_lat, coords = duplex_ways(osm), vaucresson_lat(osm), point_coords(osm)
    counts: dict[str, int] = {}
    out: dict[str, dict] = {}
    for insee, e in dist.items():
        here = origin_pts[insee]
        cells = {}
        for dr in directions:
            ends = [(here, pole_pts[pid]) if dr == "out" else (pole_pts[pid], here) for pid in pole_ids]
            cells[dr] = [None if d is None else resolve_cell(n, w, tariffs, dways, v_lat, index, en, coords)
                         for d, n, w, en in zip(e[f"dist_{dr}"], e[f"toll_nodes_{dr}"], e[f"toll_ways_{dr}"], ends,
                                                strict=True)]
            for c in cells[dr]:
                k = "no_route" if c is None else ("sans_peage" if c == [] else (
                    c["s"] if isinstance(c, dict) else "passages"))
                counts[k] = counts.get(k, 0) + 1
        out[insee] = cells
    return out, counts


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _credit_holder(source_id: str, fichier: str, exploitant: str) -> tuple[str, str] | None:
    """(titulaire, complément) du crédit d'un tarif, d'après la source de la ligne de grille ; None si inconnue.

    Accord de l'organisateur du hackathon du 09/11/2026 (D-060) : le producteur des tarifs est crédité dans la dataviz
    elle-même, à côté de chaque montant. TOLL04 : fichiers publiés par VINCI Autoroutes (Cofiroute en fait partie) ;
    TOLL03 : grille PDF de l'exploitant (Sanef) ou arrêté au Journal officiel (A14, tarif de SAPN) ; TOLL02 : APRR
    (copie data.gouv.fr sous Licence Ouverte : paternité et date).
    """
    if source_id == "TOLL04":
        return "© VINCI Autoroutes", ""
    if source_id == "TOLL03":
        if fichier.lower().endswith(".xml"):
            return exploitant, " (Journal officiel)"
        return f"© {exploitant}", ""
    if source_id == "TOLL02":
        return exploitant, ""
    return None


def point_credits(tariffs: pd.DataFrame) -> dict[str, str]:
    """Crédit affiché à côté d'un montant de péage, par point du registre (« tarif © VINCI Autoroutes 2026 »).

    Seuls les points qui ont au moins un prix (`statut` ok) en ont un. L'année est celle de la date d'effet des lignes
    de grille (`date_effet`), jamais saisie ici. Plusieurs sources pour un même point : crédits joints par une virgule.
    """
    exploitant = {p.point_id: p.exploitant for p in tt.POINTS}
    ok = tariffs[tariffs["statut"] == tt.STATUT_OK]
    found: dict[str, set[str]] = {}
    for r in ok.itertuples(index=False):
        for pid in {r.entree_point_id, r.sortie_point_id, r.point_id}:
            if not isinstance(pid, str) or pid not in exploitant:
                continue
            holder = _credit_holder(str(r.source_id), str(r.fichier_source), exploitant[pid])
            if holder is None or not isinstance(r.date_effet, str) or len(r.date_effet) < 4:
                continue
            found.setdefault(pid, set()).add(f"tarif {holder[0]} {r.date_effet[:4]}{holder[1]}")
    return {pid: ", ".join(sorted(v)) for pid, v in found.items()}


def build_tolls_json(tariffs: pd.DataFrame, service_date: date, processing_version: str,
                     sources: list[dict[str, Any]]) -> dict[str, Any]:
    """Fichier tolls.json : registre des points (ordre = indices de `car_trip.toll`) et grilles des trois jours."""
    points = []
    credits = point_credits(tariffs)
    for p in tt.POINTS:
        e: dict[str, Any] = {"id": p.point_id, "label": p.ouvrage, "road": p.autoroute, "operator": p.exploitant,
                             "system": p.systeme, "pricing": p.tarification, "status": p.statut_tarif}
        if p.statut_tarif != tt.STATUT_OK:
            e["reason"] = tt.clean(p.note or tt.SANEF_BLOCKED)
        if p.point_id in credits:
            e["credit"] = credits[p.point_id]  # toujours affiché à côté du montant (D-060)
        if p.point_id in NOTICES:
            e["notice"] = NOTICES[p.point_id]
        points.append(e)
    index = {p.point_id: i for i, p in enumerate(tt.POINTS)}
    withdrawn = {p.point_id for p in tt.POINTS if p.statut_tarif == tt.STATUT_RETIRE}
    days = {}
    for off in DAY_OFFSETS:
        d = service_date + timedelta(days=off)
        days[str(off)] = {"date": d.isoformat(), "weekday": tt.WEEKDAYS[d.weekday()],
                          "types": {s: tt.day_type(s, d) for s in sorted({p.systeme for p in tt.POINTS})}}
    grids: list[dict[str, Any]] = []
    ok = tariffs[tariffs["entree_point_id"].notna() & tariffs["sortie_point_id"].notna()]
    for (e, s, c, t), g in ok.groupby(["entree_point_id", "sortie_point_id", "classe", "tarif"], sort=True):
        if e not in index or s not in index or e in withdrawn or s in withdrawn:
            continue
        if (g["statut"] == tt.STATUT_INTERDIT).all():
            grids.append({"e": index[e], "s": index[s], "c": int(c), "t": t, "status": tt.STATUT_INTERDIT,
                          "reason": str(g["raison"].iloc[0])})
            continue
        g = g[g["statut"] == tt.STATUT_OK]
        if g.empty:
            continue
        systeme = str(g["systeme"].iloc[0])
        for off in DAY_OFFSETS:
            tj = days[str(off)]["types"][systeme]
            day = g[g["type_jour"] == tj]
            if day.empty:
                day = g[g["type_jour"] == "tous"]
            if day.empty:
                continue
            # Barrière à plein tarif (Dourdan A10) : une ligne par sens du tableau source pour le même point d'entrée et
            # de sortie ; deux lignes identiques (même tranche, même prix) ne font qu'une tranche. Deux prix différents
            # sur la même tranche resteraient : 07 les signale (grille trouée ou chevauchante).
            slots = sorted({(_minutes(r.heure_debut), _minutes(r.heure_fin), float(r.prix_ttc_eur))
                            for r in day.itertuples(index=False)})
            slots = [list(x) for x in slots]
            grids.append({"e": index[e], "s": index[s], "c": int(c), "t": t, "d": off, "slots": slots})
    return {"contract": CONTRACT, "processing_version": processing_version, "service_date": service_date.isoformat(),
            "days": days, "points": points, "grids": grids, "status_texts": STATUS_TEXTS,
            "classes": {"1": "véhicules légers (voitures)", "5": "motos, side-cars, trikes"},
            "tariffs": {"standard": "tarif standard (espèces, cartes)",
                        "telepeage": "tarif avec badge de télépéage (Duplex A86 seulement), affiché à part"},
            "rule": {"window_out": "aller : passage entre S - T et S (S = début du poste, T = durée affichée du sens)",
                     "window_ret": "retour : passage entre E et E + T (E = fin du poste)",
                     "price": "un prix si la fenêtre tient dans une tranche, sinon une fourchette (min, max), jamais "
                              "une moyenne ; une case inconnue rend le péage du sens inconnu",
                     "order": "système fermé (APRR, Cofiroute) : un couple n'est chiffré que si la grille donne le "
                              "même prix dans les deux sens (04g ne rend pas l'ordre de passage)"},
            "not_applied": ["remises et gratuités liées à des travaux (choix de l'équipe du 03/11/2026)",
                            "abonnements et réductions commerciales (badges, formules Duplex A86)", A14_NOTICE],
            "sources": sources, "decision": "D-029"}


def round_cents(x: float) -> float:
    """Au centime, demi-centime vers le haut (même règle et même calcul que le front)."""
    return math.floor(x * 100 + 0.5) / 100


def _slots_for(tj: dict[str, Any], e: int, s: int, c: int, t: str) -> tuple[dict[int, list], str | None]:
    """Grilles d'un couple par jour (décalage -> tranches), ou un statut si le couple est interdit ou absent."""
    gs = [g for g in tj["grids"] if g["e"] == e and g["s"] == s and g["c"] == c]
    if any(g.get("status") == tt.STATUT_INTERDIT for g in gs):
        return {}, tt.STATUT_INTERDIT
    if not gs:
        return {}, "couple_absent"
    gs = [g for g in gs if g["t"] == t]
    if not gs:
        return {}, "tarif_absent"
    return {int(g["d"]): g["slots"] for g in gs}, None


def window_prices(by_day: dict[int, list], lo: int, hi: int) -> tuple[list[float], str]:
    """Prix des tranches qui recoupent la fenêtre [lo, hi) (minutes depuis minuit du jour de service ; lo == hi :
    la tranche qui contient cet instant)."""
    if hi < lo:
        raise ValueError("fenêtre de passage inversée")
    found: set[float] = set()
    if lo == hi:
        d = math.floor(lo / 1440)
        if d not in by_day:
            return [], "jour_absent"
        x = lo - d * 1440
        found = {p for a, b, p in by_day[d] if a <= x < b}
    else:
        for d in range(math.floor(lo / 1440), math.floor((hi - 1) / 1440) + 1):
            if d not in by_day:
                return [], "jour_absent"
            a0, b0 = max(lo - d * 1440, 0), min(hi - d * 1440, 1440)
            found |= {p for a, b, p in by_day[d] if a < b0 and a0 < b}
    if not found:
        return [], "tranche_absente"
    return sorted(found), "ok" if len(found) == 1 else "fourchette"


def toll_leg(tj: dict[str, Any], cell: list | dict | None, classe: int, lo: int, hi: int,
             tarif: str = "standard") -> dict[str, Any]:
    """Péage d'un sens (EUR) : {min, max, status, items}. `cell` : cellule de `car_trip.toll` ; [] = 0 € sûr."""
    if cell is None:
        return {"min": None, "max": None, "status": "no_route", "items": []}
    if isinstance(cell, dict):
        return {"min": None, "max": None, "status": cell["s"], "points": cell["p"], "items": []}
    if not cell:
        return {"min": 0.0, "max": 0.0, "status": "sans_peage", "items": []}
    lo_sum = hi_sum = 0.0
    items = []
    for e, s in cell:
        by_day, st = _slots_for(tj, e, s, classe, tarif)
        if st is not None:
            return {"min": None, "max": None, "status": st, "points": [e, s], "items": items}
        prices, pst = window_prices(by_day, lo, hi)
        if pst not in ("ok", "fourchette"):
            return {"min": None, "max": None, "status": pst, "points": [e, s], "items": items}
        lo_sum += prices[0]
        hi_sum += prices[-1]
        items.append({"e": e, "s": s, "prices": prices})
    lo_r, hi_r = round_cents(lo_sum), round_cents(hi_sum)
    return {"min": lo_r, "max": hi_r, "status": "ok" if lo_r == hi_r else "fourchette", "items": items}
