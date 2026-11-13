#!/usr/bin/env bash
# 06p - Rafraîchissement de l'export partiel pendant le calcul de nuit : 06 (lots terminés) puis 07.
# Lecture seule de data/interim/matrix/ ; respecte les règles de la nuit (verrou unique, >= 4 Go libres).
# Usage (Git Bash) : HEAVY_LOCK=<dossier du verrou partagé> bash pipeline/scripts/06p_partial_refresh.sh
# Verrou : variable HEAVY_LOCK (le même dossier pour tous les outils qui partagent la machine) ; à défaut, un dossier
# neutre data/interim/heavy.lock (non versionné). Aucun chemin personnel dans ce script.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PY="$HERE/.venv/Scripts/python.exe"
LOCK="${HEAVY_LOCK:-$HERE/../data/interim/heavy.lock}"
MIN_FREE_GB=4

free_gb() { powershell -NoProfile -c "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB)" | tr -d '\r'; }
waited=0
until [ "$(free_gb)" -ge "$MIN_FREE_GB" ] && mkdir "$LOCK" 2>/dev/null; do
  [ "$waited" -ge 1800 ] && { echo "abandon : verrou ou mémoire indisponible depuis 30 min" >&2; exit 3; }
  sleep 60; waited=$((waited + 60))
done
echo "06p_partial_refresh $(date)" > "$LOCK/owner.txt"
trap 'rm -rf "$LOCK"' EXIT

cd "$HERE" || exit 2
export PYTHONIOENCODING=utf-8
t0=$(date +%s)
# 06 lance 07 AVANT d'écrire (export annulé si un P0 échoue), puis 07 revérifie les fichiers écrits.
# Mesure de la durée et de la mémoire maximale (processus 06 et ses enfants).
"$PY" - <<'PYEOF'
import subprocess, sys, time, psutil
t = time.time()
p = subprocess.Popen([sys.executable, "scripts/06_export_front.py"])
peak = 0
proc = psutil.Process(p.pid)
while p.poll() is None:
    try:
        peak = max(peak, sum(c.memory_info().rss for c in [proc, *proc.children(recursive=True)]))
    except psutil.Error:
        pass
    time.sleep(0.5)
print(f"[06p] 06 : code {p.returncode}, {time.time() - t:.0f} s, mémoire max {peak / 2**20:.0f} Mo")
sys.exit(p.returncode)
PYEOF
rc6=$?
"$PY" scripts/07_quality_checks.py
rc7=$?
echo "[06p] terminé en $(( $(date +%s) - t0 )) s ; 06=$rc6 07=$rc7"
[ $rc6 -eq 0 ] && [ $rc7 -eq 0 ]
