# Banc du soir (Claude Code, 05/11) : copie de gtfs_nuit.zip ou les courses du mercredi 18/11 parties avant 03:00 sont
# ajoutees au mardi 17/11 avec 24 h de plus. Sert a mesurer ce que voit un depart de 22h05 a 23h55. Aucun GTFS existant n'est touche.
import collections, csv, datetime as dt, io, os, zipfile
SRC = os.path.expanduser("~/b44/night/gtfs_nuit.zip"); DST = os.path.expanduser("~/b44/night/soir/gtfs_soir.zip")
z = zipfile.ZipFile(SRC)
def rd(n): return csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig"))
s = "20261118"; wed = set()
for c in rd("calendar.txt"):
    if c["start_date"] <= s <= c["end_date"] and c["wednesday"] == "1": wed.add(c["service_id"])
for c in rd("calendar_dates.txt"):
    if c["date"] == s: (wed.add if c["exception_type"] == "1" else wed.discard)(c["service_id"])
trips = {t["trip_id"]: t for t in rd("trips.txt")}
SV = "SOIR_20261117"; rows = collections.defaultdict(list); first = {}
def sec(t): a, b, c = t.split(":"); return int(a) * 3600 + int(b) * 60 + int(c)
def p24(t): a, b, c = t.split(":"); return f"{int(a) + 24:02d}:{b}:{c}"
r = rd("stop_times.txt"); F = r.fieldnames
for x in r:
    if trips[x["trip_id"]]["service_id"] not in wed: continue
    d = x["departure_time"]
    if d: first[x["trip_id"]] = min(first.get(x["trip_id"], 10 ** 9), sec(d))
    rows[x["trip_id"]].append(x)
keep = {k: v for k, v in rows.items() if first.get(k, 10 ** 9) < 3 * 3600 and len(v) >= 2}
print("courses copiees", len(keep), "arrets", sum(map(len, keep.values())), flush=True)
def text(items, fields):
    b = io.StringIO(newline=""); w = csv.DictWriter(b, fields, lineterminator="\n")
    for x in items: w.writerow(x)
    return b.getvalue()
os.makedirs(os.path.dirname(DST), exist_ok=True)
with zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as o:
    for n in z.namelist():
        if n not in ("trips.txt", "stop_times.txt", "calendar_dates.txt"):
            o.writestr(n, z.read(n)); continue
        raw = z.read(n).decode("utf-8-sig")
        if not raw.endswith("\n"): raw += "\n"
        hdr = next(csv.reader(io.StringIO(raw.split("\n", 1)[0])))
        if n == "trips.txt":
            add = [{**trips[k], "trip_id": "SOIR_" + k, "service_id": SV, **({"shape_id": ""} if "shape_id" in hdr else {})} for k in keep]
        elif n == "stop_times.txt":
            add = []
            for k, v in keep.items():
                for x in v:
                    y = {**x, "trip_id": "SOIR_" + k}
                    if y["departure_time"]: y["departure_time"] = p24(y["departure_time"])
                    if y["arrival_time"]: y["arrival_time"] = p24(y["arrival_time"])
                    add.append(y)
        else:
            add = [{"service_id": SV, "date": "20261117", "exception_type": "1"}]
        o.writestr(n, raw + text(add, hdr))
print("ecrit", DST, os.path.getsize(DST), flush=True)
