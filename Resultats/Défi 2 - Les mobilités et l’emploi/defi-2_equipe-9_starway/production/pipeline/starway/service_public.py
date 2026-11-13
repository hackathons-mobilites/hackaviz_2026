"""Offres diffusées sur « Choisir le service public » (DGAFP, EMP04, D-036) : offres EN LIGNE à la date du fichier,
rattachées à une commune quand le code postal le permet sans ambiguïté. Logique pure, testée dans
tests/test_service_public.py ; appliquée par scripts/06q_export_service_public.py.

Ce que le fichier est (relevé du 05/11/2026 sur `offres-datagouv-20261011.csv`, 290 382 lignes, 30 colonnes) :
- un cumul d'offres de plusieurs dates (publication par défaut du 10/09/2021 au 10/09/2027), pas un stock : la plupart
  des lignes sont déjà expirées à la date du fichier ;
- une même référence peut revenir sur plusieurs lignes ;
- des lignes sans date de début ni de fin de publication (la fonction publique d'État surtout) : on ne sait pas si
  elles sont en ligne, elles ne sont PAS comptées (et le nombre est publié) ;
- l'adresse est en texte libre : « rue : 62170 Montreuil-sur-Mer », « 75007 Paris », parfois un code postal Cedex ou
  une simple commune.

Règles de vérité :
- « en ligne à la date du fichier » = date de début de publication <= date du fichier <= date de fin de publication
  (les dates « par défaut » du fichier). Ce n'est PAS « poste ouvert » : une date de publication ne prouve pas que le
  poste est encore à pourvoir. Ne jamais l'écrire ainsi ;
- jamais mélangé aux postes salariés recensés par l'INSEE (Flores, EMP01) : ce sont deux grandeurs différentes ;
- une offre n'est rattachée à une commune qu'avec une CLÉ RÉELLE : un code postal de La Poste (via l'API Géo) qui
  désigne UNE commune d'Île-de-France, ou plusieurs dont le nom de commune de l'adresse départage une seule. Un code
  postal Cedex, un code postal partagé sans nom concordant, un code postal contradictoire avec le département, deux
  codes postaux différents : l'offre reste connue au département, sans répartition entre communes ;
- aucun champ personnel : on garde la référence, l'intitulé, le versant, la famille d'employeur, la commune et les
  dates de publication.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd

SERVICE_PUBLIC_CONTRACT = "service-public-1"
SOURCE_ID = "EMP04"
IDF_DEPS = ("75", "77", "78", "91", "92", "93", "94", "95")
# Année de « fin de publication » qui signifie « sans date de fin » dans le fichier (31/12/9999)
OPEN_END_YEAR = 9999

COL_ORG = "Organisme de rattachement"
COL_REF = "Référence"
COL_VERSANT = "Versant"
COL_TITLE = "Intitulé du poste"
COL_LOC = "Localisation du poste"
COL_AFF = "Lieu d'affectation"
COL_AFF_FREE = "Lieu d'affectation (sans géolocalisation)"
COL_START = "Date de début de publication par défaut"
COL_END = "Date de fin de publication par défaut"
COL_FIRST = "Date de première publication"
USED_COLUMNS = (COL_ORG, COL_REF, COL_VERSANT, COL_TITLE, COL_LOC, COL_AFF, COL_AFF_FREE, COL_START, COL_END,
                COL_FIRST)

# Versant de la fonction publique : code court du fichier publié, libellé exact du fichier
VERSANTS: dict[str, str] = {
    "FPE": "Fonction Publique de l'Etat",
    "FPT": "Fonction Publique Territoriale",
    "FPH": "Fonction Publique Hospitalière",
}
VERSANT_UNKNOWN = "n/c"  # versant non renseigné dans le fichier (jamais rangé dans un versant par déduction)

# Statuts de localisation d'une offre en ligne d'Île-de-France
LOC_COMMUNE = "commune"  # clé réelle : code postal désignant une commune (ou nom concordant) : rattachable à un astre
LOC_DEP_ONLY = "departement"  # connue seulement au département
LOC_REASONS = (
    "cp_absent",  # aucun code postal d'Île-de-France lisible dans l'adresse
    "cp_cedex_ou_inconnu",  # un code à 5 chiffres, mais pas un code postal de commune (Cedex, boîte postale...)
    "cp_partage_sans_nom",  # le code postal est partagé par plusieurs communes et le nom ne départage pas
    "cp_nom_discordant",  # le nom écrit après le code postal est celui d'une autre commune (« 94000 Choisy-le-Roi »)
    "cp_multiples",  # deux codes postaux différents dans l'adresse
    "cp_hors_departement",  # le code postal contredit le département de la localisation
    "commune_hors_astres",  # commune d'Île-de-France qu'aucun astre ne contient
)


# --- Lecture et en ligne ---------------------------------------------------------------------------------------------
def file_date(filename: str) -> date:
    """Date du fichier d'après son nom `offres-datagouv-AAAAMMJJ.csv` (jour de l'extraction par la DGAFP)."""
    m = re.search(r"(\d{4})(\d{2})(\d{2})", filename)
    if not m:
        raise ValueError(f"date introuvable dans le nom du fichier : {filename}")
    return date(int(m[1]), int(m[2]), int(m[3]))


def read_offers(path: Path) -> pd.DataFrame:
    """Le CSV (séparateur « ; », UTF-8), tout en texte : aucune conversion implicite, 10 colonnes utiles seulement."""
    return pd.read_csv(path, sep=";", dtype=str, encoding="utf-8", keep_default_na=False, usecols=list(USED_COLUMNS))


def parse_dates(series: pd.Series) -> pd.Series:
    """JJ/MM/AAAA -> date ; vide ou illisible -> NaT (jamais une date par défaut). Les années > 2262 (31/12/9999,
    « sans fin ») dépassent pandas : elles sont lues à part (`open_end`)."""
    out = pd.to_datetime(series, format="%d/%m/%Y", errors="coerce")
    return out


def open_end(series: pd.Series) -> pd.Series:
    """Vrai quand la date de fin du fichier est « sans fin » (année 9999)."""
    return series.str.endswith(f"/{OPEN_END_YEAR}", na=False)


def online_mask(df: pd.DataFrame, as_of: date) -> pd.Series:
    """Offres en ligne à `as_of` : début <= as_of <= fin, les deux dates renseignées. Une fin « sans fin » (9999)
    compte (la date de fin du fichier est postérieure) ; une date absente : non comptée."""
    ts = pd.Timestamp(as_of)
    start = parse_dates(df[COL_START])
    end = parse_dates(df[COL_END])
    return (start <= ts) & ((end >= ts) | open_end(df[COL_END]))


def missing_dates_mask(df: pd.DataFrame) -> pd.Series:
    """Lignes dont une date de publication (début ou fin) manque : on ne sait pas si elles sont en ligne."""
    return (df[COL_START].str.strip() == "") | (df[COL_END].str.strip() == "")


# --- Texte et départements -------------------------------------------------------------------------------------------
def norm(text: str) -> str:
    """Minuscules sans accents, ponctuation en espaces, « saint(e) » écrit « st(e) » : pour comparer des noms de commune."""
    s = unicodedata.normalize("NFKD", text or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace("œ", "oe").replace("æ", "ae")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"\bsaint(e?)\b", r"st\1", s)


_DEP_RE = re.compile(r"\(([0-9AB]{2,3})\)\s*$")


def department_of(localisation: str) -> str | None:
    """Code du département de « Localisation du poste » (« Hauts-de-Seine (92) » -> « 92 ») ; None si absent."""
    m = _DEP_RE.search(localisation or "")
    return m.group(1) if m else None


_CP_RE = re.compile(r"(?<!\d)(\d{5})(?!\d)")


def five_digit_codes(text: str) -> list[str]:
    """Tous les nombres à 5 chiffres du texte (numéros de rue et codes Cedex compris : le tri se fait ensuite)."""
    return _CP_RE.findall(text or "")


# --- Index des codes postaux -----------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Commune:
    insee: str
    name: str
    dep: str


def postal_index(communes: Iterable[Mapping[str, Any]], arrondissements: Iterable[Mapping[str, Any]]) -> dict[str, list[Commune]]:
    """code postal -> communes qui le portent (API Géo, `codesPostaux`). Paris : les 20 arrondissements (ce sont les
    astres), jamais la commune 75056 ; 75001 à 75020 -> 75101 à 75120, et 75116 (code propre au 16e) -> 75116."""
    index: dict[str, list[Commune]] = {}

    def add(row: Mapping[str, Any]) -> None:
        c = Commune(str(row["code"]), str(row["nom"]), str(row["codeDepartement"]))
        for cp in row.get("codesPostaux") or []:
            index.setdefault(str(cp), []).append(c)

    for row in communes:
        if row["code"] != "75056":
            add(row)
    for row in arrondissements:
        add(row)
    if "75116" not in index:  # le 16e a deux codes postaux (75016 et 75116) ; l'API peut n'en donner qu'un
        by_insee = {c.insee: c for cs in index.values() for c in cs}
        if "75116" in by_insee:
            index["75116"] = [by_insee["75116"]]
    return index


def read_postal_index(communes_path: Path, arrondissements_path: Path) -> dict[str, list[Commune]]:
    load = lambda p: json.loads(p.read_text(encoding="utf-8"))  # noqa: E731
    return postal_index(load(communes_path), load(arrondissements_path))


def commune_label(c: Commune) -> str:
    """Nom comparé au texte de l'adresse : « Paris » pour les 20 arrondissements."""
    return "Paris" if c.insee.startswith("751") and len(c.insee) == 5 else c.name


def commune_names(index: Mapping[str, list[Commune]]) -> frozenset[str]:
    """Noms normalisés de toutes les communes de l'index (« paris » pour les arrondissements)."""
    return frozenset(norm(commune_label(c)) for cs in index.values() for c in cs)


_TAIL_CUT = re.compile(r"[\n\r,;:()/]| - |\bcedex\b", re.IGNORECASE)


def names_after(text: str, cp: str) -> list[str]:
    """Noms écrits juste après chaque occurrence du code postal dans l'adresse (« 94000 Choisy-le-Roi » ->
    « choisy le roi »), normalisés, coupés à la virgule, au retour à la ligne, aux deux-points, aux parenthèses, au
    tiret entouré d'espaces et à « Cedex » ; les occurrences sans nom sont omises."""
    tails = (norm(_TAIL_CUT.split(text[m.end():], maxsplit=1)[0]) for m in re.finditer(rf"(?<!\d){cp}(?!\d)", text))
    return [t for t in tails if t]


def name_matches(c: Commune, tail: str) -> bool:
    """Le nom écrit après le code postal désigne la commune : égal à son nom, ou début d'un nom composé
    (« Le Chesnay » pour « Le Chesnay-Rocquencourt »), ou nom suivi d'autre chose (« Paris La Défense »)."""
    name = norm(commune_label(c))
    return bool(tail) and (tail == name or tail.startswith(name + " ") or name.startswith(tail + " "))


def names_another_commune(tail: str, names: frozenset[str]) -> bool:
    """Le nom écrit après le code postal commence par le nom d'une commune d'Île-de-France."""
    words = tail.split()
    return any(" ".join(words[:n]) in names for n in range(1, min(len(words), 6) + 1))


# --- Localisation d'une offre ----------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Location:
    dep: str | None  # département retenu (celui de la localisation, sinon celui du code postal)
    insee: str | None  # commune : seulement avec une clé réelle
    status: str  # LOC_COMMUNE ou LOC_DEP_ONLY
    reason: str | None  # une valeur de LOC_REASONS quand l'offre reste au département
    how: str | None  # « cp_et_nom » (nom écrit après le code postal concordant) ou « cp_seul » (code postal unique, pas de nom)


def locate(localisation: str, addresses: Sequence[str], index: Mapping[str, list[Commune]],
           astre_communes: frozenset[str] | None = None, names: frozenset[str] | None = None) -> Location | None:
    """Département et commune d'une offre. None : hors Île-de-France (ou département inconnu).

    Département : celui de « Localisation du poste » ; à défaut, celui du code postal de l'adresse. Un code postal
    d'Île-de-France avec un département hors Île-de-France (ou l'inverse) : le département du fichier prévaut et
    l'offre n'est jamais rattachée à une commune.

    Commune : le code postal doit désigner UNE commune de l'index, et le nom écrit juste après ce code dans l'adresse
    (quand il y en a un) ne doit pas désigner une AUTRE commune. Ce garde-fou est nécessaire : le fichier contient
    « 94000 Choisy-le-Roi » (94000 est le code de Créteil) ou « 93320 Saint-Denis » (93320 : Les Pavillons-sous-Bois).
    Un code postal partagé par plusieurs communes n'est tranché que si le nom écrit après le code désigne l'une
    d'elles et une seule.
    """
    dep = department_of(localisation)
    fields = [a for a in addresses if a]
    text = "\n".join(fields)
    codes = list(dict.fromkeys(five_digit_codes(text)))
    known = [cp for cp in codes if cp in index]
    other = [cp for cp in codes if cp not in index]
    names = names if names is not None else commune_names(index)
    if dep is None:
        # aucun département dans le fichier : celui d'un code postal d'Île-de-France connu, s'il est seul
        deps = {c.dep for cp in known for c in index[cp]}
        if len(deps) != 1:
            return None
        dep = next(iter(deps))
    if dep not in IDF_DEPS:
        return None
    if len(known) > 1:
        return Location(dep, None, LOC_DEP_ONLY, "cp_multiples", None)
    if not known:
        reason = "cp_cedex_ou_inconnu" if any(cp[:2] == dep for cp in other) else "cp_absent"
        return Location(dep, None, LOC_DEP_ONLY, reason, None)
    cp = known[0]
    cands = index[cp]
    if any(c.dep != dep for c in cands):
        return Location(dep, None, LOC_DEP_ONLY, "cp_hors_departement", None)
    tails = [t for f in fields for t in names_after(f, cp)]
    if len(cands) == 1:
        chosen = cands[0]
        if any(name_matches(chosen, t) for t in tails):
            how = "cp_et_nom"
        elif any(names_another_commune(t, names) for t in tails):
            return Location(dep, None, LOC_DEP_ONLY, "cp_nom_discordant", None)
        else:
            how = "cp_seul"
    else:
        named = [c for c in cands if any(name_matches(c, t) for t in tails)]
        if len(named) != 1:
            return Location(dep, None, LOC_DEP_ONLY, "cp_partage_sans_nom", None)
        chosen, how = named[0], "cp_et_nom"
    if astre_communes is not None and chosen.insee not in astre_communes:
        return Location(dep, None, LOC_DEP_ONLY, "commune_hors_astres", None)
    return Location(dep, chosen.insee, LOC_COMMUNE, None, how)


# --- Versant ---------------------------------------------------------------------------------------------------------
_VERSANT_BY_LABEL = {label: code for code, label in VERSANTS.items()}


def versant_code(label: str) -> str:
    """Code court du versant ; « n/c » quand le fichier ne le renseigne pas (rien n'est déduit de l'employeur)."""
    return _VERSANT_BY_LABEL.get((label or "").strip(), VERSANT_UNKNOWN)


# --- Offres en ligne, dédoublonnées ----------------------------------------------------------------------------------
@dataclass(frozen=True)
class Offer:
    ref: str
    title: str
    versant: str
    employer: str  # « Organisme de rattachement » du fichier (famille d'employeur : Communes, Conseils départementaux...)
    dep: str
    insee: str | None
    status: str
    reason: str | None
    how: str | None
    start: str  # AAAA-MM-JJ
    end: str | None  # AAAA-MM-JJ ; None : « sans fin » (31/12/9999)


def iso(fr: str) -> str:
    """JJ/MM/AAAA -> AAAA-MM-JJ."""
    return datetime.strptime(fr.strip(), "%d/%m/%Y").date().isoformat()


def clean_text(s: str) -> str:
    """Espaces normalisés (le fichier contient des retours à la ligne et des doubles espaces) ; tirets cadratins et
    demi-cadratins du texte source écrits « - » (règle typographique du projet : aucun de ces deux tirets publié)."""
    return re.sub(r"\s+", " ", (s or "").replace(chr(0x2014), "-").replace(chr(0x2013), "-")).strip()


def build_offers(df: pd.DataFrame, as_of: date, index: Mapping[str, list[Commune]],
                 astre_communes: frozenset[str] | None = None) -> tuple[list[Offer], dict[str, int]]:
    """Offres en ligne d'Île-de-France, UNE par référence, et le détail des comptes.

    Une référence répétée sur plusieurs lignes en ligne : les lignes doivent désigner la même commune (ou le même
    département) ; sinon la référence est comptée une fois, au département, sans commune (`ref_lieux_differents`).
    Les lignes d'une même référence qui diffèrent seulement par le titre ou les dates : la première ligne du fichier est
    gardée (ordre du fichier)."""
    mask = online_mask(df, as_of)
    stats: dict[str, int] = {
        "lignes": len(df),
        "lignes_sans_date": int(missing_dates_mask(df).sum()),
        "lignes_en_ligne": int(mask.sum()),
        "refs_en_ligne": int(df.loc[mask, COL_REF].nunique()),
        "fin_sans_date": int((mask & open_end(df[COL_END])).sum()),
        "lignes_hors_idf": 0,
        "lignes_hors_idf_avec_cp_idf": 0,
        "ref_lieux_differents": 0,
    }
    seen: dict[str, tuple[Offer, set[tuple[str | None, str | None]]]] = {}
    names = commune_names(index)
    online = df.loc[mask]
    for org, ref_raw, versant, title, localisation, aff, aff_free, start, end_raw in zip(
            online[COL_ORG], online[COL_REF], online[COL_VERSANT], online[COL_TITLE], online[COL_LOC], online[COL_AFF],
            online[COL_AFF_FREE], online[COL_START], online[COL_END], strict=True):
        ref = clean_text(ref_raw)
        loc = locate(localisation, (aff, aff_free), index, astre_communes, names)
        if loc is None:
            stats["lignes_hors_idf"] += 1
            if any(cp in index for a in (aff, aff_free) for cp in five_digit_codes(a)):
                stats["lignes_hors_idf_avec_cp_idf"] += 1  # le département du fichier contredit le code postal
            continue
        key = (loc.dep, loc.insee)
        if ref in seen:
            seen[ref][1].add(key)
            continue
        end = None if end_raw.strip().endswith(f"/{OPEN_END_YEAR}") else iso(end_raw)
        seen[ref] = (Offer(ref, clean_text(title), versant_code(versant), clean_text(org), loc.dep, loc.insee,
                           loc.status, loc.reason, loc.how, iso(start), end), {key})
    offers: list[Offer] = []
    for ref, (offer, keys) in seen.items():
        if len(keys) > 1:  # lignes de la même référence qui ne désignent pas le même lieu : au département
            stats["ref_lieux_differents"] += 1
            offer = Offer(offer.ref, offer.title, offer.versant, offer.employer, offer.dep, None, LOC_DEP_ONLY,
                          "cp_multiples", None, offer.start, offer.end)
        offers.append(offer)
    stats["offres_idf"] = len(offers)
    return offers, stats


def count_by(offers: Iterable[Offer], key) -> dict[str, int]:
    """Effectifs par valeur (valeurs absentes sous la clé « - »), triés par clé."""
    counts = Counter("-" if (v := key(o)) is None else v for o in offers)
    return dict(sorted(counts.items()))


# --- Export (contrats service-public-1 et service-public-offres-1) --------------------------------------------------
OFFERS_CONTRACT = "service-public-offres-1"
OFFERS_FILE = "service_public_offres.json"
DEPARTEMENT_NAMES = {"75": "Paris", "77": "Seine-et-Marne", "78": "Yvelines", "91": "Essonne", "92": "Hauts-de-Seine",
                     "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise"}


def fr_date(iso_date: str) -> str:
    """AAAA-MM-JJ -> JJ/MM/AAAA."""
    y, m, d = iso_date.split("-")
    return f"{d}/{m}/{y}"


def file_span(df: pd.DataFrame) -> dict[str, str | None]:
    """Étendue des dates de première publication du fichier (JJ/MM/AAAA lues, AAAA-MM-JJ écrites) : le fichier cumule
    des offres de plusieurs dates, alors que la fiche du jeu annonce 2021-2023."""
    first = parse_dates(df[COL_FIRST]).dropna()
    return {"first_publication_min": first.min().date().isoformat() if len(first) else None,
            "first_publication_max": first.max().date().isoformat() if len(first) else None}


def method_text(as_of: date) -> str:
    d = as_of.strftime("%d/%m/%Y")
    return (f"Une offre est comptée si, au {d} (date du fichier), sa date de début de publication est passée et sa date "
            "de fin de publication n'est pas passée, une seule fois par référence. Elle est rattachée à une commune "
            "seulement si le code postal de l'adresse désigne une seule commune d'Île-de-France (ou si le nom écrit "
            "après ce code départage une seule commune) et que ce nom ne désigne pas une autre commune ; sinon elle "
            "reste connue au département, sans répartition. Une date de publication ne prouve pas que le poste est "
            "encore à pourvoir.")


def build_export(offers: Sequence[Offer], stats: Mapping[str, int], *, as_of: date, file_name: str, file_sha256: str,
                 extracted_at: str, span: Mapping[str, str | None], processing_version: str,
                 generated_at: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Les deux fichiers du front : `service_public.json` (comptes, par commune et par département) et
    `service_public_offres.json` (la liste des offres rattachées à une commune, chargée à la demande).

    Les offres connues seulement au département n'apparaissent que dans les comptes (jamais listées par commune)."""
    attached = [o for o in offers if o.status == LOC_COMMUNE and o.insee]
    dept_only = [o for o in offers if o.status != LOC_COMMUNE]
    communes: dict[str, dict[str, Any]] = {}
    for o in attached:
        c = communes.setdefault(o.insee or "", {"n": 0, "v": {}})
        c["n"] += 1
        c["v"][o.versant] = c["v"].get(o.versant, 0) + 1
    communes = {k: {"n": v["n"], "v": dict(sorted(v["v"].items()))} for k, v in sorted(communes.items())}
    departements = {}
    for dep in IDF_DEPS:
        here = [o for o in offers if o.dep == dep]
        departements[dep] = {"name": DEPARTEMENT_NAMES[dep], "offers": len(here),
                             "commune": sum(1 for o in here if o.status == LOC_COMMUNE),
                             "departement": sum(1 for o in here if o.status != LOC_COMMUNE)}
    employers = sorted({o.employer for o in attached})
    emp_index = {e: i for i, e in enumerate(employers)}
    by_commune: dict[str, list[dict[str, Any]]] = {}
    for o in sorted(attached, key=lambda x: (x.insee or "", x.start, x.ref), reverse=False):
        by_commune.setdefault(o.insee or "", []).append(
            {"r": o.ref, "t": o.title, "v": o.versant, "e": emp_index[o.employer], "d": o.start, "f": o.end})
    for lst in by_commune.values():  # les plus récemment publiées d'abord
        lst.sort(key=lambda x: (x["d"], x["r"]), reverse=True)
    main: dict[str, Any] = {
        "contract": SERVICE_PUBLIC_CONTRACT,
        "processing_version": processing_version,
        "generated_at": generated_at,
        "source_id": SOURCE_ID,
        "as_of": as_of.isoformat(),
        "file": {"name": file_name, "sha256": file_sha256, "extracted_at": extracted_at},
        "method": method_text(as_of),
        "metadata_gap": {
            "fiche_temporal_coverage": {"start": "2021-01-01", "end": "2023-12-31"},
            **span,
            "note": ("La fiche data.gouv.fr annonce une couverture 2021-2023 ; le fichier du "
                     f"{fr_date(as_of.isoformat())} contient des offres dont la première publication va du "
                     f"{fr_date(span['first_publication_min'] or as_of.isoformat())} au "
                     f"{fr_date(span['first_publication_max'] or as_of.isoformat())}. Les dates du fichier font foi."),
        },
        "versants": {**VERSANTS, VERSANT_UNKNOWN: "Versant non renseigné dans le fichier"},
        "counts": {
            "file_rows": stats["lignes"],
            "file_rows_without_publication_dates": stats["lignes_sans_date"],
            "online_rows": stats["lignes_en_ligne"],
            "online_references": stats["refs_en_ligne"],
            "online_open_ended_rows": stats["fin_sans_date"],
            "online_outside_idf_rows": stats["lignes_hors_idf"],
            "online_outside_idf_with_idf_postal_code_rows": stats["lignes_hors_idf_avec_cp_idf"],
        },
        "region": {
            "offers": len(offers),
            "commune": len(attached),
            "departement": len(dept_only),
            "departement_reasons": count_by(dept_only, lambda o: o.reason),
            "commune_how": count_by(attached, lambda o: o.how),
            "versants": count_by(offers, lambda o: o.versant),
            "employer_family_note": "Organisme de rattachement du fichier (famille d'employeur), tel quel.",
        },
        "departements": departements,
        "communes": communes,
        "offers_file": OFFERS_FILE,
    }
    detail: dict[str, Any] = {
        "contract": OFFERS_CONTRACT,
        "processing_version": processing_version,
        "generated_at": generated_at,
        "source_id": SOURCE_ID,
        "as_of": as_of.isoformat(),
        "fields": {"r": "référence officielle", "t": "intitulé du poste", "v": "versant (clé de versants)",
                   "e": "indice dans employers (organisme de rattachement)", "d": "début de publication AAAA-MM-JJ",
                   "f": "fin de publication AAAA-MM-JJ, null si le fichier n'en donne pas (31/12/9999)"},
        "link": "https://choisirleservicepublic.gouv.fr/offre-emploi/offre-reference-{r}/",
        "employers": employers,
        "communes": dict(sorted(by_commune.items())),
    }
    return main, detail


PERSONAL = re.compile(r"[\w.+-]+@[\w-]+\.\w+|https?://|\b0[1-9](?:[ .]\d{2}){4}\b|\b0[1-9]\d{8}\b")
_EM, _EN = chr(0x2014), chr(0x2013)


def check_export(main: Mapping[str, Any], detail: Mapping[str, Any], astre_communes: Iterable[str]) -> list[str]:
    """Écarts internes du contrat (liste vide : conforme) : sommes, clés de commune, aucun champ personnel."""
    errs: list[str] = []
    if main.get("contract") != SERVICE_PUBLIC_CONTRACT:
        errs.append(f"contract {main.get('contract')!r}")
    if detail.get("contract") != OFFERS_CONTRACT:
        errs.append(f"contract du détail {detail.get('contract')!r}")
    region = main.get("region", {})
    communes = main.get("communes", {})
    if region.get("offers") != region.get("commune", 0) + region.get("departement", 0):
        errs.append("region.offers != commune + departement")
    if sum(c["n"] for c in communes.values()) != region.get("commune"):
        errs.append("somme des communes != region.commune")
    if sum(sum(c["v"].values()) for c in communes.values()) != region.get("commune"):
        errs.append("somme des versants des communes != region.commune")
    if sum(region.get("departement_reasons", {}).values()) != region.get("departement"):
        errs.append("somme des raisons != region.departement")
    deps = main.get("departements", {})
    for key in ("offers", "commune", "departement"):
        if sum(d[key] for d in deps.values()) != region.get(key):
            errs.append(f"somme des départements ({key}) != region.{key}")
    known = set(astre_communes)
    stray = sorted(set(communes) - known)
    if stray:
        errs.append(f"communes publiées hors des astres : {stray[:5]}")
    d_communes = detail.get("communes", {})
    if set(d_communes) != set(communes):
        errs.append("communes du détail != communes des comptes")
    refs: set[str] = set()
    for insee, lst in d_communes.items():
        if len(lst) != communes.get(insee, {}).get("n"):
            errs.append(f"{insee} : {len(lst)} offres listées pour {communes.get(insee, {}).get('n')} comptées")
        for o in lst:
            if o["r"] in refs:
                errs.append(f"référence en double : {o['r']}")
            refs.add(o["r"])
            if o["v"] not in main.get("versants", {}):
                errs.append(f"versant inconnu : {o['v']}")
            if PERSONAL.search(o["t"]):
                errs.append(f"intitulé suspect (adresse électronique, lien ou téléphone) : {o['r']}")
            if not 0 <= o["e"] < len(detail.get("employers", [])):
                errs.append(f"employeur hors liste : {o['r']}")
            if o["d"] > main.get("as_of", ""):
                errs.append(f"publication après la date du fichier : {o['r']}")
    for label, doc in (("service_public.json", main), ("service_public_offres.json", detail)):
        txt = json.dumps(doc, ensure_ascii=False)
        if _EM in txt or _EN in txt:
            errs.append(f"{label} contient un tiret cadratin ou demi-cadratin")
    return errs
