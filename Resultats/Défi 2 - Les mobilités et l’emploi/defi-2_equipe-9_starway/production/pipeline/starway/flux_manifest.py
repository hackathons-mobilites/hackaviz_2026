"""Mise à jour du manifeste pour le flux GTFS du 06/11/2026 (TRA01, TRA01B, TRA01C) : logique pure, sans réseau.

Appelée par `scripts/04o_update_flux_manifest.py` quand Claude Code annonce la fin des calculs et livre les fichiers. Règles :

  - les empreintes sont CALCULÉES sur les fichiers livrés, jamais recopiées d'un message : TRA01 doit être exactement
    l'empreinte du flux figé (`flux.F06_TRA01_SHA256`), TRA01B et TRA01C doivent commencer par les débuts annoncés
    (`flux.F06_DERIVED_PREFIXES`) ; une empreinte incomplète n'est jamais écrite ;
  - un fichier livré ne remplace JAMAIS un fichier existant : il a un nom différent de l'ancien, dans `data/raw/<source>/` ;
  - les lignes remplacées vont dans `data/flux_gtfs_precedents.csv` (rien n'est supprimé) ;
  - aucun nombre de courses n'est écrit sans être mesuré dans le fichier ou fourni par l'appelant.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path

from starway import flux

F06_DATE_TRA01 = "2026-11-06T15:11Z"  # flux figé le 06/11/2026 à 16h11, heure de Paris (UTC+1)
F06_MOTIF = "relance de tous les calculs TC sur le flux GTFS du 06/11/2026 (choix de l'équipe)"

TRA01_MILLESIME = ("offre prévue sur les 30 jours suivant le 06/11/2026 (flux figé le 06/11/2026 à 16h11, heure de Paris) ; "
                   "remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt)")
TRA01_CONTROLES = ("date de service comprise dans calendar / calendar_dates ; contrôle du pipeline : aucune ligne du flux sans service le "
                   "17/11/2026 sans être listée et justifiée")


def problems(digests: Mapping[str, str]) -> list[str]:
    """Écarts entre les empreintes calculées des trois fichiers livrés et celles de la décision du 06/11."""
    errs = []
    if digests.get("TRA01") != flux.F06_TRA01_SHA256:
        errs.append(f"TRA01 : empreinte {str(digests.get('TRA01'))[:12]} différente du flux figé "
                    f"{flux.F06_TRA01_SHA256[:12]}")
    for sid, prefix in flux.F06_DERIVED_PREFIXES.items():
        if not str(digests.get(sid, "")).startswith(prefix):
            errs.append(f"{sid} : empreinte {str(digests.get(sid))[:12]} ne commence pas par {prefix}")
    for sid in flux.GTFS_SOURCES:
        if not flux.is_complete_sha(digests.get(sid)):
            errs.append(f"{sid} : empreinte calculée incomplète")
    if len({digests.get(s) for s in flux.GTFS_SOURCES}) < len(flux.GTFS_SOURCES):
        errs.append("TRA01, TRA01B et TRA01C n'ont pas trois empreintes distinctes")
    return errs


def relative_to_raw(path: Path, raw_dir: Path, source_id: str) -> str:
    """`fichier_local` du manifeste (`data/raw/<source>/<nom>`) d'un fichier livré ; refus hors de `<raw>/<source>/`."""
    try:
        rel = path.resolve().relative_to((raw_dir / source_id).resolve())
    except ValueError as exc:
        raise ValueError(f"{path} n'est pas dans {raw_dir / source_id}") from exc
    return "data/raw/" + source_id + "/" + rel.as_posix()


def derived_texts(source_id: str, stats: str | None) -> dict[str, str]:
    """Colonnes décrites à nouveau pour TRA01B et TRA01C (les anciens nombres ne valent plus pour le nouveau flux)."""
    measured = f" ; mesuré dans le fichier livré : {stats}" if stats else " ; nombre de courses ajoutées : voir le journal des contrôles"
    if source_id == "TRA01B":
        return {
            "titre": ("IDFM - GTFS TRA01 (flux du 06/11/2026) complété des courses de la veille codées 24:00 et plus (réseau de "
                      "nuit), fichier dérivé construit par STARWAY"),
            "traitements": ("les courses des services actifs le lundi 16/11 (calendar.txt puis calendar_dates.txt) dont des "
                            "arrêts sont codés 24:00 et plus sont ajoutées au mardi 17/11 (service NUIT_20261117, identifiants "
                            "NUIT_<trip_id>) avec 24 h de moins, SEULEMENT les arrêts à partir de 24:00, sans shape_id ; "
                            "tous les autres fichiers du GTFS sont recopiés sans changement ; entrée de r5py des tables du "
                            "matin (0h à 6h55), du 6h-14h recalculé et, depuis le flux du 06/11, du vélo + TC des trois "
                            "journées-types" + measured),
            "controles": ("contrôle du pipeline : GTFS de nuit = TRA01 + lignes ajoutées conformes à la règle ; empreinte "
                          "complète au manifeste ; dossiers de nuit et vélo + TC calculés sur cette empreinte"),
            "limites": ("les courses ajoutées ne couvrent que ce que le lundi 16/11 prolonge après minuit ; le matin et le "
                        "soir viennent du même mardi type ; offre théorique (ni retards ni perturbations) ; le zip lui-même "
                        "n'est pas reproductible octet pour octet (compression), son contenu l'est ; le vélo + TC utilise ce "
                        "réseau pour les trois journées-types, les courses ajoutées ne roulant qu'avant 7h"),
        }
    return {
        "titre": ("IDFM - GTFS de nuit TRA01B (flux du 06/11/2026) complété des courses du mercredi 18/11 parties avant 3h "
                  "(réseau du soir), fichier dérivé construit par STARWAY"),
        "traitements": ("les courses des services actifs le mercredi 18/11 (calendar.txt puis calendar_dates.txt) dont le "
                        "PREMIER départ est avant 03:00:00 et qui ont au moins 2 arrêts sont copiées EN ENTIER au mardi 17/11 "
                        "avec 24 h de PLUS sur toutes les heures (service SOIR_20261117, identifiants SOIR_<trip_id d'origine>, "
                        "sans shape_id) ; tous les autres fichiers sont recopiés sans changement ; entrée de r5py de la "
                        "table commune x commune du soir seulement (départs de 22h05 à 23h55)" + measured),
        "controles": ("contrôle du pipeline : GTFS du soir = GTFS de nuit + courses du mercredi parties avant 3h conformes à la règle, aucune "
                      "oubliée (aucun nombre attendu écrit en dur) ; "
                      "empreinte complète au manifeste"),
        "limites": ("le soir vient du MÊME mardi type que le matin, avec les courses du mercredi après minuit (pas d'une "
                    "journée réelle continue) ; offre théorique (ni retards ni perturbations) ; le zip lui-même n'est pas "
                    "reproductible octet pour octet (compression), son contenu l'est ; sert uniquement aux départs de "
                    "22h05 à 23h55"),
    }


def update_rows(rows: Sequence[Mapping[str, str]], digests: Mapping[str, str], paths: Mapping[str, str],
                dates: Mapping[str, str], *, replaced_on: str, trips_on_day: int | None = None,
                stats: Mapping[str, str] | None = None
                ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """(manifeste mis à jour, lignes à ajouter aux flux précédents). Lève ValueError si une empreinte n'est pas celle de la
    décision, si un fichier livré porte le nom de l'ancien ou si une source manque au manifeste."""
    errs = problems(digests)
    if errs:
        raise ValueError(" ; ".join(errs))
    stats = stats or {}
    out = [dict(r) for r in rows]
    previous: list[dict[str, str]] = []
    for sid in flux.GTFS_SOURCES:
        idx = next((i for i, r in enumerate(out) if r["source_id"] == sid), None)
        if idx is None:
            raise ValueError(f"{sid} absent du manifeste")
        old = out[idx]
        if old["sha256"] == digests[sid]:
            continue  # déjà à jour : idempotent
        if paths[sid] == old["fichier_local"]:
            raise ValueError(f"{sid} : le fichier livré porte le nom de l'ancien ({paths[sid]}) : rien n'est remplacé")
        previous.append({"source_id": sid, "sha256": old["sha256"], "date_extraction": old["date_extraction"],
                         "fichier_local": old["fichier_local"], "remplace_le": replaced_on, "motif": F06_MOTIF})
        new = dict(old)
        new.update({"sha256": digests[sid], "fichier_local": paths[sid], "date_extraction": dates[sid]})
        if sid == "TRA01":
            n = f"{trips_on_day} courses actives" if trips_on_day is not None else "nombre de courses actives : voir le journal des contrôles"
            new.update({"millesime": TRA01_MILLESIME, "controles": TRA01_CONTROLES,
                        "date_service_transport": f"2026-11-17 (mardi ordinaire, {n})"})
        else:
            new.update(derived_texts(sid, stats.get(sid)))
            new["millesime"] = ("dérivé de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026"
                                if sid == "TRA01B" else
                                "dérivé de TRA01B puis de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours "
                                "suivant le 06/11/2026")
        out[idx] = new
    return out, previous
