"""06y - Textes publics du manifeste : retire le jargon interne des colonnes que `sources.json` reprend.

Retire ou reformule, dans `titre`, `millesime`, `date_service_transport`, `licence`, `geographie`, `traitements`,
`controles` et `limites` : renvois de décision, chemins de scripts ou de fichiers, codes d'étapes du pipeline, mention
« à confirmer par un humain », nom interne de la machine de calcul (« VM »). Seule exception sur `url_source` (audit du
10/11) : le texte écrit après l'adresse, entre parenthèses, est déplacé dans `millesime` (« URL résolue : ... » pour une
redirection de téléchargement, « code source : ... » sinon) pour que le lien du mode sources soit une seule adresse ;
l'adresse elle-même ne change pas. Ne touche à aucune autre colonne, donc à aucune empreinte, aucune date
d'extraction, et ne change aucune licence (seulement la façon de l'écrire).
À lancer après `04o` et avant `06r`. `07d` l'applique aussi à la ligne TRA02 qu'il réécrit, et `07` échoue (P0) si
un motif de `RESIDUE` reste dans `sources.json`.

    python scripts/06y_textes_publics_manifeste.py            # montre ce qui changerait, code 1 s'il reste un motif
    python scripts/06y_textes_publics_manifeste.py --write    # écrit ; une seconde exécution ne change rien
"""

from __future__ import annotations

import csv
import io
import re
import sys

from starway.config import MANIFEST_PATH
from starway.sources import with_resolved

csv.field_size_limit(10**7)
COLS = ("titre", "millesime", "date_service_transport", "licence", "geographie", "traitements", "controles", "limites")

# (motif, remplacement), appliqués dans l'ordre : les formules exactes d'abord, les règles générales ensuite
RULES = [
    (r"à confirmer par un humain", "licence à confirmer"),
    # formules exactes, avant les règles générales
    (r"\(copie exacte de ~/d031/navitia_same_stop_min\.csv\)", "(copie exacte du fichier de la VM)"),
    (r"D-036 \(06q, starway/service_public\.py\) : ", ""),
    (r"D-036 \(06q\) : ", ""),
    (r"D-028 \(06h, starway/fares_carbon\.py\) : ", ""),
    (r" \(scripts/06j_export_bmo\.py, starway/bmo\.py, D-035\)", ""),
    (r" \(starway/sky_groups\.py, scripts/03b_sky_groups\.py\)", ""),
    (r" ; D-030 \(04/11\) : ", " ; depuis le 04/11 : "),
    (r"\(D-030, choix de l'équipe", "(choix de l'équipe"),
    (r"construit par pipeline/scripts/03b_sky_groups\.py", "construit par le pipeline"),
    (r"écrit par pipeline/scripts/02_build_geo\.py \(starway/origin_points\.py\)", "écrit par le pipeline"),
    (r"écrit par 03b --publish", "écrit par le pipeline"),
    (r" \(data/processed/poles_d030\.json, aperçu frontend/public/data/preview-d030/\)", ""),
    (r"reporté dans starway/\w+\.py, vérifié par 05", "reporté dans le code du pipeline et vérifié à la construction du contexte"),
    (r"reportés dans starway/fares_carbon\.py", "reportés dans le code du pipeline"),
    (r"règles reprises dans starway/fares_carbon\.count_tickets", "règles reprises dans le code du pipeline"),
    (r"appliqués par starway/fares_carbon\.count_tickets", "appliqués par le pipeline"),
    (r"appliquées par starway/fares_carbon\.py", "appliquées par le pipeline"),
    (r"reporté dans starway/vehicles\.py \(voiture électrique, meta\.vehicles\)", "reporté dans le code du pipeline (voiture électrique)"),
    (r"lues par starway/vehicles\.py", "lues par le pipeline"),
    (r" \(starway/vehicles\.py\)", ""),
    (r"reportés dans starway/congestion\.py, publiés par 06 \(meta\.car_congestion\)", "reportés dans le code du pipeline et publiés dans les données du site"),
    (r"par starway/subscriptions\.py", "par le pipeline"),
    (r"lu par 07h \(contrôle des correspondances, D-031\)", "lu pour le contrôle des correspondances"),
    (r"publiés dans itineraries/ par 06t \(D-031 c, 04/11/2026\)", "publiés dans les itinéraires (04/11/2026)"),
    (r" \(STOP_PAIR, D-031 a1, starway/r5_transfers\.py, 04/11/2026\)", " (04/11/2026)"),
    (r"construit sur la VM le 05/11 \(~/b44/night/make_gtfs\.py\), règle reprise avec ses tests dans pipeline/starway/night_gtfs\.py et scripts/04m_build_night_gtfs\.py", "construit sur la VM le 05/11, règle reprise avec ses tests dans le pipeline"),
    (r"par ~/b44/night/soir/make_gtfs_soir\.py \(script recopié tel quel dans pipeline/scripts/04n_make_gtfs_soir\.py, sha256", "par un script recopié tel quel dans le pipeline (sha256"),
    (r" à partir de ~/b44/night/gtfs_nuit\.zip \(TRA01B", " à partir du réseau de nuit (TRA01B"),
    (r"(?<=, )D-031 a2\) \(une par requête", "connexions) (une par requête"),
    (r"ajoutées le 04/11 à 10h, connexions\)", "ajoutées le 04/11 à 10h)"),
    (r"comparaison par scripts/07d_navitia_crosscheck\.py \(réglage de marche publié D-024 et", "comparaison par le contrôle Navitia du pipeline (réglage de marche publié et"),
    (r", sonde 07e_access_cap_probe\.py", ", sonde de la limite d'accès"),
    (r" par 07i_navitia_connections\.py", " par le pipeline"),
    (r" par 07j_navitia_transfer_sample\.py", " par le pipeline"),
    (r" ; scripts/07i_navitia_connections\.py, une requête", " ; une requête"),
    (r" \(moteur R5 corrigé, pipeline/r5/r5-d031-transfer-rules\.patch\)", " (moteur R5 corrigé)"),
    (r"le recalcul D-031 de la VM", "le recalcul de la VM"),
    (r"celle du recalcul D-031 de la VM", "celle du recalcul de la VM"),
    (r"dans run_params\.json de matrix_walk\{3000,1000\}_d031, od_walk\{3000,1000\}_d031, itineraries_walk3000_d031 et matrix_story_d031", "dans les paramètres des calculs de temps de trajet, des tables commune par commune et des itinéraires"),
    (r" \(scripts/07f_panel_sources_coverage\.py, starway/panel_sources\.py\)", ""),
    (r" ; proposition docs/proposition-panneau-preuve\.md § 3", ""),
    (r" ; proposition docs/proposition-panneau-preuve\.md § 2 et 3", ""),
    (r"proposition docs/proposition-panneau-preuve\.md § 2 et 3 ; ", ""),
    (r"06n \(starway/needs\.py\) : ", ""),
    (r" \(data/raw/TRA03/2023_idfm_referentiels\.pdf", " (PDF de 2023"),
    (r"\(217 requêtes le 05/11, tools/prim/releves_05_11\.py qui charge scripts/07i_navitia_connections\.py sans le modifier, ", "(217 requêtes le 05/11, "),
    (r"07k --online \(tools/prim/releves_05_11\.py\) : ", ""),
    (r" \(data/processed/ademe_2rm_conso_lecture\.csv\)", ""),
    (r"comptage de couverture par 05b_velib_coverage\.py \(data/processed/velib_coverage_2026\.csv\)", "comptage de couverture"),
    (r"calculés par 04d_compute_velib\.py \(data/interim/matrix_velib/velib_any\.csv\)", "calculés par le pipeline"),
    (r"publiés dans le mode velib \(frontend/public/data/access/\{insee\}\.json, modes\.velib\.any ; meta\.modes et meta\.velib\), D-027", "publiés dans le mode Vélib' du site"),
    (r" ; proposition docs/proposition-velib\.md[^;]*", ""),
    (r" \(02_build_geo\.py, analyse : docs/analyse-points-origine\.md[^)]*\)", ""),
    (r"06v \(starway/territoire\.py\) : ", ""),
    (r"pipeline/r5/build_r5_(walk|d031)\.sh (\d+) \(script sha", r"le script de construction du jar (sha"),
    (r" \(patch pipeline/r5/r5-walk\d+\.patch, sha256", " (patch de sources, sha256"),
    (r"puis le patch pipeline/r5/r5-d031-transfer-rules\.patch \(sh", "puis le patch des règles de correspondance (sh"),
    (r"puis seulement le patch pipeline/r5/r5-d031-transfer-rules\.patch \(sh", "puis seulement le patch des règles de correspondance (sh"),
    (r"\(aucun commit D-024\)", "(aucune modification de cette limite)"),
    (r"\(D-031 pas encore appliqué\)", "(avant la correction des correspondances)"),
    (r"avant les règles D-031", "avant la correction des règles de correspondance"),
    (r"variante D-022 non retenue", "variante non retenue"),
    (r"entrée de la variante D-022 \(matrix_walk7200\), non retenue", "entrée d'une variante non retenue"),
    (r"règles de correspondance D-031", "règles de correspondance corrigées"),
    (r"entrée de 04g \(distances voiture : r5_jar_sha256 dans les run_params\.json de car_dist, car_dist_carspeed_v2_b44\)", "entrée du calcul des distances voiture (empreinte du jar dans les paramètres de ces calculs)"),
    (r"les dossiers dont les run_params\.json n'écrivent aucun jar", "les calculs dont les paramètres n'écrivent aucun jar"),
    (r"r5_commit non écrit dans les run_params\.json de ces dossiers", "version du code non écrite dans les paramètres de ces calculs"),
    (r"\bvoir docs/methodologie\.md § 5 quaterdecies", "voir la méthodologie"),
    (r"\bdocs/methodologie\.md § 5 quaterdecies", "la méthodologie"),
    (r"(?<=montants de l'A5 du site) \(toll_t\w+\.py\)", ""),
    (r"à vérifier par un humain", "à vérifier"),
    (r"à relire par un humain", "à relire"),
    (r" \(docs/methodologie\.md § 5 duodecies\)", ""),
    (r"des itinéraires \(04h\)", "des itinéraires"),
    (r"= (\d+) \(D-024, une ligne changée\)", r"= \1 (une ligne changée)"),
    (r"entrée de 04g \(distances voiture : r5_jar_sha256 dans les paramètres de ces calculs\)", "entrée du calcul des distances voiture"),
    (r"entrée de 04g \(distances voiture : r5_jar_sha256 dans les run_params\.json de car_dist, car_dist_carspeed_v2\w*\)", "entrée du calcul des distances voiture (empreinte du jar dans les paramètres de ces calculs)"),
    (r" \(liste dans docs/tracabilite\.md, générée\)", ""),
    (r" \(voir docs/methodologie\.md\)", " (voir la méthodologie)"),
    (r" \(docs/analyse-points-origine\.md\)", ""),
    (r" ; proposition docs/proposition-panneau-preuve\.md § 1", ""),
    (r"\(T3, docs/plan-contexte-territoire\.md\)", "(prévu au plan)"),
    (r" \(starway/toll_tariffs\.py\)", ""),
    (r"\(API connections, 07i\)", "(API connections)"),
    (r"; voir docs/methodologie\.md § 5", "; voir la méthodologie"),
    (r" \(D-031 a2, ligne TRA02B\)", " (ligne TRA02B)"),
    (r" \(D-031 c, 06t\)", ""),
    (r"entrée de 04g \(distances voiture : r5_jar_sha256 dans les run_params\.json de car_dist, car_dist_carspeed_v2 et car_dist_carspeed_v2_b44\)", "entrée du calcul des distances voiture (empreinte du jar dans les paramètres de ces calculs)"),
    (r" \((?:matrix|od_walk|itineraries)[\w, {}]*\)", ""),
    (r"lu par starway\.r5_transfers \(moteur R5 corrigé\)", "lu par le moteur R5 corrigé"),
    (r" poles_d030\.json, fichier dérivé", ", fichier dérivé"),
    (r" \(communes_idf_2026\.csv\), fichier dérivé", ", fichier dérivé"),
    (r"identiques dans navitia_same_stop_min\.csv \(TRA02B, 638 arrêts\)", "identiques dans la version de 638 arrêts (TRA02B)"),
    (r" : meta\.vehicles\.co2_kg_per_km", ""),
    (r" : od_walk\{3000,1000\}_d031_nuit_(?:matin|soir_v2)\)", ")"),
    (r" \(matrix_walk1000_d031\*, itineraries_walk1000_d031_b44, od_walk1000_d031\*\)", ""),
    (r" \(matrix_walk3000_d031\*, itineraries_walk3000_d031\*, od_walk3000_d031\* dont le matin", " (dont le matin"),
    (r" \(matrix_story_d031_b44 et matrix_bike_transit_all_d031_b44_\*\)", ""),
    # colonne « controles »
    (r"\(contrôle bloquant dans 05\)", "(contrôle bloquant du pipeline)"),
    (r"\(contrôle bloquant de vehicles\.py\)", "(contrôle bloquant du pipeline)"),
    (r"empreinte vérifiée par 07", "empreinte vérifiée par les contrôles du pipeline"),
    (r"\(vérifié par 07\)", "(vérifié par les contrôles du pipeline)"),
    (r"contrôle 07 « ", "contrôle « "),
    (r" \(scripts/06j_export_bmo\.py, 07\)", ""),
    (r"voir docs/methodologie\.md § 5 novemdecies ; 07 « service public D-036 »", "voir la méthodologie ; contrôle « service public »"),
    (r" \(07f\)", ""),
    (r", docs/proposition-congestion\.md § 3", ""),
    (r" \(07\)", ""),
    (r"chaque phrase reprise par starway/subscriptions\.py doit", "chaque phrase reprise par le pipeline doit"),
    (r"\(contrôle P0 « abonnements » de 07\)", "(contrôle bloquant « abonnements »)"),
    (r"phrases citées par starway/ticket_rules\.py", "phrases citées par le pipeline"),
    (r"\(contrôle P0 de 07\)", "(contrôle bloquant)"),
    (r" \(tests/test_ticket_rules\.py\)", ""),
    (r" \(data/processed/toll_tariffs_meta\.json\)", ""),
    (r" \(data/processed/toll_crosscheck\.json et toll_crosscheck_a5\.csv\)", ""),
    (r" \(04m --compare-to\)", ""),
    (r", 1 248 courses et 32 326 arrêts \(starway/evening_gtfs\.py, verify_evening_gtfs\)", ", 1 248 courses et 32 326 arrêts"),
    (r" \(starway/evening_gtfs\.py, verify_evening_gtfs, aucun nombre attendu écrit en dur\)", " (aucun nombre attendu écrit en dur)"),
    (r" \(verify_night_gtfs\)", ""),
    (r"07 et 06d acceptent", "les contrôles acceptent"),
    (r"07 needs_ok : ", "contrôle du pipeline : "),
    (r"banc D-031 recoupé avec les trajets Navitia \(methodologie\.md § 5 quindecies\)", "banc des correspondances recoupé avec les trajets Navitia (voir la méthodologie)"),
    (r"égal à r5_jar_sha256 des run_params\.json de ces dossiers", "égal à l'empreinte écrite dans les paramètres de ces calculs"),
    (r"égal à r5_jar_sha256 du run_params\.json de matrix_walk7200", "égal à l'empreinte écrite dans les paramètres de ce calcul"),
    (r"égal à r5_commit", "égal à la version écrite dans les paramètres"),
    (r" \(jar_pairs\)", ""),
    (r" \(engine_diff\)", ""),
    (r"par starway\.origin_points sur", "par le pipeline sur"),
    (r"= valeur des run_params\.json des calculs", "= valeur écrite dans les paramètres des calculs"),
    (r"07 refuse des lots", "les contrôles refusent des lots"),
    (r"accepté aussi par 07", "accepté aussi par les contrôles"),
    (r"07 \(check_d030_set, check_d030_preview\) recalcule", "le contrôle du pipeline recalcule"),
    (r"poles_json_sha256 des run_params\.json des dossiers \*_b44 = cette empreinte", "empreinte des astres écrite dans les paramètres des calculs = cette empreinte"),
    (r"(?:(?<=^)|(?<=; ))07 « ", "contrôle « "),
    (r"(?:(?<=^)|(?<=; ))07 : ", "contrôle du pipeline : "),
    (r" \(starway/gtfs_reference_day\.py, data/gtfs_lignes_sans_service\.csv\)", ""),
    (r"\(règle de 03\)", "(règle du pipeline)"),
    (r"\(EMP01, 03\)", "(EMP01)"),
    (r"les lots de 04h", "les lots du calcul des itinéraires"),
    (r"voir le journal de 07", "voir le journal des contrôles"),
    # colonnes millesime, date_service_transport et geographie (ajoutées le 10/11)
    (r" ; voir starway/config\.py\)", ")"),
    (r", conservé dans data/flux_gtfs_precedents\.csv", " (empreinte et date de l'ancien flux conservées dans le dépôt)"),
    (r", contrôle automatique dans 07_quality_checks\.py", ", contrôle automatique du pipeline"),
    (r" par starway/vehicles\.py\)", " par le pipeline)"),
    (r" \(écart documenté dans docs/limites\.md\)", " (écart documenté dans les limites du projet)"),
    # licences : note de téléchargement de l'équipe, licence de France Travail non confirmée (10/11)
    (r"\(écrite dans la PROVENANCE\.txt : «", "(notée au téléchargement : «"),
    (r"= manifeste = PROVENANCE\.txt", "= manifeste = note de téléchargement"),
    (r"\. À confirmer auprès de France Travail avant le dépôt si possible", ". Licence non confirmée par France Travail"),
    (r" ; à confirmer auprès de France Travail avant le dépôt si possible", " ; licence non confirmée par France Travail"),
    (r", à confirmer auprès de France Travail avant le dépôt", ", licence non confirmée par France Travail"),
    # autres trajets du panneau (10/11, PR 135) : codes d'étapes 04q et 06w
    (r"correspondances : 04q en 9h-17h et 14h-22h puis export 06w ;", "correspondances ; en 9h-17h et 14h-22h ;"),
    (r" \(04q, export 06w, 10/11/2026\)", " (10/11/2026)"),
    # règles générales
    (r"(?:(?<=^)|(?<=; ))0[1-8][a-z]? : ", ""),
    (r" \(D-\d{3}(?: [a-z]\d?)?\)", ""),
    (r", D-\d{3}(?: [a-z]\d?)?\)", ")"),
    (r"D-031 c, 06t\)", ""),
    (r"\bVM\b", "machine de calcul"),  # nom interne (10/11) : en dernier, après les formules qui le contiennent
]
RESIDUE = re.compile(r"D-\d{2,3}|\.py\b|~/|\bscripts/|\bpipeline/|\bstarway/|\btools/|data/(?:raw|interim|processed|flux_)|frontend/|"
                     r"\bVM\b|PROVENANCE\.txt|avant le dépôt|"
                     r"docs/|\btests/|run_params|matrix_\w|od_walk|itineraries_walk|verify_\w|check_d030|needs_ok|jar_pairs|engine_diff|(?:^|[ (])0[1-8](?![\w/:]| et )|par un humain|(?:^|[ (])0[1-8][a-z](?=[ ,):])")


def clean(value: str) -> str:
    for pattern, replacement in RULES:
        value = re.sub(pattern, replacement, value)
    return value.replace(" ; ;", " ;").strip()


# `url_source` suivie d'un texte entre parenthèses : « https://... (résolue : https://...) », « https://... (tag ..., commit ...) »
URL_NOTE = re.compile(r"^(https?://\S+) \((.+)\)$")


def public_url(url: str, millesime: str) -> tuple[str, str]:
    """(`url_source` réduite à l'adresse, `millesime` qui reçoit le texte qui suivait). Inchangés sans texte après l'adresse."""
    m = URL_NOTE.match(url.strip())
    if not m:
        return url, millesime
    address, note = m.group(1), m.group(2).strip()
    if note.startswith("résolue : "):
        return address, with_resolved(millesime, note.removeprefix("résolue : ").strip())
    note = f"code source : {note}"
    if note in millesime:
        return address, millesime
    return address, f"{millesime} ; {note}" if millesime else note


def clean_lines(text: str) -> tuple[list[str], int, list[str]]:
    """(lignes du fichier, lignes changées, motifs restants). Une ligne non changée reste identique au caractère près."""
    lines = text.split("\n")
    header = next(csv.reader([lines[0]]))
    changed = 0
    left: list[str] = []
    for n, line in enumerate(lines):
        if n == 0 or not line:
            continue
        row = next(csv.reader([line]))
        before = list(row)
        for col in COLS:
            if col not in header:  # manifeste réduit (tests)
                continue
            i = header.index(col)
            row[i] = clean(row[i])
            left += [f"{row[0]} {col} : {row[i][max(0, m.start() - 40):m.end() + 30]}" for m in RESIDUE.finditer(row[i])]
        if "url_source" in header and "millesime" in header:
            iu, im = header.index("url_source"), header.index("millesime")
            row[iu], row[im] = public_url(row[iu], row[im])
            if re.search(r"\s", row[iu].strip()):
                left.append(f"{row[0]} url_source : texte après l'adresse sans règle ({row[iu][:80]})")
        if row != before:
            changed += 1
            out = io.StringIO(newline="")
            csv.writer(out, lineterminator="\n").writerow(row)
            lines[n] = out.getvalue().rstrip("\n")
    return lines, changed, left


def main() -> int:
    raw = MANIFEST_PATH.read_bytes().decode("utf-8")
    crlf = "\r\n" in raw
    lines, changed, left = clean_lines(raw.replace("\r\n", "\n"))
    print(f"{changed} lignes à changer, {len(left)} motifs restants")
    for item in sorted(set(left)):
        print("  " + item)
    if "--write" in sys.argv[1:]:
        text = "\n".join(lines)
        MANIFEST_PATH.write_bytes((text.replace("\n", "\r\n") if crlf else text).encode("utf-8"))
        print(f"écrit : {MANIFEST_PATH}")
    return 1 if left else 0


if __name__ == "__main__":
    raise SystemExit(main())
