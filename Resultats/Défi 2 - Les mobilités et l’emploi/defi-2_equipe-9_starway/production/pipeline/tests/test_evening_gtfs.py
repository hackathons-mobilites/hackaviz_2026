"""Réseau du soir (D-040) : le script de la VM `make_gtfs_soir.py` (copie `scripts/04n_make_gtfs_soir.py`, jamais modifiée)
et sa vérification `starway.evening_gtfs.verify_evening_gtfs`, sur un GTFS de nuit minimal synthétique.

Les horaires ci-dessous sont des FIXTURES de test, pas des données IDFM. Le script de la VM lit et écrit sous `~/b44/night` :
le test redirige `~` vers un dossier temporaire (rien n'est écrit ailleurs).
"""

from __future__ import annotations

import hashlib
import runpy
import zipfile
from datetime import date
from pathlib import Path

import pytest

from starway import evening_gtfs as eg

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "04n_make_gtfs_soir.py"
SCRIPT_SHA256_ON_VM = "c68dff78a0ec7f5746683754d7c9e3cd3978943ac08499aa1fb95acdb82d19aa"

CALENDAR = (
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
    "MER,0,0,1,0,0,0,0,20261101,20261231\n"  # actif le mercredi 18
    "MAR,0,1,0,0,0,0,0,20261101,20261231\n"  # mardi seulement
    "MER_PASSE,0,0,1,0,0,0,0,20260101,20261001\n"  # mercredi, plage de dates terminée
    "MER_RETIRE,0,0,1,0,0,0,0,20261101,20261231\n"  # mercredi, retiré le 18 par exception
    "NUIT_20261117,0,0,0,0,0,0,0,20261101,20261231\n"  # service du GTFS de nuit : jamais actif le mercredi
)
CALENDAR_DATES = (
    "service_id,date,exception_type\n"
    "AJOUT,20261118,1\n"  # ajouté le 18 (n'est pas dans calendar.txt)
    "MER_RETIRE,20261118,2\n"
    "NUIT_20261117,20261117,1\n"
)
TRIPS = (
    "route_id,service_id,trip_id,trip_headsign,shape_id,wheelchair_accessible\n"
    "R1,MER,T_TOT,Nord,SH1,1\n"  # part à 00:20 le mercredi : copiée
    "R1,MER,T_MATIN,Nord,SH1,1\n"  # part à 05:00 : pas copiée
    "R2,MER,T_TARD,Sud,SH2,0\n"  # premier départ à 03:00 pile : pas copiée (strictement avant 03:00)
    "R2,MER,T_UN_ARRET,Sud,SH2,0\n"  # un seul arrêt : écartée
    "R3,AJOUT,T_AJOUT,Est,SH3,1\n"  # service ajouté par calendar_dates : copiée
    "R1,MAR,T_MARDI,Nord,SH1,1\n"  # service du mardi : ne compte pas
    "R1,MER_PASSE,T_PASSE,Nord,SH1,1\n"
    "R1,MER_RETIRE,T_RETIRE,Nord,SH1,1\n"
    "R1,NUIT_20261117,NUIT_T_NUIT,Nord,,1\n"  # course de nuit du GTFS de nuit : n'est pas un service du mercredi
)
STOP_TIMES = (
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n"
    "T_TOT,00:20:00,00:20:30,A,1,0,0\n"
    "T_TOT,00:40:00,00:41:00,B,2,0,0\n"
    "T_TOT,04:10:00,04:10:30,C,3,0,0\n"  # la course est copiée en ENTIER, même après 3h
    "T_TOT,,,D,4,1,0\n"  # heures vides : restent vides
    "T_MATIN,05:00:00,05:00:00,A,1,0,0\n"
    "T_MATIN,05:30:00,05:30:00,B,2,0,0\n"
    "T_TARD,03:00:00,03:00:00,A,1,0,0\n"
    "T_TARD,03:30:00,03:30:00,B,2,0,0\n"
    "T_UN_ARRET,01:00:00,01:00:00,A,1,0,0\n"
    "T_AJOUT,01:58:00,02:00:00,A,1,0,0\n"
    "T_AJOUT,02:20:00,02:21:00,B,2,0,0\n"
    "T_MARDI,00:10:00,00:11:00,A,1,0,0\n"
    "T_MARDI,00:30:00,00:31:00,B,2,0,0\n"
    "T_PASSE,00:10:00,00:11:00,A,1,0,0\n"
    "T_PASSE,00:30:00,00:31:00,B,2,0,0\n"
    "T_RETIRE,00:10:00,00:11:00,A,1,0,0\n"
    "T_RETIRE,00:30:00,00:31:00,B,2,0,0\n"
    "NUIT_T_NUIT,00:10:00,00:11:00,A,1,0,0\n"
    "NUIT_T_NUIT,00:30:00,00:31:00,B,2,0,0\n"
)
STOPS = "stop_id,stop_name\nA,Alpha\nB,Bravo\nC,Charlie\nD,Delta\n"


def make_night_gtfs(path: Path) -> Path:
    members = {"calendar.txt": CALENDAR, "calendar_dates.txt": CALENDAR_DATES, "trips.txt": TRIPS,
               "stop_times.txt": STOP_TIMES, "stops.txt": STOPS}
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, text in members.items():
            z.writestr(name, text)
    return path


def read(path: Path, name: str) -> list[str]:
    with zipfile.ZipFile(path) as z:
        return z.read(name).decode("utf-8").splitlines()


@pytest.fixture()
def built(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    """Le script de la VM, tel quel, exécuté sous un faux « ~ » : ~/b44/night/gtfs_nuit.zip -> ~/b44/night/soir/gtfs_soir.zip."""
    for var in ("HOME", "USERPROFILE"):
        monkeypatch.setenv(var, str(tmp_path))
    src = make_night_gtfs(tmp_path / "b44" / "night" / "gtfs_nuit.zip")
    runpy.run_path(str(SCRIPT), run_name="__main__")
    return src, tmp_path / "b44" / "night" / "soir" / "gtfs_soir.zip"


def test_script_is_the_vm_copy_unchanged() -> None:
    # LF des deux côtés : le sha256 de la VM est celui du contenu, pas des fins de ligne du poste
    raw = SCRIPT.read_bytes().replace(b"\r\n", b"\n")
    assert hashlib.sha256(raw).hexdigest() == SCRIPT_SHA256_ON_VM


def test_constants() -> None:
    assert eg.TARGET_DAY == date(2026, 11, 17) and eg.SOURCE_DAY == date(2026, 11, 18)
    assert eg.EVENING_SERVICE_ID == "SOIR_20261117" and eg.EVENING_TRIP_PREFIX == "SOIR_"


def test_plus_24h() -> None:
    assert eg.plus_24h("00:30:00") == "24:30:00" and eg.plus_24h("2:05:10") == "26:05:10"
    assert eg.plus_24h("24:10:00") == "48:10:00"


def test_script_copies_only_wednesday_trips_leaving_before_3h(built: tuple[Path, Path]) -> None:
    _, dst = built
    trips = read(dst, "trips.txt")
    added = {line.split(",")[2]: line for line in trips[len(TRIPS.splitlines()):]}
    assert set(added) == {"SOIR_T_TOT", "SOIR_T_AJOUT"}  # ni T_MATIN, ni T_TARD (03:00 pile), ni la course de nuit
    assert all(line.split(",")[1] == "SOIR_20261117" and line.split(",")[4] == "" for line in added.values())


def test_script_adds_24h_to_every_stop_of_the_copied_trips(built: tuple[Path, Path]) -> None:
    _, dst = built
    added = read(dst, "stop_times.txt")[len(STOP_TIMES.splitlines()):]
    assert added == [
        "SOIR_T_TOT,24:20:00,24:20:30,A,1,0,0",
        "SOIR_T_TOT,24:40:00,24:41:00,B,2,0,0",
        "SOIR_T_TOT,28:10:00,28:10:30,C,3,0,0",
        "SOIR_T_TOT,,,D,4,1,0",
        "SOIR_T_AJOUT,25:58:00,26:00:00,A,1,0,0",
        "SOIR_T_AJOUT,26:20:00,26:21:00,B,2,0,0",
    ]
    assert read(dst, "calendar_dates.txt")[-1] == "SOIR_20261117,20261117,1"


def test_script_leaves_the_other_files_and_the_original_rows_untouched(built: tuple[Path, Path]) -> None:
    src, dst = built
    with zipfile.ZipFile(src) as a, zipfile.ZipFile(dst) as b:
        assert a.namelist() == b.namelist()
        assert a.read("stops.txt") == b.read("stops.txt") and a.read("calendar.txt") == b.read("calendar.txt")
    for name in ("trips.txt", "stop_times.txt", "calendar_dates.txt"):
        assert read(dst, name)[: len(read(src, name))] == read(src, name)


def test_verification_accepts_the_script_output(built: tuple[Path, Path]) -> None:
    src, dst = built
    assert eg.verify_evening_gtfs(src, dst) == []
    assert eg.verify_evening_gtfs(src, dst, expected={"trips": 2, "stop_times": 6}) == []
    assert eg.verify_evening_gtfs(src, dst, expected={"trips": 1248}) == ["trips ajoutés : 2 au lieu de 1248"]


def _rewrite(src: Path, dst: Path, name: str, fn) -> None:
    with zipfile.ZipFile(src) as a, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as b:
        for n in a.namelist():
            data = a.read(n).decode("utf-8")
            b.writestr(n, fn(data) if n == name else data)


@pytest.mark.parametrize(("member", "change", "expect"), [
    ("stop_times.txt", lambda t: t.replace("SOIR_T_TOT,24:20:00", "SOIR_T_TOT,24:25:00"), "arrêts différents"),
    ("stop_times.txt", lambda t: t.replace("SOIR_T_AJOUT,26:20:00,26:21:00,B", "SOIR_T_AJOUT,02:20:00,02:21:00,B"),
     "arrêts différents"),
    ("trips.txt", lambda t: t.replace("SOIR_T_TOT,Nord,", "SOIR_T_TOT,Nord,SH1"), "shape_id"),
    ("trips.txt", lambda t: t.replace("SOIR_20261117,SOIR_T_AJOUT", "MER,SOIR_T_AJOUT"), "hors du service"),
    ("trips.txt", lambda t: "\n".join(t.splitlines()[:-1]) + "\n", "courses de trips.txt et de stop_times.txt"),
    ("calendar_dates.txt", lambda t: t + "SOIR_20261117,20261117,1\n", "lignes ajoutées à calendar_dates.txt"),
])
def test_verification_rejects_a_modified_evening_network(built: tuple[Path, Path], tmp_path: Path, member: str,
                                                         change, expect: str) -> None:
    src, dst = built
    bad = tmp_path / "bad.zip"
    _rewrite(dst, bad, member, change)
    problems = eg.verify_evening_gtfs(src, bad)
    assert problems and any(expect in p for p in problems), problems


def test_verification_rejects_a_forgotten_trip(built: tuple[Path, Path], tmp_path: Path) -> None:
    """Course oubliée : T_AJOUT retirée de trips.txt ET de stop_times.txt (le reste est cohérent) ; la vérification
    compare au GTFS de nuit et la retrouve."""
    src, dst = built
    mid = tmp_path / "mid.zip"
    bad = tmp_path / "bad.zip"
    _rewrite(dst, mid, "trips.txt", lambda t: "\n".join(x for x in t.splitlines() if "SOIR_T_AJOUT" not in x) + "\n")
    _rewrite(mid, bad, "stop_times.txt", lambda t: "\n".join(x for x in t.splitlines() if "SOIR_T_AJOUT" not in x) + "\n")
    assert any("absentes du GTFS du soir" in p for p in eg.verify_evening_gtfs(src, bad))


def test_verification_rejects_a_changed_untouched_file(built: tuple[Path, Path], tmp_path: Path) -> None:
    src, dst = built
    bad = tmp_path / "bad.zip"
    _rewrite(dst, bad, "stops.txt", lambda t: t.replace("Alpha", "Autre"))
    assert any("stops.txt" in p for p in eg.verify_evening_gtfs(src, bad))


def test_verification_rejects_a_night_network_taken_for_the_evening_one(built: tuple[Path, Path]) -> None:
    src, _ = built
    problems = eg.verify_evening_gtfs(src, src)
    assert problems and any("calendar_dates.txt" in p or "absentes" in p for p in problems)
