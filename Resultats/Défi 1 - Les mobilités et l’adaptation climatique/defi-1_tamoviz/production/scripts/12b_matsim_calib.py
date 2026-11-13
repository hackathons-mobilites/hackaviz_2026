"""Recalage des constantes de télétravail MATSim sur des parts cibles (journée ordinaire), par décalage logit.
Lit matsim/output_ordinaire/output_plans.xml.gz, réécrit SUBPOPS dans scripts/12_matsim_config.py."""
import gzip, re, math, ast
import pandas as pd
TARGET = {"cadre": 0.25, "autre": 0.10, "essentiel": 0.05}
src = open("scripts/12_matsim_config.py", encoding="utf-8").read()
cur = ast.literal_eval(re.search(r"SUBPOPS = (\{[^}]*\})", src).group(1))
rows = []; sub = None; sel = False; kind = None
with gzip.open("matsim/output_ordinaire/output_plans.xml.gz", "rt", encoding="utf-8") as f:
    for line in f:
        if "<person " in line: sub = None
        elif 'name="subpopulation"' in line: sub = re.search(r">([^<]*)<", line).group(1)
        elif "<plan " in line: sel = 'selected="yes"' in line; kind = None
        elif sel and "<activity " in line:
            t = re.search(r'type="([^"]+)"', line).group(1)
            if t in ("work", "telework"): kind = t
        elif sel and "</plan>" in line: rows.append((sub, kind)); sel = False
df = pd.DataFrame(rows, columns=["sub", "kind"]); new = {}
for s, g in df.groupby("sub"):
    p = min(max((g.kind == "telework").mean(), 0.005), 0.995); t = TARGET[s]
    new[s] = round(cur[s] - (math.log(p / (1 - p)) - math.log(t / (1 - t))), 2)
    print(s, "télétravail", round(p * 100, 1), "% → cible", t * 100, "% · constante", cur[s], "→", new[s])
src = re.sub(r"SUBPOPS = \{[^}]*\}", "SUBPOPS = " + repr(new), src)
open("scripts/12_matsim_config.py", "w", encoding="utf-8").write(src)
