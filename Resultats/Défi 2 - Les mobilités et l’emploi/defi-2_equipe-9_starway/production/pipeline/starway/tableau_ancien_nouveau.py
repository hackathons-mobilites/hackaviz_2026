"""Tableau ANCIEN / NOUVEAU des chiffres affichés par STARWAY, remis à Nicolas avant la décision de publier (plan, phase E, point 6).

Compare deux dossiers de données publiées (`frontend/public/data` ou une copie) et écrit un Markdown pour un lecteur non
spécialiste, plus un CSV de tous les écarts. Lecture seule. Aucun appel réseau, jamais PRIM.

Règles :
- aucun seuil : rien n'est qualifié (ni « bloquant », ni « faible ») ; tout est montré, trié par taille ;
- seuls trois signalements, objectifs : un chiffre de la visite qui change, une donnée absente d'un côté, une découverte
  contredite par Navitia ;
- les chiffres du ciel sont recalculés comme le site les affiche : table commune x commune (`od_walk*`) pour les modes qu'elle
  sert entièrement, `access/` pour les autres (vélo + TC, Vélib'). Mêmes règles que `frontend/src/data/od/compute.ts`,
  `sky.ts` et `accessibility.ts`.
Une valeur non calculable reste `None`, une donnée manquante reste `ABSENT` : jamais 0.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
import re
import statistics
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator, Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from starway import congestion as cg
from starway import od_export as ox


class _Absent:
    """Donnée qui n'existe pas dans ce dossier (distincte de `None` = publiée « non calculable »)."""

    def __repr__(self) -> str:
        return "absent"


ABSENT = _Absent()

# Scénarios de la visite « Léa » : miroir de `frontend/src/tour/tours/lea.tour.ts`. Le contrôle `controle_visite` confronte le
# résultat au texte résolu par le front (`tour.resolved.json`) : un script de visite qui change est signalé, jamais ignoré.
ORIGINE_VISITE = "78358"
VOISINE_VISITE = "78418"
BUDGET_VISITE = 60
POLE_PREUVE = "BE_1107_75108"
POLE_SOIR = "BE_1125"
METIER_VISITE = "S1X20"
JOUR_VISITE = "d09"
JOUR_SOIR = "d14"
# Nombres écrits en dur dans les phrases de la visite (réglages du scénario, pas des données) : par étape
JETONS_SCENARIO = {"acte1-ciel": {str(BUDGET_VISITE)}}

LIBELLES_DECOUVERTES = {"eclipse": "Éclipse (horaires décalés)", "territorial_gap": "Écart entre voisines",
                        "bike_gain": "Gain du vélo + TC", "late_return": "Retour tardif"}
INDICATEURS_DECOUVERTES = {"jobs": "postes atteints", "jobs_ref": "postes atteints (référence)", "jobs_delta": "écart de postes",
                           "poles_delta": "écart d'étoiles"}
CAUSE_NAVITIA = "navitia_contradicted"
CONTRADICTION = "contradicted"


# --------------------------------------------------------------------------- lignes du tableau
@dataclass(frozen=True, slots=True)
class Ligne:
    """Un chiffre comparé. `ancien` et `nouveau` : valeur, `None` (non calculable) ou `ABSENT`."""

    categorie: str
    cle: str
    libelle: str
    unite: str
    ancien: Any
    nouveau: Any
    etape: str = ""
    oral_ancien: str | None = None
    oral_nouveau: str | None = None

    @property
    def identique(self) -> bool:
        return _egaux(self.ancien, self.nouveau)

    @property
    def absent_un_cote(self) -> bool:
        return not self.identique and (_manque(self.ancien) or _manque(self.nouveau))

    @property
    def numeriques(self) -> bool:
        return _est_nombre(self.ancien) and _est_nombre(self.nouveau)

    @property
    def ecart(self) -> float | None:
        return self.nouveau - self.ancien if self.numeriques else None

    @property
    def pct(self) -> float | None:
        if not self.numeriques or self.ancien == 0:
            return None
        return 100 * (self.nouveau - self.ancien) / abs(self.ancien)

    @property
    def signal(self) -> str:
        if self.identique:
            return ""
        parts: list[str] = []
        if self.categorie == "visite":
            parts.append("chiffre de la visite qui change")
        if self.absent_un_cote:
            parts.append("donnée absente d'un côté")
        return " ; ".join(parts)


def _manque(v: Any) -> bool:
    return v is None or v is ABSENT


def _est_nombre(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool)


def _egaux(a: Any, b: Any) -> bool:
    if a is ABSENT or b is ABSENT:
        return a is b
    if a is None or b is None:
        return a is b
    return a == b


def cle_tri(ligne: Ligne) -> tuple:
    """Taille : données absentes d'un côté, puis ancien à 0 (pourcentage impossible), puis % décroissant, puis texte."""
    if ligne.absent_un_cote:
        return (0, 0.0, ligne.cle)
    if ligne.numeriques:
        if ligne.pct is None:
            return (1, -abs(ligne.ecart or 0), ligne.cle)
        return (2, -abs(ligne.pct), -abs(ligne.ecart or 0), ligne.cle)
    return (3, 0.0, ligne.cle)


def ecarts_tries(lignes: Iterable[Ligne]) -> list[Ligne]:
    return sorted((x for x in lignes if not x.identique), key=cle_tri)


# --------------------------------------------------------------------------- mise en forme
def fr_nombre(v: float) -> str:
    if isinstance(v, bool):
        return "oui" if v else "non"
    if isinstance(v, int) or float(v).is_integer():
        return f"{int(v):,}".replace(",", " ")
    return f"{v:,.1f}".replace(",", " ").replace(".", ",")


def fr_valeur(v: Any) -> str:
    if v is ABSENT:
        return "absent"
    if v is None:
        return "non calculable"
    if isinstance(v, bool):
        return "oui" if v else "non"
    if _est_nombre(v):
        return fr_nombre(v)
    return str(v).replace("|", "/").replace("\n", " ")


def fr_ecart(ligne: Ligne) -> str:
    if ligne.identique:
        return "0"
    if ligne.ecart is None:
        return "n/c"
    return ("+" if ligne.ecart > 0 else "") + fr_nombre(ligne.ecart)


def fr_pct(ligne: Ligne) -> str:
    if ligne.identique:
        return "0 %"
    if ligne.pct is None:
        return "n/c"
    return f"{ligne.pct:+.1f} %".replace(".", ",")


# --------------------------------------------------------------------------- règles orales (miroir de frontend/src/data/oral.ts)
def arrondi_js(x: float) -> int:
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def _approx(arrondi: float, exact: float) -> str:
    return "près de " if arrondi > exact else "plus de " if arrondi < exact else ""


def _milliers(n: float) -> str:
    return f"{int(n):,}".replace(",", " ")


def oral_etoiles(n: int | None) -> str | None:
    if n is None or n < 0:
        return None
    return "aucune étoile" if n == 0 else "une étoile" if n == 1 else f"{n} étoiles"


def oral_postes(n: int | None) -> str | None:
    if n is None or n <= 0:
        return None
    if n >= 1_000_000:
        millions = arrondi_js(n / 100_000) / 10
        mot = "million" if millions < 2 else "millions"
        texte = f"{millions:.1f}".rstrip("0").rstrip(".").replace(".", ",")
        return f"{_approx(millions * 1_000_000, n)}{texte} {mot} de postes"
    pas = 10_000 if n >= 100_000 else 1_000
    arrondi = max(pas, arrondi_js(n / pas) * pas)
    return f"{_approx(arrondi, n)}{_milliers(arrondi)} postes"


def oral_personnes(n: int | None, ordre_de_grandeur: bool = False) -> str | None:
    if n is None or n <= 0:
        return None
    pas = 1_000 if n >= 10_000 else 100 if n >= 1_000 else 10
    arrondi = max(pas, arrondi_js(n / pas) * pas)
    prefixe = "environ " if ordre_de_grandeur else _approx(arrondi, n)
    return f"{prefixe}{_milliers(arrondi)}"


def oral_projets(n: int | None, masque: int) -> str | None:
    if n is None or n <= 0:
        return None
    if masque > 0:
        pas = 1_000 if n >= 10_000 else 100 if n >= 1_000 else 10
        return f"au moins {_milliers(max(pas, n // pas * pas))}"
    return oral_personnes(n)


def oral_euros(n: float | None) -> str | None:
    if n is None or n <= 0:
        return None
    return f"{_milliers(max(100, arrondi_js(n / 100) * 100))} euros"


def oral_heure(minutes: int | None) -> str | None:
    if minutes is None:
        return None
    h, m = divmod(minutes, 60)
    texte = f"{h} heure{'s' if h >= 2 else ''}"
    return f"{texte} {m}" if m else texte


def hhmm(texte: str) -> int:
    h, m = texte.split(":")
    return int(h) * 60 + int(m)


# --------------------------------------------------------------------------- lecture d'un dossier
def lire_json(chemin: Path) -> Any:
    """Contenu JSON, ou ABSENT si le fichier n'existe pas (jamais une valeur par défaut)."""
    if not chemin.exists():
        return ABSENT
    return json.loads(chemin.read_text(encoding="utf-8"))


def obtenir(obj: Any, *chemin: Any) -> Any:
    """Valeur au bout de `chemin` (clés ou indices), ABSENT dès qu'un maillon manque."""
    for pas in chemin:
        if isinstance(obj, Mapping) and pas in obj or isinstance(obj, list) and isinstance(pas, int) and -len(obj) <= pas < len(obj):
            obj = obj[pas]
        else:
            return ABSENT
    return obj


@dataclass
class Jeu:
    """Un dossier de données publiées."""

    racine: Path
    meta: Any = None
    poles: Any = None
    communes: Any = None
    insights: Any = None
    index: Any = None
    od_nom: str | None = None

    @classmethod
    def charger(cls, racine: Path) -> Jeu:
        jeu = cls(racine=racine)
        jeu.meta = lire_json(racine / "meta.json")
        jeu.poles = lire_json(racine / "poles.json")
        jeu.communes = lire_json(racine / "communes.json")
        jeu.insights = lire_json(racine / "insights.json")
        jeu.od_nom = dossier_od(jeu.meta)
        jeu.index = lire_json(racine / jeu.od_nom / "index.json") if jeu.od_nom else ABSENT
        return jeu

    def liste_poles(self) -> list[Mapping]:
        return self.poles if isinstance(self.poles, list) else []

    def liste_communes(self) -> list[Mapping]:
        return self.communes if isinstance(self.communes, list) else []

    def liste_insights(self) -> list[Mapping]:
        return self.insights if isinstance(self.insights, list) else []

    def jours(self) -> list[Mapping]:
        v = obtenir(self.meta, "day_types")
        return v if isinstance(v, list) else []

    def budgets(self) -> list[int]:
        v = obtenir(self.meta, "budgets")
        return [int(b) for b in v] if isinstance(v, list) else []

    def noms(self) -> dict[str, str]:
        return {c["insee"]: c.get("name", c["insee"]) for c in self.liste_communes()}


def dossier_od(meta: Any) -> str | None:
    """Dossier de la table commune x commune du réglage de marche par défaut (`odFolderFor` du front)."""
    defaut = obtenir(meta, "walk_settings", "default")
    reglages = obtenir(meta, "walk_settings", "settings")
    if defaut is ABSENT or not isinstance(reglages, list):
        return None
    reglage = next((s for s in reglages if s.get("id") == defaut), None)
    limite = reglage.get("leg_limit_m") if reglage else None
    return f"od_walk{limite}" if isinstance(limite, int) and limite > 0 else None


def lire_swod(chemin: Path) -> ox.ParsedFile | None:
    if not chemin.exists():
        return None
    brut = chemin.read_bytes()
    return ox.parse_file(gzip.decompress(brut) if brut[:2] == b"\x1f\x8b" else brut)


# --------------------------------------------------------------------------- portée d'une commune (ce que le site affiche)
NON_MESURE = {"not_computed", "origin_not_snapped"}  # raisons qui empêchent de conclure (`NOT_MEASURED` de compute.ts)


def statut_destination(aller: ox.Leg, retour: ox.Leg, budget: int) -> str:
    """Portage de `destStatus` (compute.ts) : accessible, out_only, none ou unknown."""
    if aller.minutes is None:
        return "unknown" if aller.reason in NON_MESURE else "none"
    if aller.minutes > budget:
        return "none"
    if retour.minutes is None:
        return "unknown" if retour.reason in NON_MESURE else "out_only"
    return "accessible" if retour.minutes <= budget else "out_only"


@dataclass(frozen=True)
class ParamsOd:
    """Ce qu'il faut pour rejouer la table commune x commune d'un dossier."""

    n: int
    postes: tuple[int, ...]
    pole_de: tuple[int | None, ...]
    lookback: int
    modes: dict[str, dict]  # id de mode (y compris car_traffic) -> définition de la section de table
    periodes: tuple[cg.Period, ...]
    origine_index: dict[str, int]

    @classmethod
    def depuis(cls, jeu: Jeu) -> ParamsOd | None:
        index = jeu.index
        if not isinstance(index, Mapping):
            return None
        modes: dict[str, dict] = {}
        for m in index.get("modes", []):
            cov = obtenir(index, "coverage", m["id"], "complete")
            if cov is True:
                modes[m["id"]] = m
        periodes_meta = obtenir(jeu.meta, "car_congestion", "periods")
        periodes: tuple[cg.Period, ...] = ()
        if isinstance(periodes_meta, list) and "car" in modes:
            modes[cg.MODE_ID] = modes["car"]
            periodes = tuple(cg.Period(p["id"], hhmm(p["start"]), hhmm(p["end"]), arrondi_js(p["index"] * 100)) for p in periodes_meta)
        communes = index["communes"]
        return cls(len(communes), tuple(index["jobs"]), tuple(index["pole_of"]), int(index["outbound_lookback_min"]), modes,
                   periodes, {c: i for i, c in enumerate(communes)})


def trafic(periodes: Sequence[cg.Period], sens: str, horloge: int, jambe: ox.Leg) -> ox.Leg:
    """Temps retenu par le mode `car_traffic` (`trafficLeg` du front) : avec l'indice s'il s'applique, sinon route vide."""
    if jambe.minutes is None:
        return jambe
    _, statut, minutes = cg.attach(sens, horloge, jambe.minutes, tuple(periodes))
    return ox.Leg(minutes, None, jambe.departure) if statut == cg.STATUS_OK and minutes is not None else jambe


def jambes(pf: ox.ParsedFile, y: int, mode: str, definition: Mapping, debut: int, fin: int, params: ParamsOd) -> tuple[ox.Leg, ox.Leg]:
    """Aller et retour de l'origine vers la destination `y` pour un poste debut-fin. Sans enregistrement : aucun trajet."""
    code = definition["code"]
    sans_trajet = ox.Leg(None, ox.SENTINELS[ox.SENTINEL_NO_TRIP])
    if definition["kind"] == "series":
        rec = pf.series.get(code, {}).get(y)
        if rec is None:
            return sans_trajet, sans_trajet
        return (ox.outbound(rec[0], pf.first, debut, pf.step, params.lookback, pf.max_trip),
                ox.inbound(rec[1], pf.first, fin, pf.step, pf.max_trip))
    rec = pf.scalars.get(code, {}).get(y)
    if rec is None:
        return sans_trajet, sans_trajet
    aller, retour = ox.scalar_leg(rec[0], pf.max_trip), ox.scalar_leg(rec[1], pf.max_trip)
    if mode == cg.MODE_ID:
        return trafic(params.periodes, "out", debut, aller), trafic(params.periodes, "ret", fin, retour)
    return aller, retour


def portee_od(pf: ox.ParsedFile, mode: str, definition: Mapping, debut: int, fin: int, budgets: Sequence[int],
              params: ParamsOd) -> dict[int, tuple[int, int]] | None:
    """Pour chaque budget : (étoiles allumées, postes atteints hors commune de départ). Table `computeOd` + `odPoleStatus`."""
    code = definition["code"]
    if code not in pf.series and code not in pf.scalars:
        return None
    atteints: dict[int, list[int]] = {b: [] for b in budgets}
    for y in range(params.n):
        if y == pf.origin:
            continue
        aller, retour = jambes(pf, y, mode, definition, debut, fin, params)
        for b in budgets:
            if statut_destination(aller, retour, b) == "accessible":
                atteints[b].append(y)
    sortie: dict[int, tuple[int, int]] = {}
    for b, ys in atteints.items():
        postes_pole: dict[int, int] = defaultdict(int)
        for y in ys:
            pole = params.pole_de[y]
            if pole is not None:
                postes_pole[pole] += params.postes[y]
        sortie[b] = (sum(1 for v in postes_pole.values() if v > 0), sum(params.postes[y] for y in ys))
    return sortie


def serie_access(access: Any, mode: str, jour: str, n_poles: int) -> tuple[list, list] | None:
    """Série (aller, retour) de `access/{insee}.json`, refusée si sa longueur n'est pas celle des astres (`guardSeries`)."""
    par_jour = obtenir(access, "modes", mode)
    if par_jour is ABSENT:
        return None
    serie = par_jour.get(jour) or par_jour.get("any")
    if not serie or len(serie.get("out", [])) != n_poles or len(serie.get("ret", [])) != n_poles:
        return None
    return serie["out"], serie["ret"]


def portee_access(access: Any, mode: str, jour: str, budgets: Sequence[int], postes: Sequence[int | None]) -> dict[int, tuple[int, int | None]] | None:
    """Pour chaque budget : (étoiles allumées aller ET retour, somme des postes des astres allumés). Base `access/`."""
    serie = serie_access(access, mode, jour, len(postes))
    if serie is None:
        return None
    out, ret = serie
    sortie: dict[int, tuple[int, int | None]] = {}
    for b in budgets:
        allumes = [i for i, (o, r) in enumerate(zip(out, ret, strict=True)) if o is not None and r is not None and o <= b and r <= b]
        valeurs = [postes[i] for i in allumes]
        sortie[b] = (len(allumes), None if any(v is None for v in valeurs) else sum(v for v in valeurs if v is not None))
    return sortie


CleScenario = tuple[str, str, int]


@dataclass
class Portees:
    """Résultat d'une commune : (mode, jour, budget) -> (étoiles, postes). Un scénario non calculable n'a pas de clé."""

    insee: str
    valeurs: dict[CleScenario, tuple[int, int | None]] = field(default_factory=dict)


_CONTEXTES: dict[str, tuple[Jeu, ParamsOd | None]] = {}


def _contexte(racine: Path) -> tuple[Jeu, ParamsOd | None]:
    cle = str(racine)
    if cle not in _CONTEXTES:
        jeu = Jeu.charger(racine)
        _CONTEXTES[cle] = (jeu, ParamsOd.depuis(jeu))
    return _CONTEXTES[cle]


def calcul_commune(args: tuple[Path, str]) -> Portees:
    """Portée d'une commune, par scénario, comme le site la calcule (une table commune x commune si elle sert ce mode)."""
    racine, insee = args
    jeu, params = _contexte(racine)
    res = Portees(insee)
    modes = obtenir(jeu.meta, "modes")
    if not isinstance(modes, list):
        return res
    budgets = jeu.budgets()
    jours = jeu.jours()
    postes_poles = [p.get("jobs") for p in jeu.liste_poles()]
    access = lire_json(racine / "access" / f"{insee}.json")
    pf = lire_swod(racine / jeu.od_nom / "o" / f"{insee}.bin") if params and jeu.od_nom and insee in params.origine_index else None
    for m in modes:
        mode = m["id"]
        definition = params.modes.get(mode) if params else None
        if definition is not None:  # le site lit ce mode dans la table : sans fichier d'origine, rien (jamais `access/` en repli)
            if pf is None:
                continue
            dependant = definition["kind"] == "series" or mode == cg.MODE_ID
            for d in jours if dependant else [{"id": "any", "start": "00:00", "end": "00:00"}]:
                sortie = portee_od(pf, mode, definition, hhmm(d["start"]), hhmm(d["end"]), budgets, params)
                if sortie is not None:
                    for b, v in sortie.items():
                        res.valeurs[(mode, d["id"], b)] = v
            continue
        par_jour = obtenir(access, "modes", mode)
        if par_jour is ABSENT:
            continue
        for jour in sorted(par_jour):
            sortie_a = portee_access(access, mode, jour, budgets, postes_poles)
            if sortie_a is not None:
                for b, v in sortie_a.items():
                    res.valeurs[(mode, jour, b)] = v
    return res


def calcul_toutes(racine: Path, communes: Sequence[str], workers: int) -> dict[str, Portees]:
    """Portées de toutes les communes demandées d'un dossier."""
    if workers <= 1:
        return {c: calcul_commune((racine, c)) for c in communes}
    with ProcessPoolExecutor(max_workers=workers) as ex:
        return {p.insee: p for p in ex.map(calcul_commune, [(racine, c) for c in communes], chunksize=16)}


# --------------------------------------------------------------------------- 2.1 compteurs globaux
def _longueur(v: Any) -> Any:
    return len(v) if isinstance(v, list | dict) else ABSENT


def _couverture(meta: Any, mode: str, communes: Any) -> Any:
    """Communes où un mode est publié. Contrat de `meta.mode_coverage` (`matrix_io.partial_coverage`) : un mode absent du
    dictionnaire est publié pour toutes les communes de départ ; sans dictionnaire, la donnée est absente."""
    cov = obtenir(meta, "mode_coverage")
    if not isinstance(cov, Mapping):
        return ABSENT
    return _longueur(cov[mode]) if mode in cov else _longueur(communes)


def _population(communes: Sequence[Mapping]) -> Any:
    if not communes:
        return ABSENT
    arrondissements = any(re.fullmatch(r"751\d\d", c["insee"]) for c in communes)
    total = 0
    for c in communes:
        if arrondissements and c["insee"] == "75056":
            continue
        if c.get("population") is None:
            return None
        total += c["population"]
    return total


def _somme(valeurs: Iterable[Any]) -> Any:
    liste = list(valeurs)
    if not liste:
        return ABSENT
    return None if any(v is None for v in liste) else sum(liste)


def _lire_compteurs(jeu: Jeu) -> dict[str, tuple[str, str, Any]]:
    """Compteurs d'un dossier : clé -> (libellé, unité, valeur)."""
    meta = jeu.meta
    insights = jeu.liste_insights()
    sources = lire_json(jeu.racine / "sources.json")
    bmo = lire_json(jeu.racine / "bmo.json")
    peages = lire_json(jeu.racine / "tolls.json")
    territoire = lire_json(jeu.racine / "territoire.json")
    service = lire_json(jeu.racine / "service_public.json")
    c: dict[str, tuple[str, str, Any]] = {
        "dataset_id": ("Identifiant du jeu de données", "", obtenir(meta, "dataset_id")),
        "service_date": ("Date de service des transports (journée calculée)", "", obtenir(meta, "service_date")),
        "gtfs": ("Date de téléchargement des horaires", "", obtenir(meta, "gtfs_downloaded_at")),
        "communes": ("Communes de départ proposées", "communes", _longueur(jeu.communes)),
        "astres": ("Astres (étoiles) du ciel", "astres", _longueur(jeu.poles)),
        "postes_astres": ("Postes salariés (INSEE), somme des astres", "postes",
                          _somme(p.get("jobs") for p in jeu.liste_poles())),
        "postes_table": ("Postes salariés (INSEE), table commune x commune", "postes", _somme(jeu.index["jobs"]) if isinstance(jeu.index, Mapping) else ABSENT),
        "population": ("Population d'Île-de-France", "habitants", _population(jeu.liste_communes())),
        "communes_access": ("Communes avec un ciel calculé", "communes", _longueur(obtenir(meta, "access_communes"))),
        "communes_itin": ("Communes avec le détail des trajets", "communes", _longueur(obtenir(meta, "itineraries_communes"))),
        "communes_velo_tc": ("Communes avec le vélo + TC", "communes", _couverture(meta, "bike_transit", jeu.communes)),
        "communes_velib": ("Communes avec Vélib'", "communes", _couverture(meta, "velib", jeu.communes)),
        "stations_velib": ("Stations Vélib' prises en compte", "stations", obtenir(meta, "velib", "stations")),
        "decouvertes": ("Découvertes publiées", "découvertes", _longueur(jeu.insights)),
        "decouvertes_ecartees": ("Découvertes écartées", "découvertes", _longueur(obtenir(meta, "insights", "excluded"))),
        "sources": ("Sources de données citées", "sources", _longueur(sources)),
        "bassins_bmo": ("Bassins d'emploi avec projets de recrutement", "bassins", _longueur(obtenir(bmo, "bassins"))),
        "points_peage": ("Points de péage", "points", _longueur(obtenir(peages, "points"))),
        "communes_territoire": ("Communes avec données de territoire", "communes", _longueur(obtenir(territoire, "communes"))),
        "communes_service_public": ("Communes avec offres du service public", "communes", _longueur(obtenir(service, "communes"))),
    }
    for k, n in Counter(str(i.get("kind")) for i in insights).items():
        c[f"decouvertes_{k}"] = (f"Découvertes : {LIBELLES_DECOUVERTES.get(k, k)}", "découvertes", n)
    for k, n in Counter(str(i.get("crosscheck")) for i in insights).items():
        c[f"recoupement_{k}"] = (f"Découvertes au statut de recoupement « {k} »", "découvertes", n)
    return c


def compteurs_globaux(a: Jeu, b: Jeu) -> list[Ligne]:
    ca, cb = _lire_compteurs(a), _lire_compteurs(b)
    lignes: list[Ligne] = []
    for cle in sorted(set(ca) | set(cb)):
        ref = cb.get(cle) or ca[cle]
        lignes.append(Ligne("compteurs", f"compteur:{cle}", ref[0], ref[1], ca.get(cle, (0, 0, ABSENT))[2], cb.get(cle, (0, 0, ABSENT))[2]))
    return lignes


# --------------------------------------------------------------------------- 2.2 visite guidée
@dataclass(frozen=True)
class ChiffreVisite:
    cle: str
    etape: str
    libelle: str
    unite: str
    valeur: Any
    oral: str | None = None


def _jour(jeu: Jeu, jour: str) -> Mapping | None:
    return next((d for d in jeu.jours() if d.get("id") == jour), None)


def _mesure_visite(jeu: Jeu, params: ParamsOd | None, insee: str, mode: str, jour: str) -> tuple[int, int | None] | None:
    d = _jour(jeu, jour)
    if params is None or d is None or mode not in params.modes or insee not in params.origine_index or jeu.od_nom is None:
        return None
    pf = lire_swod(jeu.racine / jeu.od_nom / "o" / f"{insee}.bin")
    if pf is None:
        return None
    res = portee_od(pf, mode, params.modes[mode], hhmm(d["start"]), hhmm(d["end"]), [BUDGET_VISITE], params)
    return res[BUDGET_VISITE] if res else None


def _trajet_visite(jeu: Jeu, params: ParamsOd | None, insee: str, dest: str, jour: str) -> tuple[ox.Leg, ox.Leg] | None:
    d = _jour(jeu, jour)
    if params is None or d is None or "transit" not in params.modes or dest not in params.origine_index or jeu.od_nom is None:
        return None
    pf = lire_swod(jeu.racine / jeu.od_nom / "o" / f"{insee}.bin")
    if pf is None:
        return None
    return jambes(pf, params.origine_index[dest], "transit", params.modes["transit"], hhmm(d["start"]), hhmm(d["end"]), params)


def _gain_velo(jeu: Jeu, insee: str, jour: str) -> tuple[Any, Any]:
    """Astres gagnés et perdus par le vélo + TC face aux TC (base `access/`, `offlineGain`) : allumés d'un côté, calculés et éteints de l'autre."""
    access = lire_json(jeu.racine / "access" / f"{insee}.json")
    n = len(jeu.liste_poles())
    velo = serie_access(access, "bike_transit", jour, n)
    tc = serie_access(access, "transit", jour, n)
    if velo is None or tc is None:
        return None, None
    allume = lambda s, i: s[0][i] is not None and s[1][i] is not None and s[0][i] <= BUDGET_VISITE and s[1][i] <= BUDGET_VISITE
    gagnes = sum(1 for i in range(n) if allume(velo, i) and not allume(tc, i))
    perdus = sum(1 for i in range(n) if allume(tc, i) and not allume(velo, i))
    return gagnes, perdus


def chiffres_visite(jeu: Jeu, params: ParamsOd | None = None) -> list[ChiffreVisite]:
    """Chaque chiffre que la visite prononce, recalculé depuis le dossier, avec sa forme orale."""
    params = params if params is not None else ParamsOd.depuis(jeu)
    noms = jeu.noms()
    nom = lambda c: noms.get(c, c)
    sortie: list[ChiffreVisite] = []

    def ajoute(cle: str, etape: str, libelle: str, unite: str, valeur: Any, oral: str | None = None) -> None:
        sortie.append(ChiffreVisite(cle, etape, libelle, unite, valeur, oral))

    nom_o, nom_v = nom(ORIGINE_VISITE), nom(VOISINE_VISITE)
    ciel = _mesure_visite(jeu, params, ORIGINE_VISITE, "transit", JOUR_VISITE)
    etoiles, postes = ciel if ciel else (None, None)
    ajoute("ciel.etoiles", "acte1-ciel", f"{nom_o}, 9h-17h, {BUDGET_VISITE} min : étoiles allumées", "étoiles", etoiles, oral_etoiles(etoiles))
    n_poles = _longueur(jeu.poles)
    ajoute("ciel.total", "acte1-ciel", "Nombre d'astres du ciel", "astres", n_poles, None if n_poles is ABSENT else str(n_poles))
    ajoute("ciel.postes", "acte1-ciel", f"{nom_o} : postes à sa portée, hors sa commune", "postes", postes, oral_postes(postes))

    d09, d14 = _jour(jeu, JOUR_VISITE), _jour(jeu, JOUR_SOIR)
    pole_preuve = next((p for p in jeu.liste_poles() if p.get("id") == POLE_PREUVE), None)
    dest_preuve = pole_preuve["communes"][0] if pole_preuve and len(pole_preuve.get("communes", [])) == 1 else None
    preuve = _trajet_visite(jeu, params, ORIGINE_VISITE, dest_preuve, JOUR_VISITE) if dest_preuve else None
    depart = preuve[0].departure if preuve else None
    ajoute("preuve.depart", "acte1-preuve", f"{nom_o} vers Paris 8e : heure de départ", "heure", _heure(depart), oral_heure(depart))
    ajoute("preuve.aller", "acte1-preuve", "Paris 8e : durée de l'aller", "min", preuve[0].minutes if preuve else None, _txt(preuve[0].minutes if preuve else None))
    ajoute("preuve.retour", "acte1-preuve", "Paris 8e : durée du retour", "min", preuve[1].minutes if preuve else None, _txt(preuve[1].minutes if preuve else None))
    if d09:
        ajoute("preuve.debut", "acte1-preuve", "Début du poste en 9h-17h", "heure", d09["start"], oral_heure(hhmm(d09["start"])))
        ajoute("preuve.fin", "acte1-preuve", "Fin du poste en 9h-17h", "heure", d09["end"], oral_heure(hhmm(d09["end"])))
    verdict = _atteint(preuve, BUDGET_VISITE)
    ajoute("preuve.atteint", "acte1-preuve", "Paris 8e : atteint aller et retour", "", verdict)
    contexte = lire_json(jeu.racine / "context" / f"{ORIGINE_VISITE}.json")
    flux = obtenir(contexte, "flows_to_poles", "poles", POLE_PREUVE)
    n_flux, ordre = obtenir(flux, "flux"), obtenir(flux, "precision") == "order_of_magnitude"
    ajoute("preuve.flux", "acte1-preuve", f"Actifs de {nom_o} qui travaillent à Paris 8e", "personnes", n_flux,
           oral_personnes(n_flux if isinstance(n_flux, int) else None, ordre))

    bmo = lire_json(jeu.racine / "bmo.json")
    bmo_m = lire_json(jeu.racine / "bmo_metiers.json")
    metier = next((m for m in obtenir(bmo_m, "metiers") or [] if m.get("code") == METIER_VISITE), None) if bmo_m is not ABSENT else None
    bassin = obtenir(pole_preuve, "bassin", "code") if pole_preuve else ABSENT
    famille = metier.get("family") if metier else None
    case = obtenir(bmo, "bassins", bassin, "families", famille, "met") if famille and bassin is not ABSENT else ABSENT
    n_proj = obtenir(case, "n")
    masques = obtenir(case, "masked")
    ajoute("bmo.projets", "acte2-recrutement", "Projets de recrutement, famille de métiers de Léa, bassin T1 Paris", "projets", n_proj,
           oral_projets(n_proj if isinstance(n_proj, int) else None, masques if isinstance(masques, int) else 0))
    annee = obtenir(bmo, "year")
    ajoute("bmo.annee", "acte2-recrutement", "Année des projets de recrutement", "", ABSENT if annee is ABSENT else str(annee), None if annee is ABSENT else str(annee))

    voisine = _mesure_visite(jeu, params, VOISINE_VISITE, "transit", JOUR_VISITE)
    et_v, po_v = voisine if voisine else (None, None)
    ajoute("voisine.etoiles", "acte3-horizons", f"{nom_v}, 9h-17h, {BUDGET_VISITE} min : étoiles allumées", "étoiles", et_v, oral_etoiles(et_v))
    ajoute("voisine.postes", "acte3-horizons", f"{nom_v} : postes à sa portée", "postes", po_v, oral_postes(po_v))

    for cle, insee in (("origine", ORIGINE_VISITE), ("voisine", VOISINE_VISITE)):
        bloc = obtenir(lire_json(jeu.racine / "context" / f"{insee}.json"), "income")
        statut = obtenir(bloc, "median_status")
        statut = obtenir(bloc, "status") if statut is ABSENT else statut
        v = obtenir(bloc, "median_living_standard_eur") if statut == "ok" else None
        ajoute(f"halo.{cle}", "halo", f"Niveau de vie médian à {nom(insee)}", "euros", v, oral_euros(v if isinstance(v, int | float) else None))

    if d14:
        ajoute("soir.debut", "acte2-eclipse", "Début du poste en 14h-22h", "heure", d14["start"], oral_heure(hhmm(d14["start"])))
        ajoute("soir.fin", "acte2-eclipse", "Fin du poste en 14h-22h", "heure", d14["end"], oral_heure(hhmm(d14["end"])))
        ajoute("soir.fin.pole", "acte2-pole", "Fin du poste en 14h-22h (reprise dans la phrase de Poissy)", "heure", d14["end"], oral_heure(hhmm(d14["end"])))
    pole_soir = next((p for p in jeu.liste_poles() if p.get("id") == POLE_SOIR), None)
    ancrage = pole_soir.get("name_short_insee") if pole_soir else None
    soir = _trajet_visite(jeu, params, ORIGINE_VISITE, ancrage, JOUR_SOIR) if ancrage else None
    ajoute("soir.aller", "acte2-pole", "Seine-Aval (Poissy), 14h-22h : durée de l'aller", "min", soir[0].minutes if soir else None, _txt(soir[0].minutes if soir else None))
    ajoute("soir.retour", "acte2-pole", "Seine-Aval (Poissy), 14h-22h : durée du retour", "min", soir[1].minutes if soir else None, _txt(soir[1].minutes if soir else None))
    ajoute("soir.atteint", "acte2-pole", "Poissy : atteinte aller et retour le soir", "", _atteint(soir, BUDGET_VISITE))

    voiture = _mesure_visite(jeu, params, ORIGINE_VISITE, cg.MODE_ID, JOUR_SOIR)
    et_c, po_c = voiture if voiture else (None, None)
    ajoute("voiture.etoiles", "acte4-voiture", "Voiture avec le trafic moyen, 14h-22h : étoiles allumées", "étoiles", et_c, oral_etoiles(et_c))
    ajoute("voiture.postes", "acte4-voiture", "Voiture avec le trafic moyen : postes à sa portée", "postes", po_c, oral_postes(po_c))

    gagnes, perdus = _gain_velo(jeu, ORIGINE_VISITE, JOUR_SOIR)
    ajoute("velo.gagnes", "acte4-velo", "Vélo + TC, 14h-22h : astres gagnés face aux TC seuls", "astres", gagnes)
    ajoute("velo.perdus", "acte4-velo", "Vélo + TC, 14h-22h : astres perdus face aux TC seuls", "astres", perdus)
    return sortie


def _txt(v: Any) -> str | None:
    return None if v is None else str(v)


def _heure(minutes: int | None) -> str | None:
    return None if minutes is None else f"{minutes // 60:02d}:{minutes % 60:02d}"


def _atteint(trajet: tuple[ox.Leg, ox.Leg] | None, budget: int) -> bool | None:
    if trajet is None:
        return None
    return statut_destination(trajet[0], trajet[1], budget) == "accessible"


# Rappels écrits dans le plan (phase E, point 6), recopiés de docs/decisions.md, D-046 : jamais recalculés ici
RAPPEL_31_LIGNES = ("Le flux du premier calcul (téléchargé le 02/11) n'avait aucune course le 17/11 pour les 31 lignes de bus de l'exploitant "
                    "Plaine Saint-Denis (calendrier arrêté au 05/11, D-046) ; `docs/limites.md` ne le dit pas. La relance sur le flux du 06/11 (PR 81) "
                    "doit le lever. Cet outil ne le vérifie pas : c'est le contrôle P0 de `07` (`07r_gtfs_reference_day.py`).")
RAPPEL_ECLIPSE = "Le recoupement Navitia de la PR 74 avait montré un retour de 76 min (STARWAY) contre 46 (Navitia) pour Maisons-Laffitte vers Paris 8e en 14h-22h (D-046)."
DECOUVERTE_SUIVIE = "eclipse_01"


def lignes_suivies(a: Jeu, b: Jeu, params_a: ParamsOd | None, params_b: ParamsOd | None) -> list[Ligne]:
    """Maisons-Laffitte vers Paris 8e en 14h-22h, le trajet décisif de `eclipse_01` : durées et verdict des deux côtés."""
    pole = next((p for p in (b.liste_poles() or a.liste_poles()) if p.get("id") == POLE_PREUVE), None)
    dest = pole["communes"][0] if pole and len(pole.get("communes", [])) == 1 else None
    if dest is None:
        return []
    ta = _trajet_visite(a, params_a, ORIGINE_VISITE, dest, JOUR_SOIR)
    tb = _trajet_visite(b, params_b, ORIGINE_VISITE, dest, JOUR_SOIR)
    base = f"Maisons-Laffitte vers Paris 8e, 14h-22h, {BUDGET_VISITE} min"
    return [Ligne("suivi", "suivi:aller", f"{base} : aller", "min", ta[0].minutes if ta else ABSENT, tb[0].minutes if tb else ABSENT),
            Ligne("suivi", "suivi:retour", f"{base} : retour", "min", ta[1].minutes if ta else ABSENT, tb[1].minutes if tb else ABSENT),
            Ligne("suivi", "suivi:atteint", f"{base} : atteint aller et retour", "", _atteint(ta, BUDGET_VISITE) if ta else ABSENT, _atteint(tb, BUDGET_VISITE) if tb else ABSENT)]


def etat_eclipse_suivie(a: Jeu, b: Jeu, navitia: ResultatsNavitia) -> str:
    """La découverte `eclipse_01` de l'ancien jeu tient-elle ? Présence du même scénario dans le nouveau, et verdict Navitia s'il est fourni."""
    x = next((i for i in a.liste_insights() if i.get("id") == DECOUVERTE_SUIVIE), None)
    if x is None:
        return f"`{DECOUVERTE_SUIVIE}` n'existe pas dans l'ancien jeu."
    cle = cle_decouverte(x)
    y = next((i for i in b.liste_insights() if cle_decouverte(i) == cle), None)
    titre = titre_decouverte(x, {**a.noms(), **b.noms()})
    presence = f"{titre} : disparue du nouveau jeu." if y is None else f"{titre} : toujours publiée (rang {y.get('rank')}, identifiant {y.get('id')})."
    verdicts = [v for v in navitia.verdicts if cle_decouverte(v) == cle]
    if not verdicts:
        return f"{presence} Verdict Navitia sur le nouveau calcul : non fourni."
    return f"{presence} Verdict Navitia sur le nouveau calcul : {', '.join(str(v.get('verdict')) for v in verdicts)}."


def lignes_visite(a: Sequence[ChiffreVisite], b: Sequence[ChiffreVisite]) -> list[Ligne]:
    pa, pb = {c.cle: c for c in a}, {c.cle: c for c in b}
    lignes = []
    for cle in [c.cle for c in a] + [c.cle for c in b if c.cle not in pa]:
        ca, cb = pa.get(cle), pb.get(cle)
        ref = cb or ca
        assert ref is not None
        lignes.append(Ligne("visite", f"visite:{cle}", ref.libelle, ref.unite, ca.valeur if ca else ABSENT, cb.valeur if cb else ABSENT,
                            ref.etape, ca.oral if ca else None, cb.oral if cb else None))
    return lignes


JETON = re.compile(r"(?<![\w,])\d+(?: \d{3})*(?:,\d+)?(?!\w)")


def _normalise(texte: str) -> str:
    return texte.replace(" ", " ").replace(" ", " ")


def controle_visite(chiffres: Sequence[ChiffreVisite], resolu: Any) -> list[str]:
    """Confronte les chiffres recalculés au texte résolu par le front (`tour.resolved.json` du même dossier). Rend les écarts."""
    etapes = obtenir(resolu, "steps")
    if not isinstance(etapes, list):
        return ["texte résolu de la visite introuvable : contrôle non fait"]
    textes = {e["id"]: _normalise(e.get("text", "")) for e in etapes}
    problemes: list[str] = []
    for c in chiffres:
        if c.oral is None:
            continue
        if c.etape not in textes:
            problemes.append(f"étape {c.etape} absente du texte résolu ({c.cle})")
        elif _normalise(c.oral) not in textes[c.etape]:
            problemes.append(f"étape {c.etape} : « {c.oral} » introuvable dans le texte résolu ({c.cle})")
    connus: dict[str, set[str]] = defaultdict(set)
    for c in chiffres:
        if c.oral:
            connus[c.etape].update(JETON.findall(_normalise(c.oral)))
    for etape, jetons in JETONS_SCENARIO.items():
        connus[etape].update(jetons)
    for etape, texte in textes.items():
        for jeton in JETON.findall(texte):
            if jeton not in connus[etape]:
                problemes.append(f"étape {etape} : nombre « {jeton} » prononcé mais non suivi par cet outil")
    return problemes


# --------------------------------------------------------------------------- 2.3 découvertes
def cle_decouverte(item: Mapping) -> tuple:
    """Identité d'une découverte = son scénario (les identifiants `eclipse_01` suivent le rang, pas le scénario)."""
    s = item.get("scenario") or {}
    return (str(item.get("kind")), s.get("o"), s.get("d"), s.get("b"), s.get("m"), s.get("vs"), s.get("compare_day"))


def titre_decouverte(item: Mapping, noms: Mapping[str, str]) -> str:
    s = item.get("scenario") or {}
    texte = f"{LIBELLES_DECOUVERTES.get(str(item.get('kind')), item.get('kind'))} : {noms.get(s.get('o'), s.get('o'))}"
    if s.get("vs"):
        texte += f" contre {noms.get(s['vs'], s['vs'])}"
    texte += f", {s.get('d')}, {s.get('b')} min, {s.get('m')}"
    if s.get("compare_day"):
        texte += f" (comparé à {s['compare_day']})"
    return texte


@dataclass(frozen=True)
class BilanDecouvertes:
    lignes: list[Ligne]
    inchangees: int
    modifiees: int
    disparues: list[str]
    apparues: list[str]


def comparer_decouvertes(a: Jeu, b: Jeu) -> BilanDecouvertes:
    ia = {cle_decouverte(i): i for i in a.liste_insights()}
    ib = {cle_decouverte(i): i for i in b.liste_insights()}
    noms = {**a.noms(), **b.noms()}
    lignes: list[Ligne] = []
    inchangees = modifiees = 0
    disparues, apparues = [], []
    for cle in sorted(set(ia) | set(ib), key=str):
        x, y = ia.get(cle), ib.get(cle)
        ref = y or x
        assert ref is not None
        titre = titre_decouverte(ref, noms)
        base = f"decouverte:{'|'.join(str(k) for k in cle)}"
        if x is None:
            apparues.append(titre)
            lignes.append(Ligne("decouvertes", f"{base}:presence", f"{titre} : présence", "", ABSENT, "présente"))
        elif y is None:
            disparues.append(titre)
            lignes.append(Ligne("decouvertes", f"{base}:presence", f"{titre} : présence", "", "présente", ABSENT))
        metriques = sorted(set((x or {}).get("metric") or {}) | set((y or {}).get("metric") or {}))
        locales: list[Ligne] = []
        for m in metriques:
            va = obtenir(x, "metric", m) if x else ABSENT
            vb = obtenir(y, "metric", m) if y else ABSENT
            locales.append(Ligne("decouvertes", f"{base}:{m}", f"{titre} : {INDICATEURS_DECOUVERTES.get(m, m)}",
                                 "postes" if "jobs" in m else "étoiles" if "poles" in m else "", va, vb))
        for champ, lib in (("rank", "rang"), ("robust", "fiable aux trois budgets"), ("crosscheck", "statut de recoupement Navitia"), ("id", "identifiant")):
            locales.append(Ligne("decouvertes", f"{base}:{champ}", f"{titre} : {lib}", "", obtenir(x, champ) if x else ABSENT, obtenir(y, champ) if y else ABSENT))
        lignes.extend(locales)
        if x is not None and y is not None:
            if all(z.identique for z in locales):
                inchangees += 1
            else:
                modifiees += 1
    return BilanDecouvertes(lignes, inchangees, modifiees, disparues, apparues)


# --------------------------------------------------------------------------- 2.4 et 2.5 modes, journées, communes de référence
def libelle_scenario(mode: str, jour: str, budget: int, modes: Mapping[str, str], jours: Mapping[str, str]) -> str:
    return f"{modes.get(mode, mode)}, {jours.get(jour, 'toute la journée')}, {budget} min"


def tables_libelles(a: Jeu, b: Jeu) -> tuple[dict[str, str], dict[str, str]]:
    modes: dict[str, str] = {}
    jours: dict[str, str] = {}
    for jeu in (a, b):
        for m in obtenir(jeu.meta, "modes") if isinstance(obtenir(jeu.meta, "modes"), list) else []:
            modes[m["id"]] = m["label"]
        for d in jeu.jours():
            jours[d["id"]] = d["label"]
    return modes, jours


def comparer_modes(res_a: Mapping[str, Portees], res_b: Mapping[str, Portees], modes: Mapping[str, str], jours: Mapping[str, str]) -> list[Ligne]:
    """Par scénario : communes calculées, étoiles allumées et postes atteints en moyenne par commune (toutes les communes comparées)."""

    def agrege(res: Mapping[str, Portees]) -> dict[CleScenario, tuple[int, float, float | None]]:
        tmp: dict[CleScenario, list[tuple[int, int | None]]] = defaultdict(list)
        for p in res.values():
            for cle, v in p.valeurs.items():
                tmp[cle].append(v)
        sortie: dict[CleScenario, tuple[int, float, float | None]] = {}
        for cle, vals in tmp.items():
            sans_postes = any(v[1] is None for v in vals)
            sortie[cle] = (len(vals), sum(v[0] for v in vals) / len(vals), None if sans_postes else sum(v[1] for v in vals) / len(vals))  # type: ignore[misc]
        return sortie

    ag_a, ag_b = agrege(res_a), agrege(res_b)
    lignes: list[Ligne] = []
    for cle in sorted(set(ag_a) | set(ag_b)):
        mode, jour, budget = cle
        tag = libelle_scenario(mode, jour, budget, modes, jours)
        base = f"mode:{mode}:{jour}:{budget}"
        for rang, (nom, unite, cout) in enumerate((("communes calculées", "communes", "n"), ("étoiles allumées en moyenne par commune", "étoiles", "e"),
                                                     ("postes atteints en moyenne par commune", "postes", "p"))):
            va = ag_a[cle][rang] if cle in ag_a else ABSENT
            vb = ag_b[cle][rang] if cle in ag_b else ABSENT
            lignes.append(Ligne("modes", f"{base}:{cout}", f"{tag} : {nom}", unite, va, vb))
    return lignes


def communes_reference(a: Jeu, b: Jeu) -> list[tuple[str, str]]:
    """Échantillon reproductible, aucun choix à la main : communes de la visite, origines des découvertes (ancien et nouveau),
    commune la plus peuplée de chaque département. (code INSEE, motif)."""
    motifs: dict[str, list[str]] = defaultdict(list)
    motifs[ORIGINE_VISITE].append("visite")
    motifs[VOISINE_VISITE].append("visite")
    for jeu in (a, b):
        for i in jeu.liste_insights():
            s = i.get("scenario") or {}
            for champ in ("o", "vs"):
                if s.get(champ):
                    motifs[s[champ]].append("découverte")
        par_dep: dict[str, tuple[int, str]] = {}
        for c in jeu.liste_communes():
            dep, pop = c.get("dep"), c.get("population")
            if dep and pop is not None and (dep not in par_dep or pop > par_dep[dep][0]):
                par_dep[dep] = (pop, c["insee"])
        for dep, (_pop, insee) in par_dep.items():
            motifs[insee].append(f"plus peuplée du {dep}")
    return [(c, ", ".join(sorted(set(m)))) for c, m in sorted(motifs.items())]


def comparer_communes(res_a: Mapping[str, Portees], res_b: Mapping[str, Portees], modes: Mapping[str, str], jours: Mapping[str, str],
                      noms: Mapping[str, str], reference: Iterable[str]) -> tuple[list[Ligne], list[Ligne]]:
    """Par commune et scénario : étoiles et postes. Rend (lignes de référence, lignes de toutes les communes)."""
    ref = set(reference)
    toutes: list[Ligne] = []
    selection: list[Ligne] = []
    for insee in sorted(set(res_a) | set(res_b)):
        pa = res_a.get(insee)
        pb = res_b.get(insee)
        cles = set(pa.valeurs if pa else ()) | set(pb.valeurs if pb else ())
        for cle in sorted(cles):
            mode, jour, budget = cle
            va = pa.valeurs[cle] if pa and cle in pa.valeurs else None
            vb = pb.valeurs[cle] if pb and cle in pb.valeurs else None
            tag = f"{noms.get(insee, insee)}, {libelle_scenario(mode, jour, budget, modes, jours)}"
            for rang, (nom, unite, code) in enumerate((("étoiles allumées", "étoiles", "etoiles"), ("postes atteints", "postes", "postes"))):
                la = Ligne("communes", f"commune:{insee}:{mode}:{jour}:{budget}:{code}", f"{tag} : {nom}", unite,
                           va[rang] if va else ABSENT, vb[rang] if vb else ABSENT)
                toutes.append(la)
                if insee in ref:
                    selection.append(la)
    return selection, toutes


def tableaux_communes(selection: Sequence[Ligne], modes: Mapping[str, str], jours: Mapping[str, str], motifs: Mapping[str, str]) -> str:
    """Tables larges : une par mode, une ligne par commune, une colonne par journée et budget, cellule « 12 » ou « 12 -> 14 (+2) »."""
    etoiles = [x for x in selection if x.cle.endswith(":etoiles")]
    par_mode: dict[str, dict[str, dict[tuple[str, int], Ligne]]] = defaultdict(lambda: defaultdict(dict))
    noms: dict[str, str] = {}
    for x in etoiles:
        _, insee, mode, jour, budget, _ = x.cle.split(":")
        par_mode[mode][insee][(jour, int(budget))] = x
        noms[insee] = x.libelle.split(",", 1)[0]
    morceaux: list[str] = []
    ordre_jours = {j: i for i, j in enumerate(jours)}
    for mode in sorted(par_mode, key=lambda m: list(modes).index(m) if m in modes else 99):
        colonnes = sorted({k for ligne in par_mode[mode].values() for k in ligne}, key=lambda k: (ordre_jours.get(k[0], -1), k[1]))
        entete = ["Commune"] + [f"{jours.get(j, 'toute la journée')}, {b} min" for j, b in colonnes]
        morceaux.append(f"\n**{modes.get(mode, mode)}** (étoiles allumées)\n")
        morceaux.append("| " + " | ".join(entete) + " |\n|" + "---|" * len(entete))
        for insee, ligne in sorted(par_mode[mode].items()):
            cellules = [f"{noms[insee]} ({insee})"]
            for k in colonnes:
                x = ligne.get(k)
                if x is None:
                    cellules.append("absent")
                elif x.identique:
                    cellules.append(fr_valeur(x.ancien))
                else:
                    cellules.append(f"{fr_valeur(x.ancien)} -> {fr_valeur(x.nouveau)} ({fr_ecart(x)})")
            morceaux.append("| " + " | ".join(cellules) + " |")
    return "\n".join(morceaux)


# --------------------------------------------------------------------------- 3. liste complète : fichiers, cases
def _est_scalaire(v: Any) -> bool:
    return v is None or isinstance(v, str | int | float | bool)


def _cle_element(element: Any) -> str | None:
    if isinstance(element, Mapping):
        for k in ("id", "insee", "source_id", "code"):
            if k in element and _est_scalaire(element[k]):
                return str(element[k])
    return None


def differences_json(a: Any, b: Any, chemin: str, categorie: str = "fichiers") -> Iterator[Ligne]:
    """Toutes les différences de deux valeurs JSON, feuille par feuille. Une liste de valeurs simples est un seul élément."""
    if isinstance(a, Mapping) and isinstance(b, Mapping):
        for k in sorted(set(a) | set(b), key=str):
            yield from differences_json(a.get(k, ABSENT), b.get(k, ABSENT), f"{chemin}.{k}", categorie)
        return
    if isinstance(a, list) and isinstance(b, list):
        if all(_est_scalaire(x) for x in a) and all(_est_scalaire(x) for x in b):
            if a != b:
                retires = len([x for x in a if x not in b])
                ajoutes = len([x for x in b if x not in a])
                yield Ligne(categorie, chemin, f"{chemin} : liste de {len(a)} valeurs -> {len(b)} (ajoutées {ajoutes}, retirées {retires})",
                            "valeurs", len(a), len(b))
            return
        cles_a = [_cle_element(x) for x in a]
        cles_b = [_cle_element(x) for x in b]
        if None not in cles_a and None not in cles_b and len(set(cles_a)) == len(a) and len(set(cles_b)) == len(b):
            pa, pb = dict(zip(cles_a, a, strict=True)), dict(zip(cles_b, b, strict=True))
            for k in sorted(set(pa) | set(pb)):  # type: ignore[type-var]
                yield from differences_json(pa.get(k, ABSENT), pb.get(k, ABSENT), f"{chemin}[{k}]", categorie)
            return
        for i in range(max(len(a), len(b))):
            yield from differences_json(a[i] if i < len(a) else ABSENT, b[i] if i < len(b) else ABSENT, f"{chemin}[{i}]", categorie)
        return
    if isinstance(a, Mapping) or isinstance(b, Mapping) or isinstance(a, list) or isinstance(b, list):
        if not (a is ABSENT or b is ABSENT):
            yield Ligne(categorie, chemin, f"{chemin} : nature différente", "", "composite", "composite")
            return
        n = _nb_feuilles(a if b is ABSENT else b)
        if a is ABSENT:
            yield Ligne(categorie, chemin, f"{chemin} : bloc nouveau ({n} valeurs)", "", ABSENT, f"{n} valeurs")
        else:
            yield Ligne(categorie, chemin, f"{chemin} : bloc retiré ({n} valeurs)", "", f"{n} valeurs", ABSENT)
        return
    if not _egaux(a, b):
        yield Ligne(categorie, chemin, chemin, "", a, b)


def _nb_feuilles(v: Any) -> int:
    if isinstance(v, Mapping):
        return sum(_nb_feuilles(x) for x in v.values())
    if isinstance(v, list):
        return sum(_nb_feuilles(x) for x in v)
    return 1


def diff_fichiers_racine(a: Path, b: Path) -> list[Ligne]:
    """Différences feuille par feuille des fichiers JSON de la racine (hors insights.json, comparé par scénario en 2.3)."""
    noms = {p.name for p in a.glob("*.json")} | {p.name for p in b.glob("*.json")}
    lignes: list[Ligne] = []
    for nom in sorted(noms - {"insights.json"}):
        va, vb = lire_json(a / nom), lire_json(b / nom)
        lignes.extend(differences_json(va, vb, nom))
    return lignes


@dataclass(frozen=True)
class Inventaire:
    dossier: str
    identiques: int
    differents: int
    seulement_ancien: int
    seulement_nouveau: int


def _sha(chemin: Path) -> str:
    h = hashlib.sha256()
    with chemin.open("rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def inventaire(a: Path, b: Path) -> list[Inventaire]:
    """Compare tous les fichiers de deux dossiers, par sous-dossier : mêmes tailles et même sha256 = identiques."""

    def fichiers(racine: Path) -> dict[str, Path]:
        return {p.relative_to(racine).as_posix(): p for p in racine.rglob("*") if p.is_file()}

    fa, fb = fichiers(a), fichiers(b)
    meme_dossier = a.resolve() == b.resolve()  # mêmes octets : inutile de tout relire
    par_dossier: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0])
    for rel in set(fa) | set(fb):
        d = rel.split("/")[0] if "/" in rel else "(racine)"
        if rel not in fb:
            par_dossier[d][2] += 1
        elif rel not in fa:
            par_dossier[d][3] += 1
        elif meme_dossier or (fa[rel].stat().st_size == fb[rel].stat().st_size and _sha(fa[rel]) == _sha(fb[rel])):
            par_dossier[d][0] += 1
        else:
            par_dossier[d][1] += 1
    return [Inventaire(d, *v) for d, v in sorted(par_dossier.items())]


@dataclass
class CasesAccess:
    """Comparaison case par case de `access/` : une case = commune, astre, mode, journée, sens."""

    lignes: list[Ligne] = field(default_factory=list)
    comparees: Counter = field(default_factory=Counter)


def comparer_cases_access(a: Path, b: Path, communes: Iterable[str], poles: Sequence[Mapping]) -> CasesAccess:
    """Toutes les durées de `access/{insee}.json` qui diffèrent (réglage par défaut et variantes)."""
    res = CasesAccess()
    ids = [p.get("id", str(i)) for i, p in enumerate(poles)]

    def blocs(fichier: Any) -> dict[tuple[str, str, str], Mapping]:
        sortie: dict[tuple[str, str, str], Mapping] = {}
        for m, par_jour in (obtenir(fichier, "modes") if isinstance(obtenir(fichier, "modes"), Mapping) else {}).items():
            for j, s in par_jour.items():
                sortie[("défaut", m, j)] = s
        variantes = obtenir(fichier, "variants")
        for v, modes in (variantes.items() if isinstance(variantes, Mapping) else []):
            for m, par_jour in modes.items():
                for j, s in par_jour.items():
                    sortie[(v, m, j)] = s
        return sortie

    for insee in sorted(set(communes)):
        fa, fb = lire_json(a / "access" / f"{insee}.json"), lire_json(b / "access" / f"{insee}.json")
        ba, bb = blocs(fa), blocs(fb)
        for cle in sorted(set(ba) | set(bb)):
            reg, mode, jour = cle
            for sens, libelle_sens in (("out", "aller"), ("ret", "retour")):
                va, vb = (ba.get(cle) or {}).get(sens), (bb.get(cle) or {}).get(sens)
                n = max(len(va or []), len(vb or []))
                for i in range(n):
                    x = va[i] if va is not None and i < len(va) else ABSENT
                    y = vb[i] if vb is not None and i < len(vb) else ABSENT
                    res.comparees[(mode, jour, sens)] += 1
                    if not _egaux(x, y):
                        astre = ids[i] if i < len(ids) else str(i)
                        res.lignes.append(Ligne("cases", f"access:{insee}:{astre}:{reg}:{mode}:{jour}:{sens}",
                                                f"{insee} vers {astre}, {mode}, {jour}, {libelle_sens} ({reg})", "min", x, y))
    return res


# --------------------------------------------------------------------------- 3. Navitia (phase E)
@dataclass
class ResultatsNavitia:
    fournis: bool = False
    fichiers: list[str] = field(default_factory=list)
    verdicts: list[Mapping] = field(default_factory=list)  # blocs `insight_checks` du résumé de 07d
    trajets: list[dict[str, str]] = field(default_factory=list)  # lignes de CSV avec `starway_min` et `navitia_min`
    problemes: list[str] = field(default_factory=list)


def charger_navitia(chemins: Sequence[Path]) -> ResultatsNavitia:
    """Lit les résultats fournis : résumé JSON de 07d (`insight_checks`) et/ou CSV de trajets (`starway_min`, `navitia_min`)."""
    res = ResultatsNavitia(fournis=bool(chemins))
    for p in chemins:
        res.fichiers.append(str(p))
        if p.suffix.lower() == ".json":
            bloc = json.loads(p.read_text(encoding="utf-8"))
            verdicts = obtenir(bloc, "insight_checks")
            if isinstance(verdicts, list):
                res.verdicts.extend(verdicts)
            else:
                res.problemes.append(f"{p.name} : pas de bloc insight_checks")
        else:
            with p.open(encoding="utf-8-sig", newline="") as f:
                lecteur = csv.DictReader(f)
                if not {"starway_min", "navitia_min"} <= set(lecteur.fieldnames or []):
                    res.problemes.append(f"{p.name} : colonnes starway_min et navitia_min absentes")
                else:
                    res.trajets.extend(lecteur)
    return res


def contradictions_navitia(navitia: ResultatsNavitia, nouveau: Jeu) -> list[dict[str, str]]:
    """Découvertes du nouveau jeu contredites : verdict `contradicted` d'un résumé fourni, ou `meta.insights.excluded`."""
    actuelles = {cle_decouverte(i) for i in nouveau.liste_insights()}
    noms = nouveau.noms()
    sortie: list[dict[str, str]] = []
    for v in navitia.verdicts:
        if v.get("verdict") == CONTRADICTION:
            sortie.append({"decouverte": titre_decouverte(v, noms), "origine": "résultats Navitia fournis",
                           "etat": "encore publiée" if cle_decouverte(v) in actuelles else "absente du nouveau jeu"})
    excluded = obtenir(nouveau.meta, "insights", "excluded")
    for e in excluded if isinstance(excluded, list) else []:
        if isinstance(e, Mapping) and CAUSE_NAVITIA in str(e.get("cause") or e.get("reason") or ""):
            sortie.append({"decouverte": titre_decouverte(e, noms), "origine": "meta.insights.excluded du nouveau jeu", "etat": "écartée du nouveau jeu"})
    return sortie


def _ecart_navitia(ligne: Mapping[str, str]) -> float | None:
    try:
        return abs(float(ligne.get("starway_min") or "") - float(ligne.get("navitia_min") or ""))
    except ValueError:
        return None


def lignes_navitia(navitia: ResultatsNavitia) -> list[str]:
    """Résultats fournis, triés par taille de l'écart (les trajets sans durée d'un côté en tête)."""
    if not navitia.fournis:
        return ["Résultats Navitia non fournis (option `--navitia`)."]
    sortie: list[str] = []
    if navitia.verdicts:
        sortie.append("\nVerdicts des découvertes (résumé fourni) :\n")
        sortie.append("| Découverte | Verdict |\n|---|---|")
        for v in sorted(navitia.verdicts, key=lambda x: (x.get("verdict") != CONTRADICTION, str(x.get("label")))):
            sortie.append(f"| {v.get('label', '')} | {v.get('verdict', '')} |")
    if navitia.trajets:
        sortie.append("\nTrajets recoupés, triés par écart décroissant (STARWAY moins Navitia) :\n")
        entete = ["Trajet", "Journée", "Sens", "STARWAY (min)", "Navitia (min)", "Écart (min)", "État"]
        sortie.append("| " + " | ".join(entete) + " |\n|" + "---|" * len(entete))
        for t in sorted(navitia.trajets, key=lambda x: (-1 if _ecart_navitia(x) is None else 0, -(_ecart_navitia(x) or 0))):
            route = " vers ".join(x for x in (t.get("origin") or t.get("commune") or t.get("insee") or t.get("origin_insee"),
                                              t.get("dest") or t.get("pole") or t.get("dest_insee")) if x)
            ecart = _ecart_navitia(t)
            sortie.append(f"| {route.replace('|', '/')} | {t.get('day', '')} | {t.get('leg', '')} | {t.get('starway_min', '')} | {t.get('navitia_min', '')} | "
                          f"{'n/c' if ecart is None else str(round(ecart, 1)).replace('.', ',')} | {t.get('status', '')} |")
    for p in navitia.problemes:
        sortie.append(f"\nFichier non lu : {p}")
    return sortie


# --------------------------------------------------------------------------- Markdown
def _table(lignes: Sequence[Ligne], avec_signal: bool = True) -> str:
    entete = ["Indicateur", "Ancien", "Nouveau", "Écart", "%"] + (["Signalement"] if avec_signal else [])
    sortie = ["| " + " | ".join(entete) + " |", "|" + "---|" * len(entete)]
    for x in lignes:
        sortie.append("| " + " | ".join([x.libelle.replace("|", "/"), fr_valeur(x.ancien), fr_valeur(x.nouveau), fr_ecart(x), fr_pct(x)]
                                        + ([x.signal] if avec_signal else [])) + " |")
    return "\n".join(sortie)


def table_visite(lignes: Sequence[Ligne]) -> str:
    entete = ["Étape", "Chiffre", "Ancien", "Nouveau", "Écart", "%", "Prononcé (ancien)", "Prononcé (nouveau)", "Signalement"]
    sortie = ["| " + " | ".join(entete) + " |", "|" + "---|" * len(entete)]
    for x in lignes:
        oral_a, oral_b = x.oral_ancien or "", x.oral_nouveau or ""
        signal = x.signal
        if not x.identique and oral_a != oral_b:
            signal = (signal + " ; phrase prononcée différente").strip(" ;")
        sortie.append("| " + " | ".join([x.etape, x.libelle, fr_valeur(x.ancien), fr_valeur(x.nouveau), fr_ecart(x), fr_pct(x), oral_a, oral_b, signal]) + " |")
    return "\n".join(sortie)


@dataclass
class Rapport:
    ancien: Jeu
    nouveau: Jeu
    compteurs: list[Ligne]
    visite: list[Ligne]
    controle: list[str]
    decouvertes: BilanDecouvertes
    modes: list[Ligne]
    selection: list[Ligne]
    toutes_communes: list[Ligne]
    fichiers: list[Ligne]
    suivis: list[Ligne]
    etat_eclipse: str
    inventaire: list[Inventaire]
    cases: CasesAccess
    navitia: ResultatsNavitia
    contradictions: list[dict[str, str]]
    libelles_modes: dict[str, str]
    libelles_jours: dict[str, str]
    motifs: dict[str, str]
    communes_comparees: int
    partiel: bool = False

    def lignes_principales(self) -> list[Ligne]:
        return [*self.compteurs, *self.visite, *self.decouvertes.lignes, *self.modes, *self.selection, *self.suivis, *self.fichiers]

    def absences(self) -> list[Ligne]:
        """Données absentes d'un côté ; une découverte apparue ou disparue compte une fois (sa ligne « présence »)."""
        return [x for x in self.lignes_principales() if x.absent_un_cote and (x.categorie != "decouvertes" or x.cle.endswith(":presence"))]

    def toutes_les_lignes(self) -> list[Ligne]:
        principales_sauf_selection = [*self.compteurs, *self.visite, *self.decouvertes.lignes, *self.modes, *self.suivis, *self.fichiers]
        return [*principales_sauf_selection, *self.toutes_communes, *self.cases.lignes]


def _pluriel(n: int, un: str, plusieurs: str) -> str:
    return f"{fr_nombre(n)} {un if n <= 1 else plusieurs}"


def resume(r: Rapport) -> list[str]:
    """Au plus 10 lignes : ce que change le nouveau dossier pour la personne qui regarde le site. Faits observés, sans jugement."""
    principales = r.lignes_principales()
    changes = ecarts_tries(principales)
    lignes: list[str] = []
    if not changes:
        lignes.append(f"Aucun des {fr_nombre(len(principales))} chiffres comparés ne change : le site montrerait exactement la même chose.")
    else:
        lignes.append(f"Sur {fr_nombre(len(principales))} chiffres comparés, {fr_nombre(len(changes))} changent (détail en partie 3).")
    ida, idb = obtenir(r.ancien.meta, "dataset_id"), obtenir(r.nouveau.meta, "dataset_id")
    if not _egaux(ida, idb):
        lignes.append(f"Le site passerait du jeu de données {fr_valeur(ida)} au jeu {fr_valeur(idb)}.")
    visite_ch = ecarts_tries(r.visite)
    if visite_ch:
        phrases = sum(1 for x in visite_ch if (x.oral_ancien or "") != (x.oral_nouveau or ""))
        exemples = " ; ".join(f"{x.libelle} : {fr_valeur(x.ancien)} -> {fr_valeur(x.nouveau)}" for x in visite_ch[:2])
        lignes.append(f"Visite guidée : {_pluriel(len(visite_ch), 'chiffre change', 'chiffres changent')}, dont {_pluriel(phrases, 'dans une phrase prononcée', 'dans des phrases prononcées')} ({exemples}).")
    else:
        lignes.append("Visite guidée : aucun chiffre ne change.")
    d = r.decouvertes
    lignes.append(f"Découvertes : {d.inchangees} inchangées, {d.modifiees} avec un chiffre modifié, {len(d.disparues)} disparaissent, {len(d.apparues)} apparaissent.")
    etoiles = ecarts_tries(x for x in r.selection if x.cle.endswith(":etoiles"))
    if etoiles:
        communes = len({x.cle.split(":")[1] for x in etoiles})
        premier = etoiles[0]
        lignes.append(f"Étoiles allumées, communes de référence : {_pluriel(communes, 'commune changerait', 'communes changeraient')} ; plus grand écart relatif : {premier.libelle} ({fr_valeur(premier.ancien)} -> {fr_valeur(premier.nouveau)}).")
    else:
        lignes.append("Étoiles allumées, communes de référence : aucun changement.")
    couverture = [x for x in ecarts_tries(r.modes) if x.cle.endswith(":n")]
    if couverture:
        x = couverture[0]
        lignes.append(f"Couverture : {_pluriel(len(couverture), 'scénario change', 'scénarios changent')} de nombre de communes calculées ; par exemple {x.libelle}, {fr_valeur(x.ancien)} -> {fr_valeur(x.nouveau)}.")
    moyennes = [x for x in ecarts_tries(r.modes) if x.cle.endswith(":e") and not x.absent_un_cote]
    if moyennes:
        x = moyennes[0]
        lignes.append(f"Plus grand écart de moyenne par mode et journée : {x.libelle}, {fr_valeur(x.ancien)} -> {fr_valeur(x.nouveau)} ({fr_pct(x)}).")
    compteurs_ch = ecarts_tries(r.compteurs)
    if compteurs_ch:
        lignes.append("Compteurs : " + " ; ".join(f"{x.libelle} {fr_valeur(x.ancien)} -> {fr_valeur(x.nouveau)}" for x in compteurs_ch[:3]) + f" ({len(compteurs_ch)} au total).")
    absentes = r.absences()
    if absentes:
        lignes.append(f"{_pluriel(len(absentes), 'donnée est absente', 'données sont absentes')} d'un côté (partie 3.1).")
    if r.navitia.fournis or r.contradictions:
        lignes.append(f"Navitia : {_pluriel(len(r.contradictions), 'découverte contredite', 'découvertes contredites')} (partie 3.1).")
    else:
        lignes.append("Navitia : résultats non fournis.")
    return lignes[:10]


def ecrire_markdown(r: Rapport) -> str:
    sortie: list[str] = ["# Tableau ancien / nouveau des chiffres affichés par STARWAY\n"]
    gen = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    sortie.append(f"Ancien : `{r.ancien.racine}` (jeu {fr_valeur(obtenir(r.ancien.meta, 'dataset_id'))}). Nouveau : `{r.nouveau.racine}` (jeu {fr_valeur(obtenir(r.nouveau.meta, 'dataset_id'))}). Produit le {gen}.")
    if r.partiel:
        sortie.append(f"\nComparaison limitée aux {r.communes_comparees} communes demandées (option `--communes`) : les totaux par mode ne portent que sur elles.")
    sortie.append("\nAucune appréciation dans ce tableau : pas de seuil, pas de « bloquant ». Seuls sont signalés : un chiffre de la visite qui change, une donnée absente d'un côté, une découverte contredite par Navitia.\n")
    sortie.append("## 1. Ce qui change pour la personne qui regarde le site\n")
    sortie.extend(f"- {ligne}" for ligne in resume(r))

    sortie.append("\n## 2. Les chiffres affichés\n")
    sortie.append("### 2.1 Compteurs globaux\n")
    sortie.append(_table(r.compteurs))
    sortie.append("\n### 2.2 Chiffres cités par la visite guidée\n")
    sortie.append(table_visite(r.visite))
    if r.controle:
        sortie.append("\nContrôle de cet outil sur le texte de la visite (`tour.resolved.json`) : à regarder avant de se fier à ce paragraphe.\n")
        sortie.extend(f"- {p}" for p in r.controle)
    else:
        sortie.append("\nContrôle de cet outil : chaque chiffre recalculé ci-dessus (ancien) se retrouve à l'identique dans le texte prononcé, et chaque nombre prononcé est suivi.")
    sortie.append("\n### 2.3 Les découvertes (une découverte = un scénario)\n")
    d = r.decouvertes
    sortie.append(f"{d.inchangees} inchangées, {d.modifiees} modifiées, {len(d.disparues)} disparues, {len(d.apparues)} apparues.\n")
    for titre, liste in (("Contredites par Navitia", [f"{c['decouverte']} ({c['etat']})" for c in r.contradictions]), ("Disparues", d.disparues), ("Apparues", d.apparues)):
        if liste:
            sortie.append(f"**{titre}** :\n")
            sortie.extend(f"- {t}" for t in liste)
            sortie.append("")
    sortie.append(_table(d.lignes))
    sortie.append(f"\n### 2.4 Chaque mode et chaque journée ({_pluriel(r.communes_comparees, 'commune comparée', 'communes comparées')})\n")
    sortie.append(_table(r.modes, avec_signal=False))
    sortie.append(f"\n### 2.5 Astres atteints depuis les communes de référence\n\n{_pluriel(len(r.motifs), 'commune', 'communes')} : celles de la visite, les origines des découvertes et la plus peuplée de chaque département (règle fixe, aucun choix à la main).")
    sortie.append(tableaux_communes(r.selection, r.libelles_modes, r.libelles_jours, r.motifs))

    sortie.append("\n### 2.6 Deux points demandés par le plan (phase E, point 6)\n")
    sortie.append(f"**Les 31 lignes de bus.** {RAPPEL_31_LIGNES} Jeux comparés : {fr_valeur(obtenir(r.ancien.meta, 'dataset_id'))} et {fr_valeur(obtenir(r.nouveau.meta, 'dataset_id'))}.\n")
    sortie.append(f"**La découverte `{DECOUVERTE_SUIVIE}`.** {RAPPEL_ECLIPSE} {r.etat_eclipse}\n")
    sortie.append(_table(r.suivis, avec_signal=False))
    sortie.append("\n## 3. Liste complète des écarts\n")
    sortie.append("### 3.1 Signalements objectifs\n")
    visite_ch = ecarts_tries(r.visite)
    absentes = ecarts_tries(r.absences())
    sortie.append(f"- Chiffres de la visite qui changent : {len(visite_ch)}.")
    sortie.append(f"- Données absentes d'un côté (hors détail par commune) : {len(absentes)}.")
    sortie.append(f"- Découvertes contredites par Navitia : {len(r.contradictions)}.\n")
    for c in r.contradictions:
        sortie.append(f"  - {c['decouverte']} ({c['origine']}, {c['etat']})")
    if absentes:
        sortie.append("\nDonnées absentes d'un côté :\n")
        sortie.append(_table(absentes))
    tous = ecarts_tries(r.lignes_principales())
    sortie.append(f"\n### 3.2 Tous les écarts, du plus grand au plus petit ({fr_nombre(len(tous))})\n")
    sortie.append("Tri : données absentes d'un côté, puis ancien à 0 (pourcentage impossible), puis pourcentage décroissant, puis changements de texte.\n")
    sortie.append(_table(tous) if tous else "Aucun écart.")
    sortie.append("\n### 3.3 Inventaire des fichiers\n")
    sortie.append("| Dossier | Identiques | Différents | Seulement dans l'ancien | Seulement dans le nouveau |\n|---|---|---|---|---|")
    for inv in r.inventaire:
        sortie.append(f"| {inv.dossier} | {fr_nombre(inv.identiques)} | {fr_nombre(inv.differents)} | {fr_nombre(inv.seulement_ancien)} | {fr_nombre(inv.seulement_nouveau)} |")
    sortie.append("\n### 3.4 Détail case par case et commune par commune\n")
    sortie.append(_section_cases(r))
    sortie.append("\n### 3.5 Résultats Navitia (phase E)\n")
    sortie.extend(lignes_navitia(r.navitia))
    return "\n".join(sortie) + "\n"


def _section_cases(r: Rapport) -> str:
    communes_ch = ecarts_tries(r.toutes_communes)
    lignes = [f"Commune par commune (toutes les communes comparées, étoiles et postes par scénario) : {fr_nombre(len(r.toutes_communes))} chiffres, {fr_nombre(len(communes_ch))} écarts."]
    par_case: dict[tuple[str, str, str], list[Ligne]] = defaultdict(list)
    for x in r.cases.lignes:
        _, _insee, _astre, _reg, mode, jour, sens = x.cle.split(":")
        par_case[(mode, jour, sens)].append(x)
    entete = "| Mode | Journée | Sens | Cases comparées | Cases différentes | Devenues absentes | Apparues | Plus grand écart (min) | Écart médian (min) |\n|---|---|---|---|---|---|---|---|---|"
    lignes.append("\nDurées de `access/`, par mode, journée et sens :\n")
    lignes.append(entete)
    for cle, n in sorted(r.cases.comparees.items()):
        mode, jour, sens = cle
        groupe = par_case.get(cle, [])
        numeriques = [abs(x.ecart) for x in groupe if x.ecart is not None]
        perdues = sum(1 for x in groupe if not _manque(x.ancien) and _manque(x.nouveau))
        gagnees = sum(1 for x in groupe if _manque(x.ancien) and not _manque(x.nouveau))
        lignes.append(f"| {mode} | {jour} | {'aller' if sens == 'out' else 'retour'} | {fr_nombre(n)} | {fr_nombre(len(groupe))} | {fr_nombre(perdues)} | {fr_nombre(gagnees)} | "
                      f"{fr_nombre(max(numeriques)) if numeriques else 'n/c'} | {fr_nombre(statistics.median(numeriques)) if numeriques else 'n/c'} |")
    lignes.append("\nLa liste complète de ces écarts, ligne à ligne et triée par taille, est dans le CSV écrit à côté de ce fichier (`.ecarts.csv`).")
    return "\n".join(lignes)


def ecrire_csv(r: Rapport, chemin: Path) -> int:
    """Tous les écarts, y compris commune par commune et case par case, triés par taille. Rend le nombre de lignes."""
    lignes = ecarts_tries(r.toutes_les_lignes())
    chemin.parent.mkdir(parents=True, exist_ok=True)
    with chemin.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["categorie", "cle", "libelle", "unite", "ancien", "nouveau", "ecart", "ecart_pct", "signalement"])
        for x in lignes:
            w.writerow([x.categorie, x.cle, x.libelle, x.unite, fr_valeur(x.ancien), fr_valeur(x.nouveau),
                        "" if x.ecart is None else x.ecart, "" if x.pct is None else round(x.pct, 2), x.signal])
    return len(lignes)


# --------------------------------------------------------------------------- construction du rapport
def construire(ancien: Path, nouveau: Path, navitia: Sequence[Path] = (), communes: Sequence[str] | None = None,
               workers: int = 1, visite_resolue: Path | None = None) -> Rapport:
    """Compare les deux dossiers. `communes` : limite le recalcul commune par commune (essais rapides)."""
    a, b = Jeu.charger(ancien), Jeu.charger(nouveau)
    params_a, params_b = ParamsOd.depuis(a), ParamsOd.depuis(b)
    motifs = dict(communes_reference(a, b))
    toutes = sorted({*[c["insee"] for c in a.liste_communes()], *[c["insee"] for c in b.liste_communes()]})
    partiel = communes is not None
    cibles = sorted({*communes, *motifs}) if communes is not None else toutes
    res_a = calcul_toutes(ancien, cibles, workers)
    res_b = res_a if ancien.resolve() == nouveau.resolve() else calcul_toutes(nouveau, cibles, workers)  # même dossier : mêmes octets
    libelles_modes, libelles_jours = tables_libelles(a, b)
    visite_a, visite_b = chiffres_visite(a, params_a), chiffres_visite(b, params_b)
    chemin_resolu = visite_resolue if visite_resolue is not None else ancien.parent / "tour" / "lea" / "tour.resolved.json"
    resolu = lire_json(chemin_resolu) if chemin_resolu.exists() else ABSENT
    controle = controle_visite(visite_a, resolu) if resolu is not ABSENT else [f"texte résolu de la visite introuvable : {chemin_resolu}"]
    selection, toutes_communes = comparer_communes(res_a, res_b, libelles_modes, libelles_jours, {**a.noms(), **b.noms()}, motifs)
    nav = charger_navitia(list(navitia))
    return Rapport(
        ancien=a, nouveau=b,
        compteurs=compteurs_globaux(a, b),
        visite=lignes_visite(visite_a, visite_b),
        controle=controle,
        decouvertes=comparer_decouvertes(a, b),
        modes=comparer_modes(res_a, res_b, libelles_modes, libelles_jours),
        selection=selection,
        toutes_communes=toutes_communes,
        fichiers=diff_fichiers_racine(ancien, nouveau),
        suivis=lignes_suivies(a, b, params_a, params_b),
        etat_eclipse=etat_eclipse_suivie(a, b, nav),
        inventaire=inventaire(ancien, nouveau),
        cases=comparer_cases_access(ancien, nouveau, cibles, b.liste_poles() or a.liste_poles()),
        navitia=nav,
        contradictions=contradictions_navitia(nav, b),
        libelles_modes=libelles_modes, libelles_jours=libelles_jours,
        motifs=motifs, communes_comparees=len(cibles), partiel=partiel,
    )
