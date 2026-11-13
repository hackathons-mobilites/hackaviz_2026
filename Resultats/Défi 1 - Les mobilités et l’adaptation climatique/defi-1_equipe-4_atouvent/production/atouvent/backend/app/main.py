"""Point d'entrée de l'API AtouVent. Lancer : uvicorn app.main:app --reload"""
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .core.config import check_secrets, settings
from .routes import account, admin, elevators, environment, system, transport, velib

API_PREFIX = "/api/v1"
MAX_BODY = 1_000_000  # 1 Mo : un trajet complet en fait au plus quelques dizaines de Ko


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Réseau d'itinéraires chargé dès le démarrage, en arrière-plan : le premier calcul n'attend pas
    from .router import engine

    def load():
        try:
            engine.network()
        except engine.RouterUnavailable:
            pass
    threading.Thread(target=load, daemon=True).start()
    yield


def create_app() -> FastAPI:
    check_secrets()
    docs = {} if settings.enable_docs else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="AtouVent API", version="0.3.0",
                  description="Mobilités franciliennes face aux aléas climatiques. Hackathon Mobilités 2026.", lifespan=lifespan, **docs)
    # Réponses compressées (itinéraires, tracés) : moins de données sur le réseau mobile, affichage plus rapide
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST", "PUT", "DELETE"],
                       allow_headers=["Authorization", "Content-Type", "X-Requested-With", "X-AtouVent-Client"])
    @app.middleware("http")
    async def guard_requests(request, call_next):
        """Filet de sécurité de toute l'API : taille des requêtes et débit par adresse IP (en plus des limites par route)."""
        from fastapi.responses import JSONResponse
        from .core.ratelimit import PATH_BUCKETS, client_ip
        from .deps import limiter_dep
        path = request.url.path
        if not path.startswith(API_PREFIX):
            return await call_next(request)
        size = request.headers.get("content-length")
        if size and size.isdigit() and int(size) > MAX_BODY:
            return JSONResponse({"detail": "payload_too_large"}, status_code=413)
        ip = client_ip(request)
        sub_path = path[len(API_PREFIX):]
        for bucket in ["global", *(b for p, b in PATH_BUCKETS if sub_path.startswith(p))]:
            wait = limiter_dep().hit(bucket, ip)
            if wait is not None:
                return JSONResponse({"detail": "too_many_requests"}, status_code=429, headers={"Retry-After": str(wait)})
        return await call_next(request)

    @app.middleware("http")
    async def security_headers(request, call_next):
        # En-têtes de sécurité sur toutes les réponses de l'API (le site statique les reçoit du serveur web, voir README)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        if request.url.path.startswith((f"{API_PREFIX}/me", f"{API_PREFIX}/auth", f"{API_PREFIX}/admin")):
            response.headers.setdefault("Cache-Control", "no-store")  # données personnelles : jamais en cache
        if settings.trust_proxy:  # derrière HTTPS
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    for r in (system, account, admin, transport, velib, elevators, environment):
        app.include_router(r.router, prefix=API_PREFIX)

    return app


app = create_app()
