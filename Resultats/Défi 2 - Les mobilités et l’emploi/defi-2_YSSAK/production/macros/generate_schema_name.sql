{#
  Par défaut dbt préfixe les schémas personnalisés par le schéma de la cible
  (prod_hakathon_staging). On veut des noms lisibles : staging, intermediate,
  referentiels, et prod_hakathon pour les tables finales.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
