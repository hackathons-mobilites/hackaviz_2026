"""Contexte communal descriptif (halo « Derrière notre étoile » et volet « Derrière le ciel »).

Sources : GEN04 (RP 2023, population par sexe et âge, exploitation principale), GEN01 (RP 2023, actifs occupés
par sexe et mode de transport, exploitation complémentaire), SOC01 (Filosofi 2023), EMP02 (flux domicile-travail),
COST01 (forfait Navigo). Statistiques DESCRIPTIVES : aucune causalité avec l'accessibilité.

Les codes de modalités ci-dessous ont été vérifiés dans les fichiers *_metadata.csv et les aides à la lecture INSEE.
"""

from __future__ import annotations

import math
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path

import pandas as pd

from starway.config import AGE_BINS, IDF_DEPS

# GEN01 : TRANS (dictionnaire DS_RP_TD_NAVETTES_SEXTRANSPORT_COMP_2023_metadata.csv)
#   1 Pas de transport (« pas de déplacement » depuis l'EAR 2015 : travail à domicile), 2 Marche à pied,
#   3 Vélo (y compris VAE), 4 Deux-roues motorisé, 5 Voiture/camion/fourgonnette, 6 Transport en commun
TRANS_TO_MODE = {"6": "transit", "5": "car", "3": "bike", "2": "walk", "1": "other", "4": "other"}
MODES_ORDER = ("transit", "car", "bike", "walk", "other")
SEX_TO_KEY = {"F": "F", "M": "H"}  # contrat : F / H


def read_insee_zip_csv(zip_path: Path, member_suffix: str, keep: Mapping[str, Iterable[str]] | None = None,
                       chunksize: int = 1_000_000) -> pd.DataFrame:
    """Lit le CSV `*member_suffix` d'un zip INSEE (séparateur ;) et ne garde que les lignes COM/ARM d'IDF
    (+ filtres `keep` colonne -> valeurs autorisées). Lecture par blocs (mémoire limitée)."""
    with zipfile.ZipFile(zip_path) as z:
        name = next(n for n in z.namelist() if n.endswith(member_suffix))
        parts = []
        with z.open(name) as f:
            for ch in pd.read_csv(f, sep=";", dtype=str, chunksize=chunksize):
                m = ch["GEO_OBJECT"].isin(["COM", "ARM"]) & ch["GEO"].str[:2].isin(IDF_DEPS)
                for col, vals in (keep or {}).items():
                    m &= ch[col].isin(list(vals))
                parts.append(ch[m])
    df = pd.concat(parts, ignore_index=True)
    if "OBS_VALUE" in df:
        df["value"] = pd.to_numeric(df["OBS_VALUE"], errors="coerce")
    return df


def pct_shares(counts: Mapping[str, float], keys: Iterable[str]) -> dict[str, float | None]:
    """Parts en % (1 décimale) de `counts` sur leur somme. None partout si la somme est nulle (jamais 0 inventé)."""
    keys = list(keys)
    total = sum(float(counts.get(k, 0.0) or 0.0) for k in keys)
    if total <= 0:
        return {k: None for k in keys}
    return {k: round(100.0 * float(counts.get(k, 0.0) or 0.0) / total, 1) for k in keys}


def age_bin(age_code: str) -> str | None:
    """'Y37' -> '30-44' ; 'Y_GE100' -> '75+' ; '_T' -> None."""
    if age_code == "_T":
        return None
    years = 100 if age_code == "Y_GE100" else int(age_code[1:])
    for label, lo, hi in AGE_BINS:
        if years >= lo and (hi is None or years <= hi):
            return label
    raise ValueError(age_code)


def population_blocks(pop: pd.DataFrame) -> dict[str, dict]:
    """GEN04 filtré (RP_MEASURE=POP) -> {insee: {"sex": {...}, "age": {...}}} au format du contrat."""
    out: dict[str, dict] = {}
    pop = pop.assign(bin=pop["AGE"].map(age_bin))
    for insee, g in pop.groupby("GEO"):
        tot_rows = g[(g["SEX"] == "_T") & (g["AGE"] == "_T")]["value"]
        total = float(tot_rows.iloc[0]) if len(tot_rows) else float("nan")
        by_sex = g[(g["AGE"] == "_T") & g["SEX"].isin(["F", "M"])].set_index("SEX")["value"]
        sex_counts = {SEX_TO_KEY[s]: float(v) for s, v in by_sex.items()}
        ages = g[(g["SEX"] == "_T") & g["bin"].notna()].groupby("bin")["value"].sum()
        labels = [b[0] for b in AGE_BINS]
        age_shares = pct_shares(ages.to_dict(), labels)
        ok = total > 0 and len(sex_counts) == 2
        out[insee] = {
            "sex": {"total": round(total) if ok else None,
                    "shares": pct_shares(sex_counts, ["F", "H"]) if ok else {"F": None, "H": None},
                    "status": "ok" if ok else "not_available"},
            "age": {"total": round(total) if ok else None,
                    "shares": [age_shares[b] for b in labels] if ok else [],
                    "status": "ok" if ok else "not_available"},
        }
    return out


# Précision du RP (fiche INSEE « La précision des résultats du recensement », version de septembre 2023, GEN01) :
# - communes de moins de 10 000 habitants, exploitation complémentaire : taux de sondage Tc = 20 % (enquêtes
#   depuis 2014), CV(a) = 1 / sqrt(Tc x a) (§ 3) ;
# - communes de 10 000 habitants ou plus : CV lu dans le tableau du § 4.2 selon l'effectif a ;
#   « Moins de 250 : > 8,0 % » -> non calculable ; « 50 000 ou plus : < 1,0 % » -> 1,0 % utilisé comme majorant ;
# - CV d'un pourcentage = sqrt(CV(numérateur)^2 + CV(dénominateur)^2) (§ 5.2) ; marge à 95 % = 2 x part x CV.
# La fiche ne fixe AUCUN seuil de diffusion : toutes les parts sont publiées avec leur marge.
RP_TC_SMALL_COMMUNES = 0.20
RP_LARGE_COMMUNE_MIN_POP = 10_000
RP_CV_TABLE_LARGE: tuple[tuple[float, float | None], ...] = (  # (borne basse de l'effectif, CV) ; None = > 8 %
    (0, None), (250, 0.080), (500, 0.055), (1_000, 0.040), (2_000, 0.030), (3_000, 0.025), (6_000, 0.015),
    (10_000, 0.015), (20_000, 0.010), (50_000, 0.010),
)


def rp_cv(effectif: float, commune_population: float) -> float | None:
    """Coefficient de variation d'un effectif de l'exploitation complémentaire du RP (fiche INSEE)."""
    if effectif <= 0:
        return None
    if commune_population < RP_LARGE_COMMUNE_MIN_POP:
        return 1.0 / (RP_TC_SMALL_COMMUNES * effectif) ** 0.5
    cv = None
    for low, value in RP_CV_TABLE_LARGE:
        if effectif >= low:
            cv = value
    return cv


def share_margin95(count: float, denominator: float, commune_population: float) -> float | None:
    """Marge d'incertitude à 95 % (en points de %) d'une part count / denominator."""
    cv_n, cv_d = rp_cv(count, commune_population), rp_cv(denominator, commune_population)
    if cv_n is None or cv_d is None or denominator <= 0:
        return None
    share = 100.0 * count / denominator
    return round(2 * share * (cv_n ** 2 + cv_d ** 2) ** 0.5, 1)


def commute_blocks(nav: pd.DataFrame, population: Mapping[str, float]) -> dict[str, dict]:
    """GEN01 filtré (actifs occupés 15+, WORK_AREA=_T, WORK_URBAN_AREA=_T) -> parts modales par sexe, avec la
    marge à 95 % de CHAQUE cellule (mode x sexe) selon la fiche INSEE de précision."""
    nav = nav[nav["TRANS"] != "_T"].assign(mode=lambda d: d["TRANS"].map(TRANS_TO_MODE))
    if nav["mode"].isna().any():
        raise ValueError(f"modalité TRANS inconnue : {sorted(nav[nav['mode'].isna()]['TRANS'].unique())}")
    out: dict[str, dict] = {}
    for insee, g in nav[nav["SEX"].isin(["F", "M"])].groupby("GEO"):
        pop = float(population.get(insee, float("nan")))
        block: dict = {"totals": {}, "margin95": {}}
        ok = True
        for sex, key in SEX_TO_KEY.items():
            counts = g[g["SEX"] == sex].groupby("mode")["value"].sum().to_dict()
            n = float(sum(counts.values()))
            block["totals"][key] = round(n)
            block[key] = pct_shares(counts, MODES_ORDER)
            block["margin95"][key] = {m: (share_margin95(float(counts.get(m, 0.0)), n, pop) if pop == pop else None)
                                      for m in MODES_ORDER}
            ok &= n > 0
        block["status"] = "ok" if ok else "not_available"
        out[insee] = block
    return out


def income_blocks(filo: pd.DataFrame) -> dict[str, dict]:
    """Filosofi (MED_SL, PR_MD60). CONF_STATUS=C (confidentiel) ou valeur absente -> null + statut `secret`."""
    out: dict[str, dict] = {}
    for insee, g in filo.groupby("GEO"):
        vals: dict[str, float | None] = {}
        st: dict[str, str] = {}
        for measure in ("MED_SL", "PR_MD60"):
            r = g[g["FILOSOFI_MEASURE"] == measure]
            if r.empty:
                vals[measure], st[measure] = None, "not_available"
            elif r["CONF_STATUS"].iloc[0] == "C" or pd.isna(r["value"].iloc[0]):
                vals[measure], st[measure] = None, "secret"
            else:
                vals[measure], st[measure] = float(r["value"].iloc[0]), "ok"
        med = None if vals["MED_SL"] is None else round(vals["MED_SL"])
        pov = None if vals["PR_MD60"] is None else round(vals["PR_MD60"], 1)
        overall = "ok" if "ok" in st.values() else ("secret" if "secret" in st.values() else "not_available")
        out[insee] = {"median_living_standard_eur": med, "poverty_rate": pov, "status": overall,
                      "median_status": st["MED_SL"], "poverty_rate_status": st["PR_MD60"]}
    return out


# EMP02 : règle de précision publiée par l'INSEE sur la page de la base (https://www.insee.fr/fr/statistiques/8998300,
# instantané data/raw/EMP02/page-8998300.html, rubrique « Pour comprendre ») : « compte tenu notamment du sondage,
# les flux faibles (moins de 200) devront être considérés comme des ordres de grandeur ». Appliquée telle quelle,
# sur la valeur estimée non arrondie : le flux est publié, avec la mention « ordre de grandeur ».
EMP02_ORDER_OF_MAGNITUDE_BELOW = 200
EMP02_PRECISION_QUOTE = ("INSEE, base « Mobilités professionnelles en 2023 » (page 8998300) : « compte tenu notamment "
                         "du sondage, les flux faibles (moins de 200) devront être considérés comme des ordres de "
                         "grandeur »")


def flow_precision(flux: float) -> str:
    """`order_of_magnitude` si le flux estimé est inférieur à 200 (règle INSEE citée), sinon `ok`."""
    return "order_of_magnitude" if flux < EMP02_ORDER_OF_MAGNITUDE_BELOW else "ok"


def origin_totals(flows: pd.DataFrame) -> dict[str, float]:
    """Actifs occupés résidents de chaque commune d'origine (somme de tous ses flux sortants, exacte : `math.fsum`)."""
    return flows.groupby("CODGEO")["NBFLUX_C23_ACTOCC15P"].agg(math.fsum).to_dict()


def flow_shares_of_destinations(flows: pd.DataFrame, pole_members: Mapping[str, Iterable[str]],
                                idf_codes: Iterable[str]) -> dict[str, float]:
    """Ventilation de l'ensemble des flux sortants des communes d'origine selon le lieu de travail (mesure de
    couverture, jamais publiée comme un résultat par commune) : `in_astres` (commune de travail dans un astre),
    `idf_outside_astres` (commune d'Île-de-France sans astre), `outside_idf` (lieu de travail hors Île-de-France)."""
    members = {c for cs in pole_members.values() for c in cs}
    idf = set(idf_codes)
    w = flows["NBFLUX_C23_ACTOCC15P"]
    in_astres = flows["DCLT"].isin(members)
    in_idf = flows["DCLT"].isin(idf)
    return {"total": math.fsum(w), "in_astres": math.fsum(w[in_astres]),
            "idf_outside_astres": math.fsum(w[in_idf & ~in_astres]), "outside_idf": math.fsum(w[~in_idf])}


def flows_to_poles(flows: pd.DataFrame, pole_members: Mapping[str, Iterable[str]]) -> pd.DataFrame:
    """EMP02 (CODGEO -> DCLT) : actifs occupés résidents travaillant dans chaque pôle, et part de l'ensemble des
    actifs occupés résidents (dénominateur = somme de tous les flux sortants de la commune, y compris vers
    elle-même et hors IDF). Seuls les couples présents dans le fichier INSEE sont renvoyés (aucun 0 ajouté).
    `precision` est évaluée sur la somme estimée non arrondie."""
    lookup = {c: p for p, cs in pole_members.items() for c in cs}
    f = flows.assign(pole_id=flows["DCLT"].map(lookup))
    # Somme exacte (math.fsum) : le résultat ne dépend ni de l'ordre des lignes ni de la version de numpy/pandas. Les
    # flux INSEE sont des estimations décimales ; une somme flottante ordinaire donne, sur une égalité exacte
    # (x,5 ou x,x5), tantôt l'arrondi haut, tantôt le bas selon la machine (7 fichiers context/ sur 1 285 le 05/11).
    total = f.groupby("CODGEO")["NBFLUX_C23_ACTOCC15P"].agg(math.fsum).rename("actifs_occupes")
    to_p = (f.dropna(subset=["pole_id"]).groupby(["CODGEO", "pole_id"])["NBFLUX_C23_ACTOCC15P"].agg(math.fsum)
            .rename("flux"))
    out = to_p.reset_index().merge(total.reset_index(), on="CODGEO")
    out["share_pct"] = (100 * out["flux"] / out["actifs_occupes"]).round(1)
    out["precision"] = out["flux"].map(flow_precision)
    out["flux"] = out["flux"].round().astype(int)
    out["actifs_occupes"] = out["actifs_occupes"].round().astype(int)
    return out.rename(columns={"CODGEO": "insee"})


def flows_block(insee: str, fp: pd.DataFrame, pole_ids: Sequence[str], pole_members: Mapping[str, Iterable[str]],
                actifs_occupes: float | None) -> dict:
    """Bloc `flows_to_poles` du contrat context/{insee}.json : `poles` = objet indexé par id de pôle (ordre de
    poles.json), chaque entrée {flux, share_pct, precision}.

    Couple absent du fichier INSEE (qui contient « l'ensemble des flux ») -> flux null + precision
    `no_flow_in_file` : aucun actif estimé, jamais un 0 de substitution."""
    sub = fp[fp["insee"] == insee].set_index("pole_id")
    origin_pole = next((p for p, cs in pole_members.items() if insee in set(cs)), None)
    ok = actifs_occupes is not None and actifs_occupes > 0
    poles: dict[str, dict] = {}
    for pid in pole_ids:
        if ok and pid in sub.index:
            r = sub.loc[pid]
            poles[pid] = {"flux": int(r["flux"]), "share_pct": float(r["share_pct"]), "precision": str(r["precision"])}
        else:
            poles[pid] = {"flux": None, "share_pct": None, "precision": "no_flow_in_file"}
    return {
        "source": "EMP02", "year": 2023,
        "measure": "actifs occupés de 15 ans ou plus résidant dans la commune et travaillant dans une commune du pôle "
                   "(RP 2023, exploitation complémentaire)",
        "denominator": "actifs occupés de 15 ans ou plus résidant dans la commune, quel que soit leur lieu de travail "
                       "(y compris la commune elle-même et hors Île-de-France)",
        "actifs_occupes": round(actifs_occupes) if ok else None,
        "unit": "%",
        "poles": poles,
        "origin_pole": origin_pole,
        "precision_rule": EMP02_PRECISION_QUOTE,
        "note": "description des navettes déclarées au recensement ; ne dit rien de la cause (desserte, emploi, "
                "logement) ni de l'accessibilité calculée",
        "status": "ok" if ok else "not_available",
    }
