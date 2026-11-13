SELECT
    CAST(id_line AS varchar)            AS id_ligne,
    CAST(name_line AS varchar)          AS nom_ligne,
    CAST(shortname_line AS varchar)     AS nom_court,
    CAST(transportmode AS varchar)      AS mode,            -- bus, metro, rail, tram, funicular...
    CAST(transportsubmode AS varchar)   AS sous_mode,       -- regionalRail, suburbanRailway, local...
    CAST(operatorname AS varchar)       AS exploitant,
    CAST(networkname AS varchar)        AS reseau,
    CAST(accessibility AS varchar)      AS accessibilite,
    CAST(status AS varchar)             AS statut,          -- active / prochainement active
    CAST(valid_fromdate AS varchar)     AS valide_depuis
FROM {{ source('open_data', 'idfm_lignes') }}
