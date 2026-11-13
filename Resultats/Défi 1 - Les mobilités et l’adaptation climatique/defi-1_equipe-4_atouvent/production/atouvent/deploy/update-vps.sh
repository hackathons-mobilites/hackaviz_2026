#!/usr/bin/env bash
# Met à jour AtouVent sur le serveur (en root) : bash /home/deploy/atouvent/deploy/update-vps.sh
# Charge les nouvelles images envoyées dans /home/deploy/atouvent/images.tar.gz et redémarre seulement AtouVent.
set -euo pipefail
cd /home/deploy/atouvent
COMPOSE="docker compose -p atouvent -f docker-compose.yml -f docker-compose.vps.yml"

if [ -f images.tar.gz ]; then docker load -i images.tar.gz; else echo "Pas de nouvelles images : simple redémarrage"; fi
$COMPOSE up -d --no-build
for i in $(seq 1 30); do curl -fs http://127.0.0.1:8090/api/v1/health >/dev/null && break; sleep 2; done
curl -fsS https://atouvent.com/api/v1/health && echo && echo "Mise à jour terminée : https://atouvent.com"
rm -f images.tar.gz
docker image prune -f >/dev/null
