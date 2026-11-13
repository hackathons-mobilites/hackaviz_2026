"""07 - Contrôles qualité (à lancer avant tout export). Code de sortie 1 si un contrôle P0 échoue.

Contrôle ce qui existe : données traitées (communes, postes, pôles), matrices data/interim/matrix/*.csv,
et fichiers déjà exportés dans frontend/public/data/.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from itertools import combinations, pairwise
from pathlib import Path

import pandas as pd

from starway.config import (
    BUDGETS_MIN,
    FRONT_DATA_DIR,
    FRONT_SKY44_DIR,
    IDF_DEPS,
    INTERIM_DIR,
    JOBS_YEAR,
    MANIFEST_PATH,
    MAX_TRIP_MIN,
    MODES,
    OUTBOUND_STEP_MIN,
    PARIS_COMMUNE,
    POLES_D030_JSON,
    PROCESSED_DIR,
    REASONS,
    REPO_ROOT,
    SERVICE_DATE,
    WALK_SETTINGS_M,
)
from starway.geo import SKY_MIN_POLE_GAP
from starway.poles import POLE_DEFS, check_disjoint

RESULTS: list[tuple[str, str, bool, str]] = []  # (niveau, nom, ok, détail)


def access_sky_poles_file() -> Path:
    """poles.json du ciel des pôles de access/, itineraries/ et subscriptions.json : les 44 astres (seul ciel, D-054)."""
    return FRONT_SKY44_DIR / "poles.json"


def access_sky_reference_poles() -> list[dict]:
    """Pôles que `access/` doit suivre : poles.json (15) ou poles_d030.json (44) selon `access_sky_poles_file`."""
    f = access_sky_poles_file()
    return json.loads((PROCESSED_DIR / ("poles_d030.json" if f.parent == FRONT_SKY44_DIR else "poles.json"))
                      .read_text(encoding="utf-8"))


def check(level: str, name: str, fn: Callable[[], tuple[bool, str]]) -> None:
    try:
        ok, detail = fn()
    except FileNotFoundError as exc:
        ok, detail = False, f"fichier absent : {exc.filename}"
    except Exception as exc:  # noqa: BLE001
        ok, detail = False, f"{type(exc).__name__}: {exc}"
    RESULTS.append((level, name, ok, detail))


def check_od_export(od_out, codes: list[str], jobs: pd.DataFrame, poles: list[dict]) -> None:
    """Table OD D-019 exportée par 06d : structure, fidélité aux lots de 04c, comparaison avec access/."""
    import gzip

    import numpy as np

    from starway import od_export as ox
    from starway import od_table as od
    from starway import od_variant as ov

    published = od_out.parent == FRONT_DATA_DIR
    label = ("complète" if published else "partielle") + ("" if od_out.name in ("od", "od_export_partial")
                                                           else f", {od_out.name.rsplit('_', 1)[-1]}")
    idx = json.loads((od_out / "index.json").read_text(encoding="utf-8"))
    pos = {c: i for i, c in enumerate(codes)}
    files = codes if idx["files"] == "all" else idx["files"]
    parsed: dict[int, ox.ParsedFile] = {}

    def read(insee: str, only: set[int] | None = None) -> ox.ParsedFile:
        b = (od_out / "o" / f"{insee}.bin").read_bytes()
        return ox.parse_file(gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b, only)

    def structure() -> tuple[bool, str]:
        errs: list[str] = []
        if idx["communes"] != codes:
            errs.append("index.communes différent des 1 285 origines triées")
        jb = jobs.set_index("insee")["jobs"]
        if idx["jobs"] != [int(jb[c]) for c in codes]:
            errs.append("index.jobs différent de jobs_by_commune")
        if sum(idx["jobs"]) != int(jobs.loc[jobs["geo_object"] == "COM", "jobs"].sum()):
            errs.append("somme des postes != total Flores IDF")
        if idx["pole_of"] != ox.pole_of(codes, poles) or [p["id"] for p in idx["poles"]] != [p["id"] for p in poles]:
            errs.append("pole_of ou poles désalignés avec poles.json")
        for i, p in enumerate(poles):
            if sum(j for j, q in zip(idx["jobs"], idx["pole_of"], strict=True) if q == i) != p["jobs"]:
                errs.append(f"{p['id']} : somme des postes")
        if {int(k): v for k, v in idx["sentinels"].items()} != ox.SENTINELS or idx["max_trip_min"] != MAX_TRIP_MIN:
            errs.append("sentinelles ou max_trip_min")
        ws = idx.get("walk_setting")  # réglage de marche D-024 : le dossier doit dire le réglage de ses lots TC
        want_limit = next((lim for lim in ov.WALK_SETTINGS_M.values() if od_out.name.endswith(f"walk{lim}")), None)
        if ws is not None:
            if want_limit is None and ws.get("id") != "r5_default":
                errs.append(f"walk_setting {ws.get('id')} dans un dossier sans réglage ({od_out.name})")
            if want_limit is not None and ws.get("limit_m") != want_limit:
                errs.append(f"walk_setting.limit_m {ws.get('limit_m')} != {want_limit} ({od_out.name})")
        elif want_limit is not None:
            errs.append(f"{od_out.name} : bloc walk_setting absent")
        # couverture par mode : un mode absent de index.modes est annoncé « non calculé », sans aucune section publiée
        mode_codes = {m["id"]: m["code"] for m in idx["modes"]}
        for m in ("transit", "walk", "bike", "car"):
            cov = idx["coverage"].get(m)
            if cov is None:
                errs.append(f"coverage.{m} absent (couverture non annoncée)")
            elif m not in mode_codes and not (cov.get("origins") == 0 and cov.get("computed") == []
                                              and cov.get("status") == "not_computed" and not cov.get("complete")):
                errs.append(f"coverage.{m} : mode absent de index.modes mais pas annoncé « non calculé »")
        if idx["complete"] != all(idx["coverage"].get(m, {}).get("complete") for m in ("transit", "walk", "bike", "car")):
            errs.append("index.complete différent de la couverture des quatre modes")
        on_disk = {f.stem for f in (od_out / "o").glob("*.bin")}
        if on_disk != set(files):
            errs.append(f"fichiers sur disque {len(on_disk)} != index.files {len(files)}")
        first = od.parse_hhmm(idx["grid"]["first"])
        seg = idx.get("time_segments")
        if seg:  # D-040 : segments contigus, sans doublon, et = grille publiée ; réseau de nuit pour le matin et le soir
            sg = seg["segments"]
            spans = [(od.parse_hhmm(s["from"]), od.parse_hhmm(s["to"])) for s in sg]
            if [s["name"] for s in sg] != ["matin", "jour", "soir"]:
                errs.append("time_segments : segments attendus matin, jour, soir")
            if any(b != a + OUTBOUND_STEP_MIN for (_, a), (b, _) in pairwise(spans)):
                errs.append("time_segments : segments non contigus (trou ou doublon de départ)")
            if spans[0][0] != first or sum(s["n_slots"] for s in sg) != idx["grid"]["n_slots"] \
                    or od.format_hhmm(spans[-1][1]) != idx["grid"]["last"]:
                errs.append("time_segments : segments différents de la grille publiée")
            if [s["gtfs_source"] for s in sg] != ["TRA01B", "TRA01", "TRA01C"]:
                errs.append("time_segments : réseau attendu TRA01B (matin), TRA01 (jour), TRA01C (soir)")
        n_rec = 0
        for insee in files:
            pf = read(insee, only=set())
            parsed[pos[insee]] = pf
            if (pf.origin, pf.first, pf.n_slots, pf.step) != (pos[insee], first, idx["grid"]["n_slots"],
                                                             idx["grid"]["step_min"]):
                errs.append(f"{insee} : en-tête")
            for code, ds in pf.dests.items():
                n_rec += len(ds)
                if code not in mode_codes.values():
                    errs.append(f"{insee} : section du mode {code} absent de index.modes")
                if pf.origin in ds:
                    errs.append(f"{insee} : enregistrement vers soi-même (règle self_pair)")
                if ds != sorted(set(ds)):
                    errs.append(f"{insee} : destinations non triées ou en double (mode {code})")
            for code, sc in pf.scalars.items():
                bad = [v for o_r in sc.values() for v in o_r if MAX_TRIP_MIN < v < ox.SENTINEL_NOT_COMPUTED]
                if bad:
                    errs.append(f"{insee} : valeur scalaire hors contrat {bad[:3]}")
        return not errs, "; ".join(errs[:5]) or (f"{len(files)} fichiers, {n_rec} enregistrements, "
                                                 f"index aligné sur communes, postes et pôles")
    check("P0", f"table OD D-019 ({label}) : structure, postes, pôles, aucun trajet vers soi-même", structure)

    def faithful() -> tuple[bool, str]:
        """Séries décodées = lots de 04c (plafonnés), sur un échantillon déterministe d'origines."""
        srcs = {m: REPO_ROOT / idx.get("source_by_mode", {}).get(m, idx["source_od_dir"])
                for m in ("transit", "walk", "bike", "car")}  # variante D-024 : TC et autres modes de deux dossiers
        src = srcs["transit"]
        if not all((d / "run_params.json").exists() for d in srcs.values()):
            return True, f"lots de 04c absents ({idx['source_od_dir']}) : fidélité vérifiée par 06d à l'écriture"
        rp = json.loads((src / "run_params.json").read_text(encoding="utf-8"))
        seg = idx.get("time_segments")  # D-040 : TC assemblé du matin, du jour et du soir
        seg_dirs: dict = {}
        seg_plans: list = []
        if seg:
            from starway import od_night as on
            seg_dirs = {s["name"]: REPO_ROOT / s["source_dir"] for s in seg["segments"]}
            seg_plans = [on.SegmentPlan(s["name"], od.parse_hhmm(s["from"]), od.parse_hhmm(s["to"]))
                         for s in seg["segments"]]
            if not all((d / "run_params.json").exists() for d in seg_dirs.values()):
                return True, "lots de nuit de 04c absents : fidélité vérifiée par 06d à l'écriture"
        sample = files[:: max(1, len(files) // 25)]
        errs: list[str] = []
        lot_cache: dict[tuple[str, int], np.ndarray] = {}

        def row(mode: str, i: int) -> np.ndarray | None:
            k = i // rp["batch_size"]
            if (mode, k) not in lot_cache:
                if mode == "transit" and seg:
                    from starway import od_night as on
                    ids = od.batches_of(codes, rp["batch_size"])[k]
                    lot_cache[(mode, k)] = on.load_assembled_lot(seg_dirs, k, seg_plans, ids, codes)
                else:
                    p = od.lot_path(srcs[mode], mode, k)
                    lot_cache[(mode, k)] = od.read_lot(p).tt if p.exists() else None
            t = lot_cache[(mode, k)]
            return None if t is None else t[i - k * rp["batch_size"]]
        for insee in sample:
            x = pos[insee]
            pf = read(insee)
            for code, m in enumerate(("transit", "walk", "bike", "car")):
                out_rows = row(m, x)
                if out_rows is None:
                    continue
                got = pf.series.get(code) if m == "transit" else pf.scalars.get(code)
                for y, val in (got or {}).items():
                    ry = row(m, y)
                    want_o = ox.cap_series(out_rows[y])
                    want_r = (ox.cap_series(ry[x]) if ry is not None
                              else np.full_like(want_o, ox.SENTINEL_NOT_COMPUTED))
                    o, r = (val if m == "transit" else (np.array([val[0]]), np.array([val[1]])))
                    if not (np.array_equal(o, want_o) and np.array_equal(r, want_r)):
                        errs.append(f"{insee} vers {codes[y]} ({m})")
                omitted = ox.has_trip(ox.cap_series(out_rows.reshape(len(codes), -1)))
                omitted[[*(got or {}).keys(), x]] = False
                if omitted.any():
                    errs.append(f"{insee} ({m}) : {int(omitted.sum())} destinations avec aller omises")
        return not errs, "; ".join(errs[:5]) or f"{len(sample)} origines relues : séries = lots de 04c"
    check("P0", f"table OD D-019 ({label}) : séries décodées = lots de 04c (échantillon)", faithful)

    def vs_access() -> tuple[bool, str]:
        """Verdict publié (pôle, arrêt d'ancrage) contre verdict D-019 (commune de l'arrêt), 3 journées-types, au MÊME
        réglage de marche : od_walk3000 (normal) contre modes.transit, od_walk1000 (confort) contre
        variants.comfort.transit (clé lue dans meta.walk_settings, jar comparé par son empreinte)."""
        anch = pd.read_csv(PROCESSED_DIR / "pole_anchor_stops.csv", dtype={"insee": str}).set_index("pole_id")
        if any(p["id"] not in anch.index for p in poles):
            # access/ suit les 44 astres : l'arrêt d'ancrage et sa commune ne sont relevés que pour les 15 pôles
            # (pole_anchor_stops.csv), la comparaison par position n'aurait aucun sens (limite dite dans docs/limites.md)
            return True, ("comparaison sans objet : access/ suit les 44 astres, les arrêts d'ancrage communaux ne sont "
                          "relevés que pour les 15 pôles")
        anchors = [pos[anch.loc[p["id"], "insee"]] for p in poles]
        meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
        days = [(d["id"], od.parse_hhmm(d["start"]), od.parse_hhmm(d["end"])) for d in meta["day_types"]]
        ws_id = (idx.get("walk_setting") or {}).get("id", "r5_default")
        setting = next((s for s in (meta.get("walk_settings") or {}).get("settings", []) if s["id"] == ws_id), None)
        if setting is None:
            return True, (f"réglage {ws_id} : aucune série publiée dans access/ à ce réglage (access/ porte les "
                          "réglages D-024), comparaison sans objet")
        if setting.get("r5_jar_sha256") != idx["walk_setting"].get("r5_jar_sha256"):
            return False, f"réglage {ws_id} : jar R5 de access/ différent de celui de la table OD"

        def access_series(a: dict) -> dict:
            return a["modes"]["transit"] if setting["key"] is None else a["variants"][setting["key"]]["transit"]
        target = "modes.transit" if setting["key"] is None else f"variants.{setting['key']}.transit"
        cov = idx["coverage"]["transit"]
        ret_ok = set(range(len(codes))) if cov["complete"] else {pos[c] for c in cov["computed"]}
        tot = {b: {"both": 0, "published_only": 0, "od_only": 0, "neither": 0} for b in BUDGETS_MIN}
        n = skipped = 0
        examples: list[str] = []
        gaps: dict[int, list[int]] = {j: [] for j in range(len(poles))}
        for insee in files:
            ap = FRONT_DATA_DIR / "access" / f"{insee}.json"
            if not ap.exists():
                continue
            pf = read(insee, only=set(anchors))
            r = ox.anchor_comparison(pf, access_series(json.loads(ap.read_text(encoding="utf-8"))), days,
                                     anchors, BUDGETS_MIN, ret_ok)
            n += r["pairs"]
            skipped += r["skipped_not_computed"]
            for j, g in r["out_gap"].items():
                gaps[j] += g
            for b, c in r["by_budget"].items():
                for k, v in c.items():
                    tot[b][k] += v
            examples += [f"{insee}/{d}/{poles[j]['id']}/{b} min : publié {o0}+{r0}, D-019 {o1}+{r1}"
                         for d, j, b, o0, r0, o1, r1 in r["published_only"][:1]]
        pub_only = sum(c["published_only"] for c in tot.values())
        # diagnostic du point d'arrivée : distance arrêt d'ancrage -> point D-017 de sa commune, écart aller médian
        com = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str}).set_index("insee")

        def dist_m(lon1: float, lat1: float, lon2: float, lat2: float) -> int:
            import math
            p1, p2 = math.radians(lat1), math.radians(lat2)
            h = (math.sin((p2 - p1) / 2) ** 2
                 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
            return round(2 * 6371000 * math.asin(math.sqrt(h)))
        all_gaps = [g for v in gaps.values() for g in v]
        per_pole = []
        for j, p in enumerate(poles):
            st = anch.loc[p["id"]]
            c = com.loc[st["insee"]]
            d = dist_m(st["lon"], st["lat"], c["origin_lon"], c["origin_lat"])
            med = int(np.median(gaps[j])) if gaps[j] else None
            per_pole.append(f"{p['id']} {med:+d} min à {d} m" if med is not None else f"{p['id']} sans couple")
        gap_txt = (f" ; aller D-019 plus long que l'aller publié dans {sum(g > 0 for g in all_gaps)} couples sur "
                   f"{len(all_gaps)} (les deux allers existent) ; écart aller médian par pôle et distance de l'arrêt "
                   f"d'ancrage au point D-017 de sa commune : {', '.join(per_pole)}") if all_gaps else ""
        summary = "; ".join(f"{b} min : {c['both']} aux deux, {c['published_only']} publié seulement, "
                            f"{c['od_only']} D-019 seulement" for b, c in tot.items())
        return pub_only == 0, (f"réglage {ws_id} contre access/ {target} : "
                               f"{n} couples (origine, pôle, journée) comparés, {skipped} sans retour calculé ; "
                               f"{summary}" + (f" ; ex. {examples[:3]}" if examples else "") + gap_txt
                               + " (points d'arrivée différents : arrêt d'ancrage contre point D-017 de sa commune)")
    check("P1", f"table OD D-019 ({label}) : pôle accessible dans access/ = commune d'ancrage accessible", vs_access)

    def swa_volume() -> tuple[bool, str]:
        site = [f for f in FRONT_DATA_DIR.parent.rglob("*") if f.is_file()]
        extra = [] if published else [f for f in (od_out / "o").glob("*.bin")]
        size = sum(f.stat().st_size for f in site + extra)
        lim = idx["volume"]["swa_free_limit"]
        detail = (f"frontend/public{' + export partiel' if extra else ''} : {size / 1e6:.0f} Mo, "
                  f"{len(site) + len(extra)} fichiers (limite {lim['bytes'] / 1e6:.0f} Mo, {lim['files']} fichiers)")
        return size <= lim["bytes"] and len(site) + len(extra) <= lim["files"], detail
    check("P1", f"table OD D-019 ({label}) : volume du site sous la limite du plan Free de Static Web Apps",
          swa_volume)


def check_flux_gtfs() -> None:
    """Flux GTFS (décision de Nicolas du 06/11/2026) : le flux publié ne doit laisser AUCUNE ligne sans service le jour de
    référence sans qu'elle soit listée et justifiée (`starway.gtfs_reference_day`), pour ne plus refaire l'erreur du flux du
    02/11 (31 lignes de bus au calendrier arrêté au 05/11, jamais signalées). Les empreintes des trois GTFS sont lues dans
    le manifeste seul, complètes (jamais un début), et, une fois le flux du 06/11 au manifeste, conformes aux débuts annoncés."""
    from starway import flux
    from starway import gtfs_reference_day as gr
    from starway.sources import sha256_of

    sha = flux.manifest_sha()

    def complete() -> tuple[bool, str]:
        errs = flux.incomplete_problems(sha) + flux.f06_problems(sha)
        regime = "flux du 06/11 (vélo + TC sur TRA01B)" if flux.f06_active(sha) else "flux du premier calcul (02/11)"
        return not errs, "; ".join(errs[:5]) or (f"TRA01 {sha['TRA01'][:8]}, TRA01B {sha['TRA01B'][:8]}, "
                                                  f"TRA01C {sha['TRA01C'][:8]} : complètes ; manifeste = {regime}")
    check("P0", "flux GTFS : les trois empreintes (TRA01, TRA01B, TRA01C) sont complètes au manifeste", complete)

    def reference_day() -> tuple[bool, str]:
        path = flux.gtfs_path("TRA01")
        if not path.exists():
            return False, f"GTFS du manifeste absent du poste : {path}"
        digest = sha256_of(path)
        if digest != sha["TRA01"]:
            return False, f"empreinte du fichier {digest[:8]} différente du manifeste {sha['TRA01'][:8]}"
        rows = gr.route_services(path, SERVICE_DATE)
        allow = gr.read_allowlist()
        bad = gr.unjustified(rows, digest, allow)
        none = [r for r in rows if not r.served]
        listed = len(none) - len(bad) - sum(r.status in gr.AUTO_JUSTIFIED for r in none)
        head = f"{path.name} {digest[:8]} : {len(rows)} lignes, {len(none)} sans service le {SERVICE_DATE.isoformat()}"
        if bad:
            sample = "; ".join(f"{r.short_name!r} ({r.agency}, {r.status} {r.first_day}-{r.last_day})" for r in bad[:6])
            return False, (f"{head} ; {len(bad)} ni justifiées ni listées dans data/gtfs_lignes_sans_service.csv : {sample}"
                           f"{' ...' if len(bad) > 6 else ''}")
        unused = gr.unused_entries(rows, digest, allow)
        return True, (f"{head} : {sum(r.status in gr.AUTO_JUSTIFIED for r in none)} roulent un autre jour de la semaine, "
                      f"{listed} listées et justifiées par écrit, aucune sans justification"
                      + (f" ; {len(unused)} justification(s) écrite(s) sans ligne correspondante" if unused else ""))
    check("P0", "flux GTFS : aucune ligne sans service le jour de référence sans être listée et justifiée", reference_day)


def check_night_network() -> None:
    """D-040, réseaux de nuit : TROIS empreintes de GTFS acceptées (TRA01 d'origine, TRA01B = gtfs_nuit.zip, TRA01C =
    gtfs_soir.zip), chacune seulement là où elle est utilisée, sans affaiblir le contrôle ailleurs.

      - le GTFS de nuit est bien TRA01 + les courses ajoutées (rien d'autre n'a changé) et son empreinte est celle du
        manifeste (contrôle fait seulement si les deux fichiers sont sur le poste) ;
      - le GTFS du soir est bien le GTFS de nuit + les courses du mercredi 18/11 parties avant 3h (aucune oubliée, rien
        d'autre ajouté ; aucun nombre de courses écrit en dur : il change avec le flux) et son empreinte est celle du
        manifeste ;
      - chaque dossier de calcul « nuit » est calculé sur SON réseau, jamais sur un autre : table du matin et 6h-14h
        recalculé sur TRA01B, table du soir (`_nuit_soir_v2`) sur TRA01C ; et avec le MÊME moteur que son dossier de jour
        (jar R5, règles de correspondance, OSM, points, réglage de marche) : seuls le GTFS et les journées diffèrent.
        Les anciens dossiers `_nuit_soir` (jamais publiés) ne sont plus lus."""
    from starway import evening_gtfs as eg
    from starway import night_network as nn
    from starway import publication as pub
    from starway.night_gtfs import verify_night_gtfs
    from starway.sources import read_manifest, sha256_of

    sha = {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] in ("TRA01", "TRA01B", "TRA01C", "CYC01")}

    def gtfs_ok() -> tuple[bool, str]:
        if sha.get("TRA01B") is None:
            return False, "TRA01B absente du manifeste"
        if not (nn.NIGHT_GTFS.exists() and nn.BASE_GTFS.exists()):
            return True, "GTFS de nuit ou d'origine absent du poste : contenu non vérifié (empreinte du manifeste seule)"
        errs = []
        if sha256_of(nn.NIGHT_GTFS) != sha["TRA01B"]:
            errs.append("empreinte du fichier différente du manifeste")
        if sha256_of(nn.BASE_GTFS) != sha["TRA01"]:
            errs.append("TRA01 différent du manifeste")
        errs += verify_night_gtfs(nn.BASE_GTFS, nn.NIGHT_GTFS)
        return not errs, "; ".join(errs[:5]) or "GTFS de nuit = TRA01 + courses ajoutées conformes à la règle, empreinte = manifeste"
    check("P0", "réseau de nuit D-040 : GTFS de nuit = GTFS d'origine + courses ajoutées", gtfs_ok)

    def evening_gtfs_ok() -> tuple[bool, str]:
        if sha.get("TRA01C") is None:
            return False, "TRA01C absente du manifeste"
        if len({sha.get("TRA01"), sha.get("TRA01B"), sha["TRA01C"]}) < 3:
            return False, "TRA01, TRA01B et TRA01C n'ont pas trois empreintes distinctes"
        if not (eg.EVENING_GTFS.exists() and nn.NIGHT_GTFS.exists()):
            return True, "GTFS du soir ou de nuit absent du poste : contenu non vérifié (empreinte du manifeste seule)"
        errs = []
        if sha256_of(eg.EVENING_GTFS) != sha["TRA01C"]:
            errs.append("empreinte du fichier différente du manifeste")
        errs += eg.verify_evening_gtfs(nn.NIGHT_GTFS, eg.EVENING_GTFS)  # la règle, sans nombre attendu écrit en dur
        return not errs, "; ".join(errs[:5]) or ("GTFS du soir = GTFS de nuit + courses du mercredi parties avant 3h "
                                                 "(aucune oubliée, rien d'autre ajouté), empreinte = manifeste")
    check("P0", "réseau du soir D-040 : GTFS du soir = GTFS de nuit + courses du mercredi parties avant 3h", evening_gtfs_ok)

    def nuit_dirs_ok() -> tuple[bool, str]:
        dirs = sorted(p for p in INTERIM_DIR.glob("*_d031_nuit*") if (p / "run_params.json").exists())
        old = [p.name for p in dirs if p.name.endswith("_nuit_soir")]  # anciennes tables du soir : jamais publiées, plus lues
        dirs = [p for p in dirs if p.name not in old]
        if not dirs:
            return True, "aucun dossier de calcul de nuit sur le poste : sans objet"
        errs, seen = [], []
        for d in dirs:
            params = json.loads((d / "run_params.json").read_text(encoding="utf-8"))
            want = pub.gtfs_source_of(d.name)
            if params.get("gtfs_sha256") != sha.get(want):
                errs.append(f"{d.name} : gtfs_sha256 != {want} du manifeste")
            for other in ("TRA01", "TRA01B", "TRA01C"):
                if other != want and params.get("gtfs_sha256") == sha.get(other):
                    errs.append(f"{d.name} : calculé sur {other}, réseau attendu {want}")
            if params.get("osm_sha256") != sha.get("CYC01"):
                errs.append(f"{d.name} : osm_sha256 != CYC01 du manifeste")
            base = d.with_name(pub.day_counterpart(d.name))
            if (base / "run_params.json").exists():
                base_params = json.loads((base / "run_params.json").read_text(encoding="utf-8"))
                if base_params.get("gtfs_sha256") != sha.get("TRA01"):
                    errs.append(f"{base.name} : gtfs_sha256 != TRA01 du manifeste")
                errs += [f"{d.name} contre {base.name} : {e}" for e in nn.engine_diff(base_params, params)]
                seen.append(d.name)
        tail = f" ; anciennes tables du soir ignorées : {', '.join(old)}" if old else ""
        return not errs, "; ".join(errs[:5]) or (f"{len(dirs)} dossiers de nuit, chacun sur son réseau (matin et 6h-14h TRA01B, "
                                                 f"soir TRA01C) ; moteur identique à celui du jour ({len(seen)} comparés){tail}")
    check("P0", "réseau de nuit D-040 : dossiers « nuit » calculés sur leur réseau avec le même moteur que le jour", nuit_dirs_ok)


def check_car_dist_rerun() -> None:
    """04g v2 (péages relevés avec la troncature de R5, 04/11) : mêmes chemins que le calcul du 03/11 (mêmes distances
    et durées pour les 38 550 couples) ; seuls les péages relevés changent."""
    from starway import car_dist as cdist

    def ok() -> tuple[bool, str]:
        a_dir = INTERIM_DIR / cdist.FIRST_CARSPEED_DIR_NAME / "batches"
        b_dir = INTERIM_DIR / cdist.CORRECTED_DIR_NAME / "batches"
        k = ["insee", "pole_id", "direction"]
        a = pd.concat([pd.read_csv(f, dtype=str) for f in sorted(a_dir.glob("batch_*.csv"))]).set_index(k).sort_index()
        b = pd.concat([pd.read_csv(f, dtype=str) for f in sorted(b_dir.glob("batch_*.csv"))]).set_index(k).sort_index()
        if not a.index.equals(b.index):
            return False, f"couples différents ({len(a)} et {len(b)})"
        same = (a["distance_m"].fillna("") == b["distance_m"].fillna("")) & (
            a["duration_s"].fillna("") == b["duration_s"].fillna(""))
        more = int((b["toll_nodes"].notna() & a["toll_nodes"].isna()).sum())
        changed = int((a["toll_nodes"].fillna("") != b["toll_nodes"].fillna("")).sum())
        return bool(same.all()), (f"{int(same.sum())}/{len(a)} couples à distance et durée identiques ; péages relevés "
                                  f"différents pour {changed} couples (dont {more} sans péage au 03/11)")
    check("P1", "voiture 04g v2 : mêmes chemins que le calcul du 03/11, seuls les péages relevés changent", ok)


def check_tolls() -> None:
    """Péages (04j, starway/toll_tariffs.py) : contrat des deux CSV, cases vides justifiées, tranches horaires sans
    trou ni chevauchement, sources = manifeste, registre = nœuds OSM de 04i."""
    from starway import toll_tariffs as tt
    from starway.sources import sha256_of

    tariffs = pd.read_csv(PROCESSED_DIR / "toll_tariffs.csv", dtype={"heure_debut": str, "heure_fin": str},
                          keep_default_na=False, na_values=[""])
    points = pd.read_csv(PROCESSED_DIR / "toll_points.csv", keep_default_na=False, na_values=[""])
    meta = json.loads((PROCESSED_DIR / "toll_tariffs_meta.json").read_text(encoding="utf-8"))

    def contract() -> tuple[bool, str]:
        errs = []
        if list(tariffs.columns) != tt.TARIFF_COLUMNS:
            errs.append(f"colonnes toll_tariffs : {list(tariffs.columns)}")
        if list(points.columns) != tt.POINT_COLUMNS:
            errs.append(f"colonnes toll_points : {list(points.columns)}")
        statuts = {tt.STATUT_OK, tt.STATUT_NON_TROUVE, tt.STATUT_INTERDIT, tt.STATUT_HORS_PERIMETRE,
                   tt.STATUT_RETIRE}
        if not set(tariffs["statut"]) <= statuts:
            errs.append(f"statuts inconnus : {set(tariffs['statut']) - statuts}")
        ok = tariffs["statut"] == tt.STATUT_OK
        if tariffs.loc[ok, "prix_ttc_eur"].isna().any() or (tariffs.loc[ok, "prix_ttc_eur"] <= 0).any():
            errs.append("prix vide ou nul sur une ligne « ok » (jamais de 0 de substitution)")
        if tariffs.loc[~ok, "prix_ttc_eur"].notna().any():
            errs.append("prix renseigné sur une case vide")
        if tariffs.loc[~ok, "raison"].isna().any():
            errs.append("case vide sans raison")
        for col in ("source_id", "fichier_source", "citation", "date_effet"):
            if tariffs.loc[ok, col].isna().any():
                errs.append(f"ligne « ok » sans {col}")
        if not set(tariffs["classe"]) <= set(tt.CLASSES):
            errs.append(f"classes : {sorted(set(tariffs['classe']))}")
        if set(tariffs["point_id"]) != set(tt.POINTS_BY_ID) or set(points["point_id"]) != set(tt.POINTS_BY_ID):
            errs.append("points des CSV différents du registre")
        return not errs, "; ".join(errs) or (f"{len(points)} lignes de points ({points['point_id'].nunique()} points), "
                                             f"{len(tariffs)} lignes de tarifs dont {int(ok.sum())} prix")
    check("P0", "péages : contrat des CSV, cases vides justifiées, aucun prix à 0", contract)

    def slots() -> tuple[bool, str]:
        bad = []
        ok = tariffs[tariffs["statut"] == tt.STATUT_OK]
        keys = ["point_id", "entree_point_id", "sortie_point_id", "classe", "tarif", "type_jour", "sens"]
        for k, g in ok.groupby(keys):
            g = g.sort_values("heure_debut")
            if (g["heure_debut"].iloc[0] != "00:00" or g["heure_fin"].iloc[-1] != "24:00"
                    or (g["heure_fin"].iloc[:-1].values != g["heure_debut"].iloc[1:].values).any()):
                bad.append(k)
        return not bad, f"{ok.groupby(keys).ngroups} grilles journalières couvertes 00:00-24:00" + (
            f" ; en défaut : {bad[:3]}" if bad else "")
    check("P0", "péages : tranches horaires de chaque jour sans trou ni chevauchement", slots)

    def sources() -> tuple[bool, str]:
        from starway.config import data_path

        manifest = {r["fichier_local"]: r for r in pd.read_csv(MANIFEST_PATH, dtype=str).to_dict("records")}
        errs = [f for f, sha in meta["inputs_sha256"].items() if f.startswith("data/raw/")
                and (f not in manifest or manifest[f]["sha256"] != sha or sha256_of(data_path(f)) != sha)]
        used = set(tariffs["fichier_source"].dropna())
        errs += [f"{f} absent du manifeste" for f in used if f not in manifest]
        ids = set(tariffs["source_id"].dropna())
        errs += [f"{s} : aucune ligne au manifeste" for s in ids if not any(r["source_id"] == s for r in manifest.values())]
        return not errs, "; ".join(errs[:5]) or f"{len(used)} fichiers sources, empreintes = manifeste"
    check("P0", "péages : fichiers sources = manifeste (sha256)", sources)

    def osm() -> tuple[bool, str]:
        j = json.loads((PROCESSED_DIR / "osm_toll_points.json").read_text(encoding="utf-8"))
        ids = {int(n["osm_id"]) for n in j["nodes"]}
        reg = [n for p in tt.POINTS for n in p.osm_nodes]
        missing = sorted(set(reg) - ids)
        same_pbf = meta.get("osm_pbf_sha256") == j.get("osm_pbf_sha256")
        return not missing and same_pbf, (f"{len(reg)} nœuds du registre dans osm_toll_points.json (04i)"
                                         + (f" ; absents : {missing[:5]}" if missing else "")
                                         + ("" if same_pbf else " ; 04j à relancer (autre PBF)"))
    check("P0", "péages : nœuds OSM du registre présents dans l'extraction 04i", osm)

    def completeness() -> tuple[bool, str]:
        extra = meta.get("osm_nodes_on_motorway_not_registered", [])
        cross = meta.get("aprr_pdf_crosscheck", {})
        diffs = cross.get("pairs_with_different_values", [None])
        return not extra and not diffs, (f"nœuds de péage sur autoroute hors registre : {extra[:5]} ; APRR PDF / CSV : "
                                         f"{len(diffs)} couple(s) en désaccord, {len(cross.get('pairs_only_in_pdf', []))} "
                                         "seulement dans le PDF")
    check("P1", "péages : tout péage autoroutier de l'OSM au registre, grille APRR = copie data.gouv.fr", completeness)

    def symmetric() -> tuple[bool, str]:
        ok = tariffs[(tariffs["statut"] == tt.STATUT_OK) & (tariffs["systeme"].isin(["APRR", "COFIROUTE", "SANEF_A4"]))]
        price = {(r.entree_point_id, r.sortie_point_id, r.classe): r.prix_ttc_eur for r in ok.itertuples()}
        asym = [k for k, v in price.items() if (k[1], k[0], k[2]) in price and price[(k[1], k[0], k[2])] != v]
        single = [k for k in price if (k[1], k[0], k[2]) not in price]
        return not asym, (f"{len(price)} couples x classe ; asymétriques : {asym[:3]} ; "
                          f"un seul sens publié : {len(single)} (péage du trajet = case vide, règle de couples)")
    check("P1", "péages : systèmes fermés APRR, Cofiroute et Sanef A4 symétriques", symmetric)

    xc_path = PROCESSED_DIR / "toll_crosscheck.json"
    xc = json.loads(xc_path.read_text(encoding="utf-8")) if xc_path.exists() else None

    def crosscheck_fresh() -> tuple[bool, str]:
        if xc is None:
            return False, "data/processed/toll_crosscheck.json absent (python scripts/04k_toll_crosscheck.py)"
        from starway import traceability as tr

        # fichiers texte versionnés : l'empreinte enregistrée est celle du poste (CRLF) ou d'un clone (LF) : les deux valent
        stale = [f for f in ("data/processed/toll_tariffs.csv", "frontend/public/data/tolls.json")
                 if xc["entrees_sha256"].get(f) not in set(tr.file_hashes(REPO_ROOT / f).values())]
        return not stale, ("recoupement 04k fait sur les fichiers publiés" if not stale
                           else f"04k à relancer : {stale} ont changé depuis le recoupement")
    check("P0", "péages : le recoupement 04k a été fait sur les montants publiés (tolls.json, toll_tariffs.csv)",
          crosscheck_fresh)

    def crosscheck_a5() -> tuple[bool, str]:
        if xc is None:
            return False, "recoupement absent"
        a5 = xc["a5_aprr"]
        gaps = len(a5["ecarts"]) + len(a5["pdf_contre_csv_toutes_classes"]["couples_avec_ecart"])
        return gaps == 0 and a5["sha1_csv_conforme_a_data_gouv"] is True, (
            f"{a5['couples_classes']} couples x classes de l'A5 : {a5['par_verdict']} ; écarts site / CSV / PDF : "
            f"{gaps} ; PDF contre CSV (toutes classes) : {a5['pdf_contre_csv_toutes_classes']['couples_communs']} "
            "couples communs")
    check("P0", "péages : A5 (APRR) = CSV ouvert de data.gouv.fr = PDF officiel (recoupement 04k)", crosscheck_a5)

    def crosscheck_manual() -> tuple[bool, str]:
        if xc is None:
            return False, "recoupement absent"
        m = xc["a14_et_duplex_a86"]
        bad = m["A14"]["ecarts"] + m["A86"]["ecarts"] + len(m["_erreurs_de_saisie"]["erreurs"])
        return bad == 0, (f"A14 : {m['A14']['etat']} ; Duplex A86 : {m['A86']['etat']} ; lignes refusées : "
                          f"{len(m['_erreurs_de_saisie']['erreurs'])} (sans relevé manuel : « non vérifié », jamais une valeur)")
    check("P1", "péages : A14 et Duplex A86 contre les relevés manuels (« non vérifié » sans relevé)", crosscheck_manual)


def check_service_public() -> None:
    """Offres diffusées sur Choisir le service public (06q, D-036, EMP04) : sommes, clés de commune, aucun champ personnel,
    empreinte du fichier = manifeste, rattachement recalculé sur le CSV quand il est présent (data/raw n'est pas versionné)."""
    from starway import service_public as sp
    from starway.config import RAW_DIR
    from starway.sources import read_manifest, sha256_of

    main_doc = json.loads((FRONT_DATA_DIR / "service_public.json").read_text(encoding="utf-8"))
    detail = json.loads((FRONT_DATA_DIR / sp.OFFERS_FILE).read_text(encoding="utf-8"))

    def astre_communes() -> set[str]:
        out: set[str] = set()
        for path in (FRONT_DATA_DIR / "poles.json",):
            if path.exists():
                out |= {c for p in json.loads(path.read_text(encoding="utf-8")) for c in p["communes"]}
        return out

    def contract() -> tuple[bool, str]:
        errs = sp.check_export(main_doc, detail, astre_communes())
        reg = main_doc["region"]
        return not errs, ("; ".join(errs[:5]) or
                          f"{reg['offers']} offres d'Île-de-France en ligne au {main_doc['as_of']} : {reg['commune']} rattachées à "
                          f"une commune ({len(main_doc['communes'])} communes), {reg['departement']} au département seulement")
    check("P0", "service public D-036 : sommes, clés de commune, aucun champ personnel, aucun tiret long", contract)

    def vocabulary() -> tuple[bool, str]:
        text = json.dumps([main_doc, detail], ensure_ascii=False).lower()
        bad = [w for w in ("postes ouverts", "poste ouvert", "offres d'emploi ouvertes") if w in text]
        return not bad, "jamais « poste ouvert » ; la méthode dit « en ligne » et « diffusées »" + (f" ; trouvé : {bad}" if bad else "")
    check("P0", "service public D-036 : vocabulaire (offres diffusées, jamais « postes ouverts »)", vocabulary)

    def never_mixed() -> tuple[bool, str]:
        # le ciel ne lit rien de ce fichier : ni poles.json ni meta.json ne le citent, aucun `jobs` ne change
        names = ("service_public", "EMP04")
        bad = [p.name for p in (FRONT_DATA_DIR / "poles.json", FRONT_DATA_DIR / "meta.json") if p.exists()
               and any(n in p.read_text(encoding="utf-8") for n in names)]
        return not bad, "poles.json et meta.json ne citent pas les offres diffusées" + (f" ; cités dans : {bad}" if bad else "")
    check("P0", "service public D-036 : jamais mélangé aux postes salariés (INSEE) (ciel et verdicts intacts)", never_mixed)

    def manifest() -> tuple[bool, str]:
        rows = [r for r in read_manifest() if r["source_id"] == "EMP04" and r["fichier_local"].endswith(main_doc["file"]["name"])]
        if len(rows) != 1:
            return False, f"{len(rows)} ligne(s) EMP04 pour {main_doc['file']['name']}"
        errs = []
        if rows[0]["sha256"] != main_doc["file"]["sha256"]:
            errs.append("empreinte publiée != manifeste")
        if rows[0]["date_extraction"] != main_doc["file"]["extracted_at"]:
            errs.append("date d'extraction publiée != manifeste")
        from starway.config import data_path

        raw = data_path(rows[0]["fichier_local"])
        if raw.exists() and sha256_of(raw) != rows[0]["sha256"]:
            errs.append("fichier brut != manifeste")
        return not errs, "; ".join(errs) or f"empreinte du fichier du {main_doc['as_of']} = manifeste"
    check("P0", "service public D-036 : fichier source = manifeste (sha256, date d'extraction)", manifest)

    csv = RAW_DIR / "EMP04" / main_doc["file"]["name"]
    geo = RAW_DIR / "GEO01"
    if csv.exists() and (geo / "communes_idf_codes_postaux.json").exists():
        def recompute() -> tuple[bool, str]:
            from datetime import date
            index = sp.read_postal_index(geo / "communes_idf_codes_postaux.json", geo / "arrondissements_paris_codes_postaux.json")
            offers, stats = sp.build_offers(sp.read_offers(csv), date.fromisoformat(main_doc["as_of"]), index,
                                            frozenset(astre_communes()))
            reg = main_doc["region"]
            errs = []
            if len(offers) != reg["offers"]:
                errs.append(f"{len(offers)} offres recalculées pour {reg['offers']} publiées")
            if sum(1 for o in offers if o.status == sp.LOC_COMMUNE) != reg["commune"]:
                errs.append("offres rattachées à une commune : recalcul différent")
            if stats["lignes_en_ligne"] != main_doc["counts"]["online_rows"]:
                errs.append("lignes en ligne : recalcul différent")
            return not errs, "; ".join(errs) or f"{len(offers)} offres recalculées sur le CSV = publiées"
        check("P1", "service public D-036 : comptes publiés = recalcul sur le CSV", recompute)


def check_alternatives(directory: Path | None = None, walk_setting: str | None = None) -> None:
    """Trajets alternatifs (06w, D-055) : couverture = fichiers, trois états stricts, jamais « pas d'alternative » pour une case non calculée.
    `walk_setting` (phase G, `alternatives_comfort/`) : en plus, le réglage écrit dans la couverture et dans chaque fichier."""
    from starway import alternatives_export as ax
    from starway import itin_sets as iss

    d = directory or (FRONT_DATA_DIR / "alternatives")

    def coherent() -> tuple[bool, str]:
        cov = json.loads((d / "coverage.json").read_text(encoding="utf-8"))
        docs = {p.name.split(".")[0]: iss.read_doc(p) for p in sorted(d.glob("*.json.gz"))}
        communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
        codes = sorted(communes.loc[communes["is_origin"], "insee"])
        errs = ax.check_published(cov, docs, codes)
        if walk_setting is not None:
            errs += [f"{name} : réglage {x.get('walk_setting')}, attendu {walk_setting}"
                     for name, x in [("couverture", cov), *docs.items()] if x.get("walk_setting") != walk_setting]
        return (not errs, f"{len(docs)} communes avec fichier, {cov['counts']}" if not errs else " ; ".join(errs[:5]))

    if walk_setting is None:
        check("P0", "trajets alternatifs D-055 : couverture = fichiers, trois états stricts", coherent)
    else:
        check("P0", f"trajets alternatifs D-055 au réglage {walk_setting} ({d.name}/) : couverture = fichiers, trois états stricts, "
              "réglage écrit partout", coherent)


def check_territoire() -> None:
    """Repères de territoire (06v, lot T1, territoire.json) : tout taux, effectif ou nom publié vient des fichiers bruts
    (SOC02, GEO05, GEO06, EMP05), aucune valeur ne manque sans raison écrite, empreintes = manifeste, rien sur les astres."""
    from starway import territoire as tr
    from starway.config import IDF_DEPS, IDF_REGION, PROCESSED_DIR, RAW_DIR, manifest_rel
    from starway.sources import read_manifest, sha256_of

    doc = json.loads((FRONT_DATA_DIR / tr.OUT_FILE).read_text(encoding="utf-8"))
    communes = tr.read_communes(PROCESSED_DIR / "communes_idf_2026.csv")
    origins = [c.code for c in communes.values() if c.is_origin]

    def structure() -> tuple[bool, str]:
        errs = tr.check_territoire(doc, origins, IDF_DEPS)
        ch = doc["chomage"]
        return not errs, ("; ".join(errs[:5]) or
                          f"{len(doc['communes'])} communes de départ, {len(ch['zones'])} zones sur {len(ch['quarters'])} trimestres "
                          f"(dernier {ch['quarter']}), {len(ch['departments'])} départements, chaque valeur absente a sa raison écrite")
    check("P0", "repères de territoire : contrat, 1 zone par commune de départ, aucune valeur absente sans raison, aucun tiret long",
          structure)

    def sources() -> tuple[bool, str]:
        rows = {r["fichier_local"]: r for r in read_manifest()}
        errs = []
        for s in doc["sources"]:
            hits = [r for f, r in rows.items() if f.startswith(f"data/raw/{s['source_id']}/") and f.endswith("/" + s["file"])]
            if len(hits) != 1:
                errs.append(f"{s['source_id']} {s['file']} : {len(hits)} ligne(s) au manifeste")
            elif hits[0]["sha256"] != s["sha256"]:
                errs.append(f"{s['file']} : empreinte publiée != manifeste")
            else:
                from starway.config import data_path
                raw = data_path(hits[0]["fichier_local"])
                if raw.exists() and sha256_of(raw) != s["sha256"]:
                    errs.append(f"{s['file']} : fichier brut != manifeste")
        if {s["source_id"] for s in doc["sources"]} != set(tr.SOURCE_IDS):
            errs.append("sources citées != SOC02, GEO05, GEO06, EMP05")
        return not errs, "; ".join(errs) or f"{len(doc['sources'])} fichiers cités, empreintes = manifeste = fichiers bruts"
    check("P0", "repères de territoire : fichiers sources = manifeste (sha256)", sources)

    def from_raw() -> tuple[bool, str]:
        try:
            raw = tr.locate_raw(RAW_DIR)
        except tr.TerritoireError as e:
            return False, f"fichiers bruts illisibles ou modifiés, impossible de prouver l'origine des valeurs : {e}"
        numbers, words = tr.raw_vocabulary(raw)
        foreign = tr.foreign_values(doc, numbers, words)
        try:
            rebuilt = tr.build_territoire(raw, communes, IDF_REGION, IDF_DEPS)
        except tr.TerritoireError as e:
            return False, f"recalcul impossible : {e}"
        other = ["le document publié diffère du recalcul sur les fichiers bruts (relancer 06v)"] if rebuilt != doc else []
        n_numbers = len(tr.numeric_leaves(doc))
        return not (foreign or other), "; ".join([*foreign[:5], *other]) or (
            f"{n_numbers} nombres et {len(tr.name_leaves(doc))} noms retrouvés dans les fichiers bruts ; document = recalcul")
    check("P0", "repères de territoire : chaque taux, effectif et nom publié vient des fichiers bruts (recalcul indépendant)",
          from_raw)

    def not_on_astres() -> tuple[bool, str]:
        # descriptif de la commune de départ : ni le ciel ni les verdicts ne le lisent, aucun taux sur un astre
        names = (tr.OUT_FILE, "chomage", "polarity", "temps_de_travail", *tr.SOURCE_IDS)
        bad = [p.name for p in (FRONT_DATA_DIR / "poles.json", FRONT_DATA_DIR / "meta.json") if p.exists()
               and any(n in p.read_text(encoding="utf-8") for n in names)]
        return not bad, "poles.json et meta.json ne citent ni chômage, ni polarité, ni temps de travail" + (f" ; cités dans : {bad}" if bad else "")
    check("P0", "repères de territoire : aucun taux ni polarité sur un astre (ciel et verdicts intacts)", not_on_astres)


def check_sources_registry() -> None:
    """Référentiel des sources (06r, docs/sources.md) : exhaustivité du manifeste et fraîcheur du fichier généré."""
    import importlib.util

    from starway import registry as rg
    from starway.config import PIPELINE_DIR, RAW_DIR
    from starway.sources import read_manifest

    manifest_codes = {r["source_id"] for r in read_manifest()}
    memo: dict[str, dict[str, set[str]]] = {}

    def published_scan() -> dict[str, set[str]]:
        if "published" not in memo:
            memo["published"] = rg.scan_published(FRONT_DATA_DIR)
        return memo["published"]

    def raw_dirs() -> tuple[bool, str]:
        dirs = [d.name for d in RAW_DIR.iterdir() if d.is_dir()] if RAW_DIR.exists() else []
        missing, waiting = rg.raw_dirs_without_manifest(dirs, manifest_codes)
        detail = f"{len(dirs)} dossiers"
        if waiting:
            detail += " ; en attente d'une branche annoncée : " + ", ".join(
                f"{d} ({rg.PENDING_MANIFEST[d]})" for d in waiting)
        if missing:
            detail += f" ; sans ligne de manifeste : {missing}"
        return not missing, detail
    check("P0", "sources : chaque dossier de data/raw a une ligne de manifeste", raw_dirs)

    def published_codes() -> tuple[bool, str]:
        cited = published_scan()
        unknown = {c: sorted(p) for c, p in cited.items() if c not in manifest_codes}
        return not unknown, f"{len(cited)} codes cités par les fichiers publiés" + (
            f" ; absents du manifeste : {unknown}" if unknown else "")
    check("P0", "sources : tout code cité par les données publiées est dans le manifeste", published_codes)

    def fresh() -> tuple[bool, str]:
        spec = importlib.util.spec_from_file_location("m06r", PIPELINE_DIR / "scripts" / "06r_sources_registry.py")
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        bad = mod.stale()
        return not bad, ("docs/sources.md et sources.json = manifeste" if not bad
                         else f"pas à jour : {bad} (relancer python scripts/06r_sources_registry.py)")
    check("P0", "sources : docs/sources.md et sources.json à jour du manifeste (06r)", fresh)

    def public_texts() -> tuple[bool, str]:
        """Audit du 10/11 (C1) : un script qui réécrit une ligne du manifeste après 06y (07d l'a fait) ne doit pas
        remettre de nom de script, de chemin, de renvoi de décision ni « VM » dans le mode sources."""
        spec = importlib.util.spec_from_file_location("m06y", PIPELINE_DIR / "scripts" / "06y_textes_publics_manifeste.py")
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        path = FRONT_DATA_DIR / "sources.json"
        if not path.exists():
            return False, "sources.json absent"
        items = json.loads(path.read_text(encoding="utf-8"))
        left = [f"{it.get('source_id')} {col} : {m.group(0)}" for it in items for col in mod.COLS
                for m in mod.RESIDUE.finditer(str(it.get(col) or ""))]
        return not left, (f"{len(items)} lignes, aucun motif interne" if not left
                          else f"{len(left)} motifs internes (relancer 06y --write puis 06r) : {sorted(set(left))[:8]}")
    check("P0", "sources : textes publics de sources.json sans motif interne (règles de 06y)", public_texts)

    def tables() -> tuple[bool, str]:
        no_status = sorted(manifest_codes - set(rg.SOURCE_INFO))
        obsolete = sorted(set(rg.PENDING_MANIFEST) & manifest_codes)
        catalogue = rg.read_catalogue(REPO_ROOT / rg.CATALOGUE_PATH)
        no_followup = sorted(e.code for e in catalogue if e.code not in rg.CATALOGUE_FOLLOWUP)
        published = published_scan()
        # cité par un fichier publié (hors sources.json) alors que le statut dit « non publié »
        incoherent = sorted(c for c, pats in published.items() if c in rg.SOURCE_INFO
                            and rg.SOURCE_INFO[c].status != "publiee" and set(pats) - {"sources.json"})
        errs = [f"statut absent (starway/registry.py) : {no_status}" if no_status else "",
                f"PENDING_MANIFEST à retirer : {obsolete}" if obsolete else "",
                f"devenir du catalogue absent : {no_followup}" if no_followup else "",
                f"cités par un fichier publié sans le statut publiee : {incoherent}" if incoherent else ""]
        errs = [e for e in errs if e]
        ok_txt = f"{len(manifest_codes)} codes avec statut, {len(catalogue)} entrées du catalogue suivies"
        return not errs, " ; ".join(errs) or ok_txt
    check("P1", "sources : statuts, liste d'attente et devenir du catalogue à jour (starway/registry.py)", tables)


def check_traceability() -> None:
    """Traçabilité des blocs affichés (06u, docs/tracabilite.md) : une ligne par composant du registre du front et par
    visite, chaque source citée est au manifeste, chaque sha256 du manifeste correspond au fichier, chaque empreinte des
    run_params.json des dossiers publiés se retrouve dans le manifeste, le document est à jour."""
    from starway import traceability as tr
    from starway.config import RAW_DIR

    roots = tr.DataRoots(REPO_ROOT, RAW_DIR, INTERIM_DIR, PROCESSED_DIR)
    memo: dict[str, tr.Trace] = {}

    def trace() -> tr.Trace:
        if "t" not in memo:
            memo["t"] = tr.collect(roots, verify=True)
        return memo["t"]

    def rows() -> tuple[bool, str]:
        t = trace()
        doc = (REPO_ROOT / tr.DOC_PATH).read_text(encoding="utf-8")
        missing = tr.missing_in_doc(doc, tr.expected_components(t))
        other = [p.message for p in tr.problems_of(t, ["bloc", "formule", "visite"], "P0")]
        errs = ([f"composants sans ligne dans {tr.DOC_PATH} : {missing}"] if missing else []) + other
        return not errs, " ; ".join(errs) or f"{len(tr.expected_components(t))} composants (registre du front et visite) tracés"
    check("P0", "traçabilité : chaque bloc affiché a sa ligne dans docs/tracabilite.md (formules, scripts et tests existent)", rows)

    def sources() -> tuple[bool, str]:
        t = trace()
        bad = [p.message for p in tr.problems_of(t, ["source"], "P0")]
        codes = {c for e in t.entries for c in e.codes}
        return not bad, " ; ".join(bad) or f"{len(codes)} codes cités par les composants, tous au manifeste"
    check("P0", "traçabilité : chaque source citée par un bloc est au manifeste", sources)

    def sha() -> tuple[bool, str]:
        t = trace()
        bad = [p.message for p in tr.problems_of(t, ["sha"], "P0")]
        n = {s: sum(1 for c in t.checks if c.status == s) for s in ("ok", "ok_eol", "absent", "repertoire", "hors_depot")}
        return not bad, " ; ".join(bad) or (
            f"{n['ok'] + n['ok_eol']} fichiers recalculés = manifeste ({n['ok_eol']} avec d'autres fins de ligne), "
            f"{n['hors_depot']} hors dépôt (jars), {n['repertoire']} répertoire, {n['absent']} absents de ce poste")
    check("P0", "traçabilité : sha256 du manifeste = fichiers (aucun écart)", sha)

    def calc() -> tuple[bool, str]:
        t = trace()
        bad = [p.message for p in tr.problems_of(t, ["calcul"], "P0")]
        n = sum(1 for cd in t.calc_dirs if cd.state != "absent")
        return not bad, " ; ".join(bad) or (f"{n} dossiers de calcul : jar, GTFS, OSM, astres, durées au même arrêt et points "
                                            "d'origine rapprochés du manifeste" if n else "aucun dossier de calcul lu ici")
    check("P0", "traçabilité : empreintes des run_params.json des dossiers publiés = lignes du manifeste", calc)

    def fresh() -> tuple[bool, str]:
        if not INTERIM_DIR.exists():
            return True, "data/interim absent : fraîcheur non contrôlée ici (poser STARWAY_DATA_ROOT)"
        doc = (REPO_ROOT / tr.DOC_PATH).read_text(encoding="utf-8").replace("\r\n", "\n")
        return doc == tr.render(trace()), f"relancer pipeline/scripts/06u_tracabilite.py si pas à jour ({tr.DOC_PATH})"
    check("P0", "traçabilité : docs/tracabilite.md à jour du registre, du manifeste et des run_params (06u)", fresh)

    def gaps() -> tuple[bool, str]:
        bad = sorted({p.message for p in trace().problems if p.level == "P1"})
        return not bad, " ; ".join(bad) or "aucun écart"
    check("P1", "traçabilité : écarts signalés (empreintes non écrites dans les run_params, fichiers absents)", gaps)


PREVIEW_D030_DIR = FRONT_SKY44_DIR  # ciel des 44 astres (D-030) : preview-d030/ avant la bascule, racine après (06d, 03b, 06b)


def d030_attachment(origins: pd.DataFrame, ctx: dict):
    """Rattachement des origines aux bassins GEO04 (lu une fois)."""
    if "att" not in ctx:
        from starway import sky_groups as sg
        from starway.geo import load_passage_table

        ctx["att"] = sg.attach_origins(origins[["insee", "name"]], sg.read_bassins(), load_passage_table())
    return ctx["att"]


def expected_pole_count(poles: list[dict], origins: pd.DataFrame, ctx: dict) -> tuple[bool, str]:
    """Nombre de pôles attendu, dérivé de leur définition : 15 pôles de POLE_DEFS (validés contre Flores), ou D-030 :
    bassins d'emploi GEO04 rattachés aux 1 285 origines, T1 Paris remplacé par son découpage."""
    from starway import sky_groups as sg

    kind = sg.pole_set_kind(poles)
    if kind == "pole_defs":
        return len(poles) == len(POLE_DEFS), f"{len(poles)} pôles ; attendu {len(POLE_DEFS)} (POLE_DEFS)"
    if kind == "d030":
        split = sg.d030_split(poles)
        att = d030_attachment(origins, ctx)
        n = sg.expected_group_count(att, split)
        paris = "20 arrondissements" if split == "arrondissements" else "3 pôles parisiens"
        return len(poles) == n, (f"{len(poles)} astres ; attendu {n} ({len(set(att.bassin_of.values()))} bassins "
                                 f"GEO04 des 1 285 origines, T1 Paris remplacé par {paris})")
    return False, f"{len(poles)} pôles : jeu inconnu (ni POLE_DEFS, ni D-030)"


def check_d030_set(poles: list[dict], label: str, origins: pd.DataFrame, jobs: pd.DataFrame, ctx: dict) -> None:
    """Astres D-030 (bassins d'emploi) : couverture complète, recalcul exact des règles de 03b, ciel dans [0,1]."""
    from starway import sky_groups as sg

    def coverage() -> tuple[bool, str]:
        groups = [sg.Group(p["id"], p["name"], p["bassin"]["code"], p["bassin"]["name"], tuple(p["communes"]))
                  for p in poles]
        errs = sg.check_partition(groups, origins["insee"].tolist())
        total = int(jobs.loc[jobs["geo_object"] == "COM", "jobs"].sum())
        s = sum(int(p["jobs"] or 0) for p in poles)
        return not errs and s == total, (f"{len(origins)} origines, {s:,} postes sur {total:,} ({100 * s / total:.2f} %)"
                                         + (f" ; {errs[:3]}" if errs else ""))
    check("P0", f"{label} D-030 : partition des 1 285 origines, 100 % des postes Flores", coverage)

    def rebuilt() -> tuple[bool, str]:
        att = d030_attachment(origins, ctx)
        if "located" not in ctx:
            ctx["located"] = sg.located_departures()
        jm = {r.insee: (None if pd.isna(r.jobs) else int(r.jobs)) for r in jobs.itertuples()}
        ref = sg.build_sky_poles(att, origins[["insee", "name", "lon", "lat"]], jm, ctx["located"], JOBS_YEAR,
                                 f"{SERVICE_DATE:%d/%m/%Y}", sg.d030_split(poles))
        ref = json.loads(json.dumps(ref, ensure_ascii=False))
        diff = [p.get("id") for p, r in zip(poles, ref, strict=False) if p != r]
        if len(poles) != len(ref):
            diff.append(f"{len(poles)} entrées au lieu de {len(ref)}")
        return not diff, ("identique au recalcul : bassins GEO04, postes Flores, noms, arrêt d'affichage, barycentre "
                          "des postes" if not diff else f"écarts : {diff[:5]}")
    check("P0", f"{label} D-030 : fichier = recalcul des règles (positions, tailles, noms, arrêts)", rebuilt)
    check("P0", f"{label} D-030 : ciel dans [0,1]", lambda: (
        all(0 <= p["sky"]["x"] <= 1 and 0 <= p["sky"]["y"] <= 1 for p in poles), ""))


def check_d030_preview(origins: pd.DataFrame, jobs: pd.DataFrame, ctx: dict) -> None:
    """Ciel des 44 astres D-030 (racine de frontend/public/data) : astres, index OD, carte miroir."""
    from starway import od_export as ox

    poles = json.loads((PREVIEW_D030_DIR / "poles.json").read_text(encoding="utf-8"))
    check("P0", "aperçu D-030 : nombre d'astres = celui de leur définition",
          lambda: expected_pole_count(poles, origins, ctx))
    check_d030_set(poles, "aperçu", origins, jobs, ctx)
    check("P1", "aperçu D-030 : poles.json des 44 astres = data/processed/poles_d030.json", lambda: (
        json.loads((PROCESSED_DIR / "poles_d030.json").read_text(encoding="utf-8")) == poles,
        "relancer 03b --preview si différent"))

    codes = origins["insee"].sort_values().tolist()
    for d in sorted(PREVIEW_D030_DIR.glob("od_walk*")):

        def od_ok(d=d) -> tuple[bool, str]:
            idx = json.loads((d / "index.json").read_text(encoding="utf-8"))
            errs = []
            if idx["pole_of"] != ox.pole_of(codes, poles) or None in idx["pole_of"]:
                errs.append("pole_of différent des communes de poles.json (ou commune sans astre)")
            if idx["poles"] != [{"id": p["id"], "jobs": p["jobs"]} for p in poles]:
                errs.append("poles (ids, postes) différents de poles.json")
            for i, p in enumerate(poles):
                if sum(j for j, q in zip(idx["jobs"], idx["pole_of"], strict=True) if q == i) != p["jobs"]:
                    errs.append(f"{p['id']} : somme des postes")
            return not errs, "; ".join(errs[:4]) or f"{len(poles)} astres, toutes les communes rattachées, o/ = {d.name}/o/"
        check("P0", f"aperçu D-030 : {d.name}/index.json aligné sur poles.json", od_ok)

    geo = PREVIEW_D030_DIR / "geo" / "poles.geojson"
    if geo.exists():
        def geo_ok() -> tuple[bool, str]:
            fc = json.loads(geo.read_text(encoding="utf-8"))
            areas = [f for f in fc["features"] if f["properties"]["kind"] == "pole_area"]
            anch = [f for f in fc["features"] if f["properties"]["kind"] == "anchor"]
            ids = [p["id"] for p in poles]
            errs = []
            if [f["properties"]["pole_id"] for f in areas] != ids or [f["properties"]["pole_id"] for f in anch] != ids:
                errs.append("ordre des astres différent de poles.json")
            for p, a, f in zip(poles, areas, anch, strict=False):
                if a["properties"]["communes"] != p["communes"]:
                    errs.append(f"{p['id']} : communes")
                if f["geometry"]["coordinates"] != [p["point"]["lon"], p["point"]["lat"]] or \
                        f["properties"]["stop_id"] != p["point"]["stop_id"]:
                    errs.append(f"{p['id']} : arrêt d'affichage")
            return not errs, "; ".join(errs[:4]) or f"{len(areas)} contours, {len(anch)} arrêts, {geo.stat().st_size / 1024:.0f} Ko"
        check("P1", "aperçu D-030 : geo/poles.geojson aligné sur poles.json", geo_ok)

    def weight() -> tuple[bool, str]:
        # limites du plan Free de Static Web Apps (250 Mo, 15 000 fichiers ; Microsoft Learn, lu le 03/11/2026)
        files = [f for f in PREVIEW_D030_DIR.rglob("*") if f.is_file()]
        site = [f for f in (FRONT_DATA_DIR.parent).rglob("*") if f.is_file()]
        size = sum(f.stat().st_size for f in site)
        return size <= 250 * 10**6 and len(site) <= 15000, (
            f"aperçu : {len(files)} fichiers, {sum(f.stat().st_size for f in files) / 1024:.0f} Ko ; "
            f"frontend/public entier : {len(site)} fichiers, {size / 1e6:.1f} Mo (limite 250 Mo, 15 000 fichiers)")
    check("P1", "aperçu D-030 : poids ajouté, site sous la limite du plan Free", weight)


def main() -> int:
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str, "dep": str})
    jobs = pd.read_csv(PROCESSED_DIR / f"jobs_by_commune_{JOBS_YEAR}.csv", dtype={"insee": str, "dep": str})
    poles = json.loads((PROCESSED_DIR / "poles.json").read_text(encoding="utf-8"))
    origins = communes[communes["is_origin"]]

    # --- Géographie
    check("P0", "1 266 communes IDF + 20 arrondissements", lambda: (
        int((communes["kind"] == "commune").sum()) == 1266 and int((communes["kind"] == "arrondissement").sum()) == 20,
        f"{int((communes['kind'] == 'commune').sum())} communes, {int((communes['kind'] == 'arrondissement').sum())} arr."))
    check("P0", "1 285 origines, codes uniques", lambda: (
        len(origins) == 1285 and origins["insee"].is_unique, f"{len(origins)} origines"))
    check("P0", "départements IDF uniquement", lambda: (
        set(communes["dep"]) <= set(IDF_DEPS), str(sorted(set(communes["dep"])))))
    check("P0", "positions ciel des communes dans [0,1]", lambda: (
        bool(communes[["sky_x", "sky_y"]].stack().between(0, 1).all()), ""))

    # --- Postes salariés
    def jobs_cover() -> tuple[bool, str]:
        j = jobs.set_index("insee")["jobs"]
        missing = [c for c in list(origins["insee"]) + [PARIS_COMMUNE] if c not in j.index or pd.isna(j[c])]
        orphan = sorted(set(jobs["insee"]) - set(communes["insee"]))
        return not missing and not orphan, f"sans postes : {missing[:5]} ; codes orphelins : {orphan[:5]}"
    check("P0", "postes Flores pour chaque origine, aucun code orphelin", jobs_cover)
    check("P0", "Paris 75056 = somme des 20 arrondissements", lambda: (
        int(jobs[jobs.insee == PARIS_COMMUNE].jobs.iloc[0]) == int(jobs[jobs.geo_object == "ARM"].jobs.sum()), ""))

    # --- Pôles : nombre dérivé de la définition (15 pôles de POLE_DEFS, ou bassins GEO04 + découpage de Paris, D-030)
    from starway import sky_groups as sg

    kind = sg.pole_set_kind(poles)
    d030_ctx: dict = {}
    check("P0", "nombre de pôles = celui de leur définition",
          lambda: expected_pole_count(poles, origins, d030_ctx))
    if kind == "d030":
        check_d030_set(poles, "pôles", origins, jobs, d030_ctx)
    else:
        check("P0", "pôles disjoints", lambda: (not check_disjoint(), str(check_disjoint())))
        check("P0", "ordre et ids des pôles = POLE_DEFS", lambda: (
            [p["id"] for p in poles] == [d.id for d in POLE_DEFS], ""))

    def poles_sum() -> tuple[bool, str]:
        j = jobs.set_index("insee")["jobs"]
        bad = [p["id"] for p in poles if p["jobs"] is None or p["jobs"] <= 0
               or int(sum(j[c] for c in p["communes"])) != p["jobs"]]
        return not bad, f"incohérents : {bad}"
    check("P0", "postes du pôle = somme des communes membres, > 0", poles_sum)

    def sky_gap() -> tuple[bool, str]:
        xy = [(p["sky"]["x"], p["sky"]["y"]) for p in poles]
        inside = all(0 <= x <= 1 and 0 <= y <= 1 for x, y in xy)
        dmin = min(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 for a, b in combinations(xy, 2))
        return inside and dmin >= SKY_MIN_POLE_GAP - 1e-3, f"écart minimal {dmin:.4f}"
    if kind != "d030":  # règle des 15 pôles : relaxation à l'écart minimal SKY_MIN_POLE_GAP (D-030 : sans relaxation)
        check("P0", "ciel des pôles dans [0,1] et non superposé", sky_gap)

    # --- Points des pôles : règle unique « arrêt parent le plus desservi à SERVICE_DATE dans les communes du pôle »
    def anchors_rule() -> tuple[bool, str]:
        import geopandas as gpd

        deps = pd.read_csv(INTERIM_DIR / f"gtfs_departures_{SERVICE_DATE:%Y%m%d}.csv", dtype={"stop_id": str})
        contours = gpd.read_file(INTERIM_DIR / "communes_idf_2026.gpkg")[["insee", "geometry"]]
        contours = contours[contours["insee"] != PARIS_COMMUNE].to_crs("EPSG:4326")
        pts = gpd.GeoDataFrame(deps, geometry=gpd.points_from_xy(deps["lon"], deps["lat"]), crs="EPSG:4326")
        located = gpd.sjoin(pts, contours, predicate="within")
        anchors = pd.read_csv(PROCESSED_DIR / "pole_anchor_stops.csv", dtype=str).set_index("pole_id")
        errs = []
        for p in poles:
            cand = located[located["insee"].isin(p["communes"])]
            best = cand.sort_values(["departures", "stop_id"], ascending=[False, True]).iloc[0]
            if anchors.loc[p["id"], "stop_id"] != best["stop_id"]:
                errs.append(f"{p['id']} : {anchors.loc[p['id'], 'stop_id']} au lieu de {best['stop_id']}")
            if (round(best["lon"], 5), round(best["lat"], 5)) != (p["point"]["lon"], p["point"]["lat"]):
                errs.append(f"{p['id']} : point différent de l'arrêt retenu")
        return not errs, "; ".join(errs[:5]) or "15 pôles conformes à la règle"
    if kind != "d030":  # D-030 : la règle est recalculée par check_d030_set (arrêt écrit dans point)
        check("P0", "point de chaque pôle = arrêt le plus desservi à la date de service", anchors_rule)

    def neighbours() -> tuple[bool, str]:
        adj = pd.read_csv(PROCESSED_DIR / "adjacency_2026.csv", dtype=str)
        has = set(adj["insee_a"]) | set(adj["insee_b"])
        alone = sorted(set(origins["insee"]) - has)
        return not alone, f"{len(adj)} couples contigus ; sans voisin : {alone[:5]}"
    check("P0", "chaque origine a au moins une commune contiguë", neighbours)

    # --- Matrices : lots TERMINÉS publiés par 06 (calcul complet + second calcul vélo + TC), lecture seule
    from starway.matrix_io import load_published
    from starway.sources import read_manifest

    sha = {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] in ("TRA01", "TRA01B", "CYC01", "VEL01")}
    published = {}

    def lots_ok() -> tuple[bool, str]:
        from starway import publication as pub
        from starway.origin_points import origin_points_sha256

        # ciel de access/ : les 44 astres, dossiers `_b44` (règles gtfs_navitia)
        sky_poles = access_sky_reference_poles()
        sky_ids = [p["id"] for p in sky_poles]
        inp = pub.sky_inputs("44", "gtfs_navitia")
        pts = origin_points_sha256(origins)
        ld = load_published(sky_ids, origins["insee"].tolist(), sha, main_dir=inp.main_dir,
                            story_dirs=list(inp.story_dirs), points_sha=pts)
        published.update(ld.matrices)
        problems = list(ld.problems)
        # D-024 : la matrice TC publiée est celle du réglage par défaut ; les autres réglages sont contrôlés sous
        # « transit@{id} » ; la matrice TC de matrix/ (limite cachée de R5) n'est plus publiée
        from starway.config import WALK_SETTING_DEFAULT
        from starway.matrix_io import load_velib, load_walk_setting

        for sid, lim in WALK_SETTINGS_M.items():
            walk_dir = inp.walk_dirs[lim]
            wl, wparams = load_walk_setting(walk_dir, sky_ids, origins["insee"].tolist(), sha, pts, lim)
            # D-040 : le 6h-14h publié vient du recalcul sur le réseau de nuit, s'il est complet
            from starway import night_network as nn
            wl, _info, _why = nn.apply_night_d06(wl, wparams, walk_dir, sky_ids, origins["insee"].tolist(), sha, pts, lim)
            problems += [f"{sid} : {x}" for x in wl.problems]
            for (_, day), m in wl.matrices.items():
                published[("transit" if sid == WALK_SETTING_DEFAULT else f"transit@{sid}", day)] = m
        vel, _ = load_velib(inp.velib_dir, sky_ids, sha)
        published.update(vel.matrices)
        cov = ", ".join(f"{m} {len(v)}" for m, v in sorted(ld.coverage.items())) or "aucun lot terminé"
        return not problems, (f"origines publiées : {cov} ; réglages de marche {sorted(WALK_SETTINGS_M)} ; "
                              f"velib {len(vel.coverage['velib'])}" + (f" ; problèmes : {problems[:3]}" if problems else ""))
    check("P0", "lots de la matrice : paramètres = sources, lots complets et conformes au découpage", lots_ok)
    for (mode, day), m in sorted(published.items()):

        def mat_ok(m: pd.DataFrame = m) -> tuple[bool, str]:
            null = m["out"].isna() | m["ret"].isna()
            no_reason = int((null & m["reason"].isna()).sum())
            bad_reason = sorted(set(m["reason"].dropna()) - set(REASONS))
            vals = pd.concat([m["out"].dropna(), m["ret"].dropna()])
            out_range = int(((vals < 0) | (vals > MAX_TRIP_MIN)).sum())
            complete = len(m) == m["from_id"].nunique() * len(access_sky_reference_poles())
            return (no_reason == 0 and not bad_reason and out_range == 0 and complete,
                    f"{len(m)} couples, nulls sans raison {no_reason}, raisons inconnues {bad_reason}, "
                    f"hors [0,{MAX_TRIP_MIN}] {out_range}")
        check("P0", f"matrice publiée {mode}_{day} : valeur ou raison pour chaque couple", mat_ok)

        def no_zero(m: pd.DataFrame = m) -> tuple[bool, str]:
            z = m[(m["out"] == 0) | (m["ret"] == 0)]
            return z.empty, f"{len(z)} couples à 0 min" + (f" : {z[['from_id', 'to_id']].values.tolist()[:5]}" if len(z) else "")
        check("P0", f"matrice publiée {mode}_{day} : aucun out/ret à 0 (pas de 0 de substitution)", no_zero)

        def monotone(m: pd.DataFrame = m) -> tuple[bool, str]:
            acc = {b: set(m[(m["out"] <= b) & (m["ret"] <= b)].index) for b in BUDGETS_MIN}
            ok = all(acc[a] <= acc[b] for a, b in zip(BUDGETS_MIN, BUDGETS_MIN[1:]))
            return ok, " ⊂ ".join(f"{b}:{len(acc[b])}" for b in BUDGETS_MIN)
        check("P0", f"matrice publiée {mode}_{day} : monotonie des budgets", monotone)

    # --- Contexte communal (05)
    cdir = INTERIM_DIR / "context"
    if cdir.exists():
        def context_ok() -> tuple[bool, str]:
            files = sorted(cdir.glob("*.json"))
            errs: list[str] = []
            statuses = {"ok", "to_compute", "secret", "small_sample", "not_available"}
            for f in files:
                c = json.loads(f.read_text(encoding="utf-8"))
                for key in ("population_sex", "population_age", "commute_mode_by_sex", "income", "cost"):
                    b = c[key]
                    if b.get("status") not in statuses:
                        errs.append(f"{c['insee']}.{key} statut {b.get('status')}")
                    if key != "cost" and key != "income" and not b.get("denominator"):
                        errs.append(f"{c['insee']}.{key} sans dénominateur")
                ps = c["population_sex"]
                if ps["status"] == "ok" and abs(sum(ps["shares"].values()) - 100) > 0.5:
                    errs.append(f"{c['insee']} parts sexe")
                pa = c["population_age"]
                if pa["status"] == "ok" and abs(sum(pa["shares"]) - 100) > 0.5:
                    errs.append(f"{c['insee']} parts âge")
                cm = c["commute_mode_by_sex"]
                for s in ("F", "H"):
                    vals = list(cm[s].values())
                    if cm["status"] == "ok" and abs(sum(vals) - 100) > 0.5:
                        errs.append(f"{c['insee']} parts modes {s}")
                    if cm["status"] != "ok" and any(v is not None for v in vals):
                        errs.append(f"{c['insee']} parts modes {s} publiées malgré {cm['status']}")
                inc = c["income"]
                for v, st in ((inc["median_living_standard_eur"], inc["median_status"]),
                              (inc["poverty_rate"], inc["poverty_rate_status"])):
                    if (v is None) == (st == "ok"):
                        errs.append(f"{c['insee']} revenu valeur/statut incohérents")
                co = c["cost"]
                if co["car_per_trip_eur"] is not None or co.get("car_status") != "not_computed" \
                        or not co.get("car_reason"):
                    errs.append(f"{c['insee']} coût voiture publié sans source (D-011)")
                # EMP02 : flux vers les pôles, règle INSEE « moins de 200 = ordre de grandeur » (sur la valeur estimée)
                fl = c.get("flows_to_poles")
                if fl is None:
                    errs.append(f"{c['insee']} sans flows_to_poles")
                    continue
                if fl["status"] not in statuses or not fl.get("denominator") or not fl.get("precision_rule"):
                    errs.append(f"{c['insee']} flows_to_poles statut/dénominateur/règle")
                # D-030 : context/ est commun aux deux ciels, `flows_to_poles.poles` porte les 44 astres puis les 15 pôles
                # (identifiants distincts) ; la part de chaque jeu de pôles est contrôlée à part (partitions de communes)
                ids44 = [p["id"] for p in json.loads(POLES_D030_JSON.read_text(encoding="utf-8"))]
                ids15 = [p["id"] for p in poles]
                if list(fl["poles"]) != ids44 + ids15:
                    errs.append(f"{c['insee']} flows_to_poles : pôles désalignés")
                tot = {"44": 0.0, "15": 0.0}
                for pid, e in fl["poles"].items():
                    f_, pr = e["flux"], e["precision"]
                    if f_ is None:
                        if pr != "no_flow_in_file" or e["share_pct"] is not None:
                            errs.append(f"{c['insee']}/{pid} flux nul sans statut")
                        continue
                    tot["44" if pid in ids44 else "15"] += e["share_pct"]
                    # flux arrondi : une estimation de 199,6 publiée 200 reste un ordre de grandeur
                    coherent = (pr == "ok" and f_ >= 200) or (pr == "order_of_magnitude" and 0 < f_ <= 200)
                    if not coherent:
                        errs.append(f"{c['insee']}/{pid} flux {f_} précision {pr}")
                if max(tot.values()) > 100.5:
                    errs.append(f"{c['insee']} flux vers les pôles > 100 % des actifs occupés")
            ok = len(files) == len(origins) and not errs
            return ok, f"{len(files)} fichiers ; " + ("; ".join(errs[:5]) or "parts = 100 % ± 0,5, statuts cohérents")
        check("P1", "contexte communal : statuts, dénominateurs, sommes des parts", context_ok)

    # --- Export front (s'il existe)
    if (FRONT_DATA_DIR / "meta.json").exists():
        def front_ok() -> tuple[bool, str]:
            meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
            fp = json.loads(access_sky_poles_file().read_text(encoding="utf-8"))
            ref_poles = access_sky_reference_poles()
            fc = json.loads((FRONT_DATA_DIR / "communes.json").read_text(encoding="utf-8"))
            fs = json.loads((FRONT_DATA_DIR / "sources.json").read_text(encoding="utf-8"))
            errs = []
            for k in ("processing_version", "service_date", "day_types", "budgets", "modes", "sources"):
                if k not in meta:
                    errs.append(f"meta.{k}")
            if "max_trip_min" in meta and meta["max_trip_min"] != MAX_TRIP_MIN:
                errs.append("meta.max_trip_min différent de la config")
            if "outbound_step_min" in meta and meta["outbound_step_min"] != OUTBOUND_STEP_MIN:
                errs.append("meta.outbound_step_min différent de la config")
            from starway.config import SPEED_CYCLING_KMH, SPEED_WALKING_KMH

            if meta.get("speeds") != {"walk_kmh": SPEED_WALKING_KMH, "bike_kmh": SPEED_CYCLING_KMH}:
                errs.append(f"meta.speeds {meta.get('speeds')} différent de la config")
            if not set(meta.get("story_communes", [])) <= set(origins["insee"]):
                errs.append("meta.story_communes hors origines")
            if not isinstance((meta.get("insights") or {}).get("excluded", []), list):
                errs.append("meta.insights.excluded n'est pas une liste")
            sky44 = (meta.get("access_sky") or {}).get("sky") == "44"
            rpp = INTERIM_DIR / ("matrix_modes_b44" if sky44 else "matrix") / "run_params.json"
            if meta.get("access_communes") and rpp.exists():
                rp = json.loads(rpp.read_text(encoding="utf-8"))
                want = f"{rp['service_date']}_{(rp.get('origin_points_sha256') or '')[:12]}"
                if meta.get("dataset_id") != want:
                    errs.append(f"meta.dataset_id {meta.get('dataset_id')} != {want} (run_params)")
            if [p["id"] for p in fp] != [p["id"] for p in ref_poles]:
                errs.append("poles.json désaligné")
            if len(fc) != len(origins):
                errs.append(f"communes.json {len(fc)}")
            if any("sha256" in s or "fichier_local" in s for s in fs):
                errs.append("sources.json expose sha256/fichier_local")
            from starway.matrix_io import required_days

            cov = meta.get("mode_coverage", {})
            all_ids = set(origins["insee"])
            access_set = set(meta.get("access_communes", []))
            for mode, ids in cov.items():
                if not set(ids) <= access_set:
                    errs.append(f"mode_coverage.{mode} hors access_communes")
            ws = meta.get("walk_settings") or {}
            var_ids = [x["key"] for x in ws.get("settings", []) if x.get("key")]
            for insee in meta.get("access_communes", []):
                a = json.loads((FRONT_DATA_DIR / "access" / f"{insee}.json").read_text(encoding="utf-8"))
                # variants.{id}.transit (D-024) : présents exactement pour les communes publiées en TC
                in_tc = "transit" in a["modes"]
                got = sorted(a.get("variants", {}))
                if got != (sorted(var_ids) if in_tc else []):
                    errs.append(f"{insee} : variants {got} != {sorted(var_ids) if in_tc else []}")
                for sid, vm in a.get("variants", {}).items():
                    if list(vm) != ["transit"] or set(vm["transit"]) != set(required_days("transit")):
                        errs.append(f"{insee}/variants.{sid} : modes ou journées")
                for mode_id, _ in MODES:
                    expected = insee in set(cov[mode_id]) if mode_id in cov else insee in all_ids
                    has = mode_id in a["modes"] and set(a["modes"][mode_id]) == set(required_days(mode_id))
                    if expected != has:
                        errs.append(f"{insee}/{mode_id} : publié={has}, couverture={expected}")
                series = [(m_, d_, v_) for m_, ds in a["modes"].items() for d_, v_ in ds.items()]
                series += [(f"transit@{sid}", d_, v_) for sid, vm in a.get("variants", {}).items()
                           for d_, v_ in vm.get("transit", {}).items()]
                for mode, day, v in series:
                    if not (len(v["out"]) == len(v["ret"]) == len(v["reason"]) == len(fp)):
                        errs.append(f"{insee}/{mode}/{day} longueur")
                    for o, r, rs in zip(v["out"], v["ret"], v["reason"]):
                        if (o is None or r is None) and not rs:
                            errs.append(f"{insee}/{mode}/{day} null sans raison")
                    # dep : départ aller retenu ; dep + aller <= début de la journée-type (arrivée avant)
                    if "dep" in v:
                        start = next(d["start"] for d in meta["day_types"] if d["id"] == day)
                        s_min = int(start[:2]) * 60 + int(start[3:])
                        if len(v["dep"]) != len(fp):
                            errs.append(f"{insee}/{mode}/{day} dep longueur")
                        for o, dp in zip(v["out"], v["dep"]):
                            if (o is None) != (dp is None):
                                errs.append(f"{insee}/{mode}/{day} dep sans aller (ou l'inverse)")
                            elif dp is not None and int(dp[:2]) * 60 + int(dp[3:]) + o > s_min:
                                errs.append(f"{insee}/{mode}/{day} dep {dp} + {o} min après {start}")
            return not errs, "; ".join(errs[:5]) or f"{len(meta.get('access_communes', []))} fichiers access"
        check("P0", "export front conforme aux contrats", front_ok)

        # D-029 : voiture avec trafic moyen DiRIF, véhicules et coût par trajet (jamais avec les anciennes distances)
        def car_d029_ok() -> tuple[bool, str]:
            from starway import congestion as cong
            from starway import vehicles as veh
            from starway.config import RAW_DIR
            from starway.sources import read_manifest, sha256_of

            meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
            errs: list[str] = []
            man = read_manifest()

            def row(sid: str, fname: str) -> dict:
                return next((r for r in man if r["source_id"] == sid and r["fichier_local"].endswith("/" + fname)), {})

            def same_file(sid: str, fname: str) -> None:
                r, f = row(sid, fname), RAW_DIR / sid / fname
                if not r:
                    errs.append(f"{sid}/{fname} absent du manifeste")
                elif f.exists() and sha256_of(f) != r["sha256"]:
                    errs.append(f"{sid}/{fname} : empreinte différente du manifeste")
            cc = meta.get("car_congestion")
            exported = cc is not None
            if not exported:  # avant le premier export D-029 : on contrôle le bloc que 06 va écrire
                cc = cong.meta_block(row("ROAD01", "barometre_mensuel_no41-_novembre_2025.pdf"))
            errs += [f"car_congestion : {x}" for x in cong.check_block(cc)]
            same_file("ROAD01", "barometre_mensuel_no41-_novembre_2025.pdf")
            if cc.get("sha256") != row("ROAD01", "barometre_mensuel_no41-_novembre_2025.pdf").get("sha256"):
                errs.append("car_congestion.sha256 différent du manifeste")
            ids = [m["id"] for m in meta.get("modes", [])]
            if exported and cong.MODE_ID not in ids or ids.index(cong.MODE_ID) != ids.index(cong.BASE_MODE) + 1:
                errs.append("mode car_traffic absent ou pas juste après car")
            if exported and (meta.get("mode_coverage") or {}).get(cong.MODE_ID) != (meta.get("mode_coverage") or {}).get(
                    cong.BASE_MODE):
                errs.append("couverture car_traffic différente de car")
            vs = {v["id"]: v for v in meta.get("vehicles", [])}
            if vs and not any("family" in v for v in vs.values()):
                # jeu publié avant le 04/11 (3 voitures sans carbone ni deux-roues) : 06 va écrire le nouveau bloc,
                # on ne compare pas l'ancien aux règles du nouveau
                vs = {}
                exported_vehicles = False
            else:
                exported_vehicles = exported
            if exported_vehicles and list(vs) != [v[0] for v in veh.VEHICLES]:
                errs.append(f"vehicles {list(vs)}")
            xlsx = RAW_DIR / "COST08" / "sdes_bilan_transports_2024_circulation.xlsx"
            csv = RAW_DIR / "COST07" / "prix-carburants-flux-instantane-v2.csv"
            bc = RAW_DIR / "ENV02" / veh.BASE_CARBONE_FILE
            same_file("COST08", xlsx.name)
            same_file("COST07", csv.name)
            same_file("COST06", "Grille_prix_Tarif_Bleu.pdf")
            same_file("ENV02", bc.name)
            same_file("VEH01", "2023-09_ademe-2rm-maj-connaissances-consommations-emissions-echappement.pdf")
            cons = veh.read_sdes_consumption(xlsx) if xlsx.exists() else {}
            tw = veh.read_2rm_consumption(PROCESSED_DIR / "ademe_2rm_conso_lecture.csv")
            co2 = veh.read_co2_factors(bc) if bc.exists() else {}
            idf = veh.read_fuel_prices(csv) if csv.exists() else None
            for vid, v in vs.items():
                want = cons.get(vid) if v.get("family", "car") == "car" else tw[vid]["value"]
                if want is not None and abs(v["consumption_per_100km"] - round(want, 4)) > 1e-9:
                    errs.append(f"{vid} : consommation différente de la source")
                if vid == "electric":
                    if v["price_eur_per_unit"] != veh.ELEC_PRICE_EUR_KWH:
                        errs.append("prix du kWh différent de la grille relue")
                elif idf is not None:
                    st = veh.fuel_stats(idf, veh.FUELS[veh.FUEL_OF[vid]][0])
                    if v["price_eur_per_unit"] != st["median"] or st["price_and_rupture"]:
                        errs.append(f"{vid} : médiane {st['median']} / rupture {st['price_and_rupture']}")
                if abs(v["cost_eur_per_km"] - v["consumption_per_100km"] / 100 * v["price_eur_per_unit"]) > 1e-5:
                    errs.append(f"{vid} : coût au km != consommation x prix")
                if co2:
                    f = co2[v["energy"]]["total"]
                    # Tolérance dérivée des arrondis publiés : consommation à 4 décimales (au plus 5e-5 L/100 km,
                    # soit 1,6e-6 kg/km avec le facteur le plus haut) et carbone au km à 6 décimales (5e-7)
                    if v.get("co2_kg_per_unit") != f or abs(v["co2_kg_per_km"] - v["consumption_per_100km"] / 100
                                                            * f) > 3e-6:
                        errs.append(f"{vid} : carbone au km != consommation x facteur ENV02")
                if not (v.get("consumption_source") or {}).get("source_id") or not (v.get("price_source") or {}).get(
                        "source_id") or (exported and not (v.get("co2_source") or {}).get("source_id")):
                    errs.append(f"{vid} : source manquante")
                if v.get("family") == "two_wheeler" and (v.get("toll_class") != 5 or not
                                                         (v.get("time") or {}).get("text", "")
                                                         or "décret" in (v.get("time") or {}).get("text", "").lower()):
                    errs.append(f"{vid} : classe 5 ou phrase sur le temps manquante")
            dist = (meta.get("car_costs") or {}).get("distances") or {}
            tolls_path = FRONT_DATA_DIR / "tolls.json"
            tj = json.loads(tolls_path.read_text(encoding="utf-8")) if tolls_path.exists() else None
            if tj is not None:
                import itertools

                from starway import toll_tariffs as tt

                if [x["id"] for x in tj["points"]] != [x.point_id for x in tt.POINTS]:
                    errs.append("tolls.json : points différents du registre")
                # accord de l'organisateur du 09/11/2026 (D-060) : le producteur est crédité à côté de chaque montant
                priced = {i for g in tj["grids"] if g.get("slots") for i in (g["e"], g["s"])}
                uncredited = [tj["points"][i]["id"] for i in sorted(priced) if not tj["points"][i].get("credit")]
                if uncredited:
                    errs.append(f"tolls.json : point tarifé sans crédit du producteur ({', '.join(uncredited[:5])})")
                for g in tj["grids"]:
                    if g.get("status") == tt.STATUT_INTERDIT:
                        continue
                    cuts = [(a_, b_) for a_, b_, _ in g["slots"]]
                    if cuts[0][0] != 0 or cuts[-1][1] != 1440 or any(x[1] != y[0] for x, y in itertools.pairwise(cuts)):
                        errs.append(f"tolls.json : grille {g['e']}>{g['s']} classe {g['c']} jour {g['d']} trouée")
                        break
                    if any(pr is None or pr <= 0 for _, _, pr in g["slots"]):
                        errs.append("tolls.json : prix nul ou absent")
                        break
            n_trip = 0
            for insee in meta.get("access_communes", []):
                a = json.loads((FRONT_DATA_DIR / "access" / f"{insee}.json").read_text(encoding="utf-8"))
                t = a.get("car_trip")
                if not t:
                    continue
                n_trip += 1
                if dist.get("status") != "ok" or not dist.get("car_speed_mps"):
                    errs.append(f"{insee} : car_trip publié sans distances corrigées (carSpeed)")
                    break
                if tj is None:
                    errs.append("car_trip publié sans tolls.json")
                    break
                for leg in ("out", "ret"):
                    for dm, rs, cell in zip(t["dist_m"][leg], t["reason"][leg], t["toll"][leg], strict=True):
                        if (dm is None) == (rs is None) or (dm is None) != (cell is None):
                            errs.append(f"{insee}/{leg} : distance, raison et péage incohérents")
                        if isinstance(cell, list) and any(not (0 <= i < len(tj["points"])) for c in cell for i in c):
                            errs.append(f"{insee}/{leg} : indice de péage hors registre")
                        if isinstance(cell, dict) and (cell.get("s") not in tj["status_texts"] or not cell.get("p")):
                            errs.append(f"{insee}/{leg} : statut de péage inconnu")
                    for vid, v in vs.items():  # coût et carbone = distance x consommation x prix (ou facteur)
                        for dm in t["dist_m"][leg]:
                            if dm is None:
                                continue
                            km_cons = dm / 1000 * v["consumption_per_100km"] / 100
                            eur = veh.round_eur(veh.energy_eur(dm, v))
                            g = veh.round_g(veh.co2_g(dm, v))
                            # écart d'arrondi du demi-centime (0,005, plus 1e-4 de marge flottante), plus celui du coût au km
                            # publié (6 décimales, consommation à 4 décimales : au plus 1,8e-6 € par km parcouru)
                            # écart d'arrondi du demi-gramme, plus celui du carbone au km publié (au plus 2,1e-6 kg/km :
                            # 5e-7 d'arrondi à 6 décimales et 1,6e-6 venant de la consommation à 4 décimales)
                            if abs(km_cons * v["price_eur_per_unit"] - eur) > 0.0051 + 2e-6 * dm / 1000 or (
                                    v.get("co2_kg_per_unit") is not None
                                    and abs(km_cons * v["co2_kg_per_unit"] * 1000 - g) > 0.51 + 2.1e-6 * dm):
                                errs.append(f"{insee}/{vid}/{leg} : coût ou carbone != distance x consommation")
                                break
            if n_trip and dist.get("status") != "ok":
                errs.append("car_trip publié alors que meta.car_costs.distances n'est pas ok")
            return not errs, "; ".join(errs[:5]) or (
                f"indices {[p['index'] for p in cc['periods']]}, {len(vs)} véhicules, car_trip dans {n_trip} fichiers "
                f"(distances : {dist.get('status')}, péages : {((meta.get('car_costs') or {}).get('tolls') or {}).get('status')})"
                + ("" if exported else " ; bloc D-029 pas encore exporté : sources et règle contrôlées sur le bloc que 06 "
                                       "va écrire"))
        check("P0", "voiture D-029 : trafic DiRIF conforme à la règle, véhicules sourcés (voitures et deux-roues), "
                    "coût et carbone = distance corrigée x consommation x prix (ou facteur ENV02), péages au registre, "
                    "producteur crédité à chaque point tarifé (D-060)",
              car_d029_ok)

        # D-024 : réglages de marche publiés tels que calculés, sans la raison de D-023 ; D-027 : bloc Vélib'
        def walk_settings_ok() -> tuple[bool, str]:
            from starway.config import (
                SPEED_WALKING_KMH,
                TRANSFER_WALK_LIMIT_M,
                VELIB_OUT_OF_ZONE,
                VELIB_WARNING,
                WALK_SETTING_DEFAULT,
            )
            from starway.r5jar import walk_time_limit_min

            meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
            errs: list[str] = []
            ws = meta.get("walk_settings") or {}
            if ws.get("default") != WALK_SETTING_DEFAULT or ws.get("transfer_limit_m") != TRANSFER_WALK_LIMIT_M \
                    or "choix de l'équipe" not in ws.get("nature", ""):
                errs.append("meta.walk_settings : défaut, correspondances ou nature")
            got = {x["id"]: (x["leg_limit_m"], x["max_time_walking_min"], x["key"]) for x in ws.get("settings", [])}
            want = {sid: (lim, walk_time_limit_min(lim, SPEED_WALKING_KMH), None if sid == WALK_SETTING_DEFAULT else sid)
                    for sid, lim in WALK_SETTINGS_M.items()}
            if got != want:
                errs.append(f"meta.walk_settings.settings {got} != {want}")
            if "walk_limit" in meta:
                errs.append("meta.walk_limit encore publié (D-023 remplacée par D-024)")
            vb = meta.get("velib") or {}
            if vb.get("warning") != VELIB_WARNING or vb.get("out_of_zone") != VELIB_OUT_OF_ZONE:
                errs.append("meta.velib : avertissement ou texte hors zone différent de la config (D-027)")
            cov_v = meta.get("mode_coverage", {}).get("velib")
            if ("velib", "any") in published and sorted(cov_v or []) != sorted(published[("velib", "any")]["from_id"].unique()):
                errs.append("mode_coverage.velib différent de la matrice Vélib'")
            sky_ids = [p_["id"] for p_ in access_sky_reference_poles()]  # pôles de access/ (44 astres ou 15 pôles)
            n_series = n_cmp = 0
            for insee in meta.get("access_communes", []):
                a = json.loads((FRONT_DATA_DIR / "access" / f"{insee}.json").read_text(encoding="utf-8"))
                series = [(m_, d_, v_) for m_, ds in a["modes"].items() for d_, v_ in ds.items()]
                series += [(f"transit@{sid}", d_, v_) for sid, vm in a.get("variants", {}).items()
                           for d_, v_ in vm.get("transit", {}).items()]
                for mode, day, v in series:
                    n_series += 1
                    if "walk_limit" in v or "no_stop_within_walk_limit" in v["reason"]:
                        errs.append(f"{insee}/{mode}/{day} : marque D-023 publiée")
                    m = published.get((mode, day))
                    if m is None or mode not in ("transit", "velib") and not mode.startswith("transit@"):
                        continue
                    sub = m[m["from_id"] == insee].set_index("to_id").reindex(sky_ids)
                    for leg in ("out", "ret"):
                        want_v = [None if pd.isna(x) else int(x) for x in sub[leg]]
                        if want_v != v[leg]:
                            errs.append(f"{insee}/{mode}/{day}/{leg} différent des lots")
                    n_cmp += 1
            return not errs, "; ".join(errs[:5]) or (f"{n_series} séries sans marque D-023 ; {n_cmp} séries TC (2 "
                                                      "réglages) et Vélib' identiques aux lots")
        check("P0", "réglages de marche D-024 et Vélib' D-027 : meta conforme, séries = lots, aucune marque D-023",
              walk_settings_ok)

    # --- Itinéraires TC détaillés D-028 (06h --publish), un jeu par réglage de marche publié (D-024) : annonce =
    # fichiers, contrat, matrice, tickets, carbone, faits par ligne (TRA03, QS01) ; puis marquage D-031 (c) de 06t
    from starway import itin_sets as iss

    def announced_communes(meta: dict, s: iss.ItinSet) -> list[str] | None:
        if s.is_default:
            return meta.get("itineraries_communes")
        return ((meta.get("itineraries_variants") or {}).get(s.walk_setting) or {}).get("communes")

    def announced_marks(meta: dict, s: iss.ItinSet) -> dict | None:
        if s.is_default:
            return meta.get("transfer_check")
        return ((meta.get("itineraries_variants") or {}).get(s.walk_setting) or {}).get("transfer_check")

    if (FRONT_DATA_DIR / "meta.json").exists():
        def itin_meta_ok() -> tuple[bool, str]:
            from starway import itin_meta

            meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
            want = itin_meta.build(FRONT_DATA_DIR)
            diff = [k for k in itin_meta.KEYS if meta.get(k) != want.get(k)]
            old = [s.dir_name for s in iss.all_sets() if list(s.out_dir.glob("*.json"))]
            sets = ", ".join(f"{s.dir_name} {len(iss.published_communes(s.out_dir))}" for s in iss.all_sets())
            return not diff and not old, (f"annonces = dossiers publiés ({sets})"
                                          + (f" ; clés différentes : {diff}" if diff else "")
                                          + (f" ; fichiers .json de l'ancien format dans {old}" if old else ""))
        check("P0", "itinéraires D-028 : annonces de meta.json (communes par réglage, marquage, format, faits par "
                    "ligne) = dossiers publiés", itin_meta_ok)

    for iset in iss.all_sets() if (FRONT_DATA_DIR / "meta.json").exists() else []:
        def itineraries_ok(s: iss.ItinSet = iset) -> tuple[bool, str]:
            from collections import Counter

            from starway import itin_export as ie
            from starway import itineraries as it
            from starway.config import DAY_TYPES

            meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
            listed = announced_communes(meta, s)
            files = iss.published_communes(s.out_dir)
            if listed is None:
                return not files, (f"{s.dir_name} : aucun itinéraire annoncé" if not files
                                   else f"{len(files)} fichiers dans {s.dir_name}/ sans annonce dans meta.json")
            errs: list[str] = []
            if sorted(listed) != files or len(set(listed)) != len(listed):
                errs.append(f"communes annoncées ({len(listed)}) différentes des fichiers ({len(files)})")
            pole_ids = [p["id"] for p in json.loads(access_sky_poles_file().read_text(encoding="utf-8"))]
            days = [d.id for d in DAY_TYPES]
            computed = set(meta.get("access_communes", []))
            cov_t = (meta.get("mode_coverage") or {}).get("transit")  # absent = TC publié partout
            st: Counter[str] = Counter()
            for insee in files:
                if insee not in computed or (cov_t is not None and insee not in cov_t):
                    errs.append(f"{insee} : itinéraire publié sans matrice TC publiée")
                    continue
                doc = iss.read_doc(iss.doc_path(s.out_dir, insee))
                acc = json.loads((FRONT_DATA_DIR / "access" / f"{insee}.json").read_text(encoding="utf-8"))
                same = (doc.get("insee"), doc.get("service_date"), doc.get("walk_setting"))
                if same != (insee, meta.get("service_date"), s.walk_setting):
                    errs.append(f"{insee} : insee, date de service ou réglage de marche différent")
                errs += ie.check_file(doc, MAX_TRIP_MIN)
                errs += ie.check_against_access(doc, acc, pole_ids, days, s)
                for dirs in doc["days"].values():
                    for row in dirs.values():
                        for t in row:
                            st[t["status"]] += 1
                            if t["status"] == it.STATUS_OK:
                                st["tickets_" + t["tickets"]["status"]] += 1
                                st["co2_" + t["co2_g"]["status"]] += 1
            return not errs, (f"{s.dir_name} : {len(files)} communes, statuts {dict(st)}"
                              + (f" ; incohérences ({len(errs)}) : {errs[:5]}" if errs else ""))
        check("P0", f"itinéraires D-028 ({iset.walk_setting}) : annonce = fichiers, communes complètes, = matrice "
                    "publiée, tickets, carbone", itineraries_ok)

        def line_facts_ok(s: iss.ItinSet = iset) -> tuple[bool, str]:
            from collections import Counter

            from starway import line_facts as lf
            from starway.config import RAW_DIR

            files = iss.published_communes(s.out_dir)
            if not files:
                return True, f"{s.dir_name} : aucun itinéraire publié"
            facts = lf.from_files(RAW_DIR / "TRA03" / "referentiel-des-lignes.csv",
                                  RAW_DIR / "QS01" / "ponctualite-mensuelle-transilien.csv")
            sources = json.loads((FRONT_DATA_DIR / "sources.json").read_text(encoding="utf-8"))
            src_ids = {x["source_id"] for x in sources}
            errs = [f"{c} absent de sources.json" for c in (lf.SOURCE_AC, lf.SOURCE_PUNCTUALITY) if c not in src_ids]
            n: Counter[str] = Counter()
            for insee in files:
                doc = iss.read_doc(iss.doc_path(s.out_dir, insee))
                block = doc.get("line_facts_meta")
                if block is None:
                    errs.append(f"{insee} : line_facts_meta absent")
                    continue
                if block.get("punctuality_month") != facts.month:
                    errs.append(f"{insee} : mois {block.get('punctuality_month')} != QS01 {facts.month}")
                for dirs in doc["days"].values():
                    for row in dirs.values():
                        for t in row:
                            for lg in t.get("legs") or []:
                                if lg["m"] == "walk":
                                    continue
                                n["legs"] += 1
                                n[f"ac_{lg.get('air_conditioning')}"] += 1
                                p = lg.get("punctuality") or {}
                                want = lf.punctuality_value(facts, lg["m"], lg.get("line"))
                                if p.get("value_pct") != want:
                                    errs.append(f"{insee} {lg['m']} {lg.get('line')} : ponctualité "
                                                f"{p.get('value_pct')} != QS01 {want}")
                                n["punct_value" if p.get("value_pct") is not None else f"punct_{p.get('reason')}"] += 1
            legs = max(1, n["legs"])
            told = n["legs"] - n["ac_None"] - n["ac_unknown"]
            return not errs, (f"{s.dir_name} : {n['legs']} tronçons en TC ; climatisation renseignée (oui, partielle "
                              f"ou non) {told} ({told / legs:.1%}) ; ponctualité {n['punct_value']} "
                              f"({n['punct_value'] / legs:.1%}, {facts.month}) ; détail {dict(sorted(n.items()))}"
                              + (f" ; incohérences ({len(errs)}) : {errs[:5]}" if errs else ""))
        check("P0", f"itinéraires ({iset.walk_setting}) : climatisation (TRA03) et ponctualité (QS01) par ligne = "
                    "sources, mois publié", line_facts_ok)

        # --- D-031 (c) : marquage des correspondances trop courtes (06t), refait ici depuis les sorties de 07h
        def transfer_marks_ok(s: iss.ItinSet = iset) -> tuple[bool, str]:
            from collections import Counter

            from starway import transfer_marks as tm
            from starway import transfer_times as tx

            meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
            docs = dict(iss.iter_docs(s.out_dir))
            marked = [i for i, d in docs.items() if "transfer_check_meta" in d]
            announced = announced_marks(meta, s)
            if not marked and announced is None:
                return True, f"{s.dir_name} : aucun marquage publié (voir le contrôle P1 suivant)"
            errs: list[str] = []
            if len(marked) != len(docs):
                errs.append(f"{len(marked)} fichiers marqués sur {len(docs)}")
            if announced != tm.published_meta(docs.values()):
                errs.append("annonce du marquage différente du bloc des fichiers")
            if errs:
                return False, " ; ".join(errs)
            rule = announced["rule"]
            summary = json.loads(s.summary.read_text(encoding="utf-8"))
            if summary["generated_at"] != announced["checked_at"]:
                return False, (f"marquage du contrôle 07h du {announced['checked_at']}, résumé du "
                               f"{summary['generated_at']} : relancer 06t")
            if summary.get("walk_setting", "normal") != s.walk_setting:
                return False, f"résumé 07h du réglage {summary.get('walk_setting')}"
            by_trip, rows = tm.load_check_outputs(s.trips_csv, s.transfers_csv, s.short_csv, rule)
            from starway import flux as flux_mod

            gmin, nmin = tm.load_minimum_sources(flux_mod.gtfs_path("TRA01"),
                                                 PROCESSED_DIR / "navitia_connections.csv")
            sources = json.loads((FRONT_DATA_DIR / "sources.json").read_text(encoding="utf-8"))
            if not set(announced["sources"]) <= {x["source_id"] for x in sources}:
                errs.append(f"sources {announced['sources']} absentes de sources.json")
            budgets = sorted(int(b) for b in meta["budgets"])
            st: Counter = Counter()
            n_short = 0
            lit: Counter = Counter()
            risk: Counter = Counter()
            for insee, doc in docs.items():
                if doc.get("contract") != tm.CONTRACT_VERSION:
                    errs.append(f"{insee} : contrat {doc.get('contract')}")
                got: dict[tuple[str, str, str], dict] = {}
                for pid, d, direction, trip in tm.iter_marked_trips(doc):
                    k = (insee, pid, d, direction)
                    mk = trip.get("transfer_check")
                    e = tm.mark_errors(mk)
                    info = by_trip.get(k)
                    if info is None:
                        e.append("absent du contrôle 07h")
                    else:
                        r = rows.get(k, [])
                        e += tm.alignment_errors(trip, r, info["itinerary_min"], info["matrix_min"], info["n_transfers"])
                        e += tm.source_errors(r, rule, gmin, nmin)
                        if not e and mk != tm.trip_mark(r, rule, info["bound_min"], info["bound_method"]):
                            e.append("marque différente du contrôle 07h")
                    errs += [f"{insee} {pid} {d} {direction} : {x}" for x in e]
                    if isinstance(mk, dict):
                        got[(pid, d, direction)] = mk
                        st[mk.get("status")] += 1
                        n_short += len(mk.get("short") or [])
                acc = json.loads((FRONT_DATA_DIR / "access" / f"{insee}.json").read_text(encoding="utf-8"))
                for d, ser in (iss.transit_series(acc, s) or {}).items():
                    for i, pid in enumerate(doc["poles"]):
                        o, r_ = ser["out"][i], ser["ret"][i]
                        for b in budgets:
                            if tx.verdict(o, r_, b):
                                lit[(d, b)] += 1
                                risk[(d, b)] += tm.verdict_at_risk(o, r_, got.get((pid, d, "out")),
                                                                   got.get((pid, d, "ret")), b)
            if dict(st) != summary["trip_status"][rule]:
                errs.append(f"statuts {dict(st)} != résumé 07h {summary['trip_status'][rule]}")
            if n_short != summary[f"transfer_status_{rule}"].get(tx.SHORT, 0):
                errs.append(f"{n_short} correspondances trop courtes publiées != résumé 07h")
            for d, v in summary["by_day"][rule].items():
                for b, x in v["verdicts"].items():
                    if (lit[(d, int(b))], risk[(d, int(b))]) != (x["lit"], x["at_risk"]):
                        errs.append(f"{d} {b} min : {risk[(d, int(b))]}/{lit[(d, int(b))]} à risque recomptés, "
                                    f"{x['at_risk']}/{x['lit']} pour 07h")
            days = sorted({d for d, _ in lit})
            per_day = ", ".join(f"{d} " + "/".join(f"{risk[(d, b)]}:{lit[(d, b)]}" for b in budgets) for d in days)
            return not errs, (f"{s.dir_name}, règle {rule}, {sum(st.values())} trajets {dict(st)}, {n_short} "
                              f"correspondances trop courtes ; à risque / allumés {per_day}"
                              + (f" ; incohérences ({len(errs)}) : {errs[:5]}" if errs else ""))
        check("P0", f"correspondances D-031 (c) ({iset.walk_setting}) : marquage = contrôle 07h, chaque minimum "
                    "sourcé, verdicts à risque", transfer_marks_ok)

        def transfer_marks_present(s: iss.ItinSet = iset) -> tuple[bool, str]:
            meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
            if not iss.published_communes(s.out_dir):
                return True, f"{s.dir_name} : aucun itinéraire publié"
            tc = announced_marks(meta, s)
            return tc is not None, (f"{s.dir_name} : règle {tc['rule']}, contrôle 07h du {tc['checked_at']}" if tc
                                    else f"{s.dir_name} publié sans marquage des correspondances : lancer 07h puis "
                                         f"06t --walk-setting {s.walk_setting}")
        check("P1", f"correspondances D-031 (c) ({iset.walk_setting}) : itinéraires publiés marqués",
              transfer_marks_present)

        # --- « Mes besoins » (06n) : accessibilité déclarée par ligne et par gare, recopiée des sources
        def needs_ok(s: iss.ItinSet = iset) -> tuple[bool, str]:
            from collections import Counter

            from starway import needs as nd
            from starway.config import RAW_DIR

            meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
            docs = [d for _, d in iss.iter_docs(s.out_dir)]
            if not docs:
                return True, f"{s.dir_name} : aucun itinéraire publié"
            announced = meta.get("needs")
            applied = [d for d in docs if "needs_meta" in d]
            if not applied and announced is None:
                return True, f"{s.dir_name} : réglage non appliqué (voir le contrôle P1 suivant)"
            errs: list[str] = []
            if len(applied) != len(docs):
                errs.append(f"{len(applied)} fichiers avec needs_meta sur {len(docs)}")
            elif announced != nd.published_from_docs(docs, RAW_DIR / "TRA04" / "accessibilite-en-gare.csv"):
                errs.append("meta.needs différent du bloc des fichiers")
            src_ids = {s["source_id"] for s in json.loads((FRONT_DATA_DIR / "sources.json").read_text(encoding="utf-8"))}
            if announced and not set(announced["sources"]) <= src_ids:
                errs.append(f"sources {announced['sources']} absentes de sources.json")
            text = json.dumps(announced, ensure_ascii=False) if announced else ""
            if chr(0x2014) in text or chr(0x2013) in text:
                errs.append("tiret long dans meta.needs")
            lines = nd.load_lines(pd.read_csv(RAW_DIR / "TRA03" / "referentiel-des-lignes.csv", sep=";", encoding="utf-8-sig",
                                              dtype=str))
            known = {tuple(v) for v in lines.values()}
            st: Counter[str] = Counter()
            for doc in docs:
                for dirs in doc["days"].values():
                    for row in dirs.values():
                        for t in row:
                            if t.get("status") != "ok":
                                continue
                            for lg in t["legs"]:
                                errs += [f"{doc['insee']} : {e}" for e in nd.a11y_errors(lg, "needs_meta" in doc)]
                                a = lg.get("a11y")
                                if a and a["line"] is not None and (a["line"], a["audio"], a["visual"]) not in known:
                                    errs.append(f"{doc['insee']} : triplet {a['line'], a['audio'], a['visual']} "
                                                "absent du référentiel des lignes")
                                if a:
                                    st["legs"] += 1
                                    st["line_" + str(a["line"])] += 1
            return not errs, (f"{len(docs)} fichiers, {st['legs']} tronçons en TC, accessibilité de la ligne "
                              f"{ {k[5:]: v for k, v in sorted(st.items()) if k.startswith('line_')} }"
                              + (f" ; incohérences ({len(errs)}) : {errs[:5]}" if errs else ""))
        check("P0", f"Mes besoins ({iset.walk_setting}) : a11y recopié des sources (TRA03, TRA04), valeurs permises, "
                    "meta.needs = fichiers", needs_ok)

        def needs_present(s: iss.ItinSet = iset) -> tuple[bool, str]:
            meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
            docs = [d for _, d in iss.iter_docs(s.out_dir)]
            ok = "needs" in meta and all("needs_meta" in d for d in docs)
            return ok, (f"{s.dir_name} : réglage « Mes besoins » appliqué aux itinéraires publiés" if ok
                        else f"{s.dir_name} : itinéraires publiés sans accessibilité déclarée : lancer 06n")
        check("P1", f"Mes besoins ({iset.walk_setting}) : itinéraires publiés avec accessibilité déclarée", needs_present)

    if (FRONT_DATA_DIR / "meta.json").exists():
        def site_volume() -> tuple[bool, str]:
            # limites du plan Free (Microsoft Learn, 03/11/2026), publiées par 06d dans l'index de la table OD
            idx = next((json.loads((FRONT_DATA_DIR / d / "index.json").read_text(encoding="utf-8"))
                        for d in ("od_walk3000", "od", "od_walk1000") if (FRONT_DATA_DIR / d / "index.json").exists()),
                       None)
            if idx is None:
                return False, "limites du plan Free introuvables (aucun index de table OD publié)"
            lim = idx["volume"]["swa_free_limit"]
            site = [f for f in FRONT_DATA_DIR.parent.rglob("*") if f.is_file()]
            size = sum(f.stat().st_size for f in site)
            return size <= lim["bytes"] and len(site) <= lim["files"], (
                f"frontend/public : {size / 1e6:.0f} Mo, {len(site)} fichiers (limite {lim['bytes'] / 1e6:.0f} Mo, "
                f"{lim['files']} fichiers ; build compris : mesurer frontend/dist)")
        check("P1", "volume de frontend/public sous la limite du plan Free de Static Web Apps", site_volume)

    # --- Carte miroir (06b, si exportée) : géométrie de rendu, contrôles de cohérence avec les données
    geo_dir = FRONT_DATA_DIR / "geo"
    if (geo_dir / "communes.geojson").exists():
        def geo_ok() -> tuple[bool, str]:
            from shapely.geometry import shape

            from starway.config import GEO_MAX_COMMUNES_KB

            fc = json.loads((geo_dir / "communes.geojson").read_text(encoding="utf-8"))
            errs = []
            codes = [f["properties"]["insee"] for f in fc["features"]]
            if sorted(codes) != sorted(origins["insee"]) or len(set(codes)) != len(codes):
                errs.append(f"communes.geojson : {len(codes)} codes, différents des {len(origins)} origines")
            geoms = [shape(f["geometry"]) for f in fc["features"]]
            if not all(g.is_valid and not g.is_empty for g in geoms):
                errs.append("contour invalide ou vide")
            if any(g.geom_type == "Polygon" and g.exterior.is_ccw for g in geoms):
                errs.append("anneau extérieur antihoraire (d3-geo attend le sens horaire)")
            kb = (geo_dir / "communes.geojson").stat().st_size / 1024
            if kb > GEO_MAX_COMMUNES_KB:
                errs.append(f"communes.geojson {kb:.0f} Ko > {GEO_MAX_COMMUNES_KB}")
            return not errs, "; ".join(errs[:5]) or f"{len(codes)} contours ({kb:.0f} Ko)"
        check("P1", "carte miroir : contours = origines (astres contrôlés par le bloc D-030)", geo_ok)

    # --- Découvertes : seulement les types autorisés par la couverture (meta.insights), jamais de classement partiel
    if (FRONT_DATA_DIR / "meta.json").exists():
        def insights_ok() -> tuple[bool, str]:
            meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
            info = meta.get("insights")
            if not info:  # export antérieur à ce contrat : 06 l'écrira ; on vérifie seulement l'absence de fichier
                legacy = (FRONT_DATA_DIR / "insights.json").exists()
                return not legacy, "meta.insights absent (export précédent)" + (" et insights.json présent" if legacy else "")
            ok_kinds = {k for k, v in info["kinds"].items() if v["status"] == "ok"}
            if info.get("basis") == "od_astres":  # 44 astres : découvertes sur la table commune x commune (08e, D-041)
                from starway import insights_astres as ia

                p_ins = FRONT_DATA_DIR / "insights.json"
                items = json.loads(p_ins.read_text(encoding="utf-8")) if p_ins.exists() else []
                od_index = FRONT_DATA_DIR / "od_walk3000" / "index.json"
                codes = json.loads(od_index.read_text(encoding="utf-8"))["communes"] if od_index.exists() else []
                bad44 = ia.check_published(info, items, BUDGETS_MIN, codes)
                return not bad44, (f"{len(items)} découvertes sur la table commune x commune (44 astres), types "
                                   f"autorisés {sorted(ok_kinds) or 'aucun'}"
                                   + (f" ; incohérences : {bad44[:5]}" if bad44 else ""))
            bad = [k for k, v in info["kinds"].items() if v["status"] != "ok" and not v.get("reason")]
            path = FRONT_DATA_DIR / "insights.json"
            ins = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
            if info["written"] != path.exists():
                bad.append("meta.insights.written incohérent")
            computed = set(meta.get("access_communes", []))
            bad += [x["id"] for x in ins
                    if x["kind"] not in ok_kinds or x["scenario"]["o"] not in computed
                    or x["scenario"]["b"] not in BUDGETS_MIN or x["metric"]["jobs_delta"] == 0
                    or not isinstance(x["robust"], bool)]
            # D-024 : plus de retour « non mesuré » ; la liste des écartées doit être une liste (contrat)
            n_excl = len(info.get("excluded", []))
            if not isinstance(info.get("excluded", []), list):
                bad.append("meta.insights.excluded n'est pas une liste")
            return not bad, (f"{len(ins)} découvertes, types autorisés {sorted(ok_kinds) or 'aucun'}, "
                             f"{n_excl} écartées"
                             + (f" ; incohérences : {bad[:5]}" if bad else ""))
        check("P0", "insights.json : types autorisés par la couverture, scénarios calculés, écarts non nuls",
              insights_ok)

        # Recoupement Navitia (07d) : aucune découverte publiée n'est contredite, statut publié = statut recalculé
        stale: list[str] = []  # export à refaire (06) après un recoupement plus récent : P1

        def crosscheck_ok() -> tuple[bool, str]:
            from starway.navitia import CROSSCHECK_STATUSES, insight_scenario_key, published_crosscheck

            meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
            info = (meta.get("insights") or {}).get("crosscheck")
            path = FRONT_DATA_DIR / "insights.json"
            ins = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
            if (meta.get("insights") or {}).get("basis") == "od_astres":
                # 44 astres : pas de recoupement Navitia sur ces scénarios (PRIM). Aucune « contredite » publiée ;
                # `not_checked` est le statut honnête, le contrôle P1 ci-dessous le signale à refaire.
                bad_c = [x["id"] for x in ins if x.get("crosscheck") not in ("not_checked", "confirmed", "within_one_minute")]
                return not bad_c, f"44 astres : recoupement à refaire, statuts non valides : {bad_c[:5]}" if bad_c else \
                    f"44 astres : {len(ins)} découvertes, aucune contredite (recoupement Navitia des 44 astres à refaire)"
            if not info:
                return not ins, "meta.insights.crosscheck absent" + (" alors que insights.json existe" if ins else "")
            summ_path = REPO_ROOT / info["file"]
            if not summ_path.exists():
                return False, f"fichier de recoupement absent : {info['file']}"
            summ = json.loads(summ_path.read_text(encoding="utf-8"))
            checks = {insight_scenario_key(c): c for c in summ.get("insight_checks", [])}
            pole_ids = [p["id"] for p in json.loads(access_sky_poles_file().read_text(encoding="utf-8"))]
            pjobs = [int(p["jobs"]) for p in json.loads(access_sky_poles_file().read_text(encoding="utf-8"))]
            cache: dict[str, dict] = {}

            def series_of(insee: str, mode: str, day: str):
                if insee not in cache:
                    f = FRONT_DATA_DIR / "access" / f"{insee}.json"
                    cache[insee] = json.loads(f.read_text(encoding="utf-8"))["modes"] if f.exists() else {}
                return (cache[insee].get(mode) or {}).get(day)

            # P0 : publiée contredite, ou statut « recoupé » publié sans recoupement qui le fonde. Une publiée
            # `not_checked` que 07d a recoupée depuis (export à refaire) n'est pas bloquante : contrôle P1 ci-dessous.
            bad = []
            stale.clear()
            for x in ins:
                st = x.get("crosscheck")
                now = published_crosscheck(x, checks, series_of, pole_ids, pjobs)[0]
                if st not in CROSSCHECK_STATUSES or st == "contradicted" or now == "contradicted":
                    bad.append(f"{x['id']} crosscheck={st}, recoupement : {now}")
                elif st != "not_checked" and now != st:
                    bad.append(f"{x['id']} statut publié {st} différent du recoupement ({now})")
                elif st == "not_checked" and now != st:
                    stale.append(f"{x['id']} recoupée depuis l'export ({now})")
            for e in (meta.get("insights") or {}).get("excluded", []):
                if e.get("cause") == "navitia_contradicted":
                    if e.get("crosscheck_file") != info["file"]:
                        bad.append(f"{e['would_be_id']} écartée sans référence au recoupement")
                    elif published_crosscheck(e, checks, series_of, pole_ids, pjobs)[0] != "contradicted":
                        stale.append(f"{e['would_be_id']} écartée mais plus contredite par {info['file']}")
            counts = pd.Series([x.get("crosscheck") for x in ins]).value_counts().to_dict() if ins else {}
            return not bad, (f"{info['file']} ; publiées : {counts}" + (f" ; incohérences : {bad[:5]}" if bad else ""))
        check("P0", "découvertes : aucune contredite par Navitia, statut `crosscheck` fondé", crosscheck_ok)

        def crosscheck_complete() -> tuple[bool, str]:
            path = FRONT_DATA_DIR / "insights.json"
            ins = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
            todo = [x["id"] for x in ins if x.get("crosscheck", "not_checked") == "not_checked"]
            return not (todo or stale), (f"{len(ins) - len(todo)} sur {len(ins)} découvertes recoupées"
                                         + (f" ; à recouper (07d --groups insight puis 06) : {todo[:8]}" if todo else "")
                                         + (f" ; export à refaire (06) : {stale[:5]}" if stale else ""))
        check("P1", "découvertes : toutes recoupées avec Navitia", crosscheck_complete)

    # --- Table OD D-019 (proposée, 06d) : export complet (frontend/public/data/od) ou partiel (data/interim)
    od_outs = [FRONT_DATA_DIR / "od", INTERIM_DIR / "od_export_partial"]
    for lim in sorted(WALK_SETTINGS_M.values()):  # variantes de marche D-024 (06d --walk-setting)
        od_outs += [FRONT_DATA_DIR / f"od_walk{lim}", INTERIM_DIR / f"od_export_partial_walk{lim}"]
    poles_44 = json.loads(POLES_D030_JSON.read_text(encoding="utf-8"))
    for od_out in od_outs:
        if (od_out / "index.json").exists():
            # table publiée : index des 44 astres ; exports partiels de data/interim : pôles de leur calcul
            check_od_export(od_out, origins["insee"].tolist(), jobs, poles_44 if od_out.parent == FRONT_DATA_DIR else poles)

    # --- Aperçu D-030 (44 astres), publié à côté du jeu en ligne tant que le front ne lit pas le nouveau format
    if (PREVIEW_D030_DIR / "poles.json").exists():
        check_d030_preview(origins, jobs, d030_ctx)

    # --- Péages (04j) : points de péage et tarifs officiels classes 1 et 5
    if (PROCESSED_DIR / "toll_tariffs.csv").exists():
        check_tolls()
    if (INTERIM_DIR / "car_dist_carspeed" / "batches").exists() and (
            INTERIM_DIR / "car_dist_carspeed_v2" / "batches").exists():
        check_car_dist_rerun()

    # --- Flux GTFS : empreintes complètes au manifeste, aucune ligne sans service le 17/11 sans justification (flux du 06/11)
    check_flux_gtfs()

    # --- Réseau de nuit D-040 (GTFS de nuit, dossiers « nuit »)
    check_night_network()

    # --- Référentiel des sources (06r) : dossiers de data/raw, codes publiés, docs/sources.md à jour
    check_sources_registry()

    # --- Traçabilité (06u, docs/tracabilite.md) : chaque bloc affiché a sa ligne, sources au manifeste, sha256 = fichiers
    check_traceability()

    # --- Offres diffusées sur Choisir le service public (06q, D-036) : comptes, clés de commune, vocabulaire, empreinte
    if (FRONT_DATA_DIR / "service_public.json").exists():
        check_service_public()

    # --- Repères de territoire (06v, lot T1) : chômage, temps de travail, polarités ; valeurs = fichiers bruts
    if (FRONT_DATA_DIR / "territoire.json").exists():
        check_territoire()

    # --- Trajets alternatifs (06w, D-055) : couverture et fichiers
    if (FRONT_DATA_DIR / "alternatives" / "coverage.json").exists():
        check_alternatives()
    # --- Même contrôle au réglage de marche « confort » (phase G, 06w --walk-setting comfort), si le dossier est publié
    if (FRONT_DATA_DIR / "alternatives_comfort" / "coverage.json").exists():
        check_alternatives(FRONT_DATA_DIR / "alternatives_comfort", walk_setting="comfort")

    # --- Abonnements (06i, D-032 proposée) : citations dans les fichiers gardés, couverture sourcée, courses Vélib'
    if (FRONT_DATA_DIR / "subscriptions.json").exists():
        def subscriptions_ok() -> tuple[bool, str]:
            from starway.sources import sha256_of
            from starway.config import RAW_DIR
            from starway.subscription_catalog import published_problems
            pub = json.loads((FRONT_DATA_DIR / "subscriptions.json").read_text(encoding="utf-8"))
            pids = [x["id"] for x in json.loads(access_sky_poles_file().read_text(encoding="utf-8"))]
            vel = {}
            for f in sorted((FRONT_DATA_DIR / "access").glob("*.json")):
                a = (json.loads(f.read_text(encoding="utf-8")).get("modes") or {}).get("velib")
                if a:
                    vel[f.stem] = a["any"]
            bad = published_problems(pub, RAW_DIR, sha256_of, pids, vel)
            n = len(pub["transit"]["options"])
            return not bad, f"{n} abonnements TC, {len(pub['velib']['offers'])} offres Vélib', {len(vel)} communes Vélib'" + (
                f" ; écarts : {bad[:5]}" if bad else "")
        check("P0", "abonnements D-032 : citations retrouvées, couverture et prix sourcés, courses Vélib' = access/",
              subscriptions_ok)

    # --- Projets de recrutement BMO (06j, D-035) : fichiers publiés = recalcul sur le classeur, totaux, astres rattachés
    if (FRONT_DATA_DIR / "bmo.json").exists():
        def bmo_ok() -> tuple[bool, str]:
            from starway import bmo
            from starway.config import manifest_rel
            from starway.sources import read_manifest, sha256_of
            errs = bmo.verify_official()
            rows = {r["fichier_local"]: r["sha256"] for r in read_manifest() if r["source_id"] == "EMP03"}
            for path in (bmo.BMO_XLSX, bmo.OFFICIAL_PDF):
                rel = manifest_rel(path)
                if rows.get(rel) != sha256_of(path):
                    errs.append(f"{rel} : empreinte différente du manifeste (ou ligne absente)")
            doc = json.loads((FRONT_DATA_DIR / "bmo.json").read_text(encoding="utf-8"))
            detail = json.loads((FRONT_DATA_DIR / "bmo_metiers.json").read_text(encoding="utf-8"))
            df = bmo.read_bmo()
            evidence = bmo.mask_evidence()
            errs += bmo.check_main(doc, df, evidence) + bmo.check_detail(detail, doc)
            if int(df["met"].dropna().min()) < 1:
                errs.append("valeur publiée à 0 dans le classeur")
            for name in ("poles.json",):
                p = FRONT_DATA_DIR / name
                if p.exists():
                    errs += bmo.check_poles(json.loads(p.read_text(encoding="utf-8")), doc, name)
            reg = doc["region"]["published"]["met"]
            return not errs, (f"{len(doc['bassins'])} bassins, {len(detail['metiers'])} métiers, {reg['n']} projets publiés "
                              f"+ {reg['masked']} cases « * » non comptées, total officiel {doc['region']['official']['projects']}"
                              + (f" ; écarts : {errs[:5]}" if errs else ""))
        check("P0", "projets de recrutement BMO D-035 : = recalcul sur le classeur, totaux, astres rattachés, empreintes",
              bmo_ok)

    # --- Typographie (CLAUDE.md, règle 8) : aucun tiret cadratin U+2014 ni demi-cadratin U+2013
    def no_long_dashes() -> tuple[bool, str]:
        banned = (chr(0x2014), chr(0x2013))  # tiret cadratin, tiret demi-cadratin
        targets = [MANIFEST_PATH, PROCESSED_DIR / "poles.json"]
        for d in (FRONT_DATA_DIR, INTERIM_DIR / "context", INTERIM_DIR / "access"):
            if d.exists():
                targets += sorted(d.rglob("*.json"))
        bad = [str(f.relative_to(REPO_ROOT)) for f in targets
               if f.exists() and any(ch in f.read_text(encoding="utf-8") for ch in banned)]
        return not bad, f"{len(targets)} fichiers analysés" + (f" ; en défaut : {bad[:5]}" if bad else "")
    check("P0", "aucun tiret cadratin ni demi-cadratin dans les fichiers exportés", no_long_dashes)

    def dashes_in(paths: list, suffixes: set[str]) -> tuple[bool, str]:
        banned = (chr(0x2014), chr(0x2013))
        files = []
        for root in paths:
            if root.is_file():
                files.append(root)
            elif root.exists():
                files += [f for f in root.rglob("*") if f.is_file() and f.suffix in suffixes
                          and not {".venv", "node_modules", "__pycache__", "dist"} & set(f.parts)]
        bad = [str(f.relative_to(REPO_ROOT)) for f in files
               if any(ch in f.read_text(encoding="utf-8", errors="ignore") for ch in banned)]
        return not bad, f"{len(files)} fichiers" + (f" ; en défaut : {bad[:6]}" if bad else "")
    src = {".py", ".md", ".toml", ".csv", ".json", ".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".txt", ".yml", ".yaml"}
    check("P0", "aucun tiret long dans le code et la doc du pipeline (pipeline/, docs/, README.md)",
          lambda: dashes_in([REPO_ROOT / "pipeline", REPO_ROOT / "docs", REPO_ROOT / "README.md"], src))
    # frontend/src appartient à l'agent front : signalé (P1) sans bloquer l'export des données
    check("P1", "aucun tiret long dans frontend/src", lambda: dashes_in([REPO_ROOT / "frontend" / "src"], src))

    failed = False
    for level, name, ok, detail in RESULTS:
        flag = "OK  " if ok else "ECHEC"
        print(f"[{flag}] {level} {name}" + (f" - {detail}" if detail else ""))
        failed |= (not ok and level == "P0")
    print(f"{sum(r[2] for r in RESULTS)}/{len(RESULTS)} contrôles OK")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
