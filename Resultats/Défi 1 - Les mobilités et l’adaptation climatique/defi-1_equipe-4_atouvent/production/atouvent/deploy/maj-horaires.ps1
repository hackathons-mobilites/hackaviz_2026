# Horaires IDFM à jour sur atouvent.com : lancé chaque jour par le Planificateur de tâches Windows.
# Le serveur est trop petit pour reconstruire le réseau (1,9 Go de mémoire) : le PC le fait, puis l'envoie.
# Ne fait rien si les horaires en service sont encore bons (simple vérification auprès d'IDFM).
# -Envoyer : renvoie les horaires actuels même sans changement (test, ou serveur réinstallé)
param([switch]$Envoyer)
$ErrorActionPreference = 'Stop'
$racine = Split-Path -Parent $PSScriptRoot
$data = Join-Path $racine 'backend\data'
$journal = Join-Path $data 'maj-horaires.log'
$ssh = 'C:\Windows\System32\OpenSSH\ssh.exe'
$scp = 'C:\Windows\System32\OpenSSH\scp.exe'
$tar = 'C:\Windows\System32\tar.exe'
function Note($texte) { Add-Content -Path $journal -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm') $texte" -Encoding utf8 }

try {
  $avant = if (Test-Path (Join-Path $data 'gtfs_state.json')) { (Get-Item (Join-Path $data 'gtfs_state.json')).LastWriteTime } else { $null }
  # 1. Reconstruction si IDFM a publié de nouveaux horaires ou si les actuels expirent dans moins de 10 jours
  Push-Location (Join-Path $racine 'backend')
  $env:PYTHONIOENCODING = 'utf-8'
  # Python écrit ses messages d'information sur la sortie d'erreur : ce n'est pas une erreur pour PowerShell
  $ErrorActionPreference = 'Continue'
  & '.\.venv\Scripts\python.exe' -m app.router.refresh 2>&1 | Out-Null
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw "reconstruction en échec (code $LASTEXITCODE)" }
  Pop-Location
  $apres = (Get-Item (Join-Path $data 'gtfs_state.json')).LastWriteTime
  if (-not $Envoyer -and $avant -and $apres -eq $avant) { Note 'horaires à jour : rien à envoyer'; exit 0 }

  # 2. Envoi au serveur sous un nom provisoire, puis remplacement d'un coup (le site ne lit jamais un fichier à moitié copié)
  $paquet = Join-Path $env:TEMP 'atouvent-horaires.tar.gz'
  & $tar -czf $paquet -C $data router.npz router.json stop_info.json gtfs_state.json
  & $scp -q -o BatchMode=yes $paquet 'elikya-vps:atouvent/horaires.tar.gz'
  if ($LASTEXITCODE -ne 0) { throw 'envoi au serveur impossible' }
  $cmd = 'set -e; d=~/atouvent/backend/data; mkdir -p $d/.nouveau; tar -xzf ~/atouvent/horaires.tar.gz -C $d/.nouveau; ' +
         'for f in router.json stop_info.json gtfs_state.json router.npz; do mv -f $d/.nouveau/$f $d/$f; done; rmdir $d/.nouveau; rm -f ~/atouvent/horaires.tar.gz'
  & $ssh -o BatchMode=yes elikya-vps $cmd
  if ($LASTEXITCODE -ne 0) { throw 'remplacement sur le serveur impossible' }
  Remove-Item $paquet -ErrorAction SilentlyContinue
  $valide = (Get-Content (Join-Path $data 'router.json') -Raw -Encoding utf8 | ConvertFrom-Json).valid -join ' au '
  Note "nouveaux horaires envoyés sur atouvent.com (valables du $valide)"
} catch {
  Note "ÉCHEC : $($_.Exception.Message)"
  exit 1
}
