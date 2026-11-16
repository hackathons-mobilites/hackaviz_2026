// Encadré des compteurs vélo (canvas en bas à gauche de la carte) : histogrammes dévoilés au fil de l'exploration,
// même navigation que l'encadré des températures (graphiquesTemperatures.js) — au départ le graphique des mois seul
// 1. mois : moyenne journalière de chaque mois de la période ; survol ou clic (mois figé, re-clic ou Échap : libéré)
//    -> graphique 2
// 2. jours : total de chaque jour du mois (jours partiels estompés) ; survol ou clic (jour fixé, mois figé avec lui)
//    -> graphique 3
// 3. heures : passages heure par heure du jour
// Un mois ou un jour survolé reste affiché tant que la souris est dans l'encadré (passage aux graphiques suivants)
// Données : propriétés du site (10-velo-comptages.geojson : mois, profil, profilMois) + détail jour × heure chargé à la
//   demande (10-velo-jours/<idSite>.json : { debut, jours: [[24 valeurs ou null]…], estime? })
// Site « ensemble » (idSite "ensemble", tous les sites additionnés) : estime = % estimé de chaque jour (heures en panne)

const VERT = "#1b8a3a";
const VERT_ESTOMPE = "rgba(27,138,58,0.45)";
const VERT_FONCE = "#0b4d1f";
const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ABREGES = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const JOURS_SEMAINE = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const H = 128;
const LARGEUR = { 1: 165, 2: 330, 3: 495 }; // largeur du canvas selon le nombre de graphiques affichés
const GRAPHES = { mois: { x: 10, largeur: 145 }, jours: { x: 175, largeur: 145 }, heures: { x: 340, largeur: 145 } };
const [HAUT, HAUTEUR] = [56, 50];
const ETIQUETTES_HEURES = [[0, "0h"], [6, "6h"], [12, "12h"], [18, "18h"], [23, "23h"]];

const fr = (v) => Math.round(v).toLocaleString("fr-FR");
const valeursDe = (texte) => String(texte ?? "").split(",").map((v) => (v === "" ? null : Number(v)));
const dateUTC = (iso) => new Date(`${iso}T00:00:00Z`);

export function creerGraphiquesVelo(canvas, urlJours) {
  const cache = new Map(); // idSite -> données jour × heure (null si indisponibles, undefined pendant le chargement)
  const etat = { site: null, moisFixe: null, moisSurvole: null, jourSurvole: null, jourFixe: null, survol: null };

  const charger = (idSite) => {
    if (!cache.has(idSite)) {
      cache.set(idSite, undefined);
      fetch(urlJours(idSite))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((d) => {
          cache.set(idSite, d);
          if (etat.site?.idSite === idSite) dessiner();
        });
    }
    return cache.get(idSite);
  };

  // mois i de la période : nom, année, index du premier jour dans la grille, nombre de jours
  const moisDe = (i) => {
    const [a0, m0] = [Number(etat.site.periode.slice(0, 4)), Number(etat.site.periode.slice(5, 7)) - 1];
    const debut = new Date(Date.UTC(a0, m0 + i, 1));
    const premier = Math.round((debut - Date.UTC(a0, m0, 1)) / 864e5);
    const nbJours = new Date(Date.UTC(a0, m0 + i + 1, 0)).getUTCDate();
    return { m: debut.getUTCMonth(), nom: NOMS_MOIS[debut.getUTCMonth()], annee: debut.getUTCFullYear(), premier, nbJours };
  };

  function dessiner() {
    const p = etat.site;
    if (!p) return (canvas.hidden = true);
    const donnees = charger(p.idSite);
    const valeursMois = valeursDe(p.mois);
    const iMois = etat.moisFixe ?? etat.moisSurvole;
    const mois = iMois !== null ? moisDe(iMois) : null;

    // jours du mois
    const [premier, nb] = mois ? [mois.premier, mois.nbJours] : [0, 0];
    const grille = (donnees?.jours ?? []).slice(premier, premier + nb);
    const debut = dateUTC(donnees?.debut ?? p.periode.slice(0, 10));
    const dateJour = (i) => new Date(debut.getTime() + (premier + i) * 864e5);
    const totaux = grille.map((h) => (h.every((v) => v == null) ? null : h.reduce((t, v) => t + (v ?? 0), 0)));
    const estime = donnees?.estime?.slice(premier, premier + nb);
    const partiels = estime ? estime.map((e) => e >= 5) : grille.map((h) => h.some((v) => v == null) && h.some((v) => v != null));
    const iJour = mois ? (etat.jourSurvole ?? etat.jourFixe) : null;
    const jour = iJour !== null && grille[iJour] ? iJour : null;
    const nGraphes = !mois ? 1 : jour !== null ? 3 : 2;
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
    let titre = p.nom;
    while (ctx.measureText(titre).width > L - 20 && titre.length > 10) titre = titre.slice(0, -2);
    ctx.fillText(titre === p.nom ? titre : titre + "…", 10, 17);

    const s = etat.survol;
    const libelleJour = (i) => {
      const d = dateJour(i);
      return `${JOURS_SEMAINE[d.getUTCDay()]} ${d.getUTCDate()} ${ABREGES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    };

    // heures : passages du jour exploré
    const heures = jour !== null ? { valeurs: grille[jour], legende: `par heure · ${dateJour(jour).getUTCDate()} ${ABREGES[mois.m]}`, format: (v) => `${fr(v)} / h` } : null;

    // --- ligne d'information
    let info = `${fr(p.moyenneJour)} vélos / jour`;
    if (s?.graphe === "mois") {
      const v = valeursMois[s.i];
      const { nom, annee } = moisDe(s.i);
      info = `${nom} ${annee} : ${v == null ? "pas de données" : `${fr(v)} vélos / jour en moyenne`}`;
    } else if (s?.graphe === "jours" && grille[s.i]) {
      const v = totaux[s.i];
      info = `${libelleJour(s.i)} : ${v == null ? "pas de données" : `${fr(v)} vélos`}${estime?.[s.i] ? ` (dont ${estime[s.i]} % estimé)` : partiels[s.i] ? " (partiel)" : ""}`;
    } else if (s?.graphe === "heures" && heures) {
      const v = heures.valeurs[s.i];
      info = `${libelleJour(jour)}, ${s.i} h – ${s.i + 1} h : ${v == null ? "pas de données" : `${fr(v)} vélos`}`;
    } else if (mois) {
      const v = valeursMois[iMois];
      info = `${mois.nom} ${mois.annee} : ${v == null ? "pas de données" : `${fr(v)} vélos / jour`}${etat.moisFixe !== null ? " · Échap : libérer" : " · clic : figer"}`;
    }
    ctx.font = police(10.5, s ? 600 : "");
    ctx.fillStyle = s ? VERT_FONCE : "#666";
    let texte = info;
    while (ctx.measureText(texte).width > L - 20 && texte.length > 10) texte = texte.slice(0, -2);
    ctx.fillText(texte === info ? info : texte + "…", 10, 31);

    // --- histogramme générique
    const histogramme = (g, { valeurs, legende, lien, format, etiquettes, actif, estompes, fixe }) => {
      const n = valeurs.length || 1;
      const max = Math.max(...valeurs.filter((v) => v != null), 1);
      const pas = g.largeur / n;
      ctx.font = police(11, lien ? 600 : "");
      ctx.fillStyle = lien ? VERT_FONCE : "#666";
      ctx.fillText(legende, g.x, 49);
      ctx.font = police(11);
      ctx.fillStyle = "#666";
      if (valeurs.length) {
        ctx.textAlign = "right";
        ctx.fillText(format(max), g.x + g.largeur, 49);
        ctx.textAlign = "left";
      }
      const largeurBarre = n > 60 ? pas : pas * 0.8;
      valeurs.forEach((v, i) => {
        if (v == null) return;
        const h = (v / max) * HAUTEUR;
        ctx.fillStyle = i === actif || i === fixe ? VERT_FONCE : actif != null || estompes?.[i] ? VERT_ESTOMPE : VERT;
        ctx.fillRect(g.x + i * pas + (pas - largeurBarre) / 2, HAUT + HAUTEUR - h, largeurBarre, h);
      });
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.moveTo(g.x, HAUT + HAUTEUR + 0.5);
      ctx.lineTo(g.x + g.largeur, HAUT + HAUTEUR + 0.5);
      ctx.stroke();
      ctx.fillStyle = "#888";
      ctx.font = police(9);
      ctx.textAlign = "center";
      for (const [i, t] of etiquettes) ctx.fillText(t, g.x + (i + 0.5) * pas, HAUT + HAUTEUR + 11);
      ctx.textAlign = "left";
      return valeurs.length;
    };
    const message = (g, lignes) => {
      ctx.fillStyle = "#999";
      ctx.font = police(10);
      lignes.forEach((t, k) => ctx.fillText(t, g.x, HAUT + 22 + k * 13));
    };

    // 1. mois
    const nMois = histogramme(GRAPHES.mois, {
      valeurs: valeursMois,
      legende: "par mois",
      format: (v) => `${fr(v)} / j`,
      etiquettes: valeursMois.map((_, i) => [i, moisDe(i).nom[0].toUpperCase()]),
      actif: s?.graphe === "mois" ? s.i : iMois,
      fixe: etat.moisFixe,
    });
    if (etat.moisFixe !== null) {
      // repère du mois figé
      const g = GRAPHES.mois;
      const cx = g.x + ((etat.moisFixe + 0.5) * g.largeur) / valeursMois.length;
      ctx.fillStyle = VERT_FONCE;
      ctx.beginPath();
      ctx.moveTo(cx - 3, HAUT - 5);
      ctx.lineTo(cx + 3, HAUT - 5);
      ctx.lineTo(cx, HAUT - 1);
      ctx.fill();
    }

    // 2. jours
    let nJours = 0;
    if (nGraphes < 2);
    else if (donnees === undefined) message(GRAPHES.jours, ["chargement…"]);
    else if (!donnees) message(GRAPHES.jours, ["détail par jour", "indisponible"]);
    else {
      const etiquettesJours = [0, 7, 14, 21, 28].filter((j) => j < nb).map((j) => [j, String(j + 1)]);
      nJours = histogramme(GRAPHES.jours, {
        valeurs: totaux,
        legende: `par jour · ${ABREGES[mois.m]}`,
        lien: etat.moisFixe !== null,
        format: (v) => `${fr(v)} / j`,
        etiquettes: etiquettesJours,
        actif: s?.graphe === "jours" ? s.i : jour,
        estompes: partiels,
        fixe: etat.jourFixe,
      });
    }

    // 3. heures
    const nHeures = heures ? histogramme(GRAPHES.heures, { ...heures, etiquettes: ETIQUETTES_HEURES, actif: s?.graphe === "heures" ? s.i : null }) : 0;

    etat.n = { mois: nMois, jours: nJours, heures: nHeures };
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
    if (!etat.site) return;
    const b = (etat.survol = barreSous(e));
    // mois figé : le survol des mois ne change plus les jours affichés ; sinon aperçu du mois survolé
    if (b?.graphe === "mois" && etat.moisFixe === null && etat.moisSurvole !== b.i) Object.assign(etat, { moisSurvole: b.i, jourSurvole: null });
    // jour survolé : reste affiché (graphique des heures) tant que la souris est dans l'encadré
    if (b?.graphe === "jours") etat.jourSurvole = b.i;
    canvas.style.cursor = b?.graphe === "mois" || b?.graphe === "jours" ? "pointer" : "";
    dessiner();
  });
  canvas.addEventListener("mouseleave", () => {
    Object.assign(etat, { survol: null, moisSurvole: null, jourSurvole: null });
    if (etat.site) dessiner();
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
    } else return;
    dessiner();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && etat.moisFixe !== null) libererMois();
  });

  return {
    // site affiché (propriétés de 10-velo-comptages) ; le mois et le jour figés sont conservés d'un site à l'autre
    // (comparaison du même mois / du même jour entre sites)
    afficher(p) {
      if (p?.idSite !== etat.site?.idSite) Object.assign(etat, { survol: null, moisSurvole: null, jourSurvole: null });
      etat.site = p ?? null;
      dessiner();
    },
  };
}
