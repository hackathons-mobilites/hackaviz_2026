{#
  Mailles d'agrégation utilisées par les faits. Pour chaque maille :
  - maille      : libellé stocké dans dim_geo.maille (clé stable, utilisée par le dashboard)
  - residence   : colonne de int_mobpro_territoires donnant le code du territoire de résidence
  - travail     : même chose pour le lieu de travail
  - geo         : colonne de stg_cog_communes permettant de rattacher une commune à la maille
#}
{% macro mailles() %}
    {{ return([
        {'maille': 'Commune',       'residence': 'commune_residence', 'travail': 'commune_travail', 'geo': 'codgeo'},
        {'maille': 'EPCI',          'residence': 'epci_residence',    'travail': 'epci_travail',    'geo': 'epci'},
        {'maille': "Zone d'emploi", 'residence': 'ze_residence',      'travail': 'ze_travail',      'geo': 'zone_emploi'},
        {'maille': "Bassin d'emploi", 'residence': 'be_residence',    'travail': 'be_travail',      'geo': 'bassin_emploi'},
        {'maille': 'Département',   'residence': 'dep_residence',     'travail': 'dep_travail',     'geo': 'departement'},
        {'maille': 'Région',        'residence': 'region_residence',  'travail': 'reg_travail',     'geo': 'region'},
    ]) }}
{% endmacro %}

{# Libellé de maille sous forme de littéral SQL (gère l'apostrophe de "Zone d'emploi"). #}
{% macro lit(s) -%}
    '{{ s | replace("'", "''") }}'
{%- endmacro %}

{# ROUND portable DuckDB / PostgreSQL (Postgres refuse round(double, int)). #}
{% macro arrondi(expr, n=2) -%}
    ROUND(CAST({{ expr }} AS numeric), {{ n }})
{%- endmacro %}
