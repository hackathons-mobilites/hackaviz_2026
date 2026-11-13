"""Coût d'énergie et carbone d'un trajet motorisé par véhicule (D-029, demandes de l'équipe du 03 et du 04/11/2026).

Coût d'énergie d'un sens = distance routière (km) x consommation (unité / 100 km) / 100 x prix de l'énergie (EUR /
unité). Les péages traversés (classe du véhicule, heure de passage) sont dans starway/toll_publish.py (tolls.json).
Carbone d'un sens = distance x consommation / 100 x facteur ADEME « combustion + amont » de l'énergie.
Aucune autre hypothèse : ni stationnement, ni entretien, assurance, achat.

Véhicules : voitures essence, diesel, électrique ; quatre deux-roues thermiques (125 cm3, maxiscooter, moto de
cylindrée moyenne, moto de plus de 900 cm3), qui ont le temps de trajet de la voiture (décision de Nicolas du 03/11)
et le péage de classe 5. Pas de deux-roues électrique (aucune consommation publique jugée probante, 04/11).

Sources (toutes dans data/sources_manifest.csv) :
- consommations des voitures : SDES, Bilan annuel des transports en 2024, onglet G3.b « Consommations unitaires des
  véhicules immatriculés en France », voitures particulières, année 2024 (COST08) : « dont essence », « dont Diesel »,
  « Electrique ». Une seule statistique, une seule année, un seul champ pour les trois motorisations (D-029) ;
- consommations des deux-roues : ADEME 2023 (VEH01), moyenne des véhicules d'essai de chaque catégorie, lue sur la
  figure de la page 6 (data/processed/ademe_2rm_conso_lecture.csv) ;
- carburants : médiane non pondérée des prix des stations d'Île-de-France, flux « Prix des carburants en France - Flux
  instantané - v2 » (COST07, Licence Ouverte v2.0) : SP95-E10 (`e10_prix`, carburant essence le plus répandu en IDF :
  604 stations contre 126 pour le SP95 le 03/11) et gazole (`gazole_prix`) ;
- électricité : EDF, Tarif Bleu option Base, 3 et 6 kVA, 20,01 cts EUR TTC/kWh au 1er août 2026 (COST06 ; mouvement
  proposé par la CRE, délibération n° 2026-147). Valeur relue dans le PDF le 03/11 ; empreinte vérifiée par 07 ;
- carbone : ADEME, Base Carbone V23.6 (ENV02, Licence Ouverte), éléments 13988 (essence E10), 25775 (gazole routier
  B7), 43642 (électricité 2024, mix moyen, consommation).

Logique pure (sans Java), testée dans tests/test_congestion_vehicles.py.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pandas as pd

from starway.config import IDF_DEPS

SDES_SHEET = "G3.b"
SDES_YEAR = 2024
SDES_BLOCK = "Voitures particulières"
SDES_BLOCK_END = "Véhicules utilitaires légers"
SDES_ROWS = {"petrol": "dont essence", "diesel": "dont Diesel", "electric": "Electrique"}

ELEC_PRICE_EUR_KWH = 0.2001  # EDF Tarif Bleu option Base 3 et 6 kVA, TTC, au 1er août 2026 (COST06), relu le 03/11
ELEC_PRICE_TEXT = ("Tarif Bleu option Base (3 et 6 kVA), 20,01 cts EUR TTC/kWh, applicable au 1er août 2026 (grille "
                   "EDF ; mouvement proposé par la CRE, délibération n° 2026-147 du 15/07/2026)")

FUELS = {"petrol": ("e10", "SP95-E10"), "diesel": ("gazole", "gazole")}
# Prix du carburant de chaque véhicule thermique (les deux-roues roulent au SP95-E10, comme la voiture essence)
FUEL_OF = {"petrol": "petrol", "diesel": "diesel", "moto_125": "petrol", "maxiscooter": "petrol",
           "moto_mid": "petrol", "moto_900": "petrol"}
VEHICLES = (  # (id, libellé, énergie, unité, classe de péage, famille)
    ("petrol", "Voiture essence", "SP95-E10", "L", 1, "car"),
    ("diesel", "Voiture diesel", "gazole", "L", 1, "car"),
    ("electric", "Voiture électrique", "électricité", "kWh", 1, "car"),
    ("moto_125", "Scooter ou moto 125 cm3", "SP95-E10", "L", 5, "two_wheeler"),
    ("maxiscooter", "Maxiscooter", "SP95-E10", "L", 5, "two_wheeler"),
    ("moto_mid", "Moto de cylindrée moyenne", "SP95-E10", "L", 5, "two_wheeler"),
    ("moto_900", "Moto de plus de 900 cm3", "SP95-E10", "L", 5, "two_wheeler"),
)
CAR_IDS = tuple(v[0] for v in VEHICLES if v[5] == "car")

# Deux-roues (VEH01) : catégories de data/processed/ademe_2rm_conso_lecture.csv (lecture de la figure de la page 6)
ADEME_2RM_CATEGORIES = {"moto_125": "125 cm3", "maxiscooter": "maxiscooter", "moto_mid": "moto moyenne cylindrée",
                        "moto_900": "moto plus de 900 cm3"}
ADEME_2RM_TEXT = ("ADEME, « 2RM : mise à jour des connaissances sur les consommations et les émissions à "
                  "l'échappement » (septembre 2023), § 4.1, figure « CO2 et conso de carburant en usage réel ADEME », "
                  "page 6 : moyenne de {n} véhicules d'essai (n° {ids}), lue sur la figure, en usage réel sur le "
                  "trajet de référence")
# Aucune référence juridique sur la circulation inter-files : retrait confirmé par Nicolas le 05/11. La phrase ne
# porte que sur ce que le moteur fait et sur l'absence de mesure (07 et les tests refusent toute mention d'un décret).
TWO_WHEELER_TIME = ("Même temps de trajet que la voiture. En réalité il peut être plus court (circulation entre les "
                    "files), mais aucune mesure publique ne permet de chiffrer ce gain : il n'est pas estimé.")
NO_ELECTRIC_TWO_WHEELER = ("Pas de deux-roues électrique : aucune consommation publique jugée probante (choix de "
                           "l'équipe du 04/11/2026).")

# Carbone (ENV02, ADEME Base Carbone V23.6, Licence Ouverte) : facteur « combustion + amont » de l'énergie, par
# unité de consommation. Éléments choisis par leur nom exact (07 vérifie l'unité, le statut et la localisation) :
CO2_ELEMENTS = {
    "SP95-E10": "13988",  # Essence, E10 (kgCO2e/litre) : combustion 2,19 + amont 0,502
    "gazole": "25775",  # Gazole routier, B7 (kgCO2e/litre) : combustion 2,49 + amont 0,609
    "électricité": "43642",  # Electricité, 2024 - mix moyen, consommation (kgCO2e/kWh) : centrale, amont, pertes
}
CO2_UNITS = {"L": "kgCO2e/litre", "kWh": "kgCO2e/kWh"}
BASE_CARBONE_FILE = "Base_Carbone_V23.6.csv"
BASE_CARBONE_VERSION = "V23.6"
CO2_OCCUPANCY = ("une personne seule dans le véhicule : c'est la définition du scénario (le trajet d'un salarié), pas "
                 "un taux de remplissage moyen")
CO2_PERIMETER = ("énergie seule, « combustion + amont » : combustion du carburant et production, raffinage, "
                 "transport du carburant ; pour l'électricité : combustion à la centrale, amont (combustibles, "
                 "amortissement de la centrale, fonctionnement) et pertes en ligne. Non compté : fabrication du "
                 "véhicule et de sa batterie, entretien, infrastructure.")
CO2_TC_PERIMETER = ("Les facteurs IDFM des transports en commun (ENV01) ne disent pas leur périmètre (« fournis par "
                    "les opérateurs de transport pour les transports collectifs, et par la Base Carbone de l'Ademe "
                    "pour les autres ») : la comparaison avec la voiture est un ordre de grandeur, pas une mesure "
                    "au même périmètre vérifié.")

NOT_INCLUDED = ["stationnement", "achat ou location du véhicule", "assurance", "entretien et usure",
                "abonnement électrique et recharge sur borne publique (électrique)",
                "abonnements, badges et remises de péage (sauf le tarif badge du Duplex A86, affiché à part)"]


def read_sdes_consumption(xlsx: Path) -> dict[str, float]:
    """Consommations unitaires 2024 des voitures particulières, lues dans l'onglet G3.b (valeurs du fichier, non
    arrondies). Lève une erreur si un libellé ou l'année manque (jamais de valeur devinée)."""
    df = pd.read_excel(xlsx, sheet_name=SDES_SHEET, header=None, engine="openpyxl")
    year_row = next((i for i, r in df.iterrows() if SDES_YEAR in [v for v in r.tolist() if isinstance(v, int)]), None)
    if year_row is None:
        raise ValueError(f"année {SDES_YEAR} introuvable dans {SDES_SHEET}")
    col = next(j for j, v in enumerate(df.iloc[year_row].tolist()) if v == SDES_YEAR)
    labels = [str(v).strip() if isinstance(v, str) else None for v in df.iloc[:, 0].tolist()]
    if SDES_BLOCK not in labels or SDES_BLOCK_END not in labels:
        raise ValueError(f"bloc « {SDES_BLOCK} » introuvable dans {SDES_SHEET}")
    a, b = labels.index(SDES_BLOCK), labels.index(SDES_BLOCK_END)
    out: dict[str, float] = {}
    for vid, label in SDES_ROWS.items():
        rows = [i for i in range(a + 1, b) if labels[i] == label]
        if len(rows) != 1:
            raise ValueError(f"ligne « {label} » : {len(rows)} occurrences dans le bloc {SDES_BLOCK}")
        v = df.iat[rows[0], col]
        if not isinstance(v, (int, float)) or math.isnan(float(v)):
            raise ValueError(f"« {label} » {SDES_YEAR} : valeur absente")
        out[vid] = float(v)
    return out


def read_fuel_prices(csv: Path) -> pd.DataFrame:
    """Stations d'Île-de-France du flux instantané (colonnes utiles en texte, prix en nombre)."""
    df = pd.read_csv(csv, sep=";", dtype=str, encoding="utf-8-sig")
    df = df[df["code_departement"].isin(IDF_DEPS)].copy()
    for f, _ in FUELS.values():
        df[f"{f}_prix"] = pd.to_numeric(df[f"{f}_prix"], errors="coerce")
    return df


def fuel_stats(idf: pd.DataFrame, fuel: str) -> dict[str, Any]:
    """Médiane non pondérée des stations qui publient un prix pour `fuel`, avec le nombre de stations, les quartiles
    et la répartition des dates de mise à jour (heure telle que publiée, sans conversion)."""
    p = idf[f"{fuel}_prix"]
    has = p.notna()
    both = int((has & idf[f"{fuel}_rupture_type"].notna()).sum())
    q = p[has]
    maj = idf.loc[has, f"{fuel}_maj"].fillna("")
    months = maj.str[:7].value_counts().sort_index()
    return {"stations_idf": len(idf), "stations_with_price": len(q),
            "median": round(float(q.median()), 4), "q1": round(float(q.quantile(0.25)), 4),
            "q3": round(float(q.quantile(0.75)), 4), "min": float(q.min()), "max": float(q.max()),
            "updated_oldest": str(maj[maj != ""].min()) if (maj != "").any() else None,
            "updated_newest": str(maj[maj != ""].max()) if (maj != "").any() else None,
            "updated_by_month": {str(k): int(v) for k, v in months.items()},
            "price_and_rupture": both}


def read_2rm_consumption(csv: Path) -> dict[str, dict[str, Any]]:
    """Consommation des deux-roues (VEH01) : moyenne des véhicules d'essai de chaque catégorie, arrondie au centième
    (valeur publiée et utilisée), avec les numéros des véhicules. Erreur si une catégorie manque."""
    df = pd.read_csv(csv, comment="#", dtype={"vehicule_n": str})
    out: dict[str, dict[str, Any]] = {}
    for vid, cat in ADEME_2RM_CATEGORIES.items():
        g = df[df["categorie"] == cat]
        if g.empty:
            raise ValueError(f"catégorie « {cat} » absente de {csv.name}")
        mean = float(g["conso_l_100km"].mean())
        out[vid] = {"value": round(mean, 2), "mean_unrounded": mean, "n": len(g), "vehicles": g["vehicule_n"].tolist(),
                    "co2_exhaust_g_km": [float(g["co2_g_km"].min()), float(g["co2_g_km"].max())]}
    return out


def _fr_float(text: str) -> float:
    return float(str(text).replace(",", "."))


def read_co2_factors(csv: Path) -> dict[str, dict[str, Any]]:
    """Facteurs ENV02 (Base Carbone) des trois énergies, lus par identifiant d'élément : total et postes. Erreur si
    l'élément manque, s'il n'est pas « Valide générique », si son unité n'est pas celle attendue, ou si le total
    n'est pas la somme de ses postes (à l'arrondi de la base près)."""
    d = pd.read_csv(csv, sep=";", encoding="cp1252", dtype=str)
    d.columns = [c.replace("'", "_").replace(" ", "_") for c in d.columns]
    units = {"SP95-E10": CO2_UNITS["L"], "gazole": CO2_UNITS["L"], "électricité": CO2_UNITS["kWh"]}
    out: dict[str, dict[str, Any]] = {}
    for energy, eid in CO2_ELEMENTS.items():
        x = d[d["Identifiant_de_l_élément"] == eid]
        el = x[x["Type_Ligne"] == "Elément"]
        if len(el) != 1:
            raise ValueError(f"élément {eid} : {len(el)} lignes « Elément »")
        e = el.iloc[0]
        if (e["Statut_de_l_élément"] != "Valide générique" or e["Unité_français"] != units[energy]
                or e["Localisation_géographique"] != "France continentale"):
            raise ValueError(f"élément {eid} : statut, unité ou localisation inattendus")
        name = " ; ".join(str(v) for v in (e["Nom_base_français"], e["Nom_attribut_français"],
                                           e["Nom_frontière_français"]) if isinstance(v, str))
        posts = {str(r["Type_poste"]): _fr_float(r["Total_poste_non_décomposé"])
                 for _, r in x[x["Type_Ligne"] == "Poste"].iterrows()}
        total = _fr_float(e["Total_poste_non_décomposé"])
        if abs(sum(posts.values()) - total) > 0.01 * total:
            raise ValueError(f"élément {eid} : total {total} différent de la somme des postes {posts}")
        comment = e["Commentaire_français"]
        out[energy] = {"element_id": eid, "name": name, "unit": e["Unité_français"], "total": total, "posts": posts,
                       "validity": e["Période_de_validité"], "modified": e["Date_de_modification"],
                       "comment": comment if isinstance(comment, str) else None}
    return out


def vehicles_meta(consumption: dict[str, float], fuels: dict[str, dict[str, Any]],
                  rows: dict[str, dict[str, str]], two_wheelers: dict[str, dict[str, Any]] | None = None,
                  co2: dict[str, dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Table meta.vehicles : une entrée par véhicule publié, chaque valeur avec sa source. `rows` : lignes du
    manifeste par fichier (COST07, COST08, COST06, VEH01, ENV02). Deux-roues publiés seulement si `two_wheelers`
    est fourni ; carbone seulement si `co2` est fourni (sinon `co2_kg_per_km` = null, avec la raison)."""
    fuel_row, sdes_row, edf_row = rows.get("COST07", {}), rows.get("COST08", {}), rows.get("COST06", {})
    out: list[dict[str, Any]] = []
    for vid, label, energy, unit, toll, family in VEHICLES:
        if family == "two_wheeler" and two_wheelers is None:
            continue
        if family == "car":
            cons = consumption[vid]
            cons_src: dict[str, Any] = {
                "source_id": "COST08", "year": SDES_YEAR,
                "text": f"SDES, Bilan annuel des transports en 2024, onglet G3.b, voitures particulières, "
                        f"« {SDES_ROWS[vid]} »", "file_sha256": sdes_row.get("sha256") or None}
        else:
            tw = (two_wheelers or {})[vid]
            cons = tw["value"]
            cons_src = {"source_id": "VEH01", "year": 2023,
                        "text": ADEME_2RM_TEXT.format(n=tw["n"], ids=", ".join(tw["vehicles"])),
                        "reading_file": "data/processed/ademe_2rm_conso_lecture.csv",
                        "vehicles": tw["vehicles"], "co2_exhaust_g_km": tw["co2_exhaust_g_km"],
                        "file_sha256": (rows.get("VEH01") or {}).get("sha256") or None}
        if vid == "electric":
            price = ELEC_PRICE_EUR_KWH
            price_src: dict[str, Any] = {"source_id": "COST06", "text": ELEC_PRICE_TEXT, "valid_from": "2026-08-01",
                                         "file_sha256": edf_row.get("sha256") or None}
        else:
            fid = FUEL_OF[vid]
            st = fuels[fid]
            price = st["median"]
            price_src = {"source_id": "COST07", "statistic": "médiane non pondérée des stations d'Île-de-France",
                         "fuel_field": f"{FUELS[fid][0]}_prix",
                         "text": f"médiane de {st['stations_with_price']} stations d'Île-de-France, flux « Prix des "
                                 "carburants en France - Flux instantané - v2 » (Licence Ouverte v2.0)",
                         "read_at": fuel_row.get("date_extraction") or None,
                         "file_sha256": fuel_row.get("sha256") or None, **st}
        entry: dict[str, Any] = {
            "id": vid, "label": label, "family": family, "energy": energy, "unit": unit,
            "consumption_per_100km": round(cons, 4), "consumption_source": cons_src,
            "price_eur_per_unit": price, "price_source": price_src,
            "cost_eur_per_km": round(cons / 100 * price, 6), "toll_class": toll, "status": "ok"}
        if co2 is not None:
            f = co2[energy]
            entry["co2_kg_per_unit"] = f["total"]
            entry["co2_kg_per_km"] = round(cons / 100 * f["total"], 6)
            entry["co2_source"] = {"source_id": "ENV02", "version": BASE_CARBONE_VERSION, **f,
                                   "file_sha256": (rows.get("ENV02") or {}).get("sha256") or None}
        else:
            entry["co2_kg_per_km"] = None
            entry["co2_reason"] = "facteur ADEME non lu"
        if family == "two_wheeler":
            entry["time"] = {"same_as": "car", "text": TWO_WHEELER_TIME}
        out.append(entry)
    return out


def round_eur(x: float) -> float:
    """Arrondi au centime (demi-centime vers le haut)."""
    return math.floor(x * 100 + 0.5) / 100


def round_g(x: float) -> int:
    """Arrondi au gramme (demi-gramme vers le haut)."""
    return math.floor(x + 0.5)


def energy_eur(dist_m: int | None, v: dict[str, Any]) -> float | None:
    """Coût d'énergie d'un sens, non arrondi : distance (m) / 1000 x coût au km. Même ordre d'opérations que le front
    (frontend/src/data/carCost.ts) : résultats identiques au bit près."""
    return None if dist_m is None else dist_m / 1000 * float(v["cost_eur_per_km"])


def co2_g(dist_m: int | None, v: dict[str, Any]) -> float | None:
    """Carbone d'un sens (g CO2e), non arrondi : distance (m) x facteur au km (kg) ; null sans distance ou facteur."""
    if dist_m is None or v.get("co2_kg_per_km") is None:
        return None
    return dist_m * float(v["co2_kg_per_km"])


def trip_costs(dist_out_m: Sequence[int | None], dist_ret_m: Sequence[int | None],
               vehicles: Sequence[dict[str, Any]]) -> dict[str, dict[str, list[float | None]]]:
    """Coût d'énergie aller, retour, total (EUR, au centime) par véhicule ; distance absente : null (jamais 0).
    Sert aux contrôles et aux statistiques : le front fait le même calcul depuis `car_trip.dist_m`."""
    out: dict[str, dict[str, list[float | None]]] = {}
    for v in vehicles:
        o = [energy_eur(d, v) for d in dist_out_m]
        r = [energy_eur(d, v) for d in dist_ret_m]
        out[v["id"]] = {"out": [None if x is None else round_eur(x) for x in o],
                        "ret": [None if x is None else round_eur(x) for x in r],
                        "total": [None if a is None or b is None else round_eur(a + b)
                                  for a, b in zip(o, r, strict=True)]}
    return out


def trip_co2(dist_out_m: Sequence[int | None], dist_ret_m: Sequence[int | None],
             vehicles: Sequence[dict[str, Any]]) -> dict[str, dict[str, list[int | None]]]:
    """Carbone aller, retour, total (g CO2e, au gramme ; total arrondi après la somme) par véhicule."""
    out: dict[str, dict[str, list[int | None]]] = {}
    for v in vehicles:
        o = [co2_g(d, v) for d in dist_out_m]
        r = [co2_g(d, v) for d in dist_ret_m]
        out[v["id"]] = {"out": [None if x is None else round_g(x) for x in o],
                        "ret": [None if x is None else round_g(x) for x in r],
                        "total": [None if a is None or b is None else round_g(a + b)
                                  for a, b in zip(o, r, strict=True)]}
    return out


def costs_meta(distances: dict[str, Any] | None, tolls: dict[str, Any] | None = None) -> dict[str, Any]:
    """Bloc meta.car_costs : formules, ce qui n'est pas compté, état des distances (publiées seulement si corrigées)
    et des péages."""
    return {"formula": "énergie d'un sens = distance routière (km) x consommation / 100 x prix de l'énergie ; "
                       "péages = somme des péages traversés au tarif de la classe du véhicule, à l'heure de passage "
                       "(tolls.json) ; total d'un sens = énergie + péages",
            "label": "Énergie et péages",
            "energy_label": "Carburant ou électricité seuls",
            "not_included": NOT_INCLUDED,
            "rounding": "au centime (demi-centime vers le haut) ; total = aller + retour avant arrondi ; le front "
                        "calcule depuis car_trip.dist_m et meta.vehicles (cost_eur_per_km), même formule que "
                        "starway/vehicles.py",
            "carbon": {"formula": "carbone d'un sens = distance routière (km) x consommation / 100 x facteur ADEME "
                                  "« combustion + amont » de l'énergie (co2_kg_per_km de meta.vehicles)",
                       "unit": "g CO2e",
                       "rounding": "au gramme (demi-gramme vers le haut) ; total arrondi après la somme",
                       "occupancy": CO2_OCCUPANCY, "perimeter": CO2_PERIMETER, "tc_comparison": CO2_TC_PERIMETER,
                       "source_id": "ENV02"},
            "two_wheelers": {"time": TWO_WHEELER_TIME, "electric": NO_ELECTRIC_TWO_WHEELER},
            "distances": distances or {"status": "pending",
                                       "reason": "distances routières corrigées (04g, carSpeed fixé) pas encore "
                                                 "calculées : aucun coût publié"},
            "tolls": tolls or {"status": "pending", "reason": "péages traversés non publiés"},
            "decision": "D-029"}
