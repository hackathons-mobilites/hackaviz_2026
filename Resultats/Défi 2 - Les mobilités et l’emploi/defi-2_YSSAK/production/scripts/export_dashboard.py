"""Exporte les tables finales dbt vers dashboard/src/data/*.parquet.

Le dashboard (Observable Framework) lit ces fichiers avec DuckDB-wasm, directement
dans le navigateur : aucun serveur n'est nécessaire, le site est 100 % statique.

Les types exotiques pour JavaScript (DECIMAL, BIGINT, HUGEINT) sont convertis en
DOUBLE pour éviter les BigInt et les décimaux Arrow côté navigateur.

Usage :
    python scripts/export_dashboard.py                 # lit data/hakathon.duckdb
    DBT_DUCKDB_PATH=autre.duckdb python scripts/export_dashboard.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / os.environ.get("DBT_DUCKDB_PATH", "data/hakathon.duckdb")
OUT = ROOT / "dashboard" / "src" / "data"

# (schéma, table) -> nom de fichier
TABLES = {
    ("prod_hakathon", "dim_geo"): "dim_geo",
    ("prod_hakathon", "dim_indicateurs"): "dim_indicateurs",
    ("prod_hakathon", "dim_gares"): "dim_gares",
    ("prod_hakathon", "fact_mobilite"): "fact_mobilite",
    ("prod_hakathon", "fact_flux"): "fact_flux",
    ("prod_hakathon", "fact_validations"): "fact_validations",
    ("prod_hakathon", "fact_validations_jour"): "fact_validations_jour",
    ("prod_hakathon", "fact_bmo"): "fact_bmo",
    ("referentiels", "modes_transport"): "modes_transport",
    ("referentiels", "catalogue_sources"): "catalogue_sources",
}

JS_UNFRIENDLY = ("DECIMAL", "BIGINT", "HUGEINT", "UBIGINT", "UHUGEINT")


def main() -> int:
    if not DB.exists():
        print(f"Base introuvable : {DB}. Lancer d'abord `dbt build`.", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB), read_only=True)
    for (schema, table), name in TABLES.items():
        cols = con.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position",
            [schema, table],
        ).fetchall()
        select = ", ".join(
            f'CAST("{c}" AS DOUBLE) AS "{c}"' if t.upper().startswith(JS_UNFRIENDLY) else f'"{c}"'
            for c, t in cols
        )
        path = OUT / f"{name}.parquet"
        con.execute(f"COPY (SELECT {select} FROM {schema}.{table}) TO '{path.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
        n = con.execute(f"SELECT count(*) FROM {schema}.{table}").fetchone()[0]
        # Contrôle d'intégrité : un Parquet valide commence et finit par PAR1, et se relit en entier.
        data = path.read_bytes()
        if data[:4] != b"PAR1" or data[-4:] != b"PAR1":
            print(f"[export] ERREUR : {path.name} corrompu (en-tête {data[:4]!r}, fin {data[-4:]!r})", file=sys.stderr)
            return 1
        relu = con.execute(f"SELECT count(*) FROM read_parquet('{path.as_posix()}')").fetchone()[0]
        if relu != n:
            print(f"[export] ERREUR : {path.name} relu avec {relu} lignes au lieu de {n}", file=sys.stderr)
            return 1
        print(f"[export] {path.relative_to(ROOT)}  {n:>9,} lignes  {path.stat().st_size / 1e6:6.2f} Mo".replace(",", " "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
