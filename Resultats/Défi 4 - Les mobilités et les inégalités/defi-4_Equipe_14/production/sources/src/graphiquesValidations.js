// Encadré des validations du réseau ferré (canvas en bas à gauche de la carte), même navigation que les encadrés vélo et
// températures — au départ le graphique des mois seul
// 1. mois : validations moyennes par jour de chaque mois du trimestre ; survol ou clic (mois figé, re-clic ou Échap :
//    libéré) -> graphique 2
// 2. jours : total de chaque jour du mois, teinte selon le type de jour (ouvré, samedi, dimanche / férié ; vacances
//    soulignées) ; survol ou clic (jour fixé, mois figé avec lui) -> graphique 3
// 3. heures : validations heure par heure du jour = total du jour × profil horaire de son type de jour
// Données (13-validations.geojson) : propriétés de la gare (jours : 91 totaux, profils : 5 × 24 %), racine : debut, types

const BLEU = "#1f5fa8";
const BLEU_FONCE = "#0d2f5c";
const TEINTES = { JOHV: BLEU, JOVS: BLEU, SAHV: "#5b8fd0", SAVS: "#5b8fd0", DIJFP: "#9dbbe3" };
const ESTOMPE = "rgba(31,95,168,0.3)";
const VACANCES = "#e0a030";
const LIBELLES_TYPES = {
  JOHV: "jour ouvré",
  JOVS: "jour ouvré de vacances",
  SAHV: "samedi",
  SAVS: "samedi de vacances",
  DIJFP: "dimanche / férié",
};
const TYPES = ["JOHV", "JOVS", "SAHV", "SAVS", "DIJFP"];
const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ABREGES = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const JOURS_SEMAINE = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const H = 128;
const LARGEUR = { 1: 165, 2: 330, 3: 495 };
const GRAPHES = { mois: { x: 10, largeur: 145 }, jours: { x: 175, largeur: 145 }, heures: { x: 340, largeur: 145 } };
const [HAUT, HAUTEUR] = [56, 50];
const ETIQUETTES_HEURES = [[0, "0h"], [6, "6h"], [12, "12h"], [18, "18h"], [23, "23h"]];

const fr = (v) => Math.round(v).toLocaleString("fr-FR");
const dateUTC = (iso) => new Date(`${iso}T00:00:00Z`);

// debut (premier jour du trimestre) et types (type de chaque jour) : membres racine de 13-validations.geojson
export function creerGraphiquesValidations(canvas, { debut, types }) {
  const etat = { site: null, moisFixe: null, moisSurvole: null, jourSurvole: null, jourFixe: null, survol: null };
  const t0 = dateUTC(debut);
  const dateJour = (i) => new Date(t0.getTime() + i * 864e5);
  // mois du trimestre : index du premier jour, nombre de jours
  const mois = [];
  types.forEach((_, i) => {
    const d = dateJour(i);
    const m = mois.at(-1);
    if (m?.m === d.getUTCMonth()) m.nb++;
    else mois.push({ m: d.getUTCMonth(), annee: d.getUTCFullYear(), premier: i, nb: 1 });
  });
  const libelleJour = (i) => {
    const d = dateJour(i);
    return `${JOURS_SEMAINE[d.getUTCDay()]} ${d.getUTCDate()} ${ABREGES[d.getUTCMonth()]}`;
  };

  function dessiner() {
    const p = etat.site;
    if (!p) return (canvas.hidden = true);
    const jours = String(p.jours).split(",").map(Number);
    const profils = Object.fromEntries(String(p.profils).split(";").map((t) => {
      const [type, v] = t.split(":");
      return [type, v.split(",").map(Number)];
    }));
    const valeursMois = mois.map(({ premier, nb }) => jours.slice(premier, premier + nb).reduce((a, b) => a + b, 0) / nb);
    const iMois = etat.moisFixe ?? etat.moisSurvole;
    const m = iMois !== null ? mois[iMois] : null;
    const totaux = m ? jours.slice(m.premier, m.premier + m.nb) : [];
    const typesMois = m ? types.slice(m.premier, m.premier + m.nb) : [];
    const iJour = m ? (etat.jourSurvole ?? etat.jourFixe) : null;
    const jour = iJour !== null && iJour < totaux.length ? iJour : null;
    const typeJour = jour !== null ? typesMois[jour] : null;
    const heures = jour !== null ? profils[typeJour].map((v) => (totaux[jour] * v) / 100) : null;
    const nGraphes = !m ? 1 : jour !== null ? 3 : 2;
    const L = LARGEUR[nGraphes];

    const r = window.devicePixelRatio || 1;
    canvas.width = L * r;
    canvas.height = H * r;
    canvas.style.width = `${L}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext("2d");
    ctx.scale(r, r);
    const police = (taille, graisse = "") => `${graisse} ${taille}px system-ui, -apple-system, sans-serif`;
    const tronquer = (texte, x, y) => {
      let t = texte;
      while (ctx.measureText(t).width > L - 20 && t.length > 10) t = t.slice(0, -2);
      ctx.fillText(t === texte ? t : t + "…", x, y);
    };
    ctx.fillStyle = "#333";
    ctx.font = police(12, 600);
    tronquer(p.nom, 10, 17);

    // --- ligne d'information
    const s = etat.survol;
    let info = `${fr(p.moyenneJOHV)} validations / jour ouvré`;
    if (s?.graphe === "mois") info = `${NOMS_MOIS[mois[s.i].m]} ${mois[s.i].annee} : ${fr(valeursMois[s.i])} / jour en moyenne`;
    else if (s?.graphe === "jours" && totaux[s.i] != null) info = `${libelleJour(m.premier + s.i)} (${LIBELLES_TYPES[typesMois[s.i]]}) : ${fr(totaux[s.i])}`;
    else if (s?.graphe === "heures" && heures) info = `${libelleJour(m.premier + jour)}, ${s.i} h – ${s.i + 1} h : ${fr(heures[s.i])} validations`;
    else if (m) info = `${NOMS_MOIS[m.m]} ${m.annee} : ${fr(valeursMois[iMois])} / jour${etat.moisFixe !== null ? " · Échap : libérer" : " · clic : figer"}`;
    ctx.font = police(10.5, s ? 600 : "");
    ctx.fillStyle = s ? BLEU_FONCE : "#666";
    tronquer(info, 10, 31);

    // --- histogramme générique (couleur : fonction de la barre)
    const histogramme = (g, { valeurs, legende, lien, format, etiquettes, actif, fixe, couleur = () => BLEU }) => {
      const n = valeurs.length || 1;
      const max = Math.max(...valeurs, 1);
      const pas = g.largeur / n;
      ctx.font = police(11, lien ? 600 : "");
      ctx.fillStyle = lien ? BLEU_FONCE : "#666";
      ctx.fillText(legende, g.x, 49);
      ctx.font = police(11);
      ctx.fillStyle = "#666";
      ctx.textAlign = "right";
      ctx.fillText(format(max), g.x + g.largeur, 49);
      ctx.textAlign = "left";
      const largeurBarre = n > 60 ? pas : pas * 0.8;
      valeurs.forEach((v, i) => {
        const h = (v / max) * HAUTEUR;
        ctx.fillStyle = i === actif || i === fixe ? BLEU_FONCE : actif != null ? ESTOMPE : couleur(i);
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

    // 1. mois
    const nMois = histogramme(GRAPHES.mois, {
      valeurs: valeursMois,
      legende: "par mois",
      format: (v) => `${fr(v)} / j`,
      etiquettes: mois.map((x, i) => [i, ABREGES[x.m]]),
      actif: s?.graphe === "mois" ? s.i : iMois,
      fixe: etat.moisFixe,
    });
    if (etat.moisFixe !== null) {
      const g = GRAPHES.mois;
      const cx = g.x + ((etat.moisFixe + 0.5) * g.largeur) / mois.length;
      ctx.fillStyle = BLEU_FONCE;
      ctx.beginPath();
      ctx.moveTo(cx - 3, HAUT - 5);
      ctx.lineTo(cx + 3, HAUT - 5);
      ctx.lineTo(cx, HAUT - 1);
      ctx.fill();
    }

    // 2. jours (teinte selon le type de jour, vacances soulignées en orange)
    let nJours = 0;
    if (m) {
      const g = GRAPHES.jours;
      nJours = histogramme(g, {
        valeurs: totaux,
        legende: `par jour · ${ABREGES[m.m]}`,
        lien: etat.moisFixe !== null,
        format: (v) => `${fr(v)} / j`,
        etiquettes: [0, 7, 14, 21, 28].filter((j) => j < m.nb).map((j) => [j, String(j + 1)]),
        actif: s?.graphe === "jours" ? s.i : jour,
        fixe: etat.jourFixe,
        couleur: (i) => TEINTES[typesMois[i]],
      });
      const pas = g.largeur / m.nb;
      ctx.fillStyle = VACANCES;
      typesMois.forEach((t, i) => (t === "JOVS" || t === "SAVS") && ctx.fillRect(g.x + i * pas, HAUT + HAUTEUR + 1.5, pas, 2));
    }

    // 3. heures
    const nHeures = heures
      ? histogramme(GRAPHES.heures, {
          valeurs: heures,
          legende: `par heure · ${LIBELLES_TYPES[typeJour].split(" ")[0]} ${dateJour(m.premier + jour).getUTCDate()}`,
          format: (v) => `${fr(v)} / h`,
          etiquettes: ETIQUETTES_HEURES,
          actif: s?.graphe === "heures" ? s.i : null,
        })
      : 0;

    etat.n = { mois: nMois, jours: nJours, heures: nHeures };
    canvas.hidden = false;
  }

  // --- interactions (identiques aux encadrés vélo et températures)
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
    if (b?.graphe === "mois" && etat.moisFixe === null && etat.moisSurvole !== b.i) Object.assign(etat, { moisSurvole: b.i, jourSurvole: null });
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
    // gare affichée (propriétés de 13-validations, ou l'ensemble) ; mois et jour figés conservés d'une gare à l'autre
    afficher(p) {
      if (p?.id !== etat.site?.id) Object.assign(etat, { survol: null, moisSurvole: null, jourSurvole: null });
      etat.site = p ?? null;
      dessiner();
    },
  };
}

export { TYPES, LIBELLES_TYPES };
