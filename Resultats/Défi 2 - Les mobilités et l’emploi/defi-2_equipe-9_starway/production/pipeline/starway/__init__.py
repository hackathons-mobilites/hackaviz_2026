"""Pipeline de données STARWAY."""

import sys

# Console Windows (cp1252) : forcer l'UTF-8 pour les accents dans les sorties des scripts.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass
