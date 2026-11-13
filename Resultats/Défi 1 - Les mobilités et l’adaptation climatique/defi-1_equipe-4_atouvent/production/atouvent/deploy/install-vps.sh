#!/usr/bin/env bash
# Installe AtouVent sur le serveur partagé, à lancer une fois en root : bash /home/deploy/atouvent/deploy/install-vps.sh
# Ne touche qu'à AtouVent : conteneurs « atouvent », site nginx atouvent.com ; s'arrête à la première erreur.
set -euo pipefail
cd /home/deploy/atouvent
COMPOSE="docker compose -p atouvent -f docker-compose.yml -f docker-compose.vps.yml"

echo "1/5 Chargement des images"
docker load -i images.tar.gz

echo "2/5 Démarrage (base, API, collecteur, site) sur 127.0.0.1:8090"
$COMPOSE up -d --no-build
for i in $(seq 1 30); do
  curl -fs http://127.0.0.1:8090/api/v1/health >/dev/null && break
  sleep 2
done
curl -fs http://127.0.0.1:8090/api/v1/health || { echo "L'API ne répond pas :"; $COMPOSE logs --tail 40 api; exit 1; }
echo

echo "3/5 Site nginx atouvent.com (les autres sites ne sont pas modifiés)"
install -m 644 deploy/nginx-atouvent.conf /etc/nginx/sites-available/atouvent.com
ln -sf /etc/nginx/sites-available/atouvent.com /etc/nginx/sites-enabled/atouvent.com
if ! nginx -t; then
  # Configuration refusée : on retire AtouVent pour laisser nginx tel qu'il était
  rm -f /etc/nginx/sites-enabled/atouvent.com
  echo "nginx refuse la configuration : rien n'a été rechargé"; exit 1
fi
systemctl reload nginx

echo "4/5 Certificat HTTPS (Let's Encrypt) et redirection HTTP vers HTTPS"
certbot --nginx -d atouvent.com -d www.atouvent.com --non-interactive --agree-tos --redirect

echo "5/5 Vérification"
curl -fsS https://atouvent.com/api/v1/health && echo && echo "AtouVent est en ligne : https://atouvent.com"
rm -f images.tar.gz
