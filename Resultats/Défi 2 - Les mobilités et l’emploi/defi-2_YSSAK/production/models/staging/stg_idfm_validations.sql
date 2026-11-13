-- Validations sur le réseau ferré, par zone de correspondance et par trimestre.
-- Les lignes sans identifiant (ex. "Inconnu", "Aéroport d'Orly") sont conservées
-- avec id_zdc NULL : elles comptent dans le total régional mais pas dans les territoires.

SELECT
    CAST(id_zdc AS bigint)               AS id_zdc,
    CAST(libelle_arret AS varchar)       AS libelle_arret,
    CAST(trimestre AS varchar)           AS trimestre,
    CAST(debut AS date)                  AS date_debut,
    CAST(fin AS date)                    AS date_fin,
    CAST(nb_validations AS bigint)       AS nb_validations
FROM {{ source('open_data', 'idfm_validations_arret') }}
