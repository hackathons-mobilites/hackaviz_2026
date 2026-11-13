"""A few shared functions implemented; dataset logic placed in datasets/."""

from pathlib import Path
import pandas as pd


def read_source(path, rows=None):
    """Read identifiers as text and preserve special codes such as NA and ZZ."""
    return pd.read_csv(
        path, sep=";", encoding="utf-8-sig", dtype="string",
        keep_default_na=False, nrows=rows,
    )


def clean_text(frame):
    """Copy the table, strip surrounding spaces, and make blank cells missing."""
    cleaned = frame.copy()
    for column in cleaned.select_dtypes(include=["string", "object"]):
        cleaned[column] = cleaned[column].str.strip().replace("", pd.NA)
    return cleaned


def column_summary(frame):
    """Describe the table currently loaded, including data type, missing rows, and distinct values."""
    return pd.DataFrame({
        "data_type": frame.dtypes.astype(str),
        "missing_rows": frame.isna().sum(),
        "distinct_values": frame.nunique(dropna=True),
    }).rename_axis("column")


def repeated_keys(frame, columns):
    """Show repeated groups without assuming they are errors or deleting rows."""
    counts = frame.groupby(columns, dropna=False).size().rename("records").reset_index()
    return counts.loc[counts.records.gt(1)].sort_values("records", ascending=False)


def save_parquet(frame, path):
    """Explicitly save the supplied table; callers choose full data or a sample."""
    path = Path(path)
    if path.suffix.lower() != ".parquet":
        raise ValueError("Choose a .parquet output file.")
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(path, index=False)
    return path
