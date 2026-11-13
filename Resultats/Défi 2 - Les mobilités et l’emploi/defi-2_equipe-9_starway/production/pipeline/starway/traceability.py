"""Traçabilité de chaque bloc affiché (chantier C de Nicolas, 05/11/2026) : docs/tracabilite.md, généré par 06u.

Pour chaque bloc du site (le registre `frontend/src/data/provenanceCoverage.ts`, plus la visite guidée), le document
dit d'où vient la donnée et comment elle est calculée : source (manifeste), fichier exact et sha256, date ou
millésime, licence, formule, dossiers de calcul et empreintes de leurs `run_params.json`, script, test, ligne du mode
sources. RIEN n'est écrit à la main dans le document : tout est lu

- dans le registre du front (composants, codes de source, exemptions) et dans les composants eux-mêmes (notes de
  provenance posées, textes de méthode `METHODS`) ;
- dans le manifeste `data/sources_manifest.csv` (fichier, sha256, dates, licence, traitements) ;
- dans les `run_params.json` des dossiers de calcul lus par la publication (jar R5, GTFS, OSM, pôles, points
  d'origine, durées au même arrêt), rapprochés des lignes du manifeste par leur sha256 ;
- dans le code : première phrase de la docstring Python ou commentaire TypeScript de la fonction qui porte la formule.

La seule saisie humaine est la table `FAMILIES` ci-dessous (quel composant relève de quel bloc, quels scripts,
tests et fonctions le concernent). Elle est contrôlée : chaque chemin doit exister, chaque fonction citée doit porter
une documentation, chaque composant du registre doit appartenir à un bloc. Une donnée qui ne peut pas être sourcée
n'est jamais estimée : elle est signalée (`problems`) et le contrôle P0 de 07 échoue quand c'est bloquant.
"""

from __future__ import annotations

import ast
import csv
import fnmatch
import hashlib
import json
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, NamedTuple

from starway import flux as fx
from starway import registry as reg

DOC_PATH = "docs/tracabilite.md"
GENERATOR = "pipeline/scripts/06u_tracabilite.py"
REGISTRY_TS = "frontend/src/data/provenanceCoverage.ts"
PROVENANCE_TS = "frontend/src/data/provenance.ts"
COMPONENTS_DIR = "frontend/src/components"
TOUR_TS = "frontend/src/tour/tours/lea.tour.ts"
TOUR_VARIABLES_TS = "frontend/src/tour/variables.ts"
TOUR_RESOLVED = "frontend/public/tour/lea/tour.resolved.json"
VISIT_ID = "B15"

# Formes de sha256 acceptées pour un fichier TEXTE versionné : les octets tels quels, ou avec des fins de ligne LF ou
# CRLF (l'index git est en LF, le poste Windows écrit des CRLF : les deux empreintes existent dans le manifeste).
TEXT_SUFFIXES = {".csv", ".json", ".txt", ".html", ".xml", ".md", ".geojson", ".patch", ".sh", ".py", ".java"}
MAX_TEXT_BYTES = 64 << 20


# --------------------------------------------------------------------------- lecture du registre TypeScript
def strip_ts_comments(text: str) -> str:
    """Texte TypeScript sans commentaires, en respectant les chaînes (apostrophes, guillemets, accents graves)."""
    out: list[str] = []
    i, n = 0, len(text)
    quote: str | None = None
    while i < n:
        c = text[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in "'\"`":
            quote = c
            out.append(c)
            i += 1
            continue
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def strip_jsx_comments(text: str) -> str:
    """Comme le test du front (provenanceCoverage.test.ts) : retire /* */ et // sans chercher les chaînes (JSX)."""
    return re.sub(r"(^|[^:])//.*$", r"\1", re.sub(r"/\*[\s\S]*?\*/", "", text), flags=re.MULTILINE)


def _unquote_ts(literal: str) -> str:
    body = literal[1:-1]
    return body.replace("\\'", "'").replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")


@dataclass(frozen=True)
class CoverageEntry:
    file: str
    kind: str  # notes | covered | exempt
    codes: tuple[str, ...]
    when_published: tuple[str, ...] = ()
    covered_by: str | None = None
    reason: str | None = None


def _top_level_objects(code: str, start: int) -> list[str]:
    """Objets `{...}` de premier niveau du tableau qui s'ouvre à `code[start] == '['`."""
    objs: list[str] = []
    depth_sq, depth_br = 0, 0
    quote: str | None = None
    obj_start = -1
    i = start
    while i < len(code):
        c = code[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "'\"`":
            quote = c
        elif c == "[":
            depth_sq += 1
        elif c == "]":
            depth_sq -= 1
            if depth_sq == 0:
                break
        elif c == "{":
            if depth_br == 0 and depth_sq == 1:
                obj_start = i
            depth_br += 1
        elif c == "}":
            depth_br -= 1
            if depth_br == 0 and obj_start >= 0:
                objs.append(code[obj_start:i + 1])
                obj_start = -1
        i += 1
    return objs


def parse_coverage(ts_text: str) -> list[CoverageEntry]:
    """Entrées de `PROVENANCE_COVERAGE` (frontend/src/data/provenanceCoverage.ts), constantes de codes résolues."""
    code = strip_ts_comments(ts_text)
    consts = {m.group(1): tuple(re.findall(r"'([^']+)'", m.group(2)))
              for m in re.finditer(r"const\s+(\w+)\s*=\s*\[([^\]]*)\]\s*as const", code)}
    pos = code.index("PROVENANCE_COVERAGE")
    start = code.index("= [", pos) + 2
    entries: list[CoverageEntry] = []
    for obj in _top_level_objects(code, start):
        file = re.search(r"\bfile:\s*'([^']+)'", obj)
        kind = re.search(r"\bkind:\s*'(\w+)'", obj)
        if not file or not kind:
            raise ValueError(f"entrée du registre illisible : {obj[:80]}")
        cm = re.search(r"\bcodes:\s*(\[[^\]]*\]|[A-Z_]+)", obj)
        codes: tuple[str, ...] = ()
        if cm:
            raw = cm.group(1)
            codes = tuple(re.findall(r"'([^']+)'", raw)) if raw.startswith("[") else consts[raw]
        wp = re.search(r"\bwhenPublished:\s*\[([^\]]*)\]", obj)
        cb = re.search(r"\bcoveredBy:\s*'([^']+)'", obj)
        rs = re.search(r"\breason:\s*(\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*')", obj, re.DOTALL)
        entries.append(CoverageEntry(
            file=file.group(1), kind=kind.group(1), codes=codes,
            when_published=tuple(re.findall(r"'([^']+)'", wp.group(1))) if wp else (),
            covered_by=cb.group(1) if cb else None, reason=_unquote_ts(rs.group(1)) if rs else None))
    return entries


def parse_methods(provenance_ts: str) -> dict[str, str]:
    """Textes de méthode `METHODS` de provenance.ts (clé -> phrase), tels qu'affichés en mode sources."""
    m = re.search(r"export const METHODS = \{(.*?)\n\} as const;", provenance_ts, re.DOTALL)
    if not m:
        raise ValueError("METHODS introuvable dans provenance.ts")
    return {k: _unquote_ts(s) for k, s in re.findall(r"(\w+):\s*(\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*')", m.group(1))}


@dataclass(frozen=True)
class NoteUse:
    """Une note de provenance posée par un composant : `CodeSourceNote code="ENV01" method={METHODS.carbon}`."""

    component: str
    code: str | None = None
    method: str | None = None

    def label(self) -> str:
        parts = [self.code] if self.code else []
        if self.method:
            parts.append(f"méthode METHODS.{self.method}")
        return self.component + (f"({' ; '.join(parts)})" if parts else "")


_NOTE_TAG = re.compile(r"<(ProvenanceNote|ProvenanceParts|CodeSourceNote|[A-Z]\w*SourceNote|[A-Z]\w*MethodNote)\b(.*?)(?:/>|>)",
                       re.DOTALL)


def scan_component(tsx_text: str) -> list[NoteUse]:
    """Notes de provenance et de méthode posées par un composant (hors commentaires), sans doublon, dans l'ordre."""
    seen: list[NoteUse] = []
    for m in _NOTE_TAG.finditer(strip_jsx_comments(tsx_text)):
        attrs = m.group(2)
        code = re.search(r'\bcode="([^"]+)"', attrs)
        meth = re.search(r"METHODS\.(\w+)", attrs)
        use = NoteUse(m.group(1), code.group(1) if code else None, meth.group(1) if meth else None)
        if use not in seen:
            seen.append(use)
    return seen


def scanned_components(components_dir: Path) -> list[str]:
    """Composants que le test du front (provenanceCoverage.test.ts) impose d'inscrire : Proof*.tsx et dossiers de blocs."""
    out: list[str] = []
    for p in components_dir.rglob("*.tsx"):
        rel = p.relative_to(components_dir).as_posix()
        if ".test." in rel or rel.startswith("provenance/"):
            continue
        base = rel.rsplit("/", 1)[-1]
        if base.startswith("Proof") or re.match(r"^(subscriptions|needs|recruit|vehicles)/", rel):
            out.append(rel)
    return sorted(out)


# --------------------------------------------------------------------------- formules : documentation du code
def _normalize_space(text: str) -> str:
    return " ".join(text.split())


def ts_doc(text: str, symbol: str) -> str | None:
    """Commentaire `/** ... */` qui précède `symbol` (fonction, constante, type) ; `symbol` vide : premier commentaire du fichier."""
    if not symbol:
        m = re.match(r"\s*(/\*\*.*?\*/)", text, re.DOTALL)
    else:
        m = re.search(rf"(/\*\*(?:(?!\*/).)*\*/)[ \t]*\r?\n(?:export\s+)?(?:async\s+)?(?:function|const|class|interface|type)\s+"
                      rf"{re.escape(symbol)}\b", text, re.DOTALL)
    if not m:
        return None
    lines = [re.sub(r"^\s*(?:/\*\*|\*/|\*)\s?", "", ln) for ln in m.group(1).splitlines()]
    body = _normalize_space(" ".join(ln for ln in lines if ln.strip() and ln.strip() != "*/").replace("*/", ""))
    return body or None


def py_doc(text: str, symbol: str) -> str | None:
    """Premier paragraphe de la docstring de `symbol` (fonction ou classe), ou du module si `symbol` est vide."""
    tree = ast.parse(text)
    node: ast.AST | None = tree
    if symbol:
        node = next((n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef | ast.ClassDef) and n.name == symbol), None)
    doc = ast.get_docstring(node) if node is not None else None  # type: ignore[arg-type]
    return _normalize_space(doc.split("\n\n")[0]) if doc else None


def doc_of(ref: str, repo_root: Path) -> str | None:
    """`chemin:symbole` -> phrase de documentation du code (None si le fichier ou le symbole n'existe pas ou n'a pas de doc)."""
    path, _, symbol = ref.partition(":")
    f = repo_root / path
    if not f.exists():
        return None
    text = f.read_text(encoding="utf-8")
    return py_doc(text, symbol) if path.endswith(".py") else ts_doc(text, symbol)


# --------------------------------------------------------------------------- blocs : la seule saisie humaine
@dataclass(frozen=True)
class Family:
    id: str
    label: str
    files: tuple[str, ...]  # composants du registre (chemin depuis frontend/src/components/)
    dirs: tuple[str, ...] = ()  # motifs fnmatch des dossiers de calcul (data/interim) lus par la publication
    scripts: tuple[str, ...] = ()  # scripts de pipeline/scripts/
    tests: tuple[str, ...] = ()  # tests (chemin depuis la racine du dépôt)
    formulas: tuple[str, ...] = ()  # `chemin:symbole` : documentation du code qui porte la formule
    nature: str = ""  # statistique (aucun calcul r5py), calcul r5py, etc. (une phrase)


_SKY_DIRS = ("matrix_modes_b44", "matrix_walk*_d031_b44", "matrix_walk*_d031_nuit_b44", "matrix_velib_b44",
             "matrix_story_d031_b44", "matrix_bike_transit_all_d031_b44_*", "car_dist_carspeed_v2_b44",
             "od_walk*_d031", "od_walk*_d031_nuit_*")
_ITIN_DIRS = ("itineraries_walk*_d031_b44", "itineraries_walk*_d031_nuit_b44")
_P = "pipeline/tests/"
_F = "frontend/src/data/"

FAMILIES: tuple[Family, ...] = (
    Family("B01", "Le ciel : astres, tailles, états allumé ou éteint, liste, résumé, légende, crédits",
           ("SkyCredit.tsx", "SkyList.tsx", "SkySummary.tsx", "Legend.tsx", "SizeKey.tsx"),
           _SKY_DIRS,
           ("03_build_jobs_poles.py", "03b_sky_groups.py", "04_compute_matrix_b44.py", "04e_compute_walk_variant.py",
            "04c_compute_od_table.py", "06_export_front.py", "06d_export_od.py"),
           (_P + "test_sky_groups.py", _P + "test_od_table.py", _P + "test_matrix_io.py",
            _F + "accessibility.test.ts", _F + "od/sky.test.ts", _F + "astreBassin.test.ts"),
           ("frontend/src/data/accessibility.ts:isAccessible", "frontend/src/data/accessibility.ts:computePoleStates",
            "frontend/src/data/od/texts.ts:calcMethodText", "pipeline/starway/sky_groups.py:",
            "pipeline/starway/od_table.py:", "pipeline/starway/export.py:build_access"),
           "calcul r5py (aller ET retour) agrégé par astre ; taille de l'astre = postes salariés recensés par l'INSEE (Flores)"),
    Family("B02", "Compteur de postes salariés (INSEE) atteints et d'astres allumés",
           ("CounterBlock.tsx", "JobsCounter.tsx"), _SKY_DIRS,
           ("06_export_front.py", "06d_export_od.py"),
           (_F + "accessibility.test.ts", _F + "od/compute.test.ts", _F + "coverage.test.ts"),
           ("frontend/src/data/accessibility.ts:computeTotals", "frontend/src/data/accessibility.ts:isAccessible",
            "frontend/src/data/od/texts.ts:calcMethodText"),
           "somme des postes des astres accessibles du ciel affiché (aller ET retour dans le temps choisi)"),
    Family("B03", "Carte miroir : contours, astres posés sur leur arrêt, communes",
           ("MirrorMap.tsx",), (),
           ("02_build_geo.py", "06b_export_geo.py"),
           (_P + "test_geo_export.py", _F + "geo.test.ts", _F + "mirrorAstres.test.ts"),
           ("pipeline/starway/geo_export.py:", "pipeline/starway/geo.py:"),
           "géométries et positions, aucun temps de trajet propre"),
    Family("B04", "Panneau de preuve : temps aller et retour, postes atteints, modes, heure creuse, horaires libres",
           ("ProofPanel.tsx", "proof/ProofTimes.tsx", "proof/ProofOd.tsx", "proof/ProofBadgeLine.tsx",
            "proof/ProofOffpeak.tsx", "proof/ProofModes.tsx"),
           _SKY_DIRS + _ITIN_DIRS,
           ("04c_compute_od_table.py", "04e_compute_walk_variant.py", "04h_transit_itineraries.py", "06d_export_od.py",
            "06h_export_itineraries.py"),
           (_P + "test_od_table.py", _P + "test_od_night.py", _P + "test_od_export.py", _P + "test_itineraries.py",
            _F + "proofPanel.test.ts", _F + "proof.test.ts", _F + "od/texts.test.ts", _F + "od/shift.test.ts"),
           ("frontend/src/data/od/texts.ts:calcMethodText", "frontend/src/data/od/texts.ts:nightNetworkMethodText",
            "frontend/src/data/od/texts.ts:nightReturnMethodText", "pipeline/starway/od_night.py:",
            "pipeline/starway/itineraries.py:"),
           "calcul r5py sur les horaires IDFM (TRA01, TRA01B pour le matin, TRA01C pour le soir) et le réseau OSM"),
    Family("B05", "Lignes et correspondances : climatisation, ponctualité, accessibilité en gare, correspondances trop courtes",
           ("proof/ProofTransports.tsx", "proof/ProofTransferCheck.tsx"), _ITIN_DIRS,
           ("04h_transit_itineraries.py", "06h_export_itineraries.py", "06t_export_transfer_check.py",
            "07h_transfer_times_check.py"),
           (_P + "test_line_facts.py", _P + "test_transfer_times.py", _P + "test_transfer_marks.py",
            _F + "transferCheck.test.ts", _F + "panneauLignes.test.ts", _F + "provenancePanneauLignes.test.ts"),
           ("pipeline/starway/line_facts.py:", "pipeline/starway/transfer_times.py:", "pipeline/starway/transfer_marks.py:"),
           "faits relevés par ligne dans les fichiers ouverts, recopiés sur chaque tronçon des itinéraires"),
    Family("B06", "Trajet en transports en commun : coût au ticket et part de chaque ticket, abonnements, Vélib', carbone, trajets alternatifs",
           ("proof/TripBlock.tsx", "subscriptions/ProofSubscriptions.tsx", "subscriptions/SubscriptionsDialog.tsx",
            "subscriptions/SubscriptionsButton.tsx"), _ITIN_DIRS,
           ("04h_transit_itineraries.py", "06h_export_itineraries.py", "06i_export_subscriptions.py", "01_download.py",
            "04q_transit_alternatives.py", "04q_transit_alternatives_confort.py", "04r_alternatives_priority.py",
            "06w_export_alternatives.py"),
           (_P + "test_ticket_rules.py", _P + "test_subscriptions.py", _P + "test_itineraries.py", _P + "test_itin_export.py",
            _P + "test_line_facts.py", _P + "test_alternatives.py", _P + "test_alternatives_export.py",
            _F + "subscriptions.test.ts", _F + "costBreakdown.test.ts", _F + "tripTiles.test.ts",
            "frontend/src/components/proof/alternatives/alternatives.test.ts"),
           ("pipeline/starway/ticket_rules.py:", "pipeline/starway/fares_carbon.py:count_tickets",
            "pipeline/starway/subscriptions.py:transit_round_trip", "pipeline/starway/subscriptions.py:velib_effects",
            "pipeline/starway/fares_carbon.py:trip_co2", "pipeline/starway/fares_carbon.py:leg_co2_g",
            "pipeline/starway/alternatives.py:select_abc", "pipeline/starway/alternatives_export.py:a_wins",
            "pipeline/starway/alternatives_export.py:coverage_doc",
            "frontend/src/components/proof/alternatives/alternatives.ts:resolveAlternatives",
            "frontend/src/data/costBreakdown.ts:ticketBreakdown"),
           "prix publiés par IDFM et Vélib', comptés sur les tronçons des itinéraires ; aucun prix n'est estimé ; la part de chaque ticket est son nombre "
           "x le prix à l'unité publié (subscriptions.json, unit_tickets) et n'est dessinée que si la somme retombe sur le coût ; carbone : distance de "
           "chaque tronçon x facteur d'émission publié par IDFM pour sa ligne ou son mode ; autres trajets : calcul r5py (04q) sur le même réseau que les "
           "itinéraires publiés, largeur de recherche de 15 min (réglage de l'équipe), le plus rapide est l'itinéraire publié, une case non calculée reste "
           "« pas encore calculé »"),
    Family("B08", "Voiture et deux-roues : coût d'énergie, carbone, péages, trafic moyen",
           ("proof/ProofCarCost.tsx", "proof/ProofTraffic.tsx", "proof/ModeTripBlock.tsx"),
           ("matrix_modes_b44", "car_dist_carspeed_v2_b44"),
           ("04g_car_distances.py", "04i_osm_toll_points.py", "04j_toll_tariffs.py", "04k_toll_crosscheck.py",
            "06k_export_tolls.py"),
           (_P + "test_car_dist.py", _P + "test_tolls.py", _P + "test_toll_publish.py", _P + "test_toll_crosscheck.py",
            _P + "test_congestion_vehicles.py", _F + "congestion.test.ts", _F + "tolls.test.ts",
            "frontend/src/components/proof/ProofCarCost.test.ts", _F + "costBreakdown.test.ts"),
           ("pipeline/starway/vehicles.py:", "pipeline/starway/congestion.py:", "pipeline/starway/toll_publish.py:",
            "pipeline/starway/tolls.py:", "pipeline/starway/car_dist.py:"),
           "distance routière r5py (OSM) x consommation et prix publiés ; péages lus dans les tarifs officiels"),
    Family("B09", "Mes besoins : accessibilité déclarée par les sources sur le trajet, marque sur le ciel",
           ("proof/ProofNeeds.tsx", "needs/NeedsMarks.tsx"), _ITIN_DIRS,
           ("06n_export_needs.py", "07n_needs_measure.py"),
           (_P + "test_needs.py", _F + "needs.test.ts", _F + "needsSky.test.ts"),
           ("pipeline/starway/needs.py:", "pipeline/starway/needs.py:star_marked"),
           "recopie de ce que déclarent TRA03 et TRA04 ; jamais « trajet accessible »"),
    Family("B10", "Projets de recrutement BMO du bassin d'emploi (tendance, jamais des offres)",
           ("recruit/ProofRecruit.tsx",), (),
           ("06j_export_bmo.py",),
           (_P + "test_bmo.py", "frontend/src/components/recruit/ProofRecruit.test.ts", _F + "bmo.test.ts"),
           ("pipeline/starway/bmo.py:", "pipeline/starway/bmo.py:build_export"),
           "statistique de l'enquête BMO 2026 de France Travail, aucun calcul de trajet"),
    Family("B11", "Offres diffusées sur « Choisir le service public » (bloc à part)",
           ("proof/ProofPublicOffers.tsx",), (),
           ("06q_export_service_public.py",),
           (_P + "test_service_public.py", "frontend/src/components/proof/ProofPublicOffers.test.ts",
            _F + "publicOffers.test.ts"),
           ("pipeline/starway/service_public.py:", "pipeline/starway/service_public.py:build_offers"),
           "offres en ligne à la date du fichier DGAFP, jamais ajoutées aux postes salariés recensés par l'INSEE"),
    Family("B12", "Postes salariés (INSEE) et flux domicile-travail du recensement vers l'astre",
           ("proof/ProofJobs.tsx",), (),
           ("03_build_jobs_poles.py", "05_build_context.py"),
           (_P + "test_context.py", _F + "context.test.ts", _F + "flows44.test.ts"),
           ("pipeline/starway/context.py:flows_block", "frontend/src/data/proof.ts:flowToPole"),
           "statistique INSEE (Flores, recensement par sondage), aucun calcul de trajet"),
    Family("B13", "Découvertes du jour et contraste",
           ("Insights.tsx", "ContrastOfTheDay.tsx"),
           ("od_walk*_d031", "od_walk*_d031_nuit_*"),
           ("08e_insights_astres.py", "07d_navitia_crosscheck.py"),
           (_P + "test_insights_astres.py", _P + "test_insights.py", _F + "insights.test.ts"),
           ("pipeline/starway/insights_astres.py:", "pipeline/starway/insights.py:"),
           "scénarios remarquables détectés dans la table commune x commune agrégée par astre"),
    Family("B14", "Halo « Derrière notre étoile » : âge, modes de transport par sexe, niveau de vie",
           ("HaloPanel.tsx", "HaloAstrolabe.tsx", "HaloDotPlot.tsx", "IncomeRanks.tsx"), (),
           ("05_build_context.py",),
           (_P + "test_context.py", _P + "test_gender_contrast.py", _F + "halo.test.ts", _F + "incomeRank.test.ts"),
           ("pipeline/starway/context.py:", "pipeline/starway/context.py:income_blocks"),
           "statistique INSEE (recensement, Filosofi) de la commune, secret statistique respecté"),
    Family("B16", "Repères de territoire : chômage de la zone d'emploi, du département et de la région, temps de travail, polarité SDRIF-E",
           ("territoire/UnemploymentTab.tsx", "territoire/WorkTime.tsx", "territoire/Polarity.tsx"), (),
           ("06v_export_territoire.py",),
           (_P + "test_territoire.py", _F + "territoire.test.ts"),
           ("pipeline/starway/territoire.py:", "frontend/src/data/territoire.ts:", "frontend/src/data/territoire.ts:zoneRank"),
           "statistique Insee et Région Île-de-France lue telle quelle, aucun calcul de trajet ; descriptive, sur la commune de départ, jamais sur un astre"),
)

# Visite guidée : les variables de narration (`{pole.oralName}`...) sont résolues depuis les MÊMES données que
# l'interface (en-tête de tour/variables.ts). Chaque préfixe de variable relève d'un bloc (ou de codes de source).
VISIT_PREFIX_FAMILY: dict[str, str] = {
    "access": "B01", "delta": "B01", "compare": "B01", "gain": "B01", "pole": "B01", "anchor": "B01", "origin": "B01", "day": "B01",
    "budget": "B01", "mode": "B01", "trip": "B01", "flow": "B12", "halo": "B14",
    "bmo": "B10",  # étape « recrutement » jouée sur le site depuis le 06/11 : chiffre de la famille de métiers du panneau
}
VISIT_PREFIX_CODES: dict[str, tuple[str, ...]] = {"region": ("GEO01",)}  # population régionale = communes.json (API Géo)
VISIT_FORMULAS = ("frontend/src/tour/variables.ts:",)
VISIT_SCRIPTS = ("06_export_front.py",)
VISIT_TESTS = ("frontend/src/tour/tours/lea.test.ts", "frontend/src/tour/variables.test.ts",
               "frontend/src/tour/resolve.test.ts", "frontend/src/tour/vtt.test.ts",
               "frontend/src/tour/siteFigures.test.ts")


def family_of_file(file: str, families: Sequence[Family] = FAMILIES) -> Family | None:
    return next((f for f in families if file in f.files), None)


# --------------------------------------------------------------------------- empreintes : fichiers et manifeste
def lf_sha256(path: Path) -> str:
    """sha256 stable d'un fichier : fins de ligne normalisées en LF pour un fichier TEXTE (la même valeur sur un clone Linux,
    macOS ou Windows, comme le manifeste et l'index git), octets tels quels pour un fichier binaire."""
    if path.suffix.lower() in TEXT_SUFFIXES and path.stat().st_size <= MAX_TEXT_BYTES:
        return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    return file_hashes(path)["brut"]


def file_hashes(path: Path) -> dict[str, str]:
    """sha256 d'un fichier : `brut`, et pour un fichier texte versionné `LF` et `CRLF` (fins de ligne normalisées)."""
    if path.suffix.lower() in TEXT_SUFFIXES and path.stat().st_size <= MAX_TEXT_BYTES:
        data = path.read_bytes()
        lf = data.replace(b"\r\n", b"\n")
        return {"brut": hashlib.sha256(data).hexdigest(), "LF": hashlib.sha256(lf).hexdigest(),
                "CRLF": hashlib.sha256(lf.replace(b"\n", b"\r\n")).hexdigest()}
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return {"brut": h.hexdigest()}


@dataclass(frozen=True)
class DataRoots:
    """Où lire les fichiers du manifeste : `data/raw` et `data/interim` (non versionnés, parfois dans un autre arbre) et
    `data/processed` (versionné), plus la racine du dépôt pour les autres chemins."""

    repo: Path
    raw: Path
    interim: Path
    processed: Path


def resolve_local(fichier_local: str, roots: DataRoots) -> tuple[Path | None, str]:
    """(chemin local ou None, nature) d'un `fichier_local` du manifeste. Nature : `fichier`, `repertoire` ou `hors_depot`
    (fichier de la VM ou du poste hors dépôt : il n'a pas de chemin dans l'arbre)."""
    first = re.split(r"\s+\(", fichier_local.strip(), maxsplit=1)[0].strip()
    if not first.startswith("data/"):
        return None, "hors_depot"
    rel = first.removeprefix("data/")
    for prefix, base in (("raw/", roots.raw), ("interim/", roots.interim), ("processed/", roots.processed)):
        if rel.startswith(prefix):
            p = base / rel.removeprefix(prefix)
            return p, "repertoire" if first.endswith("/") else "fichier"
    return roots.repo / first, "repertoire" if first.endswith("/") else "fichier"


@dataclass(frozen=True)
class RowCheck:
    source_id: str
    fichier_local: str
    status: str  # ok | ok_eol | ecart | absent | repertoire | hors_depot | sans_empreinte
    detail: str = ""


def check_manifest(rows: Iterable[Mapping[str, str]], roots: DataRoots) -> tuple[list[RowCheck], dict[str, list[tuple[str, str]]]]:
    """Compare le sha256 de chaque ligne du manifeste au fichier. Renvoie les contrôles et l'index sha256 ->
    [(source_id, fichier_local)] (toutes les formes de fins de ligne des fichiers présents y figurent)."""
    checks: list[RowCheck] = []
    index: dict[str, list[tuple[str, str]]] = {}
    memo: dict[Path, dict[str, str]] = {}
    for r in rows:
        sid, fl, sha = r["source_id"], r["fichier_local"], (r.get("sha256") or "").strip().lower()
        if sha:
            index.setdefault(sha, []).append((sid, fl))
        if not sha:
            checks.append(RowCheck(sid, fl, "sans_empreinte", "sha256 vide"))
            continue
        path, nature = resolve_local(fl, roots)
        if nature == "hors_depot":
            checks.append(RowCheck(sid, fl, "hors_depot", "fichier hors dépôt (VM ou poste) : empreinte relevée à la source"))
            continue
        if nature == "repertoire":
            checks.append(RowCheck(sid, fl, "repertoire", "empreinte d'une liste de fichiers : non recalculée"))
            continue
        assert path is not None
        if not path.exists():
            checks.append(RowCheck(sid, fl, "absent", f"fichier absent de {path.parent}"))
            continue
        if path not in memo:
            memo[path] = file_hashes(path)
        forms = memo[path]
        for h in forms.values():
            lst = index.setdefault(h, [])
            if (sid, fl) not in lst:
                lst.append((sid, fl))
        if forms["brut"] == sha:
            checks.append(RowCheck(sid, fl, "ok"))
        elif sha in forms.values():
            checks.append(RowCheck(sid, fl, "ok_eol", "même contenu, fins de ligne différentes"))
        else:
            checks.append(RowCheck(sid, fl, "ecart", f"manifeste {sha[:12]}, fichier {forms['brut'][:12]}"))
    return checks, index


# --------------------------------------------------------------------------- dossiers de calcul (run_params.json)
FINGERPRINTS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("r5_jar_sha256", "jar R5", ("ENG01",)),
    ("gtfs_sha256", "GTFS", ("TRA01", "TRA01B", "TRA01C")),
    ("osm_sha256", "OSM", ("CYC01",)),
    ("poles", "fichier des astres", ("GEO04B",)),
    ("same_stop_csv_sha256", "durées au même arrêt", ("TRA02B", "TRA02C")),
    ("origin_points_sha256", "points d'origine", ("GEO02B",)),
    ("vel01_sha256", "stations Vélib'", ("VEL01",)),
)
REQUIRED_FINGERPRINTS = ("r5_jar_sha256", "gtfs_sha256", "osm_sha256")  # leur absence est un écart de traçabilité


@dataclass
class Resolution:
    key: str
    label: str
    sha: str | None
    status: str  # ok | absent | inconnu | autre_source
    target: str = ""  # `ENG01 (r5-v7.5.1-r5py-walk3000-d031-all.jar)`


@dataclass
class CalcDir:
    name: str
    role: str
    state: str  # absent | partiel | complet
    params_sha: str | None
    params: dict[str, Any]
    resolutions: list[Resolution] = field(default_factory=list)
    detail: str = ""


def published_calc_dirs(roots: DataRoots, sky: str = "44") -> list[CalcDir]:
    """Dossiers de calcul que la publication lit pour le ciel `sky` (même liste que 06 et 07p : `publication.dir_states`)."""
    from starway import publication as pub

    inp = pub.sky_inputs(sky, pub.RULES_D031, roots.interim, roots.processed)
    out: list[CalcDir] = []
    for s in pub.dir_states(inp):
        rp = roots.interim / s.name / "run_params.json"
        sha = lf_sha256(rp) if rp.exists() else None
        out.append(CalcDir(s.name, s.role, s.status, sha, s.params, detail=s.detail))
    return out


def _file_of(entry: tuple[str, str]) -> str:
    return re.split(r"\s+\(", entry[1].strip(), maxsplit=1)[0].replace("\\", "/").rsplit("/", 1)[-1].rsplit(":", 1)[-1]


def resolve_fingerprints(cd: CalcDir, index: Mapping[str, list[tuple[str, str]]], points_sha: str | None) -> None:
    """Rapproche chaque empreinte de `run_params.json` d'une ligne du manifeste (par sha256) : lecture seule."""
    from starway import publication as pub

    expected_gtfs = pub.gtfs_source_of(cd.name)
    for key, label, codes in FINGERPRINTS:
        sha = pub.poles_sha_of(cd.params) if key == "poles" else cd.params.get(key)
        if not sha:
            cd.resolutions.append(Resolution(key, label, None, "absent"))
            continue
        if key == "origin_points_sha256":
            ok = points_sha is not None and sha == points_sha
            if not ok and cd.params.get("n_origins") not in (None, 1285):
                # récit, Vélib' : empreinte du sous-ensemble d'origines du calcul, contrôlée au lancement par 04b et 04d
                cd.resolutions.append(Resolution(key, label, sha, "sous_ensemble",
                                                 f"sous-ensemble de {cd.params.get('n_origins')} origines"))
                continue
            cd.resolutions.append(Resolution(key, label, sha, "ok" if ok else "inconnu",
                                             "GEO02B (communes_idf_2026.csv)" if ok else ""))
            continue
        hits = [e for e in index.get(sha, []) if e[0] in codes]
        if not hits:
            other = [e for e in index.get(sha, [])]
            cd.resolutions.append(Resolution(key, label, sha, "autre_source" if other else "inconnu",
                                             ", ".join(f"{e[0]} ({_file_of(e)})" for e in other)))
            continue
        status = "ok"
        if key == "gtfs_sha256" and hits[0][0] != expected_gtfs:
            status = "autre_source"
        if key == "gtfs_sha256" and fx.PREVIOUS_FLAG in hits[0][1] and not fx.is_non_transit_dir(cd.name):
            status = "autre_source"  # un calcul avec transports sur le flux précédent n'est pas celui du flux publié
        cd.resolutions.append(Resolution(key, label, sha, status, ", ".join(f"{e[0]} ({_file_of(e)})" for e in hits)))


def expected_points_sha(processed: Path) -> str | None:
    """Empreinte de contenu des points d'origine (starway.origin_points), recalculée sur communes_idf_2026.csv."""
    f = processed / "communes_idf_2026.csv"
    if not f.exists():
        return None
    import pandas as pd

    from starway.origin_points import origin_points_sha256

    df = pd.read_csv(f, dtype={"insee": str, "dep": str})
    return origin_points_sha256(df[df["is_origin"]])


# --------------------------------------------------------------------------- collecte
@dataclass
class FamilyData:
    family: Family
    entries: list[CoverageEntry]
    notes: dict[str, list[NoteUse]]  # composant -> notes posées
    codes: list[str]  # sources affichées (registre), dans l'ordre
    when_published: list[str]
    formulas: list[tuple[str, str]]  # (réf, texte)
    methods: list[tuple[str, str]]  # (METHODS.clé, texte)
    dirs: list[CalcDir]
    calc_codes: dict[str, set[str]]  # code -> sha256 des fichiers référencés par les dossiers (sources du calcul)


class Problem(NamedTuple):
    """Écart de traçabilité. `level` : P0 (bloquant) ou P1 (signalé) ; `kind` : bloc, source, sha, calcul, formule, visite, fichier."""

    level: str
    kind: str
    message: str


@dataclass
class Trace:
    roots: DataRoots
    manifest: list[dict[str, str]]
    entries: list[CoverageEntry]
    families: list[FamilyData]
    calc_dirs: list[CalcDir]
    checks: list[RowCheck]
    visit: dict[str, Any]
    problems: list[Problem]


def collect(roots: DataRoots, manifest: list[dict[str, str]] | None = None, families: Sequence[Family] = FAMILIES,
            verify: bool = True) -> Trace:
    """Lit le registre du front, les composants, le manifeste, le code et les run_params ; ne calcule rien d'autre.
    `verify=False` saute le recalcul des sha256 des fichiers du manifeste (rendu seul : il n'en dépend pas)."""
    repo = roots.repo
    if manifest is None:
        manifest = _read_manifest(repo / "data" / "sources_manifest.csv")
    entries = parse_coverage((repo / REGISTRY_TS).read_text(encoding="utf-8"))
    methods = parse_methods((repo / PROVENANCE_TS).read_text(encoding="utf-8"))
    problems: list[Problem] = []
    manifest_codes = {r["source_id"] for r in manifest}

    # --- composants du registre : un seul bloc chacun, et tout composant scanné est au registre
    by_file = {e.file: e for e in entries}
    for e in entries:
        if family_of_file(e.file, families) is None:
            problems.append(Problem("P0", "bloc", f"composant du registre sans bloc de traçabilité : {e.file}"))
    for f in families:
        for file in f.files:
            if file not in by_file:
                problems.append(Problem("P0", "bloc", f"bloc {f.id} : composant absent du registre du front : {file}"))
    for file in scanned_components(repo / COMPONENTS_DIR):
        if file not in by_file:
            problems.append(Problem("P0", "bloc", f"composant de preuve absent du registre du front : {file}"))

    # --- sources : chaque code cité est au manifeste (les codes `whenPublished` n'y sont pas encore par construction)
    for e in entries:
        for c in e.codes:
            if c not in manifest_codes:
                problems.append(Problem("P0", "source", f"{e.file} cite {c}, absent du manifeste"))

    checks: list[RowCheck] = []
    index: dict[str, list[tuple[str, str]]] = {}
    # flux GTFS remplacés (data/flux_gtfs_precedents.csv, gardés) : leur fichier reste vérifié et leur empreinte reste
    # reconnue pour les calculs sans transport, non relancés
    rows_checked = [*manifest, *fx.previous_manifest_rows(repo / "data" / "flux_gtfs_precedents.csv")]
    if verify:
        checks, index = check_manifest(rows_checked, roots)
    else:
        for r in rows_checked:
            if r.get("sha256"):
                index.setdefault(r["sha256"].lower(), []).append((r["source_id"], r["fichier_local"]))
    for c in checks:
        if c.status == "ecart":
            problems.append(Problem("P0", "sha", f"sha256 du manifeste différent du fichier : {c.source_id} {c.fichier_local} "
                                                 f"({c.detail})"))
        elif c.status == "sans_empreinte":
            problems.append(Problem("P0", "sha", f"ligne du manifeste sans sha256 : {c.source_id} {c.fichier_local}"))
        elif c.status == "absent":
            problems.append(Problem("P1", "fichier", f"fichier du manifeste absent, empreinte non vérifiée : {c.source_id} "
                                                     f"{c.fichier_local}"))

    # --- dossiers de calcul
    points_sha = expected_points_sha(roots.processed)
    calc_dirs = published_calc_dirs(roots) if (roots.interim).exists() else []
    for cd in calc_dirs:
        if cd.state == "absent":
            continue
        resolve_fingerprints(cd, index, points_sha)
        for r in cd.resolutions:
            if r.status in ("inconnu", "autre_source"):
                problems.append(Problem("P0", "calcul", f"{cd.name} : {r.label} {str(r.sha)[:12]} ne correspond à aucune ligne "
                                                        f"attendue du manifeste ({r.target or 'inconnue'})"))
            elif r.status == "absent" and r.key in REQUIRED_FINGERPRINTS:
                problems.append(Problem("P1", "calcul", f"{cd.name} : empreinte « {r.label} » non écrite dans run_params.json "
                                                        "(traçabilité incomplète, jamais estimée)"))

    # --- fiches
    fam_data: list[FamilyData] = []
    for f in families:
        fes = [by_file[x] for x in f.files if x in by_file]
        notes = {e.file: scan_component((repo / COMPONENTS_DIR / e.file).read_text(encoding="utf-8")) for e in fes}
        codes: list[str] = []
        wp: list[str] = []
        for e in fes:
            codes += [c for c in e.codes if c not in codes]
            wp += [c for c in e.when_published if c not in wp]
        formulas: list[tuple[str, str]] = []
        for ref in f.formulas:
            doc = doc_of(ref, repo)
            if doc is None:
                problems.append(Problem("P0", "formule", f"bloc {f.id} : formule introuvable ou sans documentation dans le "
                                                         f"code : {ref}"))
            else:
                formulas.append((ref, doc))
        meths: list[tuple[str, str]] = []
        for uses in notes.values():
            for u in uses:
                if u.method and u.method in methods and (f"METHODS.{u.method}", methods[u.method]) not in meths:
                    meths.append((f"METHODS.{u.method}", methods[u.method]))
        for kind, group in (("script", f.scripts), ("test", f.tests)):
            for p in group:
                path = repo / (p if "/" in p else f"pipeline/scripts/{p}")
                if not path.exists():
                    problems.append(Problem("P0", "formule", f"bloc {f.id} : {kind} introuvable : {p}"))
        dirs = [cd for cd in calc_dirs if cd.state != "absent" and any(fnmatch.fnmatch(cd.name, pat) for pat in f.dirs)]
        calc_codes: dict[str, set[str]] = {}
        for cd in dirs:
            for r in cd.resolutions:
                if r.status == "ok" and r.sha:
                    for m in re.finditer(r"([A-Z]{2,5}\d{2}[A-Z]?) \(", r.target):
                        calc_codes.setdefault(m.group(1), set()).add(r.sha)
                    if r.key == "origin_points_sha256":
                        calc_codes.setdefault("GEO02B", set()).add("*")
        fam_data.append(FamilyData(f, fes, notes, codes, wp, formulas, meths, dirs, calc_codes))

    visit = collect_visit(repo, families, entries, problems)
    used = [fd for fd in fam_data if fd.family.id in visit["families"]]
    visit["dirs"] = [cd for cd in calc_dirs if cd.state != "absent" and any(cd in fd.dirs for fd in used)]
    visit["calc_codes"] = {}
    for fd in used:
        for code, shas in fd.calc_codes.items():
            visit["calc_codes"].setdefault(code, set()).update(shas)
    return Trace(roots, manifest, entries, fam_data, calc_dirs, checks, visit, problems)


def _read_manifest(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def tour_variables(tour_ts: str, variables_ts: str) -> list[str]:
    """Variables de narration utilisées par le script de la visite : `{pole.oralName}`, filtrées sur celles que
    `tour/variables.ts` sait résoudre (le reste du texte entre accolades n'est pas une variable)."""
    known = set(re.findall(r"^\s{2}'?([\w.]+)'?:\s*(?:\(|\w+\s*=>)", strip_ts_comments(variables_ts), re.MULTILINE))
    found = set(re.findall(r"\{([A-Za-z][\w.]*)\}", strip_ts_comments(tour_ts)))
    return sorted(found & known)


def collect_visit(repo: Path, families: Sequence[Family], entries: Sequence[CoverageEntry],
                  problems: list[Problem]) -> dict[str, Any]:
    """Visite guidée : variables de narration -> blocs -> sources ; empreinte et date du texte enregistré."""
    vs = tour_variables((repo / TOUR_TS).read_text(encoding="utf-8"), (repo / TOUR_VARIABLES_TS).read_text(encoding="utf-8"))
    fam_ids: list[str] = []
    codes: list[str] = []
    for v in vs:
        prefix = v.split(".")[0]
        if prefix in VISIT_PREFIX_FAMILY:
            fam_ids.append(VISIT_PREFIX_FAMILY[prefix])
        elif prefix in VISIT_PREFIX_CODES:
            codes += [c for c in VISIT_PREFIX_CODES[prefix] if c not in codes]
        else:
            problems.append(Problem("P0", "visite", f"visite : variable de narration sans bloc ni source : {v}"))
    by_id = {f.id: f for f in families}
    fam_ids = sorted(set(fam_ids))
    for fid in fam_ids:
        for file in by_id[fid].files:
            e = next((x for x in entries if x.file == file), None)
            if e:
                codes += [c for c in e.codes if c not in codes]
    resolved = repo / TOUR_RESOLVED
    info: dict[str, Any] = {"variables": vs, "families": fam_ids, "codes": codes, "resolved": None}
    if resolved.exists():
        doc = json.loads(resolved.read_text(encoding="utf-8"))
        info["resolved"] = {"file": TOUR_RESOLVED, "sha256": lf_sha256(resolved),
                            "generated_at": doc.get("generated_at"), "dataset_id": doc.get("dataset_id"),
                            "steps": len(doc.get("steps", []))}
    else:
        problems.append(Problem("P1", "visite", f"visite : {TOUR_RESOLVED} absent (aucune voix enregistrée)"))
    for ref in VISIT_FORMULAS:
        if doc_of(ref, repo) is None:
            problems.append(Problem("P0", "visite", f"visite : formule introuvable dans le code : {ref}"))
    return info


# --------------------------------------------------------------------------- rendu Markdown
def _cell(value: object) -> str:
    s = reg.clean_text(value).replace("|", "\\|")
    return s or "-"


def _short(sha: str | None) -> str:
    return sha if sha else "-"


def _rows_of(code: str, manifest: Sequence[Mapping[str, str]]) -> list[Mapping[str, str]]:
    return sorted((r for r in manifest if r["source_id"] == code), key=lambda r: r["fichier_local"])


def _licence_short(rows: Sequence[Mapping[str, str]]) -> str:
    text = " ; ".join(r.get("licence", "") for r in rows)
    kinds = reg.licence_kinds(text)
    label = " + ".join(reg.LICENCE_SHORT[k] for k in kinds) or "non reconnue"
    return label + (" (à confirmer)" if reg.licence_to_confirm(text) else "")


def _source_table(codes: Sequence[str], manifest: Sequence[Mapping[str, str]], only_sha: Mapping[str, set[str]] | None = None
                  ) -> list[str]:
    lines = ["| source_id | fichier exact | sha256 | date ou millésime | licence |", "|---|---|---|---|---|"]
    for code in codes:
        rows = _rows_of(code, manifest)
        if only_sha is not None and code in only_sha and "*" not in only_sha[code]:
            rows = [r for r in rows if r["sha256"].lower() in only_sha[code]]
        if not rows:
            lines.append(f"| {code} | (aucune ligne au manifeste) | - | - | - |")
            continue
        for r in rows:
            when = r.get("millesime", "")
            if r.get("date_service_transport"):
                when += f" ; service {r['date_service_transport']}"
            when += f" ; relevé {r.get('date_extraction', '')}"
            lines.append(f"| {code} | `{_cell(r['fichier_local'])}` | `{r['sha256']}` | {_cell(when)} | "
                         f"{_cell(_licence_short([r]))} (fiche : docs/sources.md#{code.lower()}) |")
    return lines


def provenance_line(e: CoverageEntry, notes: Mapping[str, list[NoteUse]]) -> str:
    """Ligne du mode sources d'un composant : notes posées (kind `notes`), parent (`covered`) ou raison (`exempt`)."""
    if e.kind == "notes":
        return ", ".join(u.label() for u in notes.get(e.file, [])) or "(aucune note détectée)"
    if e.kind == "covered":
        return f"couverte par la ligne de {e.covered_by}"
    return f"aucune ligne (exemptée : {e.reason})"


def _state_text(cd: CalcDir) -> str:
    return f"{cd.state} ({cd.detail})" if cd.detail else cd.state


def _calc_section(dirs: Sequence[CalcDir], calc_codes: Mapping[str, set[str]], calc_only: Sequence[str],
                  manifest: Sequence[Mapping[str, str]]) -> list[str]:
    """Dossiers de calcul d'un bloc (empreinte du run_params.json) et sources du calcul qui n'y sont pas déjà affichées."""
    out: list[str] = []
    if dirs:
        out += ["", "Dossiers de calcul (empreinte du `run_params.json`, détail des autres empreintes en section 3) :", "",
                "| dossier | état | sha256 du run_params.json |", "|---|---|---|"]
        out += [f"| `{cd.name}` | {_cell(_state_text(cd))} | `{_short(cd.params_sha)}` |" for cd in dirs]
    if calc_only:
        out += ["", "Sources du calcul (lues dans les `run_params.json` ci-dessus, rapprochées du manifeste par sha256) :", ""]
        out += _source_table(calc_only, manifest, calc_codes)
    return out


def render(trace: Trace) -> str:
    L: list[str] = []
    a = L.append
    a("# Traçabilité : d'où vient chaque donnée affichée, et comment elle est calculée")
    a("")
    a(f"<!-- Fichier généré par {GENERATOR} depuis le registre du front ({REGISTRY_TS}), le manifeste")
    a("     (data/sources_manifest.csv), les run_params.json des dossiers de calcul et le code. NE PAS MODIFIER À LA MAIN :")
    a("     relancer `python scripts/06u_tracabilite.py` (contrôle : `--check`, et le P0 « traçabilité » de 07). -->")
    a("")
    a("Une ligne par composant du site qui montre un chiffre (le registre du mode sources, D-033), regroupés en blocs, plus "
      "la visite guidée. Pour chaque bloc : source (identifiant du manifeste), fichier exact et sha256, date ou millésime, "
      "licence, formule (lue dans le code), dossiers de calcul avec l'empreinte de leur `run_params.json`, scripts, tests et "
      "ligne du mode sources. Rien n'est écrit à la main ni estimé : une donnée qui ne peut pas être sourcée est retirée du "
      "site ou signalée à la coordination (section 4).")
    a("")
    a("Le contrôle P0 de `07_quality_checks.py` échoue si un composant affiché n'a pas de ligne ici, si un code de source "
      "n'est pas au manifeste, si un sha256 du manifeste ne correspond pas au fichier, ou si ce document n'est pas à jour.")
    a("")
    a("## 1. Index des composants affichés")
    a("")
    a("| Composant | Bloc | Genre | Sources affichées | Ligne du mode sources |")
    a("|---|---|---|---|---|")
    for fd in trace.families:
        for e in fd.entries:
            a(f"| `{e.file}` | {fd.family.id} | {e.kind} | {_cell(', '.join(e.codes) or 'aucune')} | "
              f"{_cell(provenance_line(e, fd.notes))} |")
    v = trace.visit
    a(f"| `{VISIT_ROW}` | {VISIT_ID} | visite | {_cell(', '.join(v['codes']))} | "
      "mode sources coupé par défaut, visite comprise (D-033) ; les blocs montrés portent leurs notes |")
    a("")
    a("## 2. Fiches par bloc")
    for fd in trace.families:
        f = fd.family
        a("")
        a(f"### {f.id} : {f.label}")
        a("")
        a(f"- **Composants** : {', '.join(f'`{x}`' for x in f.files)}")
        a(f"- **Nature** : {f.nature}")
        a("- **Ligne du mode sources** :")
        for e in fd.entries:
            a(f"  - `{e.file}` : {_cell(provenance_line(e, fd.notes))}")
        a("- **Formule (lue dans le code)** :")
        for ref, doc in fd.formulas:
            a(f"  - `{ref.rstrip(':')}` : {_cell(doc)}")
        for ref, doc in fd.methods:
            a(f"  - texte affiché (`{ref}`, {PROVENANCE_TS}) : {_cell(doc)}")
        a(f"- **Scripts** : {', '.join(f'`pipeline/scripts/{s}`' for s in f.scripts) or 'aucun'}")
        a(f"- **Tests** : {', '.join(f'`{t}`' for t in f.tests) or 'aucun'}")
        a("")
        a("Sources affichées (registre du front) :")
        a("")
        L.extend(_source_table(fd.codes, trace.manifest))
        if fd.when_published:
            a("")
            a(f"Citées seulement quand le pipeline les publie : {', '.join(fd.when_published)}.")
        calc_only = [c for c in sorted(fd.calc_codes) if c not in fd.codes]
        L.extend(_calc_section(fd.dirs, fd.calc_codes, calc_only, trace.manifest))
        if not fd.dirs:
            a("")
            a("Aucun dossier de calcul r5py : donnée statistique ou géographique lue directement dans les sources ci-dessus.")
    a("")
    a(f"### {VISIT_ID} : Visite guidée narrée (cas de Léa)")
    a("")
    a("- **Composants** : `frontend/src/tour/tours/lea.tour.ts` et le lecteur `frontend/src/tour/`")
    a("- **Nature** : les chiffres prononcés sont des variables de narration résolues au moment de la lecture depuis les "
      "MÊMES données et fonctions que l'interface (en-tête de `tour/variables.ts`) ; une variable absente n'est jamais "
      "prononcée.")
    a(f"- **Variables utilisées par le script** ({len(v['variables'])}) : {', '.join(f'`{x}`' for x in v['variables'])}")
    a(f"- **Blocs dont viennent ces variables** : {', '.join(v['families'])} (préfixes `region.` : population des communes, GEO01)")
    for ref in VISIT_FORMULAS:
        a(f"- **Formule (lue dans le code)** : `{ref.rstrip(':')}` : {_cell(doc_of(ref, trace.roots.repo))}")
    if v["resolved"]:
        r = v["resolved"]
        a(f"- **Voix enregistrée** : `{r['file']}` (sha256 `{r['sha256']}`, {r['steps']} étapes, enregistrée le "
          f"{r['generated_at']}, jeu `{r['dataset_id']}`) ; une voix n'est lue que si le texte résolu à l'écran est "
          "identique, mot pour mot, au texte enregistré (`stepAudio`, `frontend/src/tour/vtt.ts`).")
    a(f"- **Scripts** : {', '.join(f'`pipeline/scripts/{s}`' for s in VISIT_SCRIPTS)}")
    a(f"- **Tests** : {', '.join(f'`{t}`' for t in VISIT_TESTS)}")
    a("")
    a("Sources affichées pendant la visite (union de celles des blocs ci-dessus) :")
    a("")
    L.extend(_source_table(v["codes"], trace.manifest))
    L.extend(_calc_section(v["dirs"], v["calc_codes"], [c for c in sorted(v["calc_codes"]) if c not in v["codes"]],
                           trace.manifest))

    a("")
    a("## 3. Dossiers de calcul et empreintes des `run_params.json`")
    a("")
    if not trace.calc_dirs:
        a("Les dossiers `data/interim/` ne sont pas lisibles là où ce document a été généré : cette section est vide. "
          "Relancer 06u sur le poste de calcul (variable `STARWAY_DATA_ROOT`).")
    else:
        a("Dossiers lus par la publication du ciel des 44 astres (`starway.publication.dir_states`). Chaque empreinte est "
          "rapprochée de la ligne du manifeste de même sha256 ; « non enregistré » : le `run_params.json` ne l'écrit pas "
          "(traçabilité incomplète, jamais estimée).")
        a("")
        a("| dossier | état | sha256 du run_params.json | " + " | ".join(lbl for _, lbl, _ in FINGERPRINTS) + " |")
        a("|---|---|---|" + "---|" * len(FINGERPRINTS))
        for cd in trace.calc_dirs:
            if cd.state == "absent":
                continue
            cells = []
            for r in cd.resolutions:
                if r.status == "absent":
                    cells.append("non enregistré" if r.key in REQUIRED_FINGERPRINTS else "-")
                elif r.status == "ok" or r.status == "sous_ensemble":
                    cells.append(f"{r.target} `{r.sha}`")
                else:
                    cells.append(f"NON RAPPROCHÉ `{r.sha}`")
            if not cd.resolutions:
                cells = ["dossier absent de ce poste"] * len(FINGERPRINTS)
            a(f"| `{cd.name}` | {_cell(_state_text(cd))} | `{_short(cd.params_sha)}` | " + " | ".join(_cell(c) for c in cells) + " |")
    a("")
    a("## 4. Écarts connus et ce qui n'a pas pu être sourcé")
    a("")
    gaps: list[str] = []
    absent = [cd.name for cd in trace.calc_dirs if cd.state == "absent"]
    if absent:
        gaps.append("Dossiers que la publication sait lire mais qui sont absents des données lues ici (aucune empreinte à citer, "
                    "ils n'apparaissent dans aucune fiche ; à rapatrier avant toute publication) : "
                    + ", ".join(f"`{n}`" for n in absent) + ".")
    for cd in trace.calc_dirs:
        for r in cd.resolutions:
            if r.status == "absent" and r.key in REQUIRED_FINGERPRINTS:
                gaps.append(f"`{cd.name}` : l'empreinte « {r.label} » n'est pas écrite dans son `run_params.json` ; rien n'est "
                            "déduit à sa place (traçabilité incomplète, signalée à la coordination).")
            elif r.status in ("inconnu", "autre_source"):
                gaps.append(f"`{cd.name}` : l'empreinte « {r.label} » `{r.sha}` ne correspond à aucune ligne attendue du manifeste.")
    outside = sorted({(r["source_id"], r["fichier_local"].split(" (")[0]) for r in trace.manifest
                      if not r["fichier_local"].strip().startswith("data/")})
    if outside:
        gaps.append("Fichiers du manifeste hors du dépôt (jars R5 de la VM et du poste) : sha256 relevé à la source (`sha256sum` "
                    "en lecture seule sur la VM) et retrouvé dans les `run_params.json` ; non rechargeables ici : "
                    + ", ".join(f"{s} `{p.rsplit('/', 1)[-1]}`" for s, p in outside) + ".")
    dirs_rows = sorted({(r["source_id"], r["fichier_local"].split(" (")[0]) for r in trace.manifest
                        if r["fichier_local"].strip().endswith("/")})
    for s, p in dirs_rows:
        gaps.append(f"{s} `{p}` : l'empreinte est celle d'une liste de fichiers (répertoire de réponses d'API), non recalculée par 07.")
    res = trace.visit.get("resolved")
    meta = trace.roots.repo / "frontend" / "public" / "data" / "meta.json"
    if res and meta.exists():
        gen = json.loads(meta.read_text(encoding="utf-8")).get("generated_at")
        if gen and res["generated_at"] and str(res["generated_at"]) < str(gen):
            gaps.append(f"Visite : la voix a été enregistrée le {res['generated_at']}, avant les données publiées le {gen} "
                        "(`meta.json`) ; elle n'est lue que si le texte résolu à l'écran est identique au texte enregistré, "
                        "sinon la visite suit une durée estimée, sans voix.")
    if not gaps:
        a("Aucun écart relevé à la génération.")
    for g in gaps:
        a(f"- {g}")
    a("")
    return "\n".join(L).replace(chr(0x2014), "-").replace(chr(0x2013), "-") + "\n"


# --------------------------------------------------------------------------- relecture du document (contrôle 07)
def parse_index(doc: str) -> dict[str, str]:
    """Index de la section 1 : composant (chemin ou `visite guidée ...`) -> identifiant de bloc."""
    out: dict[str, str] = {}
    section = False
    for ln in doc.splitlines():
        if ln.startswith("## "):
            section = ln.startswith("## 1.")
            continue
        m = re.match(r"^\| `([^`]+)` \| (B\d{2}) \|", ln)
        if section and m:
            out[m.group(1)] = m.group(2)
    return out


VISIT_ROW = "visite guidée (tour/lea.tour.ts)"


def expected_components(trace: Trace) -> list[str]:
    """Composants qui doivent avoir une ligne dans le document : tout le registre du front, plus la visite guidée."""
    return [e.file for e in trace.entries] + [VISIT_ROW]


def missing_in_doc(doc: str, expected: Iterable[str]) -> list[str]:
    """Composants attendus qui n'ont pas de ligne dans l'index du document (contrôle P0 de 07)."""
    have = parse_index(doc)
    return [c for c in expected if c not in have]


def problems_of(trace: Trace, kinds: Iterable[str], level: str | None = None) -> list[Problem]:
    ks = set(kinds)
    return [p for p in trace.problems if p.kind in ks and (level is None or p.level == level)]
