"""Shared paths and parameters for the "Access to job hubs" track.

Run every script from this folder (`cd isochrones && python <script>.py`): imports are flat.
Data and outputs live under isochrones/; the built pages go to the FastAPI app (app/static/).
"""
from pathlib import Path

ROOT          = Path(__file__).resolve().parent          # isochrones/
REPO          = ROOT.parent                              # repo root
STATIC        = REPO / "app" / "static"                  # served by app/main.py
RAW           = ROOT / "data" / "raw"
PROCESSED     = ROOT / "data" / "processed"
FIGURES       = ROOT / "outputs" / "figures"
TABLES        = ROOT / "outputs" / "tables"

GTFS_DIR      = RAW / "gtfs"
MOBPRO        = RAW / "RP2022_mobpro.parquet"
COMMUNES_GEO  = RAW / "communes_idf.geojson"
ARR_GEO       = RAW / "arrondissements.geojson"

# Representative school-term weekday inside the GTFS validity window
SERVICE_DATE  = "20261117"          # Tuesday 17 Nov 2026

# Time window kept in the connection table (seconds after midnight)
WINDOW_START  = 6 * 3600
WINDOW_END    = 11 * 3600

# Morning-peak departures: every 5 min from 07:00 to 09:00, median taken
DEPARTURES    = [7 * 3600 + 300 * k for k in range(25)]
MAX_TRIP_S    = 2 * 3600            # ignore anything beyond 2 h

# Walking model (straight line x detour factor)
WALK_SPEED    = 4.8 / 3.6           # m/s
DETOUR        = 1.3
ACCESS_RADIUS = 1600                # m, home point -> first stop / last stop -> work point
FOOT_RADIUS   = 400                 # m, stop <-> stop transfers not in transfers.txt
CHANGE_SLACK  = 60                  # s, added before boarding another vehicle

# Lambert-93 for metric distances
CRS_M         = 2154

for p in (PROCESSED, FIGURES, TABLES):
    p.mkdir(parents=True, exist_ok=True)
