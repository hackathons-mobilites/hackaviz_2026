"""Explore line names, modes, operators and status in the line reference."""

import plotly.express as px

from scripts.exploration import clean_text, read_source

FILENAME = "referentiel-des-lignes.csv"


def load(path):
    return read_source(path)


def clean(frame):
    """Only normalise whitespace; keep statuses, boolean text and dates as supplied."""
    return clean_text(frame)


def mode_summary(frame):
    return frame.groupby("TransportMode", dropna=False).agg(
        records=("ID_Line", "size"), distinct_line_ids=("ID_Line", "nunique"),
    ).reset_index()


def operator_summary(frame):
    return frame.groupby("OperatorName", dropna=False).size().rename(
        "reference_records"
    ).reset_index().sort_values("reference_records", ascending=False)


def plot_modes(summary):
    return px.bar(summary, x="TransportMode", y="records",
                  title="Line-reference records by mode (all supplied statuses)",
                  labels={"TransportMode": "Transport mode", "records": "Reference records"})
