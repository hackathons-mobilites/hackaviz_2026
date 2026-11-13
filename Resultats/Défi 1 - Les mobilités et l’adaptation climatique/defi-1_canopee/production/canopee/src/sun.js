/**
 * Position du soleil, basse précision.
 *
 * Même famille de formules que le calcul astronomique publié par
 * https://aa.quae.nl/en/reken/zonpositie.html et repris par SunCalc
 * (Vladimir Agafonkin) — c’est aussi ce que jveuxdusoleil.fr appelle
 * via SunCalc, puis passe à OSMBuildings. Les constantes sont celles
 * de ce modèle simplifié, pas celles du Solar Position Algorithm du NREL.
 *
 * Précision attendue : environ 0,3° à 1° sur la hauteur et l’azimut.
 * Suffisant pour une ombre d’immeuble, pas pour un calage au mètre.
 *
 * Entrée `date` : instant UTC (Date).
 * `lat` : degrés, positif au nord. `lon` : degrés, positif à l’est.
 *
 * Sortie :
 * - altitude : radians au-dessus de l’horizon (négatif = nuit)
 * - azimuth : radians, sens horaire depuis le nord (0 = nord, π/2 = est, π = sud)
 */

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

function toDays(date) {
  return date.getTime() / DAY_MS - 0.5 + J1970 - J2000;
}

export function sunPosition(date, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);

  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(OBLIQUITY));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  const sidereal = RAD * (280.16 + 360.9856235 * d) - lw;
  const H = sidereal - ra;

  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H),
  );

  // atan2(sin H, cos H sin φ − tan δ cos φ) : 0 vers le sud, positif vers l’ouest.
  const azFromSouth = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi),
  );
  let azimuth = azFromSouth + Math.PI;
  azimuth = ((azimuth % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  return { altitude, azimuth, declination: dec };
}

/**
 * Vecteur d’ombre au sol, en mètres (est, nord).
 * Longueur = hauteur / tan(hauteur du soleil). Le soleil rasant est borné
 * par `maxMeters` pour ne pas peindre tout le cadre.
 */
export function shadowOffset(altitude, azimuth, heightMeters, maxMeters = 180) {
  if (altitude <= 0.5 * RAD || heightMeters <= 0) return null;
  const raw = heightMeters / Math.tan(altitude);
  const length = Math.min(raw, maxMeters);
  return {
    east: -Math.sin(azimuth) * length,
    north: -Math.cos(azimuth) * length,
    length,
    raw,
    capped: raw > maxMeters + 0.5,
  };
}

export function degrees(rad) {
  return (rad * 180) / Math.PI;
}
