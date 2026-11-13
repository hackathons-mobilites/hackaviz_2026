"""Explore the MOBPRO variable dictionary on its own."""

import plotly.express as px

from scripts.exploration import clean_text, read_source

FILENAME = "varmod_mobpro_2023.csv"


def load(path):
    return read_source(path)


def clean(frame):
    """Keep NA and other dictionary codes literally; only blanks become missing."""
    return clean_text(frame)


def variables(frame):
    """One row per variable, with its definition and number of listed codes."""
    return frame.groupby("COD_VAR", sort=True).agg(
        definition=("LIB_VAR", "first"),
        data_type=("TYPE_VAR", "first"),
        listed_codes=("COD_MOD", "nunique"),
    ).reset_index()


def lookup(frame, variable):
    """Display a selected variable's codes without joining any other dataset."""
    return frame.loc[frame.COD_VAR.eq(variable)].reset_index(drop=True)


def plot_variables(summary, top_n=10):
    top = summary.nlargest(top_n, "listed_codes").sort_values("listed_codes")
    return px.bar(top, x="listed_codes", y="COD_VAR", orientation="h",
                  title="Number of listed codes by variable (Top {})".format(top_n),
                  labels={"listed_codes": "Distinct listed codes", "COD_VAR": "Variable"})
