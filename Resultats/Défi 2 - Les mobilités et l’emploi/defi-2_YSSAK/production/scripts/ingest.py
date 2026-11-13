"""Ingestion des données ouvertes du projet hakathon_mobilite.

Télécharge chaque source dans data/raw/ (cache : un fichier déjà présent n'est
pas re-téléchargé), puis la normalise en Parquet dans data/parquet/. dbt lit
ensuite ces fichiers Parquet (voir models/staging/_sources.yml).

Usage :
    python scripts/ingest.py                 # tout
    python scripts/ingest.py --only mobpro   # une seule source
    python scripts/ingest.py --force         # re-télécharge tout

Aucune transformation métier ici : on se contente de lire les formats
d'origine (xlsx, zip, csv, API) et d'écrire un Parquet propre. Les règles
métier sont dans dbt.
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "parquet"

INSEE = "https://www.insee.fr/fr/statistiques/fichier"
IDFM = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets"
# insee.fr renvoie des erreurs 500 aux clients non identifiés comme navigateurs : on s'annonce comme tel.
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 hakathon-mobilite/1.0"

# Région étudiée (code INSEE). 11 = Île-de-France.
REGION = "11"

# Trimestres glissants publiés par IDFM (les 4 jeux couvrent les 12 derniers mois).
IDFM_TRIMESTRES = ["1er", "2eme", "3eme", "4eme"]

# Millésime de l'enquête BMO (France Travail). L'URL, l'onglet et les colonnes de bassin (BE26, NOMBE26)
# en dépendent : à changer ici seulement lors de la publication d'un nouveau millésime.
BMO_ANNEE = 2026


# --------------------------------------------------------------------------
# Outils
# --------------------------------------------------------------------------
def log(msg: str) -> None:
    print(f"[ingest] {msg}", flush=True)


def gunzip_if_needed(data: bytes) -> bytes:
    return gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data


def download(url: str, dest: Path, force: bool = False, params: dict | None = None) -> Path:
    """Télécharge url vers dest (avec 3 essais). Ne fait rien si dest existe déjà."""
    if dest.exists() and dest.stat().st_size > 0 and not force:
        log(f"cache   {dest.relative_to(ROOT)}")
        return dest
    if params:
        url = f"{url}?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, 4):
        try:
            log(f"get     {url[:110]}")
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=300) as resp:
                tmp = dest.with_suffix(dest.suffix + ".part")
                with open(tmp, "wb") as fh:
                    while chunk := resp.read(1 << 20):
                        fh.write(chunk)
            # Certaines API renvoient du gzip même sans le demander.
            with open(tmp, "rb") as fh:
                magic = fh.read(2)
            if magic == b"\x1f\x8b" and dest.suffix not in {".gz", ".zip"}:
                tmp.write_bytes(gunzip_if_needed(tmp.read_bytes()))
            tmp.replace(dest)
            return dest
        except Exception as exc:  # noqa: BLE001 - on veut réessayer sur toute erreur réseau
            log(f"échec   essai {attempt}/3 : {exc}")
            if attempt == 3:
                raise
            time.sleep(5 * attempt)
    return dest


def write_parquet(df: pd.DataFrame, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.parquet"
    con = duckdb.connect()
    con.register("df", df)  # DuckDB lit le DataFrame directement (pas besoin de pyarrow)
    con.execute(f"COPY df TO '{path.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
    log(f"écrit   {path.relative_to(ROOT)} ({len(df):,} lignes)".replace(",", " "))


def duck_copy(sql: str, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.parquet"
    con = duckdb.connect()
    con.execute(f"COPY ({sql}) TO '{path.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
    n = con.execute(f"SELECT count(*) FROM '{path.as_posix()}'").fetchone()[0]
    log(f"écrit   {path.relative_to(ROOT)} ({n:,} lignes)".replace(",", " "))


def read_insee_xlsx(path: Path, sheet: str, header_row: int) -> pd.DataFrame:
    """Lit un onglet INSEE (en-têtes après plusieurs lignes de titre), tout en texte."""
    df = pd.read_excel(path, sheet_name=sheet, skiprows=header_row, dtype=str, engine="calamine")
    return df.dropna(how="all")


# --------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------
def ingest_cog(force: bool) -> None:
    """INSEE - Table d'appartenance géographique des communes (COG 2025)."""
    z = download(f"{INSEE}/7671844/table-appartenance-geo-communes-2025.zip", RAW / "cog_2025.zip", force)
    with zipfile.ZipFile(z) as zf:
        xlsx_name = next(n for n in zf.namelist() if n.endswith(".xlsx"))
        xlsx = io.BytesIO(zf.read(xlsx_name))
    write_parquet(read_insee_xlsx(xlsx, "COM", 5), "cog_communes")
    xlsx.seek(0)
    write_parquet(read_insee_xlsx(xlsx, "ARM", 5), "cog_arrondissements")
    xlsx.seek(0)
    write_parquet(read_insee_xlsx(xlsx, "Zones_supra_communales", 5), "cog_libelles_supra")


def ingest_mobpro(force: bool) -> None:
    """INSEE - RP 2022, fichier détail MOBPRO (format Parquet publié par l'INSEE)."""
    p = download(f"{INSEE}/8589904/RP2022_mobpro.parquet", RAW / "RP2022_mobpro.parquet", force)
    download(f"{INSEE}/8589904/varmod_mobpro_2022.csv", RAW / "varmod_mobpro_2022.csv", force)
    # On garde les actifs qui habitent OU travaillent dans la région (flux entrants inclus).
    duck_copy(
        f"SELECT * FROM '{p.as_posix()}' WHERE REGION = '{REGION}' OR REGLT = '{REGION}'",
        "mobpro_2022",
    )
    duck_copy(
        f"SELECT * FROM read_csv('{(RAW / 'varmod_mobpro_2022.csv').as_posix()}', delim=';', header=true, all_varchar=true)",
        "mobpro_2022_varmod",
    )


def ingest_filosofi(force: bool) -> None:
    """INSEE - Filosofi 2021, indicateurs revenus/pauvreté (géographie 2025, toutes mailles)."""
    z = download(f"{INSEE}/7756729/base-cc-filosofi-2021-geo2025_csv.zip", RAW / "filosofi_2021_geo2025.zip", force)
    with zipfile.ZipFile(z) as zf:
        name = next(n for n in zf.namelist() if n.endswith("_data.csv"))
        target = RAW / "filosofi_2021_data.csv"
        target.write_bytes(zf.read(name))
    duck_copy(
        f"""SELECT * FROM read_csv('{target.as_posix()}', delim=';', header=true,
                                   types={{'GEO': 'VARCHAR', 'OBS_VALUE': 'DOUBLE'}})
            WHERE GEO_OBJECT IN ('COM', 'ARM', 'EPCI', 'ZE2020', 'DEP', 'REG')""",
        "filosofi_2021",
    )


def ingest_chomage(force: bool) -> None:
    """INSEE - Taux de chômage localisés par zone d'emploi (série trimestrielle)."""
    x = download(f"{INSEE}/1893230/chomage-zone-t1-2003-t2-2026.xlsx", RAW / "chomage_ze.xlsx", force)
    df = read_insee_xlsx(x, "txcho_ze", 5)  # ligne 5 = codes (ZE2020, LIBZE2020, REG, LIBREG, 2003-T1...)
    long = df.melt(id_vars=["ZE2020", "LIBZE2020", "REG", "LIBREG"], var_name="periode", value_name="taux_chomage")
    long = long[long["periode"].str.match(r"^\d{4}-T[1-4]$")]
    long["taux_chomage"] = pd.to_numeric(long["taux_chomage"], errors="coerce")
    write_parquet(long, "chomage_ze")


def idfm_id_column(dataset: str) -> str:
    req = urllib.request.Request(f"{IDFM}/{dataset}", headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    fields = {f["name"] for f in json.loads(gunzip_if_needed(body))["fields"]}
    for candidate in ("id_zdc", "ida"):
        if candidate in fields:
            return candidate
    raise RuntimeError(f"{dataset} : colonne identifiant introuvable parmi {sorted(fields)}")


def ingest_idfm(force: bool) -> None:
    """Île-de-France Mobilités - gares ferrées + validations des 12 derniers mois."""
    g = download(f"{IDFM}/emplacement-des-gares-idf/exports/csv", RAW / "idfm_gares.csv", force, {"delimiter": ";"})
    # geo_point_2d = "lat, lon" : on l'éclate en deux colonnes numériques.
    gares = duckdb.sql(
        f"""SELECT * EXCLUDE (geo_shape, picto, geo_point_2d),
                   CAST(trim(split_part(geo_point_2d, ',', 2)) AS DOUBLE) AS lon,
                   CAST(trim(split_part(geo_point_2d, ',', 1)) AS DOUBLE) AS lat
            FROM read_csv('{g.as_posix()}', delim=';', header=true)"""
    ).df()
    # Rattachement de chaque gare à sa commune par intersection point / contour exact
    # (fait ici en Python : évite de dépendre de PostGIS ou de l'extension spatial de DuckDB).
    gares["codegeo_commune"] = assign_communes(gares["lon"], gares["lat"], force)
    write_parquet(gares, "idfm_gares")

    frames_arret, frames_jour = [], []
    for t in IDFM_TRIMESTRES:
        ds = f"validations-reseau-ferre-nombre-validations-par-jour-{t}-trimestre"
        base = f"{IDFM}/{ds}/exports/csv"
        common = {"delimiter": ";"}
        # L'identifiant de zone de correspondance s'appelle "ida" ou "id_zdc" selon le trimestre.
        id_col = idfm_id_column(ds)
        f_arret = download(base, RAW / f"idfm_validations_arret_{t}.csv", force, {
            **common,
            "select": f"{id_col} as id_zdc, libelle_arret, sum(nb_vald) as nb_validations",
            "group_by": f"{id_col}, libelle_arret",
        })
        f_jour = download(base, RAW / f"idfm_validations_jour_{t}.csv", force, {
            **common,
            "select": "jour, sum(nb_vald) as nb_validations",
            "group_by": "jour",
        })
        jour = pd.read_csv(f_jour, sep=";", encoding="utf-8-sig")
        jour["jour"] = pd.to_datetime(jour["jour"], utc=True).dt.date
        debut, fin = jour["jour"].min(), jour["jour"].max()
        trimestre = f"{debut.year}-T{(debut.month - 1) // 3 + 1}"
        arret = pd.read_csv(f_arret, sep=";", encoding="utf-8-sig", dtype={"libelle_arret": str})
        arret["trimestre"], arret["debut"], arret["fin"] = trimestre, debut, fin
        jour["trimestre"] = trimestre
        frames_arret.append(arret)
        frames_jour.append(jour)
    write_parquet(pd.concat(frames_arret, ignore_index=True), "idfm_validations_arret")
    write_parquet(pd.concat(frames_jour, ignore_index=True), "idfm_validations_jour")


def download_contours(force: bool) -> dict:
    f = download(
        "https://geo.api.gouv.fr/communes",
        RAW / "communes_contours.geojson",
        force,
        {"codeRegion": REGION, "format": "geojson", "geometry": "contour", "fields": "code,nom,codeDepartement"},
    )
    return json.loads(f.read_text(encoding="utf-8"))


def assign_communes(lons: pd.Series, lats: pd.Series, force: bool) -> list[str | None]:
    """Code commune contenant chaque point (lon, lat), ou None hors région."""
    from shapely import STRtree
    from shapely.geometry import Point, shape

    gj = download_contours(force)
    geoms = [shape(ft["geometry"]) for ft in gj["features"]]
    codes = [ft["properties"]["code"] for ft in gj["features"]]
    tree = STRtree(geoms)
    out: list[str | None] = []
    for lon, lat in zip(lons, lats):
        if pd.isna(lon) or pd.isna(lat):
            out.append(None)
            continue
        hits = tree.query(Point(lon, lat), predicate="within")
        out.append(codes[hits[0]] if len(hits) else None)
    return out


def ingest_contours(force: bool) -> None:
    """geo.api.gouv.fr (Etalab / IGN) - contours des communes, simplifiés pour le web."""
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union

    gj = download_contours(force)
    rows, by_dep = [], {}
    for feat in gj["features"]:
        geom = shape(feat["geometry"])
        p = feat["properties"]
        by_dep.setdefault(p["codeDepartement"], []).append(geom)
        simple = geom.simplify(0.0008, preserve_topology=True)
        c = geom.representative_point()
        rows.append({"maille": "Commune", "codegeo": p["code"], "libgeo": p["nom"],
                     "lon": c.x, "lat": c.y, "geojson": json.dumps(mapping(simple))})
    for dep, geoms in by_dep.items():
        u = unary_union(geoms)
        c = u.representative_point()
        rows.append({"maille": "Département", "codegeo": dep, "libgeo": None,
                     "lon": c.x, "lat": c.y, "geojson": json.dumps(mapping(u.simplify(0.002, preserve_topology=True)))})
    write_parquet(pd.DataFrame(rows), "contours_idf")


# --------------------------------------------------------------------------
# Sources spécifiques au défi 2 « mobilités et emploi »
# --------------------------------------------------------------------------
IDF_ODS = "https://data.iledefrance.fr/api/explore/v2.1/catalog/datasets"
DARES_ODS = "https://data.dares.travail-emploi.gouv.fr/api/explore/v2.1/catalog/datasets"


def ingest_bassins_emploi(force: bool) -> None:
    """Région IDF - 25 bassins d'emploi (2021), polygones + rattachement de chaque commune."""
    from shapely import STRtree
    from shapely.geometry import Point, mapping, shape

    f = download(f"{IDF_ODS}/bassins-demploi-ile-de-france-2021/exports/geojson", RAW / "bassins_emploi.geojson", force)
    gj = json.loads(f.read_text(encoding="utf-8"))
    rows, geoms = [], []
    for ft in gj["features"]:
        p, g = ft["properties"], shape(ft["geometry"])
        geoms.append(g)
        c = g.representative_point()
        rows.append({"code_be": p["code_be"], "nom": p["nom"], "nom_suppl": p.get("nom_suppl"), "statut": p.get("statut"),
                     "lon": c.x, "lat": c.y, "geojson": json.dumps(mapping(g.simplify(0.001, preserve_topology=True)))})
    write_parquet(pd.DataFrame(rows), "bassins_emploi")

    # Rattachement commune -> bassin : point représentatif de la commune dans le polygone du bassin.
    tree = STRtree(geoms)
    communes = download_contours(force)
    link = []
    for ft in communes["features"]:
        pt = shape(ft["geometry"]).representative_point()
        hits = tree.query(pt, predicate="within")
        if not len(hits):  # commune à cheval / bord : bassin le plus proche
            hits = [tree.nearest(pt)]
        link.append({"codgeo": ft["properties"]["code"], "code_be": rows[hits[0]]["code_be"]})
    write_parquet(pd.DataFrame(link), "communes_bassins")


def ingest_bmo(force: bool) -> None:
    """France Travail - enquête Besoins en Main-d'Œuvre, projets de recrutement par bassin et métier."""
    a, aa = BMO_ANNEE, str(BMO_ANNEE)[-2:]
    url = f"https://www.francetravail.org/files/live/sites/peorg/files/documents/Statistiques-et-analyses/Open-data/BMO/Base-open-data-BMO-{a}.xlsx"
    x = download(url, RAW / f"bmo_{a}.xlsx", force)
    df = pd.read_excel(x, sheet_name=f"BMO_{a}_open_data", dtype=str, engine="calamine")
    df = df[df["REG"] == REGION].rename(columns={
        "Code métier BMO": "code_metier", "Nom métier BMO": "metier", "Famille_met": "code_famille",
        "Lbl_fam_met": "famille", "REG": "region", "NOM_REG": "nom_region", "Dept": "departement",
        "NomDept": "nom_departement", f"BE{aa}": "code_be_bmo", f"NOMBE{aa}": "nom_bassin",
        "met": "nb_projets", "xmet": "nb_projets_difficiles", "smet": "nb_projets_saisonniers",
    })
    for c in ("nb_projets", "nb_projets_difficiles", "nb_projets_saisonniers"):
        df[c] = pd.to_numeric(df[c], errors="coerce")  # '*' = secret statistique -> NULL
    # Nom de sortie stable : models/staging/_sources.yml lit bmo_2026 (renommer les deux ensemble).
    write_parquet(df, "bmo_2026")


def ingest_chomage_dep(force: bool) -> None:
    """INSEE - Taux de chômage localisés, comparaisons départementales (série trimestrielle)."""
    x = download(f"{INSEE}/2012804/sl_etc_2026T2.xls", RAW / "chomage_dep.xls", force)
    df = pd.read_excel(x, sheet_name="Département", skiprows=3, dtype=str)
    df = df.rename(columns={"Code": "departement", "Libellé": "libelle"}).dropna(subset=["departement"])
    long = df.melt(id_vars=["departement", "libelle"], var_name="periode", value_name="taux_chomage")
    long = long[long["periode"].str.match(r"^T[1-4]_\d{4}$")]
    long["periode"] = long["periode"].str.replace(r"^T(\d)_(\d{4})$", r"\2-T\1", regex=True)  # T2_2026 -> 2026-T2
    long["taux_chomage"] = pd.to_numeric(long["taux_chomage"], errors="coerce")
    write_parquet(long, "chomage_dep")


def ingest_defm(force: bool) -> None:
    """DARES - Demandeurs d'emploi inscrits à France Travail par zone d'emploi, mensuel (région uniquement)."""
    f = download(f"{DARES_ODS}/dares_defm_zone_emploi_mens/exports/csv", RAW / "defm_ze.csv", force,
                 {"where": f"code_region='{REGION}'", "delimiter": ";"})
    duck_copy(f"SELECT * FROM read_csv('{f.as_posix()}', delim=';', header=true, all_varchar=true)", "defm_ze")


def ingest_idfm_lignes(force: bool) -> None:
    """Île-de-France Mobilités - Référentiel des lignes (train, RER, métro, tram, bus, car)."""
    f = download(f"{IDFM}/referentiel-des-lignes/exports/csv", RAW / "idfm_lignes.csv", force, {"delimiter": ";"})
    duck_copy(
        f"""SELECT * EXCLUDE (picto, notice_text, colourprint_cmjn, textcolourprint_hexa)
            FROM read_csv('{f.as_posix()}', delim=';', header=true, all_varchar=true)""",
        "idfm_lignes",
    )


def ingest_polarites(force: bool) -> None:
    """Région IDF - Polarités du SDRIF-E (communes structurantes), avec la liste des communes concernées."""
    f = download(f"{IDF_ODS}/polarites-sdrif-e/exports/csv", RAW / "polarites_sdrife.csv", force, {"delimiter": ";"})
    duck_copy(
        f"""SELECT objectid, nom_polarite, CAST(importance AS INTEGER) AS importance, liste_com,
                   CAST(trim(split_part(geo_point_2d, ',', 2)) AS DOUBLE) AS lon,
                   CAST(trim(split_part(geo_point_2d, ',', 1)) AS DOUBLE) AS lat
            FROM read_csv('{f.as_posix()}', delim=';', header=true, all_varchar=true)""",
        "polarites_sdrife",
    )
    # Une ligne par commune citée dans liste_com (rapprochée par libellé dans dbt).
    df = pd.read_csv(f, sep=";", dtype=str, encoding="utf-8-sig")
    df["importance"] = pd.to_numeric(df["importance"], errors="coerce")
    ex = df.assign(nom_commune=df["liste_com"].fillna("").str.split(",")).explode("nom_commune")
    ex["nom_commune"] = ex["nom_commune"].str.strip()
    ex = ex[ex["nom_commune"] != ""][["objectid", "nom_polarite", "importance", "nom_commune"]]
    write_parquet(ex, "polarites_communes")


STEPS = {
    "cog": ingest_cog,
    "mobpro": ingest_mobpro,
    "filosofi": ingest_filosofi,
    "chomage": ingest_chomage,
    "idfm": ingest_idfm,
    "contours": ingest_contours,
    # défi 2
    "bassins": ingest_bassins_emploi,
    "bmo": ingest_bmo,
    "chomage_dep": ingest_chomage_dep,
    "defm": ingest_defm,
    "lignes": ingest_idfm_lignes,
    "polarites": ingest_polarites,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", choices=STEPS, action="append", help="source(s) à traiter")
    parser.add_argument("--force", action="store_true", help="re-télécharger même si le fichier est en cache")
    args = parser.parse_args()
    # Une source en panne n'empêche pas les suivantes : le Parquet versionné de data/parquet/ reste en place
    # pour elle, et le code de sortie non nul signale l'ingestion incomplète (avertissement en CI).
    echecs = []
    for name in args.only or STEPS:
        log(f"=== {name}")
        try:
            STEPS[name](args.force)
        except Exception as exc:  # noqa: BLE001 - on veut continuer sur toute erreur
            log(f"ÉCHEC  {name} : {exc}")
            echecs.append(name)
    if echecs:
        log(f"terminé avec {len(echecs)} source(s) en échec : {', '.join(echecs)}")
        return 1
    log("terminé")
    return 0


if __name__ == "__main__":
    sys.exit(main())
