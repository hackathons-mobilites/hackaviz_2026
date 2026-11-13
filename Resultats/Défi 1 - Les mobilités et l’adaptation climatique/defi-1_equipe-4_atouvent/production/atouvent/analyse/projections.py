"""Chaleur à venir : années types +2,7 °C et +4 °C (TRACC) comparées à l'année observée, et effet attendu gare par gare.
Lancer : python analyse/projections.py (complète backend/data/chaleur.json sans refaire toute l'analyse)."""
from __future__ import annotations

import json
from pathlib import Path

import duckdb

from sources import PERIOD, RAW, fetch

OUT = Path(__file__).resolve().parents[1] / "backend" / "data" / "chaleur.json"
ADEME = "https://data.ademe.fr/data-fair/api/v1/datasets/donnees-climatiques-prospectives-france-{}-vague-de-chaleur/raw"
SCENARIOS = {"+2,7 °C": ("tracc_27.csv", ADEME.format("27c")), "+4 °C": ("tracc_4.csv", ADEME.format("4c"))}
METEO_78 = "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/Q_78_latest-2025-2026_RR-T-Vent.csv.gz"
TRAPPES, MONTSOURIS = "78621001", "75114001"
THRESHOLDS = (30, 33, 35, 38)
TROPICAL_NIGHT = 20  # nuit tropicale : la température ne descend pas sous 20 °C
WORKDAY_SHARE = 251 / 365
SUMMER = ("07-01", "08-31")  # fenêtre tracée pour la vague de chaleur


def _scenario_days(con, path: Path) -> list[dict]:
    """Températures maximale et minimale de chaque jour de l'année type, à Trappes."""
    return [{"day": f"{m:02d}-{d:02d}", "tx": round(tx, 1), "tn": round(tn, 1)} for m, d, tx, tn in con.sql(f"""
        select mois, jour, max(T2m), min(T2m) from read_csv('{path.as_posix()}', delim=';', header=true, decimal_separator='.')
        where STATION = 'TRAPPES' group by all order by mois, jour""").fetchall()]


def _observed_days(con, path: Path, poste: str) -> list[dict]:
    """Jours observés (juillet 2025 à juin 2026) d'un poste Météo-France."""
    return [{"day": j.strftime("%m-%d"), "tx": tx, "tn": tn} for j, tx, tn in con.sql(f"""
        select strptime(AAAAMMJJ, '%Y%m%d')::date j, try_cast(TX as double) tx, try_cast(TN as double) tn
        from read_csv('{path.as_posix()}', delim=';', header=true, all_varchar=true)
        where NUM_POSTE = '{poste}' and j between '{PERIOD[0]}' and '{PERIOD[1]}' and tx is not null order by j""").fetchall()]


def summary(days: list[dict]) -> dict:
    """Jours chauds par seuil, nuits tropicales, record et plus longue série de jours ≥ 33 °C."""
    run = best = 0
    for d in days:
        run = run + 1 if d["tx"] >= 33 else 0
        best = max(best, run)
    return {"days": {str(t): sum(d["tx"] >= t for d in days) for t in THRESHOLDS},
            "tropical_nights": sum(d["tn"] is not None and d["tn"] >= TROPICAL_NIGHT for d in days),
            "tx_max": max(d["tx"] for d in days), "longest_33": best, "n_days": len(days)}


BREAK = 0.75  # fréquentation des jours ordinaires en fin de période < 75 % du début : rupture sans lien avec la météo


def structural_break(days: list[str], values: list[float | None], hot: set[str]) -> bool:
    """Rupture de fréquentation indépendante de la chaleur : médiane des jours non chauds, 2 premières vs 2 dernières semaines."""
    calm = [v for d, v in zip(days, values) if v is not None and d not in hot]
    if len(calm) < 20:
        return False
    med = lambda xs: sorted(xs)[len(xs) // 2]  # noqa: E731
    return med(calm[-10:]) < BREAK * med(calm[:10])


def station_effects(stations: list[dict], hot_workdays: dict[str, float], series: dict | None = None,
                    hot_days: set[str] = frozenset()) -> tuple[list[dict], list[str]]:
    """Validations perdues par an les jours ≥ 33 °C, aujourd'hui et dans chaque scénario (gares à mesure fiable)."""
    out, broken = [], []
    for s in stations:
        drop = (s.get("change") or {}).get("33")
        if not s.get("reliable") or drop is None or drop >= 0 or not s.get("ref"):
            continue
        values = (series or {}).get("values", {}).get(s["id"])
        if values and structural_break(series["days"], values, hot_days):
            broken.append(s["name"])
            continue
        lost = {k: round(s["ref"] * -drop / 100 * n) for k, n in hot_workdays.items()}
        out.append({"id": s["id"], "name": s["name"], "lines": [l["line"] for l in s.get("lines", [])], "ac": s.get("ac"),
                    "ref": s["ref"], "change": drop, "vuln_night": s.get("vuln_night"), "income_q": s.get("income_q"),
                    "lost": lost})
    return sorted(out, key=lambda x: -x["lost"]["+4 °C"]), sorted(broken)


def build(stations: list[dict], ridership: dict | None = None, hot_days: set[str] = frozenset()) -> dict:
    """ridership : validations jour par jour des gares (« series » de chaleur.json) ; hot_days : jours observés ≥ 33 °C."""
    con = duckdb.connect()
    scen = {name: _scenario_days(con, fetch(file, url)) for name, (file, url) in SCENARIOS.items()}
    trappes = _observed_days(con, fetch("meteo_78.csv.gz", METEO_78), TRAPPES)
    montsouris = _observed_days(con, RAW / "meteo_75.csv.gz", MONTSOURIS)
    series = {"Trappes 2025-2026": trappes, **scen}
    summaries = {k: summary(v) for k, v in series.items()}
    summaries["Paris-Montsouris 2025-2026"] = summary(montsouris)
    hot = {k: round(summaries[k]["days"]["33"] * WORKDAY_SHARE, 1) for k in series}
    effects, broken = station_effects(stations, hot, ridership, hot_days)
    in_summer = lambda d: SUMMER[0] <= d["day"] <= SUMMER[1]  # noqa: E731
    return {
        "reference_station": "Trappes (78), station de référence TRACC pour l'Île-de-France (zone H1a)",
        "scenarios": list(series), "summaries": summaries, "hot_workdays": hot,
        "summer": {k: [d for d in v if in_summer(d)] for k, v in series.items()},
        "stations": effects[:60], "stations_total": len(effects), "excluded": broken,
        "lost_total": {k: sum(s["lost"][k] for s in effects) for k in series},
    }


SOURCES = ["Données climatiques prospectives +2,7 °C et +4 °C, vague de chaleur, TRACC (ADEME, Météo-France, CSTB, DHUP, 2025)",
           "Données climatologiques quotidiennes, Trappes (Météo-France)"]


def main() -> None:
    data = json.loads(OUT.read_text(encoding="utf-8"))
    hot = {d["date"] for d in data["daily"] if d["tx"] >= 33}
    data["projections"] = build(data["stations"], data.get("series"), hot)
    data["sources"] = [s for s in data["sources"] if s not in SOURCES] + SOURCES
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    p = data["projections"]
    for k, v in p["summaries"].items():
        print(f"{k:28} jours ≥33 : {v['days']['33']:3}  ≥35 : {v['days']['35']:3}  nuits ≥20 : {v['tropical_nights']:3}  max {v['tx_max']} °C")
    print("validations perdues par an (gares fiables) :", p["lost_total"], "·", p["stations_total"], "gares")
    print("écartées (rupture de fréquentation) :", p["excluded"])


if __name__ == "__main__":
    main()
