"""
Indice communal de résilience de la desserte ferrée en Île-de-France (v2).

Question : les habitants d'une commune ont-ils accès à des trains fréquents,
fiables, et à une alternative si leur ligne principale est perturbée ?

=============================================================================
DONNÉES UTILISÉES (à placer dans le même dossier que ce script)
=============================================================================
1. emplacement-des-gares-idf.csv
   IDFM, « Emplacement des gares d'Île-de-France »
   https://data.iledefrance-mobilites.fr/explore/dataset/emplacement-des-gares-idf/
   -> position (x, y en Lambert-93) de chaque gare et lignes qui la desservent.

2. offre_hebdomadaire_moyenne_hors_vacances.csv
   IDFM, offre hebdomadaire moyenne hors vacances scolaires
   -> nombre moyen de passages par arrêt, par ligne et par heure.
   Sert à calculer la fréquence en heure de pointe GARE PAR GARE.

3. Offre_commerciale_contractuelle_rail.xlsx  et  Offre_commerciale_réalisée_rail.xlsx
   Offre prévue au contrat et offre réellement produite, par ligne et par an.
   -> taux de réalisation = réalisée / contractuelle = part des trains prévus
      qui ont vraiment roulé (moyenne 2022-2025, plafonnée à 100 %).

4. Contours des communes : téléchargés automatiquement depuis geo.api.gouv.fr
   (IGN / INSEE) au premier lancement, puis gardés dans communes_idf.geojson.

=============================================================================
CALCUL (version simple : on compte ce qui se trouve DANS la commune)
=============================================================================
Chaque gare est rattachée à la commune où elle se trouve. Puis, par commune :
- Gares       : nombre de gares (un pôle de correspondance compte pour 1).
- Offre       : somme, sur les lignes qui ont une gare dans la commune, des
                trains par heure en pointe à la meilleure gare de la ligne.
- Robustesse  : 1 - (trains/h de la ligne principale / offre totale).
                0 = une seule ligne ; proche de 1 = plusieurs lignes équivalentes.
                C'est la part de l'offre qui reste si la ligne principale tombe.
- Fiabilité   : taux de réalisation moyen des lignes, pondéré par leurs trains/h.

Indice (0-100) = 100 x moyenne des rangs (gares, offre, robustesse, fiabilité)
                 -> poids modifiables dans POIDS ci-dessous.
Les rangs (percentiles parmi les communes qui ont une gare) mettent les quatre
critères sur la même échelle. Une commune sans gare a un indice de 0.

=============================================================================
Installation :  python -m pip install geopandas pandas numpy requests plotly openpyxl
Sorties      :  indice_communes.csv (tableau, aussi alternative accessible à la carte)
                carte_indice.html   (carte des communes)
"""
from pathlib import Path
import re
import sys

import numpy as np
import pandas as pd
import geopandas as gpd

DOSSIER = Path(__file__).resolve().parent

# ----------------------------------------------------------------- paramètres
HEURES_POINTE = [7, 8]            # tranches horaires 7h-8h et 8h-9h
JOUR = "nb_courses_mardi"         # jour ouvré type
ANNEES_FIABILITE = [2022, 2023, 2024, 2025]
POIDS = {"gares": 1, "offre": 1, "robustesse": 1, "fiabilite": 1}   # poids relatifs
MODES_FERRES = [0, 1, 2, 6, 7]    # tram, métro, train (RER/Transilien/TER), câble, funiculaire
DEPARTEMENTS = ["75", "77", "78", "91", "92", "93", "94", "95"]


def trouver(motif):
    """Trouve un fichier du dossier par motif (insensible aux accents mal encodés)."""
    trouves = sorted(DOSSIER.glob(motif))
    if not trouves:
        sys.exit(f"Fichier introuvable ({motif}) dans {DOSSIER}\n"
                 f"Fichiers présents : {[p.name for p in DOSSIER.iterdir()]}")
    return trouves[0]


def normaliser_id(s):
    """'43 170' ou '43170.0' -> '43170' pour que les identifiants se joignent."""
    return s.astype(str).str.replace(" ", "", regex=False).str.replace(r"\.0$", "", regex=True)


# ------------------------------------------------------------------- 1. gares
def charger_gares():
    f = trouver("emplacement-des-gares-idf*.csv")
    df = pd.read_csv(f, sep=";", encoding="utf-8-sig",
                     usecols=["id_ref_ZdC", "nom_ZdC", "id_ref_ZdA", "nom_ZdA", "mode",
                              "idrefligc", "res_com", "x", "y"],
                     dtype={"id_ref_ZdA": str, "id_ref_ZdC": str, "idrefligc": str})
    n0 = len(df)
    df = df[(df["x"] > 0) & (df["y"] > 0)]
    df = df.drop_duplicates(["id_ref_ZdA", "res_com"])
    df["id_ref_ZdA"] = normaliser_id(df["id_ref_ZdA"])
    print(f"[gares]      {f.name} : {n0} -> {len(df)} gares x lignes après nettoyage")
    return gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df["x"], df["y"]), crs=2154)


# ------------------------------------------------------------ 2. fréquences
def charger_frequences():
    f = trouver("offre_hebdomadaire*.csv")
    cols = ["code_mode_ligne", "id_ligne_commerciale", "nom_ligne_commerciale",
            "id_zone_arret", "tranche_horaire", JOUR]
    morceaux = []
    for bloc in pd.read_csv(f, sep=";", encoding="utf-8-sig", usecols=cols, chunksize=300_000,
                            dtype={"id_zone_arret": str, "id_ligne_commerciale": str,
                                   "nom_ligne_commerciale": str}):
        morceaux.append(bloc[bloc["code_mode_ligne"].isin(MODES_FERRES)])
    df = pd.concat(morceaux)

    # table des lignes ferrées (nom, mode) pour relier la fiabilité
    lignes = df.drop_duplicates("id_ligne_commerciale")[
        ["id_ligne_commerciale", "nom_ligne_commerciale", "code_mode_ligne"]]

    pointe = df[df["tranche_horaire"].isin(HEURES_POINTE)]
    # passages des deux sens confondus, par heure
    freq = (pointe.groupby(["id_zone_arret", "id_ligne_commerciale"])[JOUR].sum()
            / len(HEURES_POINTE)).rename("trains_heure").reset_index()
    freq["id_zone_arret"] = normaliser_id(freq["id_zone_arret"])
    print(f"[fréquences] {f.name} : {len(freq)} couples gare x ligne en pointe "
          f"({freq['id_ligne_commerciale'].nunique()} lignes ferrées)")
    return freq, lignes


# ------------------------------------------------------------- 3. fiabilité
def lire_offre_xlsx(chemin):
    df = pd.read_excel(chemin, header=0)
    df.columns = ["ligne", "operateur"] + [int(float(c)) for c in df.columns[2:]]
    df["ligne"] = df["ligne"].ffill()
    df = df[df["operateur"].isna() | (df["operateur"] == "Total")]       # RER A/B : total RATP+SNCF
    df = df[~df["ligne"].astype(str).str.contains("Toutes|%")]
    df["ligne"] = df["ligne"].astype(str).str.replace("*", "", regex=False).str.strip()
    return df.set_index("ligne")[ANNEES_FIABILITE].apply(pd.to_numeric, errors="coerce")


def noms_vers_ids(nom, lignes):
    """'RER A' -> ligne A (train) ; 'Ligne H' -> H (train) ; 'Ligne 3 - 3 bis' -> 3 et 3B (métro)."""
    trains = lignes[lignes["code_mode_ligne"] == 2]
    metros = lignes[lignes["code_mode_ligne"] == 1]
    m = re.fullmatch(r"(?:RER|Ligne)\s+([A-Z])", nom)
    if m:
        return trains.loc[trains["nom_ligne_commerciale"] == m.group(1), "id_ligne_commerciale"].tolist()
    m = re.fullmatch(r"Ligne\s+(\d+)(?:\s*-\s*\d+\s*bis)?", nom)
    if m:
        n = m.group(1)
        cibles = [n, n + "B"] if "bis" in nom else [n]
        return metros.loc[metros["nom_ligne_commerciale"].isin(cibles), "id_ligne_commerciale"].tolist()
    return []


def charger_fiabilite(lignes):
    contrat = lire_offre_xlsx(trouver("*contractuelle*rail*.xlsx"))
    realise = lire_offre_xlsx(trouver("*alis*rail*.xlsx"))
    taux = (realise / contrat).clip(upper=1).mean(axis=1).dropna().rename("taux_realisation")

    lignes_fiab = []
    for nom, t in taux.items():
        ids = noms_vers_ids(nom, lignes)
        if not ids:
            print(f"   ! ligne non reliée : {nom}")
        lignes_fiab += [{"id_ligne_commerciale": i, "taux_realisation": t} for i in ids]
    fiab = pd.DataFrame(lignes_fiab)
    print(f"[fiabilité]  taux de réalisation {ANNEES_FIABILITE[0]}-{ANNEES_FIABILITE[-1]} "
          f"pour {len(fiab)} lignes (moyenne {fiab['taux_realisation'].mean():.1%})")
    return fiab


# -------------------------------------------------------------- 4. communes
def charger_communes():
    cache = DOSSIER / "communes_idf.geojson"
    if not cache.exists():
        import requests
        morceaux = []
        for d in DEPARTEMENTS:
            r = requests.get(f"https://geo.api.gouv.fr/departements/{d}/communes",
                             params={"fields": "nom,code,population,contour",
                                     "format": "geojson", "geometry": "contour"}, timeout=60)
            r.raise_for_status()
            morceaux.append(gpd.GeoDataFrame.from_features(r.json()["features"], crs=4326))
        gpd.GeoDataFrame(pd.concat(morceaux, ignore_index=True), crs=4326).to_file(cache, driver="GeoJSON")
    c = gpd.read_file(cache).to_crs(2154).rename(columns={"code": "insee", "nom": "commune"})
    c["population"] = pd.to_numeric(c["population"], errors="coerce")
    print(f"[communes]   {cache.name} : {len(c)} communes")
    return c[["insee", "commune", "population", "geometry"]]


# ------------------------------------------------------------------ calcul
def rang(s):
    """Percentile entre 0 et 1 (ex æquo au rang moyen)."""
    return s.rank(pct=True, method="average")


def main():
    gares = charger_gares()
    freq, lignes = charger_frequences()
    fiab = charger_fiabilite(lignes)
    communes = charger_communes()

    # -- fréquence de chaque gare x ligne
    gares = gares.merge(freq, left_on=["id_ref_ZdA", "idrefligc"],
                        right_on=["id_zone_arret", "id_ligne_commerciale"], how="left")
    sans = gares["trains_heure"].isna()
    if sans.any():
        # gare absente de l'offre (ligne récente, identifiant différent) : médiane de sa ligne,
        # sinon médiane de son mode
        med_ligne = gares.groupby("res_com")["trains_heure"].transform("median")
        med_mode = gares.groupby("mode")["trains_heure"].transform("median")
        gares["trains_heure"] = gares["trains_heure"].fillna(med_ligne).fillna(med_mode)
        print(f"   ! {sans.sum()} gares x lignes sans fréquence dans l'offre -> médiane de la ligne. "
              f"Exemples : {sorted(gares.loc[sans, 'res_com'].unique())[:8]}")

    # -- fiabilité de chaque ligne (moyenne des lignes connues sinon)
    gares = gares.merge(fiab, left_on="idrefligc", right_on="id_ligne_commerciale",
                        how="left", suffixes=("", "_f"))
    connue = gares["taux_realisation"].notna()
    print(f"   fiabilité connue pour {gares.loc[connue, 'res_com'].nunique()} lignes ; "
          f"moyenne appliquée à : {sorted(gares.loc[~connue, 'res_com'].unique())}")
    gares["taux_realisation"] = gares["taux_realisation"].fillna(fiab["taux_realisation"].mean())

    # -- commune de chaque gare (point dans polygone)
    gares = gpd.sjoin(gares, communes[["insee", "geometry"]], predicate="within", how="left")
    hors = gares["insee"].isna()
    if hors.any():
        print(f"   {gares.loc[hors, 'nom_ZdA'].nunique()} gares hors Île-de-France ignorées")
    gares = gares[~hors]

    # -- une ligne par commune : sa meilleure gare dans la commune
    lc = (gares.groupby(["insee", "res_com"])
               .agg(trains_heure=("trains_heure", "max"), taux=("taux_realisation", "first"))
               .reset_index())
    lc["trains_taux"] = lc["trains_heure"] * lc["taux"]

    g = lc.groupby("insee")
    res = pd.DataFrame({
        "nb_gares": gares.groupby("insee")["id_ref_ZdC"].nunique(),
        "nb_lignes": g["res_com"].nunique(),
        "offre": g["trains_heure"].sum(),
        "ligne_principale": lc.loc[g["trains_heure"].idxmax()].set_index("insee")["res_com"],
        "max_ligne": g["trains_heure"].max(),
        "trains_taux": g["trains_taux"].sum(),
        "gares": gares.groupby("insee")["nom_ZdC"].apply(lambda s: ", ".join(sorted(set(s)))),
        "lignes": g["res_com"].apply(lambda s: ", ".join(sorted(s))),
    })
    res["robustesse"] = 1 - res["max_ligne"] / res["offre"]
    res["fiabilite"] = res["trains_taux"] / res["offre"]

    out = communes.drop(columns="geometry").merge(res, left_on="insee", right_index=True, how="left")
    desservie = out["nb_gares"].fillna(0) > 0

    # rangs calculés parmi les communes qui ont au moins une gare
    score = 0
    for critere, colonne in [("gares", "nb_gares"), ("offre", "offre"),
                             ("robustesse", "robustesse"), ("fiabilite", "fiabilite")]:
        out[f"rang_{critere}"] = rang(out.loc[desservie, colonne])
        score = score + POIDS[critere] * out[f"rang_{critere}"]
    out["indice"] = (100 * score / sum(POIDS.values())).round(1)

    out.loc[~desservie, ["indice", "nb_gares", "nb_lignes", "offre", "robustesse"]] = 0
    out["lignes"] = out["lignes"].fillna("aucune gare dans la commune")
    out[["ligne_principale", "gares"]] = out[["ligne_principale", "gares"]].fillna("")

    cols = ["insee", "commune", "population", "indice", "nb_gares", "nb_lignes",
            "offre", "robustesse", "fiabilite", "ligne_principale", "lignes", "gares"]
    out = out[cols].sort_values("indice", ascending=False)
    for c in ["robustesse", "fiabilite"]:
        out[c] = out[c].round(3)
    out["offre"] = out["offre"].round(1)
    out[["nb_gares", "nb_lignes"]] = out[["nb_gares", "nb_lignes"]].astype(int)
    out.to_csv(DOSSIER / "indice_communes.csv", sep=";", index=False, encoding="utf-8-sig")

    # -- résumé
    pop = out["population"].fillna(0)
    print(f"\nCommunes : {len(out)} | desservies : {int(desservie.sum())} | "
          f"sans gare : {int((~desservie).sum())} "
          f"({pop[out['nb_lignes'] == 0].sum() / pop.sum():.0%} de la population)")
    vue = ["commune", "indice", "nb_gares", "nb_lignes", "offre", "robustesse", "fiabilite",
           "ligne_principale"]
    print("\n15 communes les mieux notées :")
    print(out.head(15)[vue].to_string(index=False))
    print("\n15 communes desservies les moins bien notées :")
    print(out[out["nb_gares"] > 0].tail(15)[vue].to_string(index=False))
    print(f"\nÉcrit : {DOSSIER / 'indice_communes.csv'}")

    carte(communes, out)


def carte(communes, out):
    try:
        import plotly.express as px
    except ImportError:
        print("Carte non générée : python -m pip install plotly")
        return
    c = communes[["insee", "geometry"]].copy()
    c["geometry"] = c.simplify(50)
    c = c.to_crs(4326).merge(out, on="insee")
    c["robustesse_txt"] = c["robustesse"].map(lambda v: f"{v:.2f}")
    c["fiabilite_txt"] = c["fiabilite"].map(lambda v: "" if pd.isna(v) else f"{v:.1%}")
    fig = px.choropleth_map(
        c, geojson=c.__geo_interface__, locations="insee", featureidkey="properties.insee",
        color="indice", range_color=(0, 100), color_continuous_scale="Cividis",
        hover_name="commune",
        hover_data={"insee": False, "indice": True, "nb_gares": True, "nb_lignes": True,
                    "robustesse_txt": True, "fiabilite_txt": True, "lignes": True},
        labels={"indice": "Indice (0-100)", "nb_gares": "Gares", "nb_lignes": "Lignes",
                "robustesse_txt": "Robustesse", "fiabilite_txt": "Trains réalisés",
                "lignes": "Lignes"},
        center={"lat": 48.75, "lon": 2.45}, zoom=8.2, map_style="carto-positron",
        opacity=0.85,
        title="Résilience de la desserte ferrée par commune (0 = aucune gare, 100 = maximum)",
    )
    fig.update_layout(margin={"l": 0, "r": 0, "t": 40, "b": 0})
    fig.write_html(DOSSIER / "carte_indice.html", include_plotlyjs="cdn")
    print(f"Écrit : {DOSSIER / 'carte_indice.html'}")


if __name__ == "__main__":
    main()