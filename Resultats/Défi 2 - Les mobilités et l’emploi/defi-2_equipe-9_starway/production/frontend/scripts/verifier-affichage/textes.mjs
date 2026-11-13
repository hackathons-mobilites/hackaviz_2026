/**
 * Contrôle de l'affichage : formats français et phrases attendues. Arrondis de l'affichage documentés (docs/verifier-affichage.md) :
 * - entiers (postes, minutes, grammes) : à l'unité ;
 * - pourcentages : `Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })` sur le ratio exact ;
 * - euros : `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })` ;
 * - durée d'un tronçon : minute la plus proche, au moins 1 min.
 * Ces phrases sont les seules choses à ajuster si un libellé change sur le site.
 */

const nf = new Intl.NumberFormat('fr-FR');
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

/** Espaces insécables, apostrophes, espaces multiples : neutres pour la comparaison */
export function normalise(s) {
  return String(s ?? '')
    .replace(/[   ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export const fmtInt = (n) => normalise(nf.format(Math.round(n)));
export const fmtPct = (v) => `${normalise(nf1.format(v))} %`;
export const fmtEur = (v) => normalise(euros.format(v));
export const fmtKm = (m) => normalise(nf1.format(m / 1000));

/** 495 -> « 8h15 », 540 -> « 9h » */
export function fmtHeure(minutes) {
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/** Durée d'un tronçon affichée : minute la plus proche, au moins 1 */
export const minTroncon = (m) => Math.max(1, Math.round(m));

/** Distance affichée d'un tronçon à pied */
export function distanceTexte(m) {
  if (typeof m !== 'number' || !Number.isFinite(m) || m < 0) return null;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${String(Math.round(m / 100) / 10).replace('.', ',')} km`;
}

export const NOM_COURT_COMMUNE = (n) => n.replace(/\s+Arrondissement$/i, '');

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export function jourDeLaDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? JOURS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] : null;
}

/** Libellés de famille de transport (contrat itineraries, champ `m`) */
export const FAMILLE = { walk: 'Marche', metro: 'Métro', rer: 'RER', train: 'Transilien', ter: 'TER', rail: 'Train', tram: 'Tram', bus: 'Bus', trolleybus: 'Trolleybus', cable: 'Câble', cable_tram: 'Tramway à câble', funicular: 'Funiculaire', monorail: 'Monorail', ferry: 'Navette fluviale' };

export function titreTroncon(leg) {
  const k = leg.m ? FAMILLE[leg.m] : null;
  if (leg.m === 'walk') return 'Marche';
  if (k && leg.line) return `${k} ${leg.line}`;
  return k ?? (leg.line ? `Ligne ${leg.line}` : 'Ligne non renseignée');
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function moisTexte(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(ym ?? '');
  return m && MOIS[+m[2] - 1] ? `${MOIS[+m[2] - 1]} ${m[1]}` : null;
}

export function faitsLigneCourts(leg, texts, avecMois = false) {
  if (leg.m === 'walk' || leg.m == null) return null;
  const parts = [];
  if (leg.on_demand === true) parts.push('transport à la demande, sur réservation');
  if (leg.air_conditioning !== undefined) {
    const v = leg.air_conditioning ?? 'unknown';
    const ac = texts?.air_conditioning?.values?.[v] ?? { true: 'oui', partial: 'partielle', false: 'non', unknown: 'non renseignée' }[v];
    parts.push(`climatisation : ${ac}`);
  }
  const p = leg.punctuality;
  if (p !== undefined) {
    const mois = moisTexte(p?.month);
    const rail = leg.m === 'rer' || leg.m === 'train';
    // Audit d'affichage du 11/11 (T4) : le mois est dans le « i » des lignes, hors mode sources
    if (p && rail && p.value_pct != null && mois) parts.push(`ponctualité : ${fmtPct(p.value_pct)}${avecMois ? ` (${mois})` : ''}`);
    else if (p?.reason === 'month_not_published') parts.push(`ponctualité : ${texts?.punctuality?.month_not_published ?? 'mois non publié pour cette ligne'}`);
    else parts.push('ponctualité : pas de donnée ouverte');
  }
  return parts.length ? parts.join(' · ') : null;
}

export const PHRASE = {
  // P10 (audit du 11/11) : sans mode sources, le dénominateur est dans le « i » de la barre de part
  atteintsLigne: (r, m, src = false) => `${fmtInt(r)} postes salariés (INSEE) atteints aller et retour${src ? `, sur ${fmtInt(m)}` : ''}`,
  selfNote: (n) => `Votre commune : ${fmtInt(n)} poste${n > 1 ? 's' : ''}, trajet non mesuré, hors du pourcentage.`,
  nonCalculesNote: (n) => `${fmtInt(n)} postes dans des communes non calculées.`,
  aucunTrajetAller: (lim, td, walk) => `${td ? `aucun départ dans les ${lim} avant le début du poste n'arrive à l'heure` : `aucun trajet trouvé en ${lim} ou moins`}${walk ? `, avec au plus ${walk} à pied à chaque bout` : ''}`,
  aucunTrajetRetour: (lim, td, walk) => `${td ? `aucune arrivée trouvée dans les ${lim} après la fin du poste` : `aucun trajet trouvé en ${lim} ou moins`}${walk ? `, avec au plus ${walk} à pied à chaque bout` : ''}`,
  // Audit d'affichage du 11/11 : plus de phrase hors TC (P27) ; horaires libres raccourcie (P28, D9) ; « exemple de trajet » dans le titre (T1)
  itinJournees: () => 'Détail du trajet : non calculé en horaires libres.',
  // D-066 : titre recomposé par la lecture à partir du bloc « Trajet » (titre, sens pressé, départ et arrivée)
  transportsTitre: (sens, dep, arr, exemple = false) => `Trajet (${sens}${exemple ? ', exemple de trajet' : ''}) · ${dep} → ${arr}`,
  ticketTotal: (e) => `Aller et retour : ${fmtEur(e)}`,
  // Le détail par sens et la phrase de garde sont dans le « i » (retiré à la lecture) : il reste « (estimation). »
  carboneOk: (t) => `Carbone : environ ${fmtInt(t)} g CO2e aller et retour (estimation).`,
  carboneNon: (raisons) => `Carbone non calculé : ${raisons.join(' ; ')}.`,
};

/** Besoins : libellés des cases et états (D-034, mots validés avec Sara) */
export const BESOINS = {
  ordre: ['wc_trip', 'wc_stops', 'station', 'audio', 'visual'],
  ciel: ['wc_trip', 'wc_stops', 'station'],
  libelle: {
    wc_trip: 'Véhicules déclarés adaptés au fauteuil roulant',
    wc_stops: 'Arrêts déclarés adaptés au fauteuil roulant',
    station: "Gares sans réservation d'assistance",
    audio: 'Annonces sonores',
    visual: 'Annonces visuelles',
  },
  etat: {
    filled: 'rempli sur tout le trajet',
    not_filled: 'non rempli : au moins une source déclare le contraire',
    not_stated: 'non renseigné : au moins une valeur absente de la source',
    no_station: 'aucune gare ferrée du jeu sur ce trajet, la case ne bloque pas',
    no_ride: 'aucun transport en commun sur ce trajet, rien de déclaré',
  },
  marqueAria: "marque : tout ce que vous avez coché est déclaré rempli sur le trajet le plus rapide, aller et retour ; à confirmer avant de partir",
  marqueVerdictOui: 'Astre marqué',
};

export const OR_MENTION = 'or : gain démontré';

export const ALT_ETAT = {
  pasEncore: 'Pas encore calculé',
  sansAutre: "Calculé, pas d'autre trajet",
  // Case calculée dont le trajet A n'est pas l'itinéraire publié (a_lines différent, ou pas d'itinéraire publié) : jamais « Pas encore calculé »
  nonAffiche: 'Calcul fait, non affiché',
};
