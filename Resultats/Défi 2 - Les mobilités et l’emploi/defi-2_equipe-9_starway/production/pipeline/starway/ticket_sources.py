"""Sources des règles de comptage des tickets à l'unité (TKT01, 04/11/2026, correction de D-028).

Parcouru par 01_download.py (`SOURCES + SUBSCRIPTION_SOURCES + TICKET_SOURCES`). Les trois pages ont été téléchargées
une fois avec curl le 04/11/2026 (même User-Agent de navigateur que les autres pages IDFM) puis tracées au manifeste ;
la version française de la liste des correspondances par la voie publique répond HTTP 403 au robot (non contourné) :
la version anglaise officielle du même site est gardée.
"""

from __future__ import annotations

from starway.sources import Source

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
_IDFM = "https://www.iledefrance-mobilites.fr"
_LIC = "page publique IDFM, citée comme source d'une règle tarifaire (aucune réutilisation de contenu)"
_CTRL = "phrases citées par le pipeline retrouvées dans le texte de l'instantané (contrôle bloquant)"

TICKET_SOURCES: tuple[Source, ...] = (
    Source("TKT01", f"{_IDFM}/cgvu-tickets-bus-tram", "cgvu-tickets-bus-tram.html",
           {"titre": "IDFM - Conditions générales de vente et d'utilisation des tickets Bus-Tram (version HTML)",
            "millesime": "« Date de validité : à partir de juin 2026 » (mention de la page)",
            "licence": _LIC, "granularite": "règles d'usage", "geographie": "Île-de-France",
            "traitements": "art. 2.1 (bus de tarification francilienne), 2.2 (pas de métro, RER, train), 2.3 (voyage "
                           "de 1h30 sans sortie, correspondances entre modes autorisés) appliqués par "
                           "le pipeline",
            "controles": _CTRL, "limites": "règles pour le support sans contact (passe Navigo Easy, téléphone)"},
           user_agent=_UA),
    Source("TKT01", f"{_IDFM}/cgvu-tickets-metro-train-rer", "cgvu-tickets-metro-train-rer.html",
           {"titre": "IDFM - Conditions générales de vente et d'utilisation des tickets Métro-Train-RER (version HTML)",
            "millesime": "« Date de validité : à partir de juin 2026 » (mention de la page)",
            "licence": _LIC, "granularite": "règles d'usage", "geographie": "Île-de-France",
            "traitements": "art. 2.3 : correspondances par la voie publique autorisées selon la liste officielle",
            "controles": _CTRL, "limites": "renvoie à la liste de la page correspondance-voie-publique"},
           user_agent=_UA),
    Source("TKT01", f"{_IDFM}/en/correspondance-voie-publique", "correspondance-voie-publique-en.html",
           {"titre": "IDFM - Rules for correspondence and correspondence by public highway (version anglaise de la "
                     "page « Règles de correspondances et correspondances par la voie publique »)",
            "millesime": "« Published on 2024 October 30 - Updated on 2026 February 20 » (mention de la page)",
            "licence": _LIC, "granularite": "liste des correspondances par la voie publique",
            "geographie": "Île-de-France",
            "traitements": "24 lignes de la liste recopiées ; stations rattachées à la main aux stations parentes du "
                           "GTFS IDFM (ticket_rules.STREET_GROUPS, noms contrôlés)",
            "controles": _CTRL + " ; nom GTFS de chaque station parente contrôlé",
            "limites": "version anglaise traduite automatiquement (noms de stations traduits, ex. « Bleach » pour "
                       "Javel) ; la version française répond HTTP 403 au robot"},
           user_agent=_UA),
)
