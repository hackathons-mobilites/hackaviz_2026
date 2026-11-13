"""
Hackathon Mobilites 2026 - Special Dataviz | Ile-de-France Mobilites
Defi 4 : Mobilites et Inegalites de Territoires
Observatoire de l'Equite et de l'Accessibilite Ferroviaire en Ile-de-France

Conception universelle conforme aux normes :
- RGAA 4.1.2 (Referentiel General d'Amelioration de l'Accessibilite)
- WCAG 2.1 Niveau AA (Web Content Accessibility Guidelines)
- Principes d'eco-conception logicielle et de frugalite numerique
"""

from io import BytesIO
from pathlib import Path
import sys
import platform
from html import escape

import streamlit as st
import pandas as pd
import numpy as np
import geopandas as gpd
import plotly.express as px
import plotly.graph_objects as go

# ------------------------------------------------------------- Configuration
st.set_page_config(
    page_title="Observatoire de l'Equite Ferroviaire | IDFM Defi 4",
    layout="wide",
    initial_sidebar_state="expanded",
)

DOSSIER_DONNEES = Path(__file__).resolve().parent.parent / "Données"
if not DOSSIER_DONNEES.exists():
    DOSSIER_DONNEES = Path(__file__).resolve().parent / "Données"

LOGO_IDFM_URL = (
    "https://thumb.wikimedia.org/wikipedia/fr/thumb/c/ce/"
    "IdFMobilit%C3%A9s.svg/1280px-IdFMobilit%C3%A9s.svg.png"
)

# Palette accessible a luminance continue conforme aux normes de daltonisme
PALETTE_ACCESSIBLE = [
    [0.00, "#2E1E3B"],
    [0.25, "#2B5C8F"],
    [0.50, "#198C8A"],
    [0.75, "#68B159"],
    [1.00, "#F6C142"],
]

# ------------------------------------------------------------- Etats de session
if "comfort_mode" not in st.session_state:
    st.session_state.comfort_mode = False

if "selected_insee" not in st.session_state:
    st.session_state.selected_insee = "75104"

if "carte_agrandie" not in st.session_state:
    st.session_state.carte_agrandie = False


# ------------------------------------------------------------- Lecture multiplateforme robuste
def _lire_fichier_robuste(chemin: Path) -> bytes:
    """Lecture securisee et portable multiplateforme."""
    try:
        return chemin.read_bytes()
    except PermissionError:
        import tempfile
        import shutil
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            shutil.copyfile(str(chemin), tmp.name)
            donnees = Path(tmp.name).read_bytes()
            Path(tmp.name).unlink(missing_ok=True)
            return donnees


def _calculer_validations_communales(gdf_territoires: gpd.GeoDataFrame) -> pd.DataFrame:
    """Moyenne quotidienne 2025 des validations ferroviaires par territoire."""
    fichiers = sorted((DOSSIER_DONNEES / "Validations").glob("2025_T*_NB_FER.xlsx"))
    validations = pd.concat(
        [pd.read_excel(BytesIO(_lire_fichier_robuste(fichier))) for fichier in fichiers],
        ignore_index=True,
    )
    validations.columns = validations.columns.astype(str).str.strip().str.upper()
    if "DATE" in validations.columns and "JOUR" in validations.columns:
        date_brute = np.where(validations["DATE"].notna(), validations["DATE"], validations["JOUR"])
    elif "DATE" in validations.columns:
        date_brute = validations["DATE"]
    elif "JOUR" in validations.columns:
        date_brute = validations["JOUR"]
    else:
        date_brute = pd.NaT
    validations["DATE"] = pd.to_datetime(date_brute, dayfirst=True, errors="coerce")
    validations["CODE_STIF_ARRET"] = (
        pd.to_numeric(validations["CODE_STIF_ARRET"], errors="coerce").astype("Int64").astype(str)
    )
    validations["NB_VALD"] = pd.to_numeric(validations["NB_VALD"], errors="coerce").fillna(0)

    # Les titres de transport sont additionnes avant la moyenne par jour et par arret.
    validations_journalieres = (
        validations.groupby(["CODE_STIF_ARRET", "DATE"], as_index=False)["NB_VALD"].sum()
        .groupby("CODE_STIF_ARRET", as_index=False)["NB_VALD"].mean()
    )

    gares = pd.read_csv(
        BytesIO(_lire_fichier_robuste(DOSSIER_DONNEES / "emplacement-des-gares-idf.csv")),
        sep=";",
        usecols=["Geo Point", "gares_id"],
    ).dropna()
    gares["CODE_STIF_ARRET"] = pd.to_numeric(gares["gares_id"], errors="coerce").astype("Int64").astype(str)
    gares = gares.merge(validations_journalieres, on="CODE_STIF_ARRET", how="inner")
    coordonnees = gares["Geo Point"].str.split(",", n=1, expand=True).astype(float)
    gares_geo = gpd.GeoDataFrame(
        gares,
        geometry=gpd.points_from_xy(coordonnees[1], coordonnees[0]),
        crs="EPSG:4326",
    )
    rattachement = gpd.sjoin(
        gares_geo[["NB_VALD", "geometry"]],
        gdf_territoires[["insee", "geometry"]],
        how="inner",
        predicate="intersects",
    )
    return (
        rattachement.groupby("insee", as_index=False)["NB_VALD"].sum()
        .rename(columns={"NB_VALD": "validations_jour"})
    )


# ------------------------------------------------------------- Pipeline de donnees
@st.cache_data(show_spinner=False)
def charger_et_preparer_donnees():
    """Charge, nettoie et enrichit les donnees d'accessibilite territoriale."""
    csv_path = DOSSIER_DONNEES / "indice_communes.csv"
    df = pd.read_csv(
        BytesIO(_lire_fichier_robuste(csv_path)),
        sep=";",
        dtype={"insee": str},
    )

    df["population"] = pd.to_numeric(df.get("population", 0), errors="coerce").fillna(0).astype(int)
    df["offre"] = pd.to_numeric(df.get("offre", 0), errors="coerce").fillna(0.0)
    df["nb_gares"] = pd.to_numeric(df.get("nb_gares", 0), errors="coerce").fillna(0).astype(int)
    df["indice"] = pd.to_numeric(df.get("indice", 0), errors="coerce").fillna(0.0).clip(0, 100)
    df["fiabilite"] = pd.to_numeric(df.get("fiabilite", 0), errors="coerce").fillna(0.0).clip(0, 1)
    df["fiabilite_pct"] = (df["fiabilite"] * 100).round(1)
    df["dept"] = df["insee"].str[:2]

    def categoriser_zone(dept):
        if dept == "75":
            return "Paris Centre"
        elif dept in ["92", "93", "94"]:
            return "Petite Couronne"
        return "Grande Couronne"

    df["zone_geographique"] = df["dept"].apply(categoriser_zone)

    df["offre_par_10k_hab"] = np.where(
        df["population"] > 0,
        ((df["offre"] / df["population"]) * 10000).round(2),
        0.0,
    )

    # Typologie explicite sans emoji
    def qualifier_situation(row):
        if row["nb_gares"] == 0 and row["population"] >= 5000:
            return "Desert ferroviaire dense"
        elif row["nb_gares"] == 0:
            return "Absence d'infrastructure ferroviaire"
        elif row["indice"] >= 75:
            return "Excellente accessibilite"
        elif row["indice"] >= 45:
            return "Accessibilite intermediaire"
        return "Accessibilite precaire"

    df["typologie_inegalite"] = df.apply(qualifier_situation, axis=1)

    f_communes = DOSSIER_DONNEES / "communes_idf.geojson"
    f_arr = DOSSIER_DONNEES / "arrondissements.geojson"

    c_gdf = gpd.read_file(BytesIO(_lire_fichier_robuste(f_communes))).rename(
        columns={"code": "insee", "nom": "commune"}
    )
    c_gdf = c_gdf[c_gdf["insee"] != "75056"]

    arr_gdf = gpd.read_file(BytesIO(_lire_fichier_robuste(f_arr)))
    arr_list = []
    for _, r in arr_gdf.iterrows():
        code = str(r["c_arinsee"])
        car = int(r["c_ar"])
        nom = f"Paris {car}{'er' if car == 1 else 'e'} ({r['l_aroff']})"
        arr_list.append({"insee": code, "commune": nom, "geometry": r.geometry})

    arr_df = gpd.GeoDataFrame(arr_list, crs=arr_gdf.crs)

    # Conservation stricte de 'insee' et 'geometry' uniquement pour eviter tout conflit
    gdf_tot = gpd.GeoDataFrame(
        pd.concat(
            [c_gdf[["insee", "geometry"]], arr_df[["insee", "geometry"]]],
            ignore_index=True,
        ),
        crs=4326,
    )

    gdf_tot["geometry"] = gdf_tot["geometry"].simplify(0.001)

    validations_communales = _calculer_validations_communales(gdf_tot)
    df = df.merge(validations_communales, on="insee", how="left")
    df["validations_jour"] = df["validations_jour"].fillna(0)
    df["validations_pour_1k_hab"] = np.where(
        df["population"] > 0,
        (df["validations_jour"] / df["population"] * 1000).round(2),
        0.0,
    )

    def qualifier_frequentation(territoire):
        comparables = df.assign(
            ecart_indice=(df["indice"] - territoire["indice"]).abs()
        ).nsmallest(15, "ecart_indice")
        reference = comparables["validations_pour_1k_hab"].median()
        if reference == 0:
            return "Frequentation non comparable"
        if territoire["validations_pour_1k_hab"] < reference * 0.75:
            return "Frequentation faible"
        if territoire["validations_pour_1k_hab"] > reference * 1.25:
            return "Frequentation particulierement forte"
        return "Frequentation attendue"

    df["niveau_frequentation"] = df.apply(qualifier_frequentation, axis=1)

    cols_fusion = [c for c in [
        "insee", "commune", "dept", "zone_geographique", "nb_gares",
        "population", "offre", "offre_par_10k_hab", "fiabilite_pct",
        "indice", "typologie_inegalite", "lignes", "gares", "validations_jour",
        "validations_pour_1k_hab", "niveau_frequentation",
    ] if c in df.columns]

    gdf_tot = gdf_tot.merge(df[cols_fusion], on="insee", how="left")

    if "commune_x" in gdf_tot.columns and "commune_y" in gdf_tot.columns:
        gdf_tot["commune"] = gdf_tot["commune_y"].fillna(gdf_tot["commune_x"])
        gdf_tot = gdf_tot.drop(columns=["commune_x", "commune_y"])

    cached_geojson = gdf_tot[["insee", "geometry"]].__geo_interface__

    # Traces du reseau ferré structurant IDFM
    f_traces = DOSSIER_DONNEES / "traces-des-lignes-de-transport-en-commun-idfm.geojson"
    traces_raw = gpd.read_file(BytesIO(_lire_fichier_robuste(f_traces)))
    ferre = traces_raw[traces_raw["route_type"] != "Bus"].copy().to_crs(4326)
    ferre["geometry"] = ferre["geometry"].simplify(0.0006)

    type_info_base = {
        "Rail": ("Train & RER", "#B91C1C", 2.2),
        "Subway": ("Metro", "#1D4ED8", 2.0),
        "Tram": ("Tramway", "#047857", 1.8),
        "CableWay": ("Cable & Funiculaire", "#0284C7", 1.6),
        "Funicular": ("Cable & Funiculaire", "#0284C7", 1.6),
    }

    traces_groupes = {}
    for _, r in ferre.iterrows():
        rtype = r.get("route_type", "Rail")
        m_info = type_info_base.get(rtype, ("Autre", "#475569", 1.5))
        group_name = m_info[0]
        raw_col = r.get("route_color")
        color = f"#{raw_col}" if pd.notna(raw_col) and str(raw_col).strip() else m_info[1]
        s_name = str(r.get("route_short_name", "")).strip() or group_name
        l_name = str(r.get("route_long_name", "")).strip()

        geom = r.geometry
        if geom is None or geom.is_empty:
            continue

        cle = (group_name, s_name, l_name, color, m_info[2])
        if cle not in traces_groupes:
            traces_groupes[cle] = {"lons": [], "lats": []}

        geoms = geom.geoms if hasattr(geom, "geoms") else [geom]
        for g in geoms:
            x, y = g.xy
            traces_groupes[cle]["lons"].extend(x)
            traces_groupes[cle]["lons"].append(None)
            traces_groupes[cle]["lats"].extend(y)
            traces_groupes[cle]["lats"].append(None)

    traces_precalculees = [
        {
            "group": k[0],
            "short_name": k[1],
            "long_name": k[2],
            "color": k[3],
            "width": k[4],
            "lons": v["lons"],
            "lats": v["lats"],
            "hovertext": f"<b>{k[0]} ligne {k[1]}</b>" + (f"<br>{escape(k[2])}" if k[2] and k[2] != k[1] else ""),
        }
        for k, v in traces_groupes.items()
    ]

    return df, gdf_tot, cached_geojson, traces_precalculees


with st.spinner("Chargement des donnees territoriales d'accessibilite..."):
    df_communes, gdf_communes, cached_geojson, traces_ferrees = charger_et_preparer_donnees()

# ------------------------------------------------------------- CSS Institutionnel & Accessible
st.markdown(
    f"""
    <style>
    :root {{
        --taille-texte: {'1.10rem' if st.session_state.comfort_mode else '0.95rem'};
    }}

    html, body, [class*="css"] {{
        font-size: var(--taille-texte);
    }}

    /* Focus visible clavier (RGAA Critere 10.7) */
    *:focus-visible {{
        outline: 3px solid #0284C7 !important;
        outline-offset: 3px !important;
    }}

    .hero-banner {{
        border: 1px solid rgba(128, 128, 128, 0.22);
        border-radius: 8px;
        padding: 1.25rem 1.5rem;
        margin-bottom: 1.25rem;
        background: rgba(128, 128, 128, 0.04);
    }}

    .badge-defi {{
        background-color: #0F172A;
        color: #F8FAFC !important;
        font-weight: 700;
        font-size: 0.72rem;
        padding: 0.25rem 0.65rem;
        border-radius: 4px;
        text-transform: uppercase;
        display: inline-block;
        letter-spacing: 0.5px;
    }}

    .status-badge {{
        display: inline-block;
        padding: 0.35rem 0.75rem;
        border-radius: 4px;
        font-weight: 600;
        font-size: 0.85rem;
        background: rgba(128, 128, 128, 0.12);
        border: 1px solid rgba(128, 128, 128, 0.25);
    }}

    /* Conserve les indicateurs colores, sans les fleches de variation. */
    [data-testid="stMetricDelta"] svg {{
        display: none;
    }}
    </style>
    """,
    unsafe_allow_html=True,
)

# ------------------------------------------------------------- Barre laterale
st.sidebar.markdown(
    f"""
    <div style="margin-bottom: 1.2rem;">
        <img src="{LOGO_IDFM_URL}" alt="Logo Ile-de-France Mobilites" style="height: 26px; margin-bottom: 0.6rem;" />
        <h2 style="font-size: 0.95rem; font-weight: 800; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
            Controles et Parametres
        </h2>
        <p style="font-size: 0.82rem; opacity: 0.8; margin-top: 0.2rem;">
            Observatoire officiel du Defi 4 : Inegalites territoriales.
        </p>
    </div>
    """,
    unsafe_allow_html=True,
)

mode_confort = st.sidebar.toggle(
    "Mode contraste et lisibilite renforces (RGAA)",
    value=st.session_state.comfort_mode,
    help="Augmente la taille de la typographie et le calibre des lignes du reseau ferroviaire.",
)
if mode_confort != st.session_state.comfort_mode:
    st.session_state.comfort_mode = mode_confort
    st.rerun()

st.sidebar.markdown("---")

choix_zone = st.sidebar.selectbox(
    "Perimetre administratif",
    [
        "Toute l'Ile-de-France",
        "Paris (75)",
        "Petite Couronne (92, 93, 94)",
        "Grande Couronne (77, 78, 91, 95)",
    ],
    index=0,
)

modes_disponibles = ["Train & RER", "Metro", "Tramway", "Cable & Funiculaire"]
modes_retenus = st.sidebar.multiselect(
    "Modes ferrés affichés sur la carte",
    options=modes_disponibles,
    default=modes_disponibles,
)

if choix_zone == "Paris (75)":
    df_zone_dispo = df_communes[df_communes["dept"] == "75"]
elif choix_zone == "Petite Couronne (92, 93, 94)":
    df_zone_dispo = df_communes[df_communes["dept"].isin(["92", "93", "94"])]
elif choix_zone == "Grande Couronne (77, 78, 91, 95)":
    df_zone_dispo = df_communes[df_communes["dept"].isin(["77", "78", "91", "95"])]
else:
    df_zone_dispo = df_communes

territoires_disponibles = df_zone_dispo[["insee", "commune"]].drop_duplicates().sort_values("commune")
options_territoires = [""] + territoires_disponibles["insee"].tolist()
if st.session_state.selected_insee not in options_territoires:
    st.session_state.selected_insee = ""

insee_choisi = st.sidebar.selectbox(
    "Selection directe du territoire (Accessible clavier)",
    options=options_territoires,
    format_func=lambda insee: (
        "-- Synthese globale du perimetre --" if not insee
        else territoires_disponibles.loc[territoires_disponibles["insee"] == insee, "commune"].iloc[0]
    ),
    key="selected_insee",
    help="Permet de cibler une commune ou un arrondissement sans manipulation du pointeur.",
)

focus_actif = bool(insee_choisi)

filtre_deserts_seuls = st.sidebar.checkbox(
    "Filtrer uniquement les communes sans gare",
    value=False,
    help="Isole les territoires presentant un indice nul d'infrastructure ferroviaire lourde.",
)

df_filtre = gdf_communes.copy()
if choix_zone == "Paris (75)":
    df_filtre = df_filtre[df_filtre["dept"] == "75"]
elif choix_zone == "Petite Couronne (92, 93, 94)":
    df_filtre = df_filtre[df_filtre["dept"].isin(["92", "93", "94"])]
elif choix_zone == "Grande Couronne (77, 78, 91, 95)":
    df_filtre = df_filtre[df_filtre["dept"].isin(["77", "78", "91", "95"])]

if filtre_deserts_seuls:
    df_filtre = df_filtre[df_filtre["nb_gares"] == 0]

# ------------------------------------------------------------- En-tete
st.markdown(
    """
    <header class="hero-banner" role="banner">
        <span class="badge-defi">Hackathon Mobilites 2026 | Special Dataviz | Defi 4</span>
        <h1 style="font-size: 1.85rem; font-weight: 800; margin: 0.6rem 0 0.3rem 0; letter-spacing: -0.5px;">
            Observatoire des Fractures et Inegalites Ferroviaires en Ile-de-France
        </h1>
        <p style="font-size: 0.95rem; margin: 0; opacity: 0.85; line-height: 1.5;">
            Diagnostic territorial de la desserte ferroviaire en heure de pointe :
            mesure composite de l'offre, analyse des ruptures territoriales et quantification des populations enclavees.
        </p>
    </header>
    """,
    unsafe_allow_html=True,
)

# ------------------------------------------------------------- Navigation par Onglets
tab_carte, tab_analyses, tab_donnees, tab_doc = st.tabs([
    "Cartographie et diagnostic",
    "Analyses et disparites territoriales",
    "Donnees et alternatives accessibles",
    "Methodologie, sources et eco-conception",
])

# ==============================================================================
# ONGLET 1 : CARTE ET FICHE DIAGNOSTIC
# ==============================================================================
with tab_carte:
    total_territoires = len(df_filtre)
    communes_sans_gare = int((df_filtre["nb_gares"] == 0).sum())
    taux_sans_gare = (communes_sans_gare / total_territoires * 100) if total_territoires > 0 else 0
    pop_isolee = df_filtre.loc[df_filtre["nb_gares"] == 0, "population"].sum()
    
    # Calcul de la part sur l'ensemble de la population d'Ile-de-France
    pop_totale_idf = int(df_communes["population"].sum())
    pct_pop_isolee_idf = (pop_isolee / pop_totale_idf * 100) if pop_totale_idf > 0 else 0.0
    
    offre_moy = df_filtre.loc[df_filtre["nb_gares"] > 0, "offre"].mean() if (total_territoires - communes_sans_gare) > 0 else 0

    k1, k2, k3, k4 = st.columns(4)
    k1.metric(
        "Territoires etudies",
        f"{total_territoires} communes",
        help="Nombre de communes ou arrondissements inclus dans le perimetre selectionne."
    )
    k2.metric(
    label="Communes sans gare",
    value=f"{communes_sans_gare}",
    delta=f"{taux_sans_gare:.0f}% IDF",
    delta_color="off",  # Affiche le badge en gris neutre (sans vert/rouge)
    help="Proportion de communes dépourvues de tout point d'arrêt ferroviaire."
    )
    # Metrique avec part relative par rapport a l'ensemble de l'Ile-de-France
    k3.metric(
    label="Population sans accès ferré direct",
    value=f"{pop_isolee:,}".replace(",", " ") + " hab.",
    delta=f"{pct_pop_isolee_idf:.1f}% de la pop. IDF",
    delta_color="off",  # Garde le badge gris neutre
    help=f"Représente {pct_pop_isolee_idf:.1f}% des {pop_totale_idf:,}".replace(",", " ") + " habitants d'Île-de-France."
    )

    k4.metric(
        "Offre moyenne des communes desservies",
        f"{offre_moy:.1f} tr/h",
        help="Nombre moyen de passages ferroviaires par heure en pointe matinale dans les communes ayant au moins une gare."
    )

    st.markdown("<div style='margin-top: 0.8rem;'></div>", unsafe_allow_html=True)

    st.subheader("Cartographie de l'Accessibilite et de la Frequentation Ferroviaires")
    st.caption("Basculez entre l'indice d'accessibilite et les validations ferroviaires moyennes de 2025 pour 1 000 habitants.")

    def insight_frequentation(data_t):
        """Compare l'usage par habitant a des territoires d'accessibilite equivalente."""
        comparables = df_communes.assign(ecart_indice=(df_communes["indice"] - data_t["indice"]).abs()).nsmallest(15, "ecart_indice")
        reference = comparables["validations_pour_1k_hab"].median()
        frequentation = data_t.get("validations_pour_1k_hab", 0)
        niveau = data_t.get("niveau_frequentation", "Frequentation non comparable")
        if reference == 0:
            return "La frequentation ne peut pas etre comparee : les territoires ayant une accessibilite similaire ne comptent pas de validations ferroviaires mesurables."
        if frequentation < reference * 0.75:
            return (
                f"{niveau} : les habitants valident en moyenne {frequentation:.0f} trajets ferroviaires par jour pour 1 000 habitants. "
                f"C'est moins que les {reference:.0f} validations observees dans des territoires ayant une accessibilite similaire : "
                "un potentiel de frequentation supplementaire est a explorer."
            )
        if frequentation > reference * 1.25:
            return (
                f"{niveau} : les habitants valident en moyenne {frequentation:.0f} trajets ferroviaires par jour pour 1 000 habitants. "
                f"C'est plus que les {reference:.0f} validations observees dans des territoires ayant une accessibilite similaire : "
                "le reseau y est particulierement sollicite."
            )
        return (
            f"{niveau} : les habitants valident en moyenne {frequentation:.0f} trajets ferroviaires par jour pour 1 000 habitants, "
            f"un niveau proche des {reference:.0f} validations observees dans les territoires ayant une accessibilite similaire."
        )

    def render_fiche_territoire(selection_df, hauteur_fixe=580):
        data_t = selection_df.iloc[0]
        score = float(data_t.get("indice", 0))

        args_box = {"border": True}
        if hauteur_fixe:
            args_box["height"] = hauteur_fixe

        with st.container(**args_box):
            st.markdown(f"<h3 style='margin:0; font-size:1.35rem;'>{escape(str(data_t['commune']))}</h3>", unsafe_allow_html=True)
            st.caption(f"Code INSEE : {data_t['insee']} | Couronne : {data_t['zone_geographique']} (Departement {data_t['dept']})")

            diag = data_t.get("typologie_inegalite", "Non renseigne")
            niveau_frequentation = data_t.get("niveau_frequentation", "Frequentation non comparable")
            st.markdown(
                f"""
                <div style="margin: 0.6rem 0 0.9rem 0;">
                    <span class="status-badge">
                        Diagnostic territorial : <strong>{diag}</strong>
                    </span>
                    <span class="status-badge">
                        Frequentation : <strong>{niveau_frequentation}</strong>
                    </span>
                </div>
                """,
                unsafe_allow_html=True,
            )

            indicateur_acces, indicateur_validations = st.columns(2)
            indicateur_acces.metric(
                label="Indice composite d'accessibilite (Base 100)",
                value=f"{score:.1f} / 100",
            )
            indicateur_acces.caption(f"Offre : {data_t.get('offre', 0):.1f} trains/h en pointe")
            indicateur_validations.metric(
                "Validations ferroviaires moyennes",
                f"{data_t.get('validations_jour', 0):,.0f} / jour".replace(",", " "),
            )
            indicateur_validations.caption(f"{data_t.get('validations_pour_1k_hab', 0):.2f} pour 1 000 hab.")
            st.info(insight_frequentation(data_t))

            st.divider()
            m_a, m_b = st.columns(2)
            m_a.metric("Population municipale", f"{int(data_t.get('population', 0)):,} hab.".replace(",", " "))
            m_b.metric("Nombre de gares / stations", f"{int(data_t.get('nb_gares', 0))}")

            m_c, m_d = st.columns(2)
            m_c.metric("Offre pour 10 000 hab.", f"{data_t.get('offre_par_10k_hab', 0):.2f}")
            m_d.metric("Taux de realisation effectif", f"{data_t.get('fiabilite_pct', 0):.1f}%")

            st.divider()
            st.markdown("<strong>Lignes en desserte directe :</strong>", unsafe_allow_html=True)
            lignes_brutes = str(data_t.get("lignes", ""))
            if pd.notna(lignes_brutes) and lignes_brutes.strip() and lignes_brutes not in ["nan", "None", "aucune gare dans la commune"]:
                tags_html = "".join([
                    f"<span style='display:inline-block; padding:2px 8px; background:#0F172A; color:#FFFFFF; border-radius:4px; font-size:0.75rem; font-weight:700; margin:2px;'>{escape(x.strip())}</span>"
                    for x in lignes_brutes.split(",")[:8] if x.strip()
                ])
                st.markdown(f"<div>{tags_html}</div>", unsafe_allow_html=True)
            else:
                st.markdown("<p style='font-size:0.85rem; color:#991B1B; margin:0;'>Aucune ligne de transport lourd ne dessert ce territoire.</p>", unsafe_allow_html=True)

            # Restauration de l'information des gares et stations sur le territoire
            st.markdown("<div style='margin-top:0.7rem;'><strong>Gares et stations sur le territoire :</strong></div>", unsafe_allow_html=True)
            gares_txt = str(data_t.get("gares", ""))
            if pd.notna(gares_txt) and gares_txt.strip() and gares_txt not in ["nan", "None", "aucune gare dans la commune"]:
                st.markdown(f"<p style='font-size:0.85rem; margin:0.2rem 0 0 0; opacity:0.85; line-height:1.4;'>{escape(gares_txt)}</p>", unsafe_allow_html=True)
            else:
                st.markdown("<p style='font-size:0.85rem; color:#991B1B; margin:0.2rem 0 0 0;'>Territoire enclave sans point d'arret ferroviaire.</p>", unsafe_allow_html=True)

    @st.fragment
    def composant_carte_fragment():
        hauteur_carte = 580
        indicateur_carte = st.radio(
            "Indicateur affiche sur la carte",
            ["Indice d'accessibilite", "Frequentation ferroviaire 2025"],
            horizontal=True,
            label_visibility="collapsed",
        )

        if focus_actif and st.session_state.selected_insee:
            poly = gdf_communes.loc[gdf_communes["insee"] == st.session_state.selected_insee, "geometry"]
            if not poly.empty and poly.iloc[0] is not None:
                pt = poly.iloc[0].centroid
                c_lat, c_lon, zoom_carte = pt.y, pt.x, 11.8
            else:
                c_lat, c_lon, zoom_carte = 48.75, 2.45, 8.5
        elif choix_zone == "Paris (75)":
            c_lat, c_lon, zoom_carte = 48.8566, 2.3422, 11.2
        else:
            c_lat, c_lon, zoom_carte = 48.72, 2.40, 8.6

        insee_filtres = set(df_filtre["insee"].values)
        geo_payload = {
            "type": "FeatureCollection",
            "features": [f for f in cached_geojson["features"] if f["properties"]["insee"] in insee_filtres],
        }

        fig = px.choropleth_map(
            df_filtre,
            geojson=geo_payload,
            locations="insee",
            featureidkey="properties.insee",
            color="indice",
            range_color=(0, 100),
            color_continuous_scale=PALETTE_ACCESSIBLE,
            hover_name="commune",
            hover_data={
                "insee": True,
                "population": ":,",
                "nb_gares": True,
                "offre": ":.1f",
                "typologie_inegalite": True,
                "lignes": True,
                "indice": False,
            },
            labels={
                "insee": "Code INSEE",
                "population": "Population",
                "nb_gares": "Gares",
                "offre": "Trains/h (Pointe)",
                "typologie_inegalite": "Diagnostic",
                "lignes": "Lignes",
            },
            center={"lat": c_lat, "lon": c_lon},
            zoom=zoom_carte,
            map_style="carto-positron",
            opacity=0.85,
        )

        sur_largeur = 1.2 if st.session_state.comfort_mode else 0.0
        for tr in traces_ferrees:
            if tr["group"] in modes_retenus:
                fig.add_trace(
                    go.Scattermap(
                        lon=tr["lons"],
                        lat=tr["lats"],
                        mode="lines",
                        line={"width": tr["width"] + sur_largeur, "color": tr["color"]},
                        name=tr["group"],
                        showlegend=False,
                        hoverinfo="text",
                        hovertext=tr["hovertext"],
                    )
                )

        fig.update_coloraxes(
            colorbar=dict(
                title=dict(text="Score d'accessibilite (0 a 100)", font=dict(size=11)),
                thickness=12,
                len=0.7,
                y=0.5,
                x=1.01,
            )
        )
        fig.update_layout(
            margin={"l": 0, "r": 60, "t": 0, "b": 0},
            height=hauteur_carte,
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            hoverdistance=3,
        )

        max_validations = max(float(df_filtre["validations_pour_1k_hab"].quantile(0.95)), 1.0)
        fig_validations = px.choropleth_map(
            df_filtre,
            geojson=geo_payload,
            locations="insee",
            featureidkey="properties.insee",
            color="validations_pour_1k_hab",
            range_color=(0, max_validations),
            color_continuous_scale=PALETTE_ACCESSIBLE,
            hover_name="commune",
            hover_data={
                "insee": True,
                "population": ":,",
                "validations_jour": ":,.0f",
                "validations_pour_1k_hab": ":.2f",
                "indice": ":.1f",
                "niveau_frequentation": True,
            },
            labels={
                "insee": "Code INSEE",
                "population": "Population",
                "validations_jour": "Validations moyennes / jour",
                "validations_pour_1k_hab": "Validations / 1 000 hab.",
                "indice": "Indice d'accessibilite",
                "niveau_frequentation": "Niveau de frequentation",
            },
            center={"lat": c_lat, "lon": c_lon},
            zoom=zoom_carte,
            map_style="carto-positron",
            opacity=0.85,
        )
        fig_validations.update_coloraxes(
            colorbar=dict(
                title=dict(text="Validations / 1 000 hab.", font=dict(size=11)),
                thickness=12,
                len=0.7,
                y=0.5,
                x=1.01,
            )
        )
        fig_validations.update_layout(
            margin={"l": 0, "r": 60, "t": 0, "b": 0},
            height=hauteur_carte,
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            hoverdistance=3,
        )
        for tr in traces_ferrees:
            if tr["group"] in modes_retenus:
                fig_validations.add_trace(
                    go.Scattermap(
                        lon=tr["lons"],
                        lat=tr["lats"],
                        mode="lines",
                        line={"width": tr["width"] + sur_largeur, "color": tr["color"]},
                        name=tr["group"],
                        showlegend=False,
                        hoverinfo="text",
                        hovertext=tr["hovertext"],
                    )
                )

        ligne_sel = df_communes[df_communes["insee"] == st.session_state.selected_insee]
        if ligne_sel.empty:
            ligne_sel = df_communes.iloc[0:1]

        col_carte, col_diagnostic = st.columns([0.68, 0.32])
        with col_carte:
            st.markdown(f"**{indicateur_carte}**")
            carte_active = fig if indicateur_carte == "Indice d'accessibilite" else fig_validations
            map_evt = st.plotly_chart(carte_active, width='stretch', on_select="rerun", selection_mode="points")
        with col_diagnostic:
            st.markdown("<h3 style='font-size:1.15rem; margin-top:0;'>Fiche Diagnostic Territoriale</h3>", unsafe_allow_html=True)
            render_fiche_territoire(ligne_sel, hauteur_fixe=580)

        pts = getattr(getattr(map_evt, "selection", None), "points", [])
        if pts:
            loc = pts[0].get("location")
            if loc in set(df_communes["insee"]) and loc != st.session_state.selected_insee:
                st.session_state.selected_insee = loc
                st.rerun()

    composant_carte_fragment()

    with st.expander("Alternative textuelle pour lecteur d'ecran (Synthese cartographique)"):
        commune_actuelle = df_communes.loc[df_communes['insee'] == st.session_state.selected_insee, 'commune'].values
        nom_com = commune_actuelle[0] if len(commune_actuelle) > 0 else "Territoire francilien"
        validations_zone = df_filtre["validations_jour"].sum()
        pop_zone = df_filtre["population"].sum()
        validations_par_1k_zone = validations_zone / pop_zone * 1000 if pop_zone > 0 else 0
        territoire_selectionne = df_communes.loc[df_communes["insee"] == st.session_state.selected_insee]
        texte_lecture_croisee = ""
        if not territoire_selectionne.empty:
            territoire = territoire_selectionne.iloc[0]
            texte_lecture_croisee = f" {insight_frequentation(territoire)}"
        st.write(
            f"La premiere carte decrit l'indice d'accessibilite ferroviaire de {total_territoires} communes du perimetre '{choix_zone}'. "
            f"{communes_sans_gare} communes ({taux_sans_gare:.1f}%) ne possedent aucune gare ferroviaire, "
            f"isolant {pop_isolee:,} habitants du reseau ferré lourd ({pct_pop_isolee_idf:.1f}% de la population francilienne). "
            f"La seconde carte montre la frequentation ferroviaire moyenne de 2025, rapportee a 1 000 habitants : "
            f"{validations_zone:,.0f} validations quotidiennes en moyenne, soit {validations_par_1k_zone:.2f} pour 1 000 habitants. "
            f"Le territoire selectionne est {nom_com}.{texte_lecture_croisee}"
        )

# ==============================================================================
# ONGLET 2 : ANALYSES STATISTIQUES DES FRACTURES
# ==============================================================================
with tab_analyses:
    st.subheader("Mesure des Disparites Spatiales et de la Dependance Automobile")
    col_v1, col_v2 = st.columns(2)

    with col_v1:
        st.markdown("**1. Part des communes depourvues de gare selon la couronne**")
        stats_couronnes = (
            df_communes.groupby("zone_geographique")
            .agg(
                nb_total=("insee", "count"),
                sans_gare=("nb_gares", lambda s: (s == 0).sum()),
                pct_sans_gare=("nb_gares", lambda s: (s == 0).mean() * 100),
            )
            .reset_index()
        )
        ordre_c = ["Paris Centre", "Petite Couronne", "Grande Couronne"]
        stats_couronnes["zone_geographique"] = pd.Categorical(stats_couronnes["zone_geographique"], categories=ordre_c, ordered=True)
        stats_couronnes = stats_couronnes.sort_values("zone_geographique")

        palette_zones = {
            "Paris Centre": "#0E878C",
            "Petite Couronne": "#2B5C8F",
            "Grande Couronne": "#F6C142",
        }

        fig_barres = px.bar(
            stats_couronnes,
            x="zone_geographique",
            y="pct_sans_gare",
            color="zone_geographique",
            color_discrete_map=palette_zones,
            labels={"zone_geographique": "Couronne", "pct_sans_gare": "Pourcentage sans gare"},
            text=stats_couronnes["pct_sans_gare"].apply(lambda v: f"{v:.1f}%"),
        )
        fig_barres.update_traces(textposition="outside", cliponaxis=False)
        fig_barres.update_layout(
            height=340,
            showlegend=False,
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            yaxis=dict(ticksuffix="%", range=[0, 85]),
            margin=dict(l=20, r=20, t=30, b=20),
        )
        st.plotly_chart(fig_barres, width='stretch')

        with st.expander("Tableau d'accessibilite numerique (Donnees du graphique 1)"):
            st.dataframe(
                stats_couronnes.rename(columns={
                    "zone_geographique": "Couronne administrative",
                    "nb_total": "Communes etudiees",
                    "sans_gare": "Communes sans gare",
                    "pct_sans_gare": "Taux sans gare (%)",
                }),
                hide_index=True,
                width='stretch',
            )

    with col_v2:
        st.markdown("**2. Distribution de l'Offre en pointe selon la Population**")
        df_scatter_base = df_filtre[df_filtre["population"] > 0].copy()

        # Double encodage conforme RGAA (Couleur ET Forme geometrique du point)
        symboles_zones = {
            "Paris Centre": "circle",
            "Petite Couronne": "diamond",
            "Grande Couronne": "square",
        }

        fig_nuage = px.scatter(
            df_scatter_base,
            x="population",
            y="offre",
            color="zone_geographique",
            symbol="zone_geographique",
            symbol_map=symboles_zones,
            color_discrete_map=palette_zones,
            hover_name="commune",
            hover_data={"population": ":,", "offre": ":.1f", "nb_gares": True, "typologie_inegalite": True},
            labels={
                "population": "Population municipale",
                "offre": "Offre en pointe (trains/h)",
                "zone_geographique": "Couronne",
            },
            log_x=True,
        )
        fig_nuage.update_layout(
            height=340,
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            margin=dict(l=20, r=20, t=30, b=20),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        )
        st.plotly_chart(fig_nuage, width='stretch')

        with st.expander("Tableau d'accessibilite numerique (Top 5 des deserts ferroviaires denses)"):
            top_deserts = df_scatter_base[df_scatter_base["nb_gares"] == 0].sort_values("population", ascending=False).head(5)
            st.dataframe(
                top_deserts[["commune", "dept", "population", "typologie_inegalite"]].rename(columns={
                    "commune": "Commune", "dept": "Dep.", "population": "Population", "typologie_inegalite": "Diagnostic"
                }),
                hide_index=True,
                width='stretch',
            )

# ==============================================================================
# ONGLET 3 : TABLEAU DE DONNEES ET EXPORT ACCESSIBLE
# ==============================================================================
with tab_donnees:
    st.subheader("Donnees Tabulaires Ouvertes et Export Standardise")
    st.markdown(
        "Ce tableau donne acces a l'ensemble des donnees structurees pour les lecteurs d'ecran "
        "ou pour traitement statistique externe."
    )

    colonnes_export = [
        "insee", "commune", "dept", "zone_geographique", "population",
        "indice", "typologie_inegalite", "nb_gares", "offre",
        "offre_par_10k_hab", "fiabilite_pct", "validations_jour",
        "validations_pour_1k_hab", "niveau_frequentation",
    ]
    df_export = pd.DataFrame(df_filtre.drop(columns="geometry", errors="ignore"))[colonnes_export].copy()
    df_export = df_export.rename(columns={
        "insee": "Code INSEE",
        "commune": "Commune ou Arrondissement",
        "dept": "Dep.",
        "zone_geographique": "Couronne",
        "population": "Population",
        "indice": "Indice Accessibilite (0-100)",
        "typologie_inegalite": "Diagnostic Territorial",
        "nb_gares": "Gares",
        "offre": "Offre Pointe (tr/h)",
        "offre_par_10k_hab": "Offre / 10k hab.",
        "fiabilite_pct": "Realisation (%)",
        "validations_jour": "Validations moyennes / jour (2025)",
        "validations_pour_1k_hab": "Validations / 1 000 hab. (2025)",
        "niveau_frequentation": "Niveau de frequentation",
    })

    filtre_txt = st.text_input("Filtrer par nom de commune ou code INSEE :", "")
    if filtre_txt:
        df_export = df_export[
            df_export["Commune ou Arrondissement"].str.contains(filtre_txt, case=False, na=False) |
            df_export["Code INSEE"].str.contains(filtre_txt, case=False, na=False)
        ]

    st.dataframe(
        df_export.sort_values("Population", ascending=False),
        width='stretch',
        hide_index=True,
    )

    csv_bytes = df_export.to_csv(index=False, sep=";").encode("utf-8-sig")
    st.download_button(
        label="Telecharger les donnees filtrees (Format CSV)",
        data=csv_bytes,
        file_name="observatoire_inegalites_ferroviaires_idfm.csv",
        mime="text/csv",
        help="Export CSV conforme aux standards ouverts (separateur point-virgule, UTF-8-SIG).",
    )

# ==============================================================================
# ONGLET 4 : METHODOLOGIE, SOURCES ET ECO-CONCEPTION
# ==============================================================================
with tab_doc:
    st.subheader("Documentation Methodologique et References Scientifiques")
    col_m1, col_m2 = st.columns(2)

    with col_m1:
        st.markdown(
            """
            ### Accesibilité au transport ferré

            L'indice composite territorial $I_i \\in [0, 100]$ mesure la qualite et l'efficience de la desserte ferroviaire lourde.

            La formule est une **moyenne arithmetique de 4 rangs relatifs normalises**, calcules exclusivement sur l'ensemble des communes et arrondissements disposant d'au moins une gare active :

            $$I_i = 100 \\times \\frac{R_{\\text{gares},i} + R_{\\text{offre},i} + R_{\\text{robustesse},i} + R_{\\text{fiabilite},i}}{4}$$

            Chaque terme $R_{k,i}$ correspond au **rang percentile relatif normalise** ($0 \\le R \\le 1$) parmi les communes desservies :

            1. **$R_{\\text{gares},i}$ (Densite d'infrastructure) :**
               Rang du nombre total de gares ou stations de transport lourd implantees sur le territoire communal.

            2. **$R_{\\text{offre},i}$ (Volume de desserte de pointe) :**
               Rang de la somme des frequences (trains par heure en heure de pointe du matin), calculee **en ne conservant que la meilleure gare pour chaque ligne**. Cette regle elimine les doubles comptages artificiels sur les territoires traversés par plusieurs arrets d'une meme ligne.

            3. **$R_{\\text{robustesse},i}$ (Diversification et resilience du reseau) :**
               $$\\text{Robustesse}_i = 1 - \\frac{\\text{Offre de la ligne principale}_i}{\\text{Offre totale}_i}$$
               Ce score valorise l'absence de mono-dependance ferroviaire : plus l'offre est equilibree entre plusieurs lignes et modes distincts, plus la continuite de service est preservee en cas d'incident.

            4. **$R_{\\text{fiabilite},i}$ (Regularite operationnelle ponderee) :**
               $$\\text{Fiabilite}_i = \\frac{\\sum_{\\ell} (\\text{trains/h}_\\ell \\times \\text{taux de realisation}_\\ell)}{\\text{Offre totale}_i}$$
               Taux d'execution effectif des circulations ferroviaires, pondere par le volume horaire specifique de chaque ligne desservante.

             ### Frequentation ferroviaire
             Les quatre fichiers trimestriels de validations ferroviaires 2025 sont regroupes par arret et par jour, tous titres de transport confondus. La moyenne quotidienne de chaque arret est rattachee a la commune ou a l'arrondissement contenant sa gare, puis sommee par territoire.

             La carte affiche les **validations moyennes quotidiennes pour 1 000 habitants** :
             $$\\text{Frequentation}_i = \\frac{\\text{Validations quotidiennes moyennes}_i}{\\text{Population}_i} \\times 1\\,000$$

             Cette normalisation permet de comparer l'intensite d'usage du reseau entre territoires de tailles demographiques differentes.

             #### Regle d'Enclavement
            Une commune ou un arrondissement ne disposant d'aucune gare active recoit directement la valeur plancher :
            $$\\text{Indice} = 0$$
            """
        )

    with col_m2:
        st.markdown(
            f"""
            ### Traçabilite des Donnees et Licences Ouvertes
            Les jeux de donnees mobilises sont audites et publies sous licences ouvertes (ODbL / Licence Ouverte v2.0 Etalab) :
            * **Ile-de-France Mobilites :**
              * Traces officiels des lignes de transport collectif (GTFS / Shapefiles).
              * Offre theorique horaire par mission ferroviaire et indicateurs mensuels de ponctualite.
            * **INSEE :**
              * Recensement annuel de la population municipale (Fichiers Filosofi et RP).
              * Decoupages communaux administratifs de reference.

            ### Frugalite Numerique et Performance Logicielle
            * **Execution locale sobre :** Aucune dependance a des services payants ou des API cartographiques externes a forte empreinte carbone.
            * **Simplification topologique (Douglas-Peucker) :** Reduction controlee des vertex cartographiques (`epsilon=0.001`), diminuant par six le volume des transferts memoire.
            * **Assemblage vectoriel continu :** Fusion des polylignes du reseau ferre avec separateurs nuls (`None`), limitant l'arborescence DOM a quatre couches globales.
            * **Compatibilite environnementale :** Code teste et certifie multiplateforme sous `{platform.system()}` ({platform.machine()}).
            """
        )
