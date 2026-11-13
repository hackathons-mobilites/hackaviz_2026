"""Limiteur de débit par adresse IP (fenêtre glissante, en mémoire)."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from .config import settings

# bucket : (nombre de requêtes, fenêtre en secondes)
LIMITS = {
    "login": (10, 15 * 60),
    "register": (5, 60 * 60),
    "email": (5, 60 * 60),          # mot de passe oublié
    "departures": (30, 60),
    "bundle": (10, 60),
    "weather": (60, 60),
    "geocode": (60, 60),
    "plan": (30, 60),
    "live": (30, 60),
    "nearby": (60, 60),          # arrêts, signalements, Vélib' proches
    "report": (10, 10 * 60),     # signalements : 10 par tranche de 10 minutes
    "vote": (30, 10 * 60),
    "login_account": (20, 60 * 60),  # par compte visé : essais répartis sur plusieurs adresses IP
    # Filet global (middleware) : toute l'API, puis plus strict pour le compte, l'administration et le flux en direct
    "global": (300, 60),
    "account": (60, 60),
    "admin": (120, 60),
    "stream": (10, 60),          # ouvertures du flux en direct (une connexion dure longtemps)
}

# Préfixe de chemin (sous /api/v1) → palier appliqué en plus du filet global
PATH_BUCKETS = (("/me", "account"), ("/admin", "admin"), ("/stream", "stream"))


class RateLimiter:
    def __init__(self, limits: dict[str, tuple[int, int]] = LIMITS):
        self.limits = limits
        self._hits: dict[tuple[str, str], deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, bucket: str, key: str) -> int | None:
        """Enregistre un appel ; renvoie le délai d'attente (s) si la limite est dépassée."""
        limit, window = self.limits[bucket]
        now = time.monotonic()
        with self._lock:
            q = self._hits[(bucket, key)]
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= limit:
                return int(q[0] + window - now) + 1
            q.append(now)
            if len(self._hits) > 50_000:  # nettoyage des clés inactives
                for k in [k for k, v in self._hits.items() if not v]:
                    del self._hits[k]
        return None


def client_ip(request: Request) -> str:
    if settings.trust_proxy:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "inconnu"


def limit(bucket: str):
    """Dépendance FastAPI : Depends(limit("login"))."""
    def dep(request: Request):
        from ..deps import limiter_dep
        wait = limiter_dep().hit(bucket, client_ip(request))
        if wait is not None:
            raise HTTPException(429, "too_many_requests", headers={"Retry-After": str(wait)})
    return dep
