/**
 * Mentions de licence obligatoires, écrites une seule fois (audit du 03/11, point 3).
 * OpenStreetMap (ODbL) : les temps de trajet sont calculés sur les rues OSM, une production dérivée
 * doit citer « © les contributeurs d'OpenStreetMap » (page de droits d'auteur d'OSM, GEO03 du catalogue).
 */
export const OSM_CREDIT = "© les contributeurs d'OpenStreetMap";

/**
 * Forme courte sous le ciel hors mode provenance (choix de Nicolas, 13/11) : « © OpenStreetMap » avec le lien vers la page
 * des droits d'auteur, forme admise par les consignes d'attribution d'OpenStreetMap ; le nom accessible garde la forme longue.
 */
export const OSM_CREDIT_SHORT = '© OpenStreetMap';

/** Page officielle des droits d'auteur et de la licence d'OpenStreetMap. */
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

/**
 * Producteurs crédités en clair, hors mode sources (accord de l'organisateur du hackathon du 09/11/2026, D-060 :
 * « producteur crédité dans la dataviz elle-même »), par code du manifeste. Une chaîne vide : rien à créditer (fichier
 * construit par STARWAY, logiciel). Un code absent de la table est crédité par le producteur lu dans le titre publié
 * (sources.json), jamais oublié. OpenStreetMap (CYC01) a sa mention propre, OSM_CREDIT.
 */
export const CREDIT_NAMES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    ['TRA01', 'TRA01B', 'TRA01C', 'TRA02', 'TRA02B', 'TRA02C', 'TRA02D', 'TRA02E', 'TRA03', 'TRA04', 'COST01', 'COST02', 'SUB01', 'SUB02', 'SUB03', 'TKT01', 'ENV01'].map((c) => [
      c,
      'Île-de-France Mobilités',
    ]),
  ),
  ...Object.fromEntries(['EMP01', 'EMP02', 'EMP05', 'GEN01', 'GEN04', 'GEO02', 'GEO05', 'SOC01', 'SOC02'].map((c) => [c, 'INSEE'])),
  ...Object.fromEntries(['GEO04', 'GEO04B', 'EMP03'].map((c) => [c, 'France Travail'])),
  ...Object.fromEntries(['ENV02', 'VEH01', 'CO2-01'].map((c) => [c, 'ADEME'])),
  ...Object.fromEntries(['VEL01', 'SUB04'].map((c) => [c, "Vélib' Métropole"])),
  GEO01: 'API Géo',
  ROAD01: 'DiRIF',
  COST06: 'EDF',
  COST07: "Ministère de l'Économie",
  COST08: 'SDES',
  SUB05: 'Service Public',
  EMP04: 'Choisir le service public',
  QS01: 'SNCF Voyageurs',
  GEO06: 'Institut Paris Region',
  GEO02B: '',
  ENG01: '',
};
