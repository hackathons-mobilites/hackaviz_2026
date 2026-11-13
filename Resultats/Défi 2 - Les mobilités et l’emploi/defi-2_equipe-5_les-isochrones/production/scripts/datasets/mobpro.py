"""Explore individual residence/workplace records, without transport-data joins."""

import pandas as pd
import plotly.express as px

from scripts.exploration import clean_text, read_source

FILENAME = "FD_MOBPRO_2023.csv"

# English labels for TRANS codes defined in varmod_mobpro_2023.csv.
MODE_LABELS = {
    "1": "No transport",
    "2": "Walking and similar",
    "3": "Bicycle (including electric)",
    "4": "Motorised two-wheelers",
    "5": "Car / van / truck",
    "6": "Public transport",
}


def load_sample(path, rows=10_000):
    """First rows, not a random or representative sample of France or IDF."""
    return read_source(path, rows=rows)


def read_chunks(path, chunk_size=100_000, columns=None):
    """Opt-in iteration over the whole source without loading it all at once."""
    return pd.read_csv(
        path, sep=";", encoding="utf-8-sig", dtype="string",
        keep_default_na=False, usecols=columns, chunksize=chunk_size,
    )


def clean(frame):
    """Preserve geography/mode codes; convert the individual weight to a number."""
    cleaned = clean_text(frame)
    cleaned["IPONDI"] = pd.to_numeric(cleaned.IPONDI, errors="raise")
    cleaned["weight_is_valid"] = (
        cleaned.IPONDI.notna() & cleaned.IPONDI.gt(0) & cleaned.IPONDI.lt(float("inf"))
    ).fillna(False)
    return cleaned


def mode_summary(frame):
    """Sum valid weights by main mode; require an explicit decision on bad weights."""
    if not frame.weight_is_valid.all():
        raise ValueError("Inspect invalid weights, then explicitly select valid rows before analysis.")
    result = frame.groupby("TRANS", dropna=False).agg(
        sample_records=("IPONDI", "size"), estimated_workers=("IPONDI", "sum"),
    ).reset_index()
    total = result.estimated_workers.sum()
    result["share_pct"] = result.estimated_workers / total * 100 if total else float("nan")
    return result


def plot_modes(summary, scope="loaded sample"):
    return px.bar(summary, x="TRANS", y="estimated_workers", text_auto=".0f",
                  title=f"Main commuting mode — {scope}",
                  labels={"TRANS": "Mode code (see dictionary notebook)",
                          "estimated_workers": "Sum of individual weights"})


def commune_mode_summary(path, geography="residence", chunk_size=100_000):
    """Scan the full source and sum IPONDI by IDF commune and usual main mode.

    Residence selects REGION=11, including jobs outside IDF. Workplace selects
    REGLT=11, including residents outside IDF. Paris workplace arrondissements
    are combined into commune 75056. All six modes stay in share denominators.
    """
    if geography == "residence":
        commune_column, region_column = "COMMUNE", "REGION"
    elif geography == "workplace":
        commune_column, region_column = "DCLT", "REGLT"
    else:
        raise ValueError("geography must be 'residence' or 'workplace'.")

    parts = []
    columns = [commune_column, region_column, "TRANS", "IPONDI"]
    for chunk in read_chunks(path, chunk_size=chunk_size, columns=columns):
        selected = chunk.loc[chunk[region_column].str.strip().eq("11")]
        if selected.empty:
            continue
        selected = clean(selected).rename(columns={commune_column: "commune_code"})
        if not selected.weight_is_valid.all():
            raise ValueError("Inspect invalid weights before calculating commune statistics.")
        if selected.commune_code.isna().any() or not selected.TRANS.isin(MODE_LABELS).all():
            raise ValueError("Inspect missing communes or unknown TRANS codes before analysis.")
        if geography == "workplace":
            paris = selected.commune_code.str.fullmatch(r"751(0[1-9]|1[0-9]|20)")
            selected.loc[paris, "commune_code"] = "75056"
        parts.append(selected.groupby(["commune_code", "TRANS"]).agg(
            sample_records=("IPONDI", "size"), estimated_workers=("IPONDI", "sum"),
        ))

    if not parts:
        raise ValueError("No records found for the selected IDF population.")
    summary = pd.concat(parts).groupby(level=[0, 1]).sum().reset_index()
    summary["commune_estimated_workers"] = summary.groupby("commune_code")[
        "estimated_workers"
    ].transform("sum")
    summary["share_pct"] = 100 * summary.estimated_workers / summary.commune_estimated_workers
    summary["mode_label"] = summary.TRANS.map(MODE_LABELS)
    return summary


def plot_commune_modes(summary, commune_code, geography="residence", metric="share_pct"):
    """Show weighted counts or shares for one commune; include absent modes as zero."""
    if metric not in ("share_pct", "estimated_workers"):
        raise ValueError("metric must be 'share_pct' or 'estimated_workers'.")
    selected = summary.loc[summary.commune_code.eq(str(commune_code))]
    if selected.empty:
        raise ValueError(f"Commune {commune_code} is not in the summary; check its INSEE code.")
    commune_label = (
        selected.commune_label.iloc[0] if "commune_label" in selected else f"Commune {commune_code}"
    )
    selected = selected.set_index("TRANS").reindex(list(MODE_LABELS)).reset_index()
    for column in ["share_pct", "estimated_workers", "sample_records"]:
        selected[column] = selected[column].fillna(0)
    selected["mode_label"] = selected.TRANS.map(MODE_LABELS)
    return px.bar(
        selected, x="mode_label", y=metric, text_auto=".1f",
        hover_data=["sample_records", "estimated_workers", "share_pct"],
        title=f"Usual main commuting mode — {commune_label} ({geography}), 2023",
        labels={"mode_label": "Main mode", "share_pct": "Weighted share (%)",
                "estimated_workers": "Estimated workers", "sample_records": "Source records"},
    )


def plot_commune_comparison(summary, commune_codes, geography="residence"):
    """Compare weighted mode shares for explicitly chosen communes."""
    codes = [str(code) for code in commune_codes]
    missing = set(codes) - set(summary.commune_code)
    if missing:
        raise ValueError(f"Commune codes not found: {sorted(missing)}")
    selected = summary.loc[summary.commune_code.isin(codes)].copy()
    if "commune_label" not in selected:
        selected["commune_label"] = selected.commune_code
    label_order = selected.drop_duplicates("commune_code").set_index("commune_code").loc[
        codes, "commune_label"
    ].tolist()
    figure = px.bar(
        selected, x="commune_label", y="share_pct", color="mode_label", barmode="stack",
        category_orders={"commune_label": label_order, "mode_label": list(MODE_LABELS.values())},
        hover_data=["commune_code", "sample_records", "estimated_workers"],
        title=f"Usual main commuting modes by commune ({geography}), 2023",
        labels={"commune_label": "Commune (INSEE code)", "commune_code": "INSEE commune code",
                "share_pct": "Weighted share (%)",
                "mode_label": "Main mode", "sample_records": "Source records",
                "estimated_workers": "Estimated workers"},
    )
    figure.update_xaxes(type="category")
    return figure
