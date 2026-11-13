/**
 * Contrôle de l'affichage : lecture du DOM d'une vraie page (Playwright). Tous les sélecteurs viennent de `selecteurs.mjs`. Le code passé à
 * `page.evaluate` tourne dans le navigateur : il renvoie des textes bruts, normalisés ici.
 */
import { ATTR_ASTRE, SEL } from './selecteurs.mjs';
import { normalise } from './textes.mjs';

function lireCielDansPage([sel, attr]) {
  const txt = (el) => (el ? el.textContent : null);
  return {
    url: location.search,
    compteur: txt(document.querySelector(sel.compteur)),
    legendeCompteur: txt(document.querySelector(sel.legendeCompteur)),
    resume: txt(document.querySelector(sel.resumeCiel)),
    astres: [...document.querySelectorAll(sel.astre)].map((el) => ({ aria: el.getAttribute('aria-label'), id: el.getAttribute(attr.id), etat: el.getAttribute(attr.etat) })),
    courts: [...document.querySelectorAll(sel.etiquetteCourte)].map((el) => ({ texte: el.textContent, allume: el.classList.contains('is-on') })),
    besoins: [...document.querySelectorAll(sel.legendeBesoins)].map(txt).join(' '),
  };
}

export async function lireCiel(page) {
  const r = await page.evaluate(lireCielDansPage, [SEL, ATTR_ASTRE]);
  return {
    ...r,
    compteur: r.compteur == null ? null : normalise(r.compteur),
    legendeCompteur: normalise(r.legendeCompteur),
    resume: normalise(r.resume),
    astres: r.astres.map((a) => ({ ...a, aria: normalise(a.aria) })),
    courts: r.courts.map((c) => ({ texte: normalise(c.texte), allume: c.allume })),
    besoins: r.besoins == null ? null : normalise(r.besoins),
  };
}

function lirePreuveDansPage(sel) {
  const racine = document.querySelector(sel.preuve);
  if (!racine) return null;
  const t = (el) => (el ? el.textContent : null);
  const un = (ctx, s) => ctx?.querySelector(s) ?? null;
  const tous = (ctx, s) => (ctx ? [...ctx.querySelectorAll(s)] : []);
  const texte = (ctx, s) => t(un(ctx, s));
  const textes = (ctx, s) => tous(ctx, s).map(t);
  // Audit d'affichage du 10/11 : une phrase du pli « Coût et carbone » se lit sans ses « i » ni ses boutons
  const nu = (el) => {
    if (!el) return null;
    const c = el.cloneNode(true);
    c.querySelectorAll(sel.horsPhrase).forEach((x) => x.remove());
    return c.textContent.replace(/\s+([.,)])/g, '$1');
  };

  const groupes = {};
  for (const g of tous(racine, sel.groupe)) groupes[g.getAttribute('data-group')] = { chiffre: texte(g, sel.groupeChiffre), texte: g.textContent, nu: nu(g) };

  const od = un(racine, sel.odSection);
  const times = un(racine, sel.temps);
  const cout = un(racine, sel.cout);
  const subs = un(racine, sel.abonnements);
  const voiture = un(racine, sel.voitureCout);
  const alt = un(racine, sel.alternatives);

  // D-066 : le bloc « Trajet » montre un sens à la fois ; le titre lu est recomposé (« Trajet (aller, exemple de trajet) · 08:10 → 08:58 »)
  const bloc = un(racine, sel.trajetBloc);
  const titreBloc = t(un(bloc, sel.trajetTitre)) ?? '';
  const sensPresse = tous(bloc, sel.trajetSens).find((b) => b.getAttribute('aria-pressed') === 'true');
  const sensMot = /^\s*Retour/.test(sensPresse?.textContent ?? '') ? 'retour' : 'aller';
  const depArr = (t(un(bloc, sel.trajetMeta)) ?? '').split(' · ')[0];
  const titreRecompose = bloc ? `Trajet (${sensMot}${/exemple de trajet/.test(titreBloc) ? ', exemple de trajet' : ''}) · ${depArr}` : null;
  const transports = tous(racine, sel.transports).map((sec) => ({
    titre: texte(sec, sel.transportsTitre) ?? titreRecompose,
    lignes: tous(sec, sel.lignes).map((li) => ({ titre: texte(li, sel.ligneTitre), heures: texte(li, sel.ligneHeures), faits: texte(li, sel.ligneFaits) })),
    troncons: tous(sec, sel.troncons).map((li) => ({ titre: texte(li, sel.ligneTitre), heures: texte(li, sel.ligneHeures), ou: texte(li, sel.tronconOu) })),
    // Audit d'affichage du 11/11 (A3) : l'écart est dans le « i » du titre (ligne de bulle), lu sans l'ouvrir
    delta: [...(bloc ?? sec).querySelectorAll('p, .pf-tip-line')].map(t).find((x) => x && /Itinéraire détaillé à .* près/.test(x)) ?? null,
  }));

  return {
    titre: texte(racine, sel.titre),
    contexte: texte(racine, sel.contexte),
    badges: tous(racine, sel.badge).map((el) => ({ classes: el.className, texte: el.textContent })),
    od: od ? { part: texte(od, sel.odPart), ligne: texte(od, sel.odLigne), notes: textes(od, sel.odNotes) } : null,
    temps: times ? { cellules: tous(times, sel.tempsCellule).map((c) => ({ nom: texte(c, sel.tempsNom), minutes: texte(c, sel.tempsMinutes), heures: texte(c, sel.tempsHeures), indices: textes(c, sel.tempsIndice), raison: texte(c, sel.tempsRaison) })), manquant: texte(times, sel.tempsManquant) } : null,
    transports,
    itinManquant: texte(racine, sel.itinManquant),
    correspondances: textes(racine, sel.correspondances),
    groupes,
    cout: cout ? { ligne: nu(un(cout, sel.coutLigne)) } : null,
    trajetAR: texte(racine, sel.trajetAR),
    carbone: nu(un(racine, sel.carbone)),
    abonnements: subs ? { phrases: tous(subs, 'p').map(nu), liste: textes(subs, 'li') } : null,
    voiture: voiture ? { titre: texte(voiture, 'h3'), lignes: textes(voiture, sel.voitureLignes), texte: voiture.textContent, phrases: tous(voiture, 'p').map(t) } : null,
    trafic: textes(racine, sel.voitureTrafic),
    communes: tous(racine, sel.communesLignes).map((tr) => ({ tete: texte(tr, 'th'), cases: textes(tr, 'td') })),
    modes: tous(racine, sel.modesLignes).map((tr) => ({ tete: texte(tr, 'th'), cases: textes(tr, 'td') })),
    besoinsResume: tous(racine, sel.besoinsResume).map((d) => ({ titre: d.firstChild?.textContent, lignes: textes(d, 'li') })),
    besoinsVerdict: texte(racine, sel.besoinsVerdict),
    provenanceVisible: tous(racine, sel.provenance).filter((el) => el.textContent.trim() && getComputedStyle(el).display !== 'none').length,
    alternatives: alt ? { etat: textes(alt, sel.alternativesEtat), onglets: textes(alt, sel.alternativesOnglets) } : null,
    texteComplet: racine.textContent,
  };
}

const n = normalise;
const nObj = (o, champs) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, champs.includes(k) ? (v == null ? null : n(v)) : v]));

export async function lirePreuve(page) {
  const r = await page.evaluate(lirePreuveDansPage, SEL);
  if (!r) return null;
  // D-066 : bloc « Trajet », un sens à la fois : on lit le retour par sa bascule, puis on revient à l'aller
  const retour = page.locator(`${SEL.trajetBloc} ${SEL.trajetSens}`, { hasText: /^Retour/ });
  if ((await retour.count().catch(() => 0)) && (await retour.first().getAttribute('aria-pressed')) !== 'true') {
    await retour.first().click().catch(() => {});
    await new Promise((ok) => setTimeout(ok, 250));
    const r2 = await page.evaluate(lirePreuveDansPage, SEL).catch(() => null);
    if (r2) {
      r.transports = [...r.transports, ...r2.transports];
      r.coutRetour = r2.cout;
      r.carboneRetour = r2.carbone;
    }
    await page.locator(`${SEL.trajetBloc} ${SEL.trajetSens}`, { hasText: /^Aller/ }).first().click().catch(() => {});
    await new Promise((ok) => setTimeout(ok, 150));
  }
  return {
    ...r,
    titre: n(r.titre),
    contexte: n(r.contexte),
    badges: r.badges.map((b) => ({ classes: b.classes, texte: n(b.texte) })),
    od: r.od && { part: r.od.part == null ? null : n(r.od.part), ligne: n(r.od.ligne), notes: r.od.notes.map(n).filter(Boolean) },
    temps: r.temps && { manquant: r.temps.manquant == null ? null : n(r.temps.manquant), cellules: r.temps.cellules.map((c) => ({ nom: n(c.nom), minutes: n(c.minutes), heures: c.heures == null ? null : n(c.heures), indices: c.indices.map(n), raison: c.raison == null ? null : n(c.raison) })) },
    transports: r.transports.map((s) => ({ titre: n(s.titre), lignes: s.lignes.map((l) => nObj(l, ['titre', 'heures', 'faits'])), troncons: s.troncons.map((l) => nObj(l, ['titre', 'heures', 'ou'])), delta: s.delta == null ? null : n(s.delta) })),
    itinManquant: r.itinManquant == null ? null : n(r.itinManquant),
    correspondances: r.correspondances.map(n),
    groupes: Object.fromEntries(Object.entries(r.groupes).map(([k, g]) => [k, { chiffre: g.chiffre == null ? null : n(g.chiffre), texte: n(g.texte), nu: n(g.nu) }])),
    cout: r.cout && { ligne: r.cout.ligne == null ? null : n(r.cout.ligne) },
    carbone: r.carbone == null ? null : n(r.carbone),
    coutRetour: r.coutRetour ? { ligne: r.coutRetour.ligne == null ? null : n(r.coutRetour.ligne) } : null,
    carboneRetour: r.carboneRetour == null ? null : n(r.carboneRetour),
    trajetAR: r.trajetAR == null ? null : n(r.trajetAR),
    abonnements: r.abonnements && { phrases: r.abonnements.phrases.map(n), liste: r.abonnements.liste.map(n) },
    voiture: r.voiture && { titre: n(r.voiture.titre), lignes: r.voiture.lignes.map(n), texte: n(r.voiture.texte), phrases: r.voiture.phrases.map(n) },
    trafic: r.trafic.map(n),
    communes: r.communes.map((c) => ({ tete: n(c.tete), cases: c.cases.map(n) })),
    modes: r.modes.map((c) => ({ tete: n(c.tete), cases: c.cases.map(n) })),
    besoinsResume: r.besoinsResume.map((b) => ({ titre: n(b.titre), lignes: b.lignes.map(n) })),
    besoinsVerdict: r.besoinsVerdict == null ? null : n(r.besoinsVerdict),
    alternatives: r.alternatives && { etat: r.alternatives.etat.map(n), onglets: r.alternatives.onglets.map(n) },
    texteComplet: n(r.texteComplet),
  };
}

const empreinteCiel = (s) => JSON.stringify([s.compteur, s.legendeCompteur, s.resume, s.astres.map((a) => a.aria), s.besoins]);
const empreintePreuve = (p) => (p ? p.texteComplet : '');

const dort = (ms) => new Promise((r) => setTimeout(r, ms));

/** Attend que `fn` rende deux fois de suite la même empreinte (la page a fini de charger ses données), ou lève au délai. */
export async function attendreStable(page, lire, empreinte, { delai = 45000, intervalle = 450, minimum = 2 } = {}) {
  const debut = Date.now();
  let dernier = null;
  let stable = 0;
  let valeur = null;
  while (Date.now() - debut < delai) {
    valeur = await lire(page);
    const e = empreinte(valeur);
    stable = e === dernier && e !== '' ? stable + 1 : 0;
    dernier = e;
    if (stable >= minimum) return valeur;
    await dort(intervalle);
  }
  throw new Error('page instable après le délai');
}

export async function cielStable(page) {
  await page.waitForSelector(SEL.astre, { timeout: 90000 });
  // La marque des besoins se calcule après le chargement des itinéraires : la page n'est pas prête tant qu'elle dit « en cours »
  return attendreStable(page, lireCiel, (c) => (c.resume && !/Calcul de la marque en cours/.test(c.besoins ?? '') ? empreinteCiel(c) : ''), { minimum: 2 });
}

export async function preuveStable(page) {
  return attendreStable(page, lirePreuve, empreintePreuve, { minimum: 3 });
}

/** Ouvre le panneau d'un astre en cliquant son bouton (hors barre) ; suppose le ciel chargé. */
export async function ouvrirAstre(page, indexPole) {
  await page.evaluate(([s, i]) => {
    const btn = document.querySelectorAll(s)[i];
    btn.click();
  }, [SEL.astre, indexPole]);
}
