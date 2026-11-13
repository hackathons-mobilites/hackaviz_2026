"""Client HTTP partagé : une seule réserve de connexions pour toute l'application."""
import httpx

_client: httpx.Client | None = None


def shared() -> httpx.Client:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.Client(timeout=20, follow_redirects=True,
                               headers={"User-Agent": "AtouVent/0.3 (+https://atouvent.com)"})
    return _client
