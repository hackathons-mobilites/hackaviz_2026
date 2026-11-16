// Rames de métro : un point par ligne qui fait l'aller-retour sur son parcours (pipeline/06-parcours.geojson)
// - vitesse visuelle identique pour toutes les lignes (une longue ligne met plus de temps) ;
//   départs décalés d'une ligne à l'autre pour éviter un mouvement synchrone
// - la position ne dépend que d'une horloge (ms) : temps réel en lecture normale, temps de l'image pendant le tournage vidéo
// - les points portent l'année du parcours : le filtre de la frise les fait apparaître avec la ligne complète

const KM_PAR_DEGRE_LAT = 110.57;
const KM_PAR_DEGRE_LON_EQUATEUR = 111.32;

// Distances cumulées le long du tracé (approximation équirectangulaire, suffisante à l'échelle d'une ligne)
function preparer({ geometry, properties }, i) {
  const coords = geometry.coordinates;
  const cumul = [0];
  for (let k = 1; k < coords.length; k++) {
    const [[x1, y1], [x2, y2]] = [coords[k - 1], coords[k]];
    const dx = (x2 - x1) * KM_PAR_DEGRE_LON_EQUATEUR * Math.cos((((y1 + y2) / 2) * Math.PI) / 180);
    const dy = (y2 - y1) * KM_PAR_DEGRE_LAT;
    cumul.push(cumul[k - 1] + Math.hypot(dx, dy));
  }
  const total = cumul.at(-1);
  return { coords, cumul, total, depart: ((i * 0.618) % 1) * 2 * total, properties };
}

// Point à la distance d du début du tracé
function pointA({ coords, cumul }, d) {
  let bas = 0;
  let haut = cumul.length - 1;
  while (haut - bas > 1) {
    const milieu = (bas + haut) >> 1;
    if (cumul[milieu] <= d) bas = milieu;
    else haut = milieu;
  }
  const f = (d - cumul[bas]) / (cumul[haut] - cumul[bas] || 1);
  const [[x1, y1], [x2, y2]] = [coords[bas], coords[haut]];
  return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
}

export function installerRames(map, parcours, { source = "rames", couche = "rames", kmParSeconde = 0.8 } = {}) {
  const rames = parcours.features.map(preparer);

  const positions = (ms) => ({
    type: "FeatureCollection",
    features: rames.map((r) => {
      // aller-retour : distance parcourue repliée sur [0, total]
      const cycle = (r.depart + (kmParSeconde * ms) / 1000) % (2 * r.total);
      const d = cycle <= r.total ? cycle : 2 * r.total - cycle;
      return { type: "Feature", geometry: { type: "Point", coordinates: pointA(r, d) }, properties: r.properties };
    }),
  });

  const placerA = (ms) => map.getSource(source).setData(positions(ms));

  let suspendu = false;
  const boucle = (ms) => {
    if (!suspendu && map.getLayoutProperty(couche, "visibility") !== "none") placerA(ms);
    requestAnimationFrame(boucle);
  };
  requestAnimationFrame(boucle);

  return {
    placerA,
    // tournage : la boucle temps réel s'arrête, chaque image place les rames à son propre temps
    suspendre: (oui) => (suspendu = oui),
  };
}
