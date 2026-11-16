// Encadré des températures (canvas en bas à gauche, au-dessus de l'encadré vélo) : graphiques dévoilés au fil de
// l'exploration (l'encadré s'élargit) — au départ le graphique des mois seul
// 1. moyenne mensuelle des TNTXM ((TN + TX) / 2 quotidiennes) des 12 mois de la période ; survol ou clic (mois figé,
//    re-clic ou Échap : libéré) -> graphique 2
// 2. TNTXM de chaque jour du mois (barres) avec les courbes des minimales (TN, bleu) et maximales (TX, rouge) ;
//    survol ou clic (jour fixé, mois figé avec lui) d'un jour -> graphique 3
// 3. 24 heures du jour : courbe de la température horaire T, repères TN (bleu) et TX (rouge) du jour
// Un mois ou un jour survolé reste affiché tant que la souris est dans l'encadré (passage aux graphiques suivants)
// Données : 12-temperatures.geojson (membre racine "series", étape 12) + 12-temperatures-heures.json chargé à la demande
// Heures HTN / HTX fournies en UTC, affichées à l'heure de Paris ; TN couvre 18 h UTC la veille -> 18 h UTC,
// TX 6 h UTC -> 6 h UTC le lendemain : un minimum ou un maximum peut donc tomber la veille au soir ou le lendemain matin

const ORANGE = "#e07b39";
const ORANGE_ESTOMPE = "rgba(224,123,57,0.45)";
const ORANGE_FONCE = "#9c4a14";
const BLEU = "#2c6db5";
const ROUGE = "#c62828";
const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ABREGES = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const JOURS_SEMAINE = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const H = 128;
const GRAPHES = { mois: { x: 10, largeur: 145 }, jours: { x: 175, largeur: 145 }, heures: { x: 340, largeur: 145 } };
const LARGEUR = { 1: 165, 2: 330, 3: 495 }; // largeur du canvas selon le nombre de graphiques affichés
const [HAUT, HAUTEUR] = [56, 50];
const ETIQUETTES_HEURES = [[0, "0h"], [6, "6h"], [12, "12h"], [18, "18h"], [23, "23h"]];

const deg = (v) => (v == null ? "–" : `${v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`);
const dateUTC = (iso) => new Date(`${iso}T00:00:00Z`);
const libelleJour = (iso) => {
  const d = dateUTC(iso);
  return `${JOURS_SEMAINE[d.getUTCDay()]} ${d.getUTCDate()} ${ABREGES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

// heure UTC « hh:mm » du relevé du jour iso -> heure de Paris, précédée de « veille » / « lendemain » si besoin
function heureParis(iso, hhmm, type) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const d = dateUTC(iso);
  // TN : fenêtre 18 h UTC (J-1) -> 18 h UTC (J) ; TX : 6 h UTC (J) -> 6 h UTC (J+1)
  if (type === "tn" && h >= 18) d.setUTCDate(d.getUTCDate() - 1);
  if (type === "tx" && h < 6) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(h, m);
  const jourParis = d.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  const heure = d.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", minute: "2-digit" }).replace(":", " h ");
  return jourParis < iso ? `veille ${heure}` : jourParis > iso ? `lendemain ${heure}` : heure;
}

export function creerGraphiquesTemperatures(canvas, urlHeures) {
  const etat = { station: null, serie: null, moisFixe: null, moisSurvole: null, jourSurvole: null, jourFixe: null, survol: null };
  let heures = null; // Promise -> { debut, stations: { NOM: [[24]…] } } (ou null si indisponible)
  let donneesHeures = null;
  const chargerHeures = () => {
    heures ??= fetch(urlHeures)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
        donneesHeures = d;
        dessiner();
        return d;
      });
    return heures;
  };

  function dessiner() {
    const { station: p, serie } = etat;
    if (!p || !serie) return (canvas.hidden = true);
    const mois = serie.mois;
    const iMois = etat.moisFixe ?? etat.moisSurvole;
    const jours = iMois === null ? [] : serie.jours.filter((j) => j.date.startsWith(mois[iMois].mois));
    const iJour = iMois !== null ? (etat.jourSurvole ?? etat.jourFixe) : null;
    const jour = iJour !== null ? (jours[iJour] ?? null) : null;
    const nGraphes = iMois === null ? 1 : jour ? 3 : 2;
    const avecHeures = nGraphes === 3;

    const L = LARGEUR[nGraphes];
    const r = window.devicePixelRatio || 1;
    canvas.width = L * r;
    canvas.height = H * r;
    canvas.style.width = `${L}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext("2d");
    ctx.scale(r, r);
    const police = (taille, graisse = "") => `${graisse} ${taille}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = "#333";
    ctx.font = police(12, 600);
    let titre = `Températures · ${p.libelle}`;
    while (ctx.measureText(titre).width > L - 20 && titre.length > 10) titre = titre.slice(0, -2);
    ctx.fillText(titre, 10, 17);

    const s = etat.survol;
    const nomMois = (i) => {
      const d = dateUTC(`${mois[i].mois}-01`);
      return { nom: NOMS_MOIS[d.getUTCMonth()], abrege: ABREGES[d.getUTCMonth()], annee: d.getUTCFullYear() };
    };
    const grilleJour = jour && donneesHeures?.stations?.[p.nom]?.[Math.round((dateUTC(jour.date) - dateUTC(donneesHeures.debut)) / 864e5)];

    // --- ligne d'information
    let info = `moyenne ${deg(p.moyenne)} sur 12 mois`;
    if (s?.graphe === "mois") {
      const m = mois[s.i];
      const { nom, annee } = nomMois(s.i);
      info = `${nom} ${annee} : moyenne ${deg(m.tntxm)} (min ${deg(m.tn)}, max ${deg(m.tx)})`;
    } else if (s?.graphe === "jours" && jours[s.i]) {
      const j = jours[s.i];
      info = `${libelleJour(j.date)} : moy. ${deg(j.tntxm)} · min ${deg(j.tn)} (${heureParis(j.date, j.htn, "tn")}) · max ${deg(j.tx)} (${heureParis(j.date, j.htx, "tx")})`;
    } else if (s?.graphe === "heures" && jour) {
      const v = grilleJour?.[s.i];
      info = `${libelleJour(jour.date)}, ${s.i} h : ${v == null ? "pas de relevé" : deg(v)} · min ${deg(jour.tn)} · max ${deg(jour.tx)}`;
    } else if (iMois !== null) {
      const { nom, annee } = nomMois(iMois);
      info = `${nom} ${annee} : moyenne ${deg(mois[iMois].tntxm)}${etat.moisFixe !== null ? " · Échap : libérer" : " · clic : figer"}`;
    }
    ctx.font = police(10.5, s ? 600 : "");
    ctx.fillStyle = s ? ORANGE_FONCE : "#666";
    let texte = info;
    while (ctx.measureText(texte).width > L - 20 && texte.length > 10) texte = texte.slice(0, -2);
    ctx.fillText(texte === info ? info : texte + "…", 10, 31);

    const legende = (g, gauche, droite, lien = false) => {
      ctx.font = police(11, lien ? 600 : "");
      ctx.fillStyle = lien ? ORANGE_FONCE : "#666";
      ctx.fillText(gauche, g.x, 49);
      ctx.font = police(11);
      ctx.fillStyle = "#666";
      ctx.textAlign = "right";
      ctx.fillText(droite, g.x + g.largeur, 49);
      ctx.textAlign = "left";
    };
    const axe = ({ x, largeur }) => {
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.moveTo(x, HAUT + HAUTEUR + 0.5);
      ctx.lineTo(x + largeur, HAUT + HAUTEUR + 0.5);
      ctx.stroke();
    };
    const etiquettes = ({ x }, pas, liste) => {
      ctx.fillStyle = "#888";
      ctx.font = police(9);
      ctx.textAlign = "center";
      for (const [i, t] of liste) ctx.fillText(t, x + (i + 0.5) * pas, HAUT + HAUTEUR + 11);
      ctx.textAlign = "left";
    };
    const zero = ({ x, largeur }, y, bas) => {
      if (bas >= 0) return;
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, Math.round(y(0)) + 0.5);
      ctx.lineTo(x + largeur, Math.round(y(0)) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const courbe = (g, pas, valeurs, y, couleur, epaisseur) => {
      ctx.strokeStyle = couleur;
      ctx.lineWidth = epaisseur;
      ctx.beginPath();
      let ouvert = false;
      valeurs.forEach((v, i) => {
        if (v == null) return (ouvert = false);
        const [px, py] = [g.x + (i + 0.5) * pas, y(v)];
        ouvert ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        ouvert = true;
      });
      ctx.stroke();
      ctx.lineWidth = 1;
    };
    const point = (px, py, couleur, rayon = 2.5) => {
      ctx.fillStyle = couleur;
      ctx.beginPath();
      ctx.arc(px, py, rayon, 0, 2 * Math.PI);
      ctx.fill();
    };

    // --- 1. moyenne mensuelle des TNTXM (barres depuis 0, ou depuis le minimum s'il est négatif)
    {
      const g = GRAPHES.mois;
      const valeurs = mois.map((m) => m.tntxm);
      const max = Math.max(...valeurs.filter((v) => v != null), 1);
      const min = Math.min(0, ...valeurs.filter((v) => v != null));
      const y = (v) => HAUT + HAUTEUR - ((v - min) / (max - min)) * HAUTEUR;
      const pas = g.largeur / valeurs.length;
      legende(g, "moyenne par mois", `${Math.round(max)} °C`);
      valeurs.forEach((v, i) => {
        if (v == null) return;
        const actif = i === iMois || (s?.graphe === "mois" && s.i === i);
        ctx.fillStyle = actif ? ORANGE_FONCE : iMois !== null || s?.graphe === "mois" ? ORANGE_ESTOMPE : ORANGE;
        ctx.fillRect(g.x + i * pas + pas * 0.1, y(v), pas * 0.8, y(min) - y(v));
      });
      if (etat.moisFixe !== null) {
        // repère du mois figé
        ctx.fillStyle = ORANGE_FONCE;
        ctx.beginPath();
        const cx = g.x + (etat.moisFixe + 0.5) * pas;
        ctx.moveTo(cx - 3, HAUT - 5);
        ctx.lineTo(cx + 3, HAUT - 5);
        ctx.lineTo(cx, HAUT - 1);
        ctx.fill();
      }
      axe(g);
      etiquettes(g, pas, mois.map((m, i) => [i, NOMS_MOIS[dateUTC(`${m.mois}-01`).getUTCMonth()][0].toUpperCase()]));
    }

    // --- 2. TNTXM par jour (barres) + courbes TN (bleu) et TX (rouge), échelle min(TN) -> max(TX)
    if (nGraphes >= 2) {
      const g = GRAPHES.jours;
      const n = jours.length || 1;
      const pas = g.largeur / n;
      const bas = Math.floor(Math.min(...jours.map((j) => j.tn).filter((v) => v != null), 0));
      const haut = Math.ceil(Math.max(...jours.map((j) => j.tx).filter((v) => v != null), 1));
      const y = (v) => HAUT + HAUTEUR - ((v - bas) / (haut - bas)) * HAUTEUR;
      legende(g, `par jour · ${nomMois(iMois).abrege}`, `${bas} à ${haut} °C`, etat.moisFixe !== null);
      zero(g, y, bas);
      const actif = s?.graphe === "jours" ? s.i : iJour;
      jours.forEach((j, i) => {
        if (j.tntxm == null) return;
        ctx.fillStyle = i === actif || i === etat.jourFixe ? ORANGE_FONCE : actif !== null ? ORANGE_ESTOMPE : "rgba(224,123,57,0.7)";
        const largeurBarre = n > 60 ? pas : pas * 0.8;
        ctx.fillRect(g.x + i * pas + (pas - largeurBarre) / 2, y(j.tntxm), largeurBarre, y(bas) - y(j.tntxm));
      });
      courbe(g, pas, jours.map((j) => j.tn), y, BLEU, n > 60 ? 1 : 1.5);
      courbe(g, pas, jours.map((j) => j.tx), y, ROUGE, n > 60 ? 1 : 1.5);
      if (actif !== null && jours[actif]) {
        const px = g.x + (actif + 0.5) * pas;
        if (jours[actif].tn != null) point(px, y(jours[actif].tn), BLEU);
        if (jours[actif].tx != null) point(px, y(jours[actif].tx), ROUGE);
      }
      axe(g);
      etiquettes(g, pas, [0, 7, 14, 21, 28].filter((d) => d < n).map((d) => [d, String(d + 1)]));
    }

    // --- 3. heures du jour (mois figé) : courbe T, repères TN / TX du jour (pointillés)
    if (avecHeures) {
      const g = GRAPHES.heures;
      const pas = g.largeur / 24;
      if (!donneesHeures) {
        legende(g, "par heure", "");
        ctx.fillStyle = "#999";
        ctx.font = police(10);
        ctx.fillText("chargement…", g.x, HAUT + 28);
      } else {
        const valeurs = grilleJour ?? Array(24).fill(null);
        const connues = [...valeurs, jour.tn, jour.tx].filter((v) => v != null);
        const bas = Math.floor(Math.min(...connues));
        const haut = Math.max(Math.ceil(Math.max(...connues)), bas + 2);
        const y = (v) => HAUT + HAUTEUR - ((v - bas) / (haut - bas)) * HAUTEUR;
        const d = dateUTC(jour.date);
        legende(g, `par heure · ${d.getUTCDate()} ${ABREGES[d.getUTCMonth()]}`, `${bas} à ${haut} °C`);
        zero(g, y, bas);
        for (const [v, couleur] of [[jour.tn, BLEU], [jour.tx, ROUGE]]) {
          if (v == null) continue;
          ctx.strokeStyle = couleur;
          ctx.globalAlpha = 0.6;
          ctx.setLineDash([3, 2]);
          ctx.beginPath();
          ctx.moveTo(g.x, Math.round(y(v)) + 0.5);
          ctx.lineTo(g.x + g.largeur, Math.round(y(v)) + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
        courbe(g, pas, valeurs, y, ORANGE_FONCE, 2);
        valeurs.forEach((v, h) => v != null && point(g.x + (h + 0.5) * pas, y(v), ORANGE_FONCE, s?.graphe === "heures" && s.i === h ? 3.5 : 1.5));
        if (s?.graphe === "heures") {
          ctx.strokeStyle = "rgba(0,0,0,0.2)";
          ctx.beginPath();
          ctx.moveTo(g.x + (s.i + 0.5) * pas + 0.5, HAUT);
          ctx.lineTo(g.x + (s.i + 0.5) * pas + 0.5, HAUT + HAUTEUR);
          ctx.stroke();
        }
      }
      axe(g);
      etiquettes(g, pas, ETIQUETTES_HEURES);
    }
    etat.n = { mois: mois.length, jours: nGraphes >= 2 ? jours.length : 0, heures: avecHeures && donneesHeures ? 24 : 0 };
    canvas.hidden = false;
  }

  // --- interactions
  const barreSous = (e) => {
    const { left, top } = canvas.getBoundingClientRect();
    const [x, y] = [e.clientX - left, e.clientY - top];
    if (y < HAUT - 6 || y > HAUT + HAUTEUR + 14) return null;
    for (const [graphe, g] of Object.entries(GRAPHES)) {
      const n = etat.n?.[graphe];
      if (n && x >= g.x && x < g.x + g.largeur) return { graphe, i: Math.min(n - 1, Math.floor(((x - g.x) / g.largeur) * n)) };
    }
    return null;
  };
  const libererMois = () => {
    Object.assign(etat, { moisFixe: null, jourFixe: null, jourSurvole: null });
    dessiner();
  };
  canvas.addEventListener("mousemove", (e) => {
    if (!etat.serie) return;
    const b = (etat.survol = barreSous(e));
    // mois figé : le survol des mois ne change plus les jours affichés ; sinon aperçu du mois survolé (nouveau mois :
    // le jour survolé est oublié)
    if (b?.graphe === "mois" && etat.moisFixe === null && etat.moisSurvole !== b.i) Object.assign(etat, { moisSurvole: b.i, jourSurvole: null });
    // jour survolé : reste affiché (graphique des heures) tant que la souris est dans l'encadré
    if (b?.graphe === "jours") {
      etat.jourSurvole = b.i;
      chargerHeures();
    }
    canvas.style.cursor = b?.graphe === "mois" || b?.graphe === "jours" ? "pointer" : "";
    dessiner();
  });
  canvas.addEventListener("mouseleave", () => {
    Object.assign(etat, { survol: null, moisSurvole: null, jourSurvole: null });
    if (etat.serie) dessiner();
  });
  canvas.addEventListener("click", (e) => {
    const b = barreSous(e);
    if (b?.graphe === "mois") {
      if (etat.moisFixe === b.i) return libererMois();
      Object.assign(etat, { moisFixe: b.i, moisSurvole: null, jourFixe: null, jourSurvole: null });
    } else if (b?.graphe === "jours") {
      // jour fixé : son mois est figé avec lui
      etat.moisFixe ??= etat.moisSurvole;
      etat.jourFixe = etat.jourFixe === b.i ? null : b.i;
      etat.jourSurvole = null;
      chargerHeures();
    } else return;
    dessiner();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && etat.moisFixe !== null) libererMois();
  });

  return {
    // station affichée (propriétés de 12-temperatures.geojson) et sa série ; null : encadré masqué
    // (le mois figé est conservé d'une station à l'autre, pour comparer)
    afficher(p, serie) {
      if (p?.nom !== etat.station?.nom) Object.assign(etat, { survol: null, moisSurvole: null, jourSurvole: null });
      Object.assign(etat, { station: p ?? null, serie: serie ?? null });
      dessiner();
    },
  };
}
