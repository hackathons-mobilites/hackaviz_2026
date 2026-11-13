"""Explore station-by-line records; repeated station IDs are retained."""

import pandas as pd
import plotly.express as px

from scripts.exploration import clean_text, read_source

FILENAME = "emplacement-des-gares-idf.csv"


def load(path):
    return read_source(path)


def clean(frame):
    """Parse the supplied 'latitude, longitude' text; keep the original columns."""
    cleaned = clean_text(frame)
    coordinates = cleaned["Geo Point"].str.split(",", expand=True).reindex(columns=[0, 1])
    cleaned["latitude"] = pd.to_numeric(coordinates[0], errors="raise")
    cleaned["longitude"] = pd.to_numeric(coordinates[1], errors="raise")
    cleaned["coordinates_in_bounds"] = (
        cleaned.latitude.between(-90, 90) & cleaned.longitude.between(-180, 180)
    ).fillna(False)
    return cleaned


def mode_summary(frame):
    return frame.groupby("mode", dropna=False).agg(
        station_line_records=("id_gare_g", "size"),
        distinct_station_ids=("id_gare_g", "nunique"),
    ).reset_index()


def plot_modes(summary):
    return px.bar(summary, x="mode", y="station_line_records",
                  title="Station-by-line records by transport mode",
                  labels={"mode": "Mode", "station_line_records": "Records (not unique stations)"})


def plot_locations(frame):
    points = frame.loc[frame.coordinates_in_bounds]
    return px.scatter(points, x="longitude", y="latitude", color="mode", hover_name="nom_long",
                      title=f"Station coordinates — {len(points):,} of {len(frame):,} records",
                      labels={"longitude": "Longitude (degrees)", "latitude": "Latitude (degrees)"})


def select_station(frame, station_id):
    """Select all line records for one exact station ID, not a partial name match."""
    selected = frame.loc[frame.id_gare_g.eq(str(station_id))].copy()
    if selected.empty:
        raise ValueError(f"Station ID {station_id} not found. Check the search results first.")
    return selected


def plot_station_lines(selected):
    """One dot per distinct listed line at one station; no service-frequency estimate."""
    if selected.empty or selected.id_gare_g.nunique() != 1:
        raise ValueError("Select exactly one station ID before plotting its lines.")
    lines = selected[["mode", "idrefligc", "res_com"]].drop_duplicates().copy()
    lines["line_label"] = lines.res_com.fillna("Unnamed line") + " (" + lines.idrefligc.fillna("unknown ID") + ")"
    station_name = selected.nom_long.dropna().iloc[0]
    station_id = selected.id_gare_g.iloc[0]
    figure = px.scatter(
        lines, x="mode", y="line_label", color="mode", symbol="mode",
        hover_data=["idrefligc", "res_com"],
        title=f"Listed lines at {station_name} — station ID {station_id}",
        labels={"mode": "Transport mode", "line_label": "Listed line",
                "idrefligc": "Line ID", "res_com": "Line name"},
        height=max(320, 65 * len(lines)),
    )
    figure.update_traces(marker_size=16)
    return figure
