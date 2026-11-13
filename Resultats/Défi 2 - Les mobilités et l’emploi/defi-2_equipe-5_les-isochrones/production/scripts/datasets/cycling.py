"""Explore cycling-facility records; keep their geometry and classification codes."""

import pandas as pd
import plotly.express as px

from scripts.exploration import clean_text, read_source

FILENAME = "amenagements-velo-en-ile-de-france.csv"


def load(path, rows=None):
    """Load the full source by default, or select a first-row sample explicitly."""
    return read_source(path, rows=rows)


def clean(frame):
    """Convert lengths and representative coordinates; retain OSM IDs as text."""
    cleaned = clean_text(frame)
    cleaned["longueur"] = pd.to_numeric(cleaned.longueur, errors="raise")
    coordinates = cleaned.geo_point_2d.str.split(",", expand=True).reindex(columns=[0, 1])
    cleaned["latitude"] = pd.to_numeric(coordinates[0], errors="raise")
    cleaned["longitude"] = pd.to_numeric(coordinates[1], errors="raise")
    cleaned["coordinates_in_bounds"] = (
        cleaned.latitude.between(-90, 90) & cleaned.longitude.between(-180, 180)
    ).fillna(False)
    return cleaned


def facility_summary(frame):
    """Describe the raw highway categories; do not assume every row is a cycleway."""
    return frame.groupby("highway", dropna=False).size().rename(
        "facility_records"
    ).reset_index().sort_values("facility_records", ascending=False)


def plot_facilities(summary):
    return px.bar(summary, x="highway", y="facility_records",
                  title="Cycling-source records by highway classification",
                  labels={"highway": "Raw highway code", "facility_records": "Source records"})


def plot_locations(frame, max_points=5_000):
    """Display representative points only, not line geometry or a routable network."""
    points = frame.loc[frame.coordinates_in_bounds]
    points = points.sample(min(max_points, len(points)), random_state=42)
    return px.scatter(points, x="longitude", y="latitude", color="highway", hover_name="nom_voie",
                      title=f"Cycling representative coordinates — {len(points):,} sampled points",
                      labels={"longitude": "Longitude (degrees)", "latitude": "Latitude (degrees)"})
