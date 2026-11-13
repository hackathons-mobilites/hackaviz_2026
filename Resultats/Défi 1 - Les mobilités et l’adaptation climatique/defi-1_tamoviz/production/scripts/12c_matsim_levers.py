"""Entrées MATSim des mesures testées un jour de canicule.
- freq : renfort de fréquence des bus aux heures de pointe (6 h-10 h, 16 h-20 h) : un départ intermédiaire
  est inséré dès que deux départs consécutifs sont espacés d'au moins 10 minutes.
  Sorties : matsim/scenario/transitSchedule_freq.xml.gz, transitVehicles_freq.xml.gz
- horaires : horaires décalés recommandés les jours rouges : la moitié des cadres et des « autres » avancent
  leur journée d'une heure (départ du domicile et sortie du travail). Les essentiels gardent leurs horaires.
  Sortie : matsim/scenario/population_horaires.xml.gz
La mesure « clim » (tous les bus climatisés) ne demande pas d'entrée : elle se règle dans la notation (12_matsim_config.py)."""
import gzip, re, random
SC = "matsim/scenario/"
PEAKS = [(6 * 3600, 10 * 3600), (16 * 3600, 20 * 3600)]
def sec(s): h, m, x = map(int, s.split(":")); return h * 3600 + m * 60 + x
def hms(t): t = int(t); return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"

# ---------- renfort de fréquence ----------
src = gzip.open(SC + "transitSchedule.xml.gz", "rt", encoding="utf-8").read()
rx_route = re.compile(r"(<transitRoute .*?</transitRoute>)", re.S)
rx_dep = re.compile(r'<departure id="([^"]+)" departureTime="([^"]+)" vehicleRefId="([^"]+)"/>')
added = 0; new_veh = []
def boost(m):
    global added
    r = m.group(1)
    mode = re.search(r"<transportMode>([^<]+)</transportMode>", r).group(1)
    if not mode.startswith("bus"): return r
    deps = sorted((sec(t), i, v) for i, t, v in rx_dep.findall(r))
    extra = []
    for (t0, _, _), (t1, _, _) in zip(deps, deps[1:]):
        mid = (t0 + t1) / 2
        if t1 - t0 >= 600 and any(a <= mid <= b for a, b in PEAKS):
            vid = f"vf{added}"; extra.append(f'<departure id="f{added}" departureTime="{hms(mid)}" vehicleRefId="{vid}"/>')
            new_veh.append(vid); added += 1
    return r.replace("</departures>", "".join(extra) + "</departures>") if extra else r
out = rx_route.sub(boost, src)
with gzip.open(SC + "transitSchedule_freq.xml.gz", "wt", encoding="utf-8") as f: f.write(out)
veh = gzip.open(SC + "transitVehicles.xml.gz", "rt", encoding="utf-8").read()
veh = veh.replace("</vehicleDefinitions>", "".join(f'<vehicle id="{v}" type="bus"/>\n' for v in new_veh) + "</vehicleDefinitions>")
with gzip.open(SC + "transitVehicles_freq.xml.gz", "wt", encoding="utf-8") as f: f.write(veh)
base = len(rx_dep.findall(src))
print("renfort de fréquence :", added, "départs de bus ajoutés aux heures de pointe, soit", round(100 * added / base, 1), "% de l'offre totale")

# ---------- horaires décalés ----------
random.seed(7); shifted = n = 0
rx_end = re.compile(r'end_time="([0-9:]+)"')
lines = []; cur = []
with gzip.open(SC + "population.xml.gz", "rt", encoding="utf-8") as f:
    for line in f:
        if line.startswith("<person "):
            n += 1
            sub = re.search(r'name="subpopulation"[^>]*>([^<]*)<', line)
            cur_shift = bool(sub) and sub.group(1) in ("cadre", "autre") and random.random() < 0.5
            shifted += cur_shift
        elif line.startswith("<plan ") and cur_shift:
            line = rx_end.sub(lambda m: f'end_time="{hms(max(4 * 3600, sec(m.group(1)) - 3600))}"', line)
        lines.append(line)
with gzip.open(SC + "population_horaires.xml.gz", "wt", encoding="utf-8") as f: f.writelines(lines)
print("horaires décalés :", shifted, "agents sur", n, "avancent leur journée d'une heure")
