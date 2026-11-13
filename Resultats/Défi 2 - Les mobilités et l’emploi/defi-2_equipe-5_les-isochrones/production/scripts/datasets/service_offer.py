"""Explore average service-offer rows before interpreting stop/line/hour frequency."""

import pandas as pd
import plotly.express as px

from scripts.exploration import clean_text, read_source

FILENAME = "offre_hebdomadaire_moyenne_hors_vacances.csv"
DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
COURSE_COLUMNS = [f"nb_courses_{day}" for day in DAYS]


def load_sample(path, rows=20_000):
    """First rows only; coverage and repetition in this sample may be incomplete."""
    return read_source(path, rows=rows)


def read_chunks(path, chunk_size=100_000):
    return pd.read_csv(path, sep=";", encoding="utf-8-sig", dtype="string",
                       keep_default_na=False, chunksize=chunk_size)


def clean(frame):
    """Convert measurements only. Preserve identifiers and service hours above 23."""
    cleaned = clean_text(frame)
    for column in ["tranche_horaire", "longitude_arret", "latitude_arret", *COURSE_COLUMNS]:
        cleaned[column] = pd.to_numeric(cleaned[column], errors="raise")
    cleaned["coordinates_in_bounds"] = (
        cleaned.latitude_arret.between(-90, 90) & cleaned.longitude_arret.between(-180, 180)
    ).fillna(False)
    cleaned["negative_offer_value"] = cleaned[COURSE_COLUMNS].lt(0).any(axis=1)
    return cleaned


def hour_coverage(frame):
    """Count source rows, not departures or passengers; do not sum successive stops."""
    return frame.groupby("tranche_horaire", dropna=False).size().rename(
        "source_records"
    ).reset_index().sort_values("tranche_horaire")


def plot_hour_coverage(summary, scope="loaded sample"):
    return px.bar(summary, x="tranche_horaire", y="source_records",
                  title=f"Rows available by supplied service hour — {scope}",
                  labels={"tranche_horaire": "Service hour (original convention)",
                          "source_records": "Source records, not service frequency"})
