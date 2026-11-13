"""Mise à jour automatique des horaires IDFM (GTFS) et des données qui en dépendent."""
from __future__ import annotations

import json
import logging
import shutil
import sys
import tempfile
import zipfile
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import httpx

DATA = Path(__file__).resolve().parents[2] / "data"
URL = "https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip"
STATE = DATA / "gtfs_state.json"
GTFS_DIR = DATA / "raw" / "gtfs"
FILES = {"routes.txt", "trips.txt", "stop_times.txt", "stops.txt", "transfers.txt", "calendar.txt", "calendar_dates.txt",
         "shapes.txt", "pathways.txt"}
log = logging.getLogger("atouvent.refresh")


def state() -> dict:
    return json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}


def valid_until() -> date | None:
    meta = DATA / "router.json"
    if not meta.exists():
        return None
    end = json.loads(meta.read_text(encoding="utf-8")).get("valid", [None, None])[1]
    return datetime.strptime(end, "%Y%m%d").date() if end else None


def check_sent() -> str:
    """Serveur trop petit pour reconstruire (GTFS_BUILD=0) : on vérifie seulement les horaires envoyés par le PC
    (deploy/maj-horaires.ps1). Échec signalé s'ils manquent ou expirent dans moins de 10 jours."""
    until = valid_until()
    if until is None:
        raise RuntimeError("horaires absents : à envoyer depuis le PC (deploy/maj-horaires.ps1)")
    if until - date.today() < timedelta(days=10):
        raise RuntimeError(f"horaires valables jusqu'au {until:%d/%m/%Y} seulement : à renvoyer depuis le PC (deploy/maj-horaires.ps1)")
    return f"horaires valables jusqu'au {until:%d/%m/%Y} (reconstruits sur le PC)"


def upstream_modified(client: httpx.Client | None = None) -> datetime | None:
    r = (client or httpx).head(URL, timeout=30, follow_redirects=True)
    r.raise_for_status()
    lm = r.headers.get("last-modified")
    return parsedate_to_datetime(lm) if lm else None


def needs_refresh(client: httpx.Client | None = None) -> tuple[bool, str]:
    until = valid_until()
    if until is None:
        return True, "réseau absent"
    if until - date.today() < timedelta(days=10):
        return True, f"horaires valables jusqu'au {until}"
    up = upstream_modified(client)
    known = state().get("upstream_modified")
    if up and (not known or up > datetime.fromisoformat(known)):
        return True, f"nouveau GTFS publié le {up:%d/%m/%Y %H:%M}"
    return False, "à jour"


def refresh(force: bool = False, client: httpx.Client | None = None) -> dict:
    """Télécharge, reconstruit et remplace. Ne touche à rien si une étape échoue (l'ancien réseau reste en service)."""
    from . import amenities, build
    need, why = (True, "forcé") if force else needs_refresh(client)
    if not need:
        return {"refreshed": False, "reason": why}
    up = upstream_modified(client)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        zpath = tmp / "gtfs.zip"
        with httpx.stream("GET", URL, timeout=600, follow_redirects=True) as r:
            r.raise_for_status()
            with open(zpath, "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
        src = tmp / "gtfs"
        with zipfile.ZipFile(zpath) as z:
            z.extractall(src, [n for n in z.namelist() if n in FILES])
        # Contrôle de plausibilité avant de remplacer quoi que ce soit
        if not (src / "stop_times.txt").exists() or (src / "stop_times.txt").stat().st_size < 50_000_000:
            raise ValueError("GTFS incomplet : stop_times.txt absent ou trop petit")
        out = tmp / "data"
        out.mkdir()
        old_out = build.OUT
        try:
            build.OUT = out
            stats = build.build(src)
        finally:
            build.OUT = old_out
        if stats["connections"] < 1_000_000 or stats["stops"] < 10_000:
            raise ValueError(f"réseau anormal : {stats}")
        # Remplacement : sources GTFS (entrées de gare), puis fichiers du calculateur, puis équipements des arrêts
        if GTFS_DIR.exists():
            shutil.rmtree(GTFS_DIR)
        shutil.copytree(src, GTFS_DIR)
        for name in ("router.npz", "router.json"):
            shutil.move(str(out / name), str(DATA / f"{name}.new"))
            (DATA / f"{name}.new").replace(DATA / name)
    am = amenities.build()
    STATE.write_text(json.dumps({"upstream_modified": up.isoformat() if up else None, "built_at": datetime.now(timezone.utc).isoformat(),
                                 "reason": why, "stats": stats}, ensure_ascii=False), encoding="utf-8")
    log.info("Réseau reconstruit (%s) : %s", why, stats)
    return {"refreshed": True, "reason": why, "stats": stats, "amenities": am}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(refresh(force="--force" in sys.argv))
