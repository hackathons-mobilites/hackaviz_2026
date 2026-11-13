/**
 * Contrôle de l'affichage : compare ce que dit l'oracle à ce que lit le navigateur. Un contrôle = un fait comparé (texte exact après
 * normalisation des espaces et apostrophes). Gravité : BLOQUANT (chiffre ou état faux), MAJEUR (transports, abonnement, marque),
 * MINEUR (libellé). Pas de tolérance : les arrondis d'affichage sont calculés dans `textes.mjs` comme le site les affiche.
 */
import { ALT_ETAT, BESOINS, OR_MENTION, fmtInt, fmtPct, normalise } from './textes.mjs';

export const GRAVITE = { BLOQUANT: 'BLOQUANT', MAJEUR: 'MAJEUR', MINEUR: 'MINEUR' };

export class Journal {
  constructor() {
    this.ecarts = [];
    this.attente = [];
    this.controles = 0;
    this.notes = [];
  }

  ok() {
    this.controles += 1;
  }

  ecart(sc, gravite, controle, regle, attendu, affiche, poleId) {
    this.controles += 1;
    this.ecarts.push({ url: sc.urlPourRejouer(poleId), gravite, controle, regle, attendu, affiche, pole: poleId ?? null, tag: sc.tag });
  }

  enAttente(sc, controle, regle, attendu, affiche, poleId) {
    this.attente.push({ url: sc.urlPourRejouer(poleId), controle, regle, attendu, affiche, pole: poleId ?? null });
  }
}

const rendu = (v) => (v == null ? '(absent)' : Array.isArray(v) || typeof v === 'object' ? JSON.stringify(v) : String(v));

function egal(j, sc, grav, nom, regle, attendu, affiche, pole) {
  if (attendu === undefined) return;
  const a = attendu == null ? null : typeof attendu === 'number' ? attendu : normalise(attendu);
  const b = affiche == null ? null : typeof affiche === 'number' ? affiche : normalise(affiche);
  if (a === b) j.ok();
  else j.ecart(sc, grav, nom, regle, rendu(attendu), rendu(affiche), pole);
}

function listeEgale(j, sc, grav, nom, regle, attendu, affiche, pole) {
  if (attendu === undefined) return;
  if (JSON.stringify(attendu.map(normalise)) === JSON.stringify(affiche.map(normalise))) j.ok();
  else j.ecart(sc, grav, nom, regle, rendu(attendu), rendu(affiche), pole);
}

/** Lit « 42 % » sans espace, nombres du type 324 056 */
const nombre = (s) => (s == null ? null : Number(s.replace(/ /g, '').replace(',', '.')));

const EX = {
  ariaOd: /^(.*?) : ([\d ]+) postes atteints aller et retour sur ([\d ]+)(?: \(([\d ,]+) %\))?(?: ; ([\d ]+) postes non calculés)?(?: ; votre commune : ([\d ]+) postes?, trajet non mesuré)?\./,
  ariaAcc: /^(.*?), ([\d ]+) postes salariés recensés par l'INSEE(?:, (accessible|retour au-delà|hors de portée|non calculé)(?:.*?) : aller (.*?), retour (.*?)\.|, non calculé pour ce scénario\.)/,
};

/** Ciel : compteur, résumé, chaque astre, marques. */
export function controlerCiel(j, sc, ciel, lu, attenduMarques, cartePoles) {
  const regle = 'accessible = aller ET retour <= budget ; commune par commune (D-019, table OD), ou access/ par astre pour vélo + TC et Vélib\'';
  // Sky stable : 44 astres, jamais moins
  egal(j, sc, GRAVITE.BLOQUANT, 'nombre d\'astres', 'D-030 : ciel fixe de 44 astres', cartePoles.length, lu.astres.length);

  if (ciel.base === 'od') {
    const t = ciel.totaux;
    egal(j, sc, GRAVITE.BLOQUANT, 'compteur de postes', regle, fmtInt(t.reachedAll), lu.compteur);
    const pct = t.measurableJobs > 0 ? fmtPct((t.reachedAll / t.measurableJobs) * 100) : null;
    if (t.reachedAll > 0) {
      const lp = /soit (\d[\d ,]* %) des [\d ]+ postes d'Île-de-France/.exec(lu.legendeCompteur)?.[1] ?? null;
      egal(j, sc, GRAVITE.BLOQUANT, 'part IDF du compteur', 'Part = Atteints / Postes, commune de départ hors du total', pct, lp);
    } else {
      egal(j, sc, GRAVITE.BLOQUANT, 'compteur à zéro', 'aucun poste atteint', true, /Aucun poste atteint/.test(lu.legendeCompteur));
    }
    const r = /([\d ]+) postes salariés recensés par l'INSEE sont atteints aller et retour.*?dans ([\d ]+) communes sur ([\d ]+)/.exec(lu.resume);
    egal(j, sc, GRAVITE.BLOQUANT, 'résumé : postes', regle, fmtInt(t.reachedAll), r?.[1] ?? null);
    egal(j, sc, GRAVITE.BLOQUANT, 'résumé : communes atteintes', regle, fmtInt(t.reachedCommunes), r?.[2] ?? null);
    egal(j, sc, GRAVITE.BLOQUANT, 'résumé : communes mesurées', regle, fmtInt(t.communes), r?.[3] ?? null);
    const rp = /(\d+) pôles? sur (\d+) éclairés?/.exec(lu.resume);
    egal(j, sc, GRAVITE.BLOQUANT, 'résumé : pôles éclairés', 'allumé dès qu\'un poste est atteint aller et retour', ciel.accessibleCount, rp ? Number(rp[1]) : null);
    if (t.selfJobs > 0) {
      const v = /Votre commune : ([\d ]+) postes?/.exec(lu.resume)?.[1] ?? null;
      egal(j, sc, GRAVITE.BLOQUANT, 'résumé : postes de la commune', 'commune de départ : trajet non mesuré, hors du total', fmtInt(t.selfJobs), v);
    }
  } else if (ciel.hasData) {
    egal(j, sc, GRAVITE.BLOQUANT, 'compteur de postes', regle, ciel.jobs == null ? '-' : fmtInt(ciel.jobs), lu.compteur);
    const rp = /: (\d+) pôles? sur (\d+) accessibles?/.exec(lu.resume);
    egal(j, sc, GRAVITE.BLOQUANT, 'résumé : pôles accessibles', regle, ciel.accessibleCount, rp ? Number(rp[1]) : null);
    if (ciel.jobs != null) {
      const v = /soit ([\d ]+) postes salariés/.exec(lu.resume)?.[1] ?? null;
      egal(j, sc, GRAVITE.BLOQUANT, 'résumé : postes', regle, fmtInt(ciel.jobs), v);
    }
  } else {
    // Hors couverture ou non calculé : ciel neutre, aucun compteur, jamais 0
    egal(j, sc, GRAVITE.BLOQUANT, 'compteur absent', 'ciel neutre : jamais de 0 de substitution (règle du contrat)', null, lu.compteur);
  }

  ciel.poles.forEach((s, i) => {
    const a = lu.astres[i];
    if (!a) return;
    if (a.etat) egal(j, sc, GRAVITE.BLOQUANT, 'état de l\'astre', regle, s.status, a.etat, s.id);
    if (ciel.neutre) {
      if (/aller|accessible/.test(a.aria.split('. Bassin')[0]) && !/non calculé pour ce scénario/.test(a.aria)) j.ecart(sc, GRAVITE.BLOQUANT, 'astre neutre', 'hors calcul, l\'astre ne porte pas de temps', '(aucun temps ni état)', a.aria, s.id);
      else j.ok();
      return;
    }
    if (ciel.base === 'od') {
      const m = EX.ariaOd.exec(a.aria);
      if (!m) {
        j.ecart(sc, GRAVITE.MINEUR, 'lecture de l\'astre', 'libellé attendu en table OD', 'nom : R postes atteints aller et retour sur M', a.aria, s.id);
        return;
      }
      egal(j, sc, GRAVITE.BLOQUANT, 'postes atteints (astre)', regle, s.reached, nombre(m[2]), s.id);
      egal(j, sc, GRAVITE.BLOQUANT, 'postes mesurés (astre)', 'postes du pôle moins la commune de départ', s.measurable, nombre(m[3]), s.id);
      const pct = s.share != null ? fmtPct(s.share * 100) : null;
      egal(j, sc, GRAVITE.BLOQUANT, 'part atteinte (astre)', regle, pct, m[4] ? `${m[4]} %` : null, s.id);
      if (s.unknown > 0) egal(j, sc, GRAVITE.BLOQUANT, 'postes non calculés (astre)', 'non calculé jamais compté', s.unknown, nombre(m[5]), s.id);
      if (s.self > 0) egal(j, sc, GRAVITE.BLOQUANT, 'postes de la commune (astre)', 'commune de départ : trajet non mesuré', s.self, nombre(m[6]), s.id);
    } else {
      const m = EX.ariaAcc.exec(a.aria);
      if (!m) {
        j.ecart(sc, GRAVITE.MINEUR, 'lecture de l\'astre', 'libellé attendu', 'nom, postes, état : aller, retour', a.aria, s.id);
        return;
      }
      egal(j, sc, GRAVITE.BLOQUANT, 'postes (astre)', 'poles.json', s.jobs, nombre(m[2]), s.id);
      const etatTexte = { accessible: 'accessible', out_only: 'retour au-delà', none: 'hors de portée', unknown: 'non calculé' }[s.status];
      egal(j, sc, GRAVITE.BLOQUANT, 'état de l\'astre', regle, etatTexte, m[3] ?? (a.aria.includes('non calculé pour ce scénario') ? 'non calculé' : null), s.id);
      if (s.status !== 'unknown') {
        egal(j, sc, GRAVITE.BLOQUANT, 'temps aller (astre)', 'access/ out', s.out == null ? '-' : `${s.out} min`, m[4], s.id);
        egal(j, sc, GRAVITE.BLOQUANT, 'temps retour (astre)', 'access/ ret', s.ret == null ? '-' : `${s.ret} min`, m[5]?.replace(/ \(.*/, ''), s.id);
      }
    }
  });

  // Étiquettes courtes du ciel : allumée si l'astre est atteint
  if (!ciel.neutre) {
    for (const c of lu.courts) {
      const s = ciel.poles.find((_, i) => (cartePoles[i].name_short ?? cartePoles[i].name) === c.texte);
      if (!s) continue;
      egal(j, sc, GRAVITE.BLOQUANT, 'étiquette allumée', regle, s.status === 'accessible', c.allume, s.id);
    }
  }

  // Marques des besoins
  if (attenduMarques && attenduMarques.etat !== 'aucune' && sc.needs?.length) {
    const regleB = 'D-034 : toutes les cases cochées parmi 1 à 3 remplies sur tout le trajet le plus rapide, aller et retour, dans le budget';
    if (attenduMarques.etat === 'pret') {
      const n = attenduMarques.ids.size;
      const legende = /(\d+) astres? sur \d+/.exec(lu.besoins ?? '');
      egal(j, sc, GRAVITE.MAJEUR, 'légende : nombre d\'astres marqués', regleB, n, legende ? Number(legende[1]) : null);
      ciel.poles.forEach((s, i) => {
        const a = lu.astres[i];
        if (!a) return;
        const marque = a.aria.includes(BESOINS.marqueAria);
        egal(j, sc, GRAVITE.MAJEUR, 'marque de l\'astre', regleB, attenduMarques.ids.has(s.id), marque, s.id);
      });
    } else {
      egal(j, sc, GRAVITE.MAJEUR, 'légende sans marque', regleB, true, /Aucune marque/.test(lu.besoins ?? ''));
    }
  }
}

export function controlerPreuve(j, sc, exp, lu) {
  const pole = exp.pole;
  const egalP = (grav, nom, regle, attendu, affiche) => egal(j, sc, grav, nom, regle, attendu, affiche, pole);
  const listeP = (grav, nom, regle, attendu, affiche) => listeEgale(j, sc, grav, nom, regle, attendu, affiche, pole);

  if (!lu) {
    j.ecart(sc, GRAVITE.BLOQUANT, 'panneau de preuve absent', 'p= ouvre le panneau', 'panneau affiché', '(absent)', pole);
    return;
  }
  egalP(GRAVITE.MINEUR, 'titre de l\'astre', 'poles.json', exp.titre, lu.titre);
  egalP(GRAVITE.MINEUR, 'sous-titre du panneau', 'commune, journée, jour type', exp.contexte, lu.contexte);

  // État du panneau
  const b = lu.badges.find((x) => !/\bpf-badge-gain\b/.test(x.classes) && !/\btc-badge\b/.test(x.classes));
  if (exp.badge !== undefined) {
    if (exp.badge === null) egalP(GRAVITE.BLOQUANT, 'badge d\'état', '', null, b?.texte ?? null);
    else {
      egalP(GRAVITE.BLOQUANT, 'badge d\'état', 'règle aller ET retour', exp.badge.texte, b?.texte ?? null);
      egalP(GRAVITE.BLOQUANT, 'classe du badge', 'règle aller ET retour', exp.badge.classe, b ? /pf-badge-(\w+)/.exec(b.classes)?.[1] ?? null : null);
    }
  }

  if (exp.od) {
    egalP(GRAVITE.BLOQUANT, 'part des postes (panneau)', 'postes atteints / postes mesurés', exp.od.part, lu.od?.part ?? null);
    egalP(GRAVITE.BLOQUANT, 'ligne des postes (panneau)', 'postes atteints aller et retour sur postes mesurés', exp.od.ligne, lu.od?.ligne ?? null);
    const notes = lu.od?.notes ?? [];
    for (const n of exp.od.notes) {
      if (notes.some((x) => x.includes(n))) j.ok();
      else j.ecart(sc, GRAVITE.MINEUR, 'note de la commune', 'commune de départ, non calculés', n, rendu(notes), pole);
    }
    listeEgale(j, sc, GRAVITE.BLOQUANT, 'communes du pôle', 'D-019, aller et retour commune par commune', exp.communes.map(ligneCommuneTexte), (lu.communes ?? []).map(ligneCommuneLue), pole);
    egalP(GRAVITE.MINEUR, 'chiffre clé des communes', 'communes atteintes sur communes mesurées', exp.figureCommunes, lu.groupes.communes?.chiffre ?? null);
  } else if (exp.temps) {
    (exp.temps ?? []).forEach((c, i) => {
      const luC = lu.temps?.cellules?.[i];
      egalP(GRAVITE.BLOQUANT, `temps ${c.nom}`, 'access/ : durées du calcul', c.minutes, luC?.minutes ?? null);
      if (c.heures !== undefined) egalP(GRAVITE.BLOQUANT, `heures ${c.nom}`, 'départ dep, arrivée = départ + durée', c.heures, luC?.heures ?? null);
      if (c.indice !== undefined) {
        const has = (luC?.indices ?? []).some((x) => x === c.indice);
        if (has) j.ok();
        else j.ecart(sc, GRAVITE.MINEUR, `indice ${c.nom}`, 'fin du poste, attente comprise', c.indice, rendu(luC?.indices), pole);
      }
    });
  } else if (exp.temps === null && exp.tempsManquant !== undefined) {
    egalP(GRAVITE.MINEUR, 'message hors couverture', 'texte publié meta.velib.out_of_zone', exp.tempsManquant, lu.temps?.manquant ?? null);
  }

  // Transports
  for (const sens of ['out', 'ret']) {
    const bloc = exp.transports?.[sens];
    const luBloc = lu.transports.find((t) => (t.titre ?? '').includes(sens === 'out' ? '(aller' : '(retour')) ?? null;
    if (exp.transports === undefined) continue;
    if (!bloc) {
      if (luBloc) j.ecart(sc, GRAVITE.MAJEUR, `transports ${sens} inattendus`, 'itinéraires D-028 : détail seulement si publié', '(aucun bloc)', luBloc.titre, pole);
      else j.ok();
      continue;
    }
    if (!luBloc) {
      j.ecart(sc, GRAVITE.MAJEUR, `transports ${sens} absents`, 'itinéraires D-028', bloc.titre, '(absent)', pole);
      continue;
    }
    egalP(GRAVITE.BLOQUANT, `titre transports ${sens}`, 'itinéraire publié : dep, arr', bloc.titre, luBloc.titre);
    listeP(GRAVITE.MAJEUR, `lignes ${sens}`, 'itinéraire publié : lignes empruntées', bloc.lignes.map((l) => `${l.titre} | ${l.heures}`), luBloc.lignes.map((l) => `${l.titre} | ${l.heures}`));
    listeP(GRAVITE.MINEUR, `faits des lignes ${sens}`, 'TRA03, QS01', bloc.lignes.map((l) => l.faits ?? ''), luBloc.lignes.map((l) => l.faits ?? ''));
    listeP(GRAVITE.MAJEUR, `tronçons ${sens}`, 'itinéraire publié : marches, attentes, types', bloc.troncons.map((l) => `${l.titre} | ${l.heures} | ${l.ou ?? ''}`), luBloc.troncons.map((l) => `${l.titre} | ${l.heures} | ${l.ou ?? ''}`));
    egalP(GRAVITE.MINEUR, `écart itinéraire ${sens}`, 'delta_min', bloc.delta, luBloc.delta);
  }
  for (const phrase of exp.itinManquantContient ?? []) {
    if ((lu.itinManquant ?? '').includes(normalise(phrase))) j.ok();
    else j.ecart(sc, GRAVITE.MINEUR, 'raison d\'un détail absent', 'statut publié ou règle D-028', phrase, lu.itinManquant, pole);
  }
  if (exp.correspondances !== undefined) listeP(GRAVITE.MINEUR, 'correspondances trop courtes', 'D-031 c (`transfer_check`)', exp.correspondances, lu.correspondances);

  // Coût et carbone (audit d'affichage du 10/11) : une ligne de coût, le carbone dessous, jamais le forfait Navigo du contexte
  const pli = lu.groupes.cout?.nu ?? '';
  if (/quels que soient le pôle et la commune/.test(pli)) j.ecart(sc, GRAVITE.BLOQUANT, 'forfait Navigo affiché', 'D-032 : le coût est ce qu\'on paie en plus, le forfait n\'est plus affiché seul', '(absent)', pli.slice(0, 200), pole);
  else j.ok();
  if (exp.coutLigne !== undefined) egalP(GRAVITE.BLOQUANT, 'tuile Coût', 'D-028, D-066 : prix sûr du sens, sinon « Prix inconnu »', exp.coutLigne, lu.cout?.ligne ?? null);
  if (exp.coutRetour !== undefined) egalP(GRAVITE.BLOQUANT, 'tuile Coût (retour)', 'D-028, D-066', exp.coutRetour, lu.coutRetour?.ligne ?? null);
  if (exp.carboneRetour !== undefined) egalP(GRAVITE.BLOQUANT, 'tuile Carbone (retour)', 'ENV01, D-066 : « estimation » sous la valeur', exp.carboneRetour, lu.carboneRetour ?? null);
  if (exp.trajetAR !== undefined) egalP(GRAVITE.BLOQUANT, 'ligne aller et retour', 'D-066 : chaque partie seulement si les deux sens la donnent', exp.trajetAR, lu.trajetAR ?? null);
  egalP(GRAVITE.MINEUR, 'chiffre clé du coût', 'total au ticket, ce qui reste à payer, ou la raison', exp.figureCout, exp.figureCout === undefined ? undefined : (lu.groupes.cout?.chiffre ?? null));
  // D-066 : tuile Carbone du sens affiché (« estimation » sous la valeur, « Non calculé » sinon)
  if (exp.carbone) egalP(GRAVITE.BLOQUANT, 'tuile Carbone', 'ENV01, D-066', exp.carbone, lu.carbone);
  else egalP(GRAVITE.BLOQUANT, 'carbone absent', 'ENV01 : pas de valeur sans trajet', null, lu.carbone);
  if (exp.coutSansItineraire) {
    if (pli.includes(normalise(exp.coutSansItineraire.texte))) j.ok();
    else j.ecart(sc, GRAVITE.MAJEUR, 'coût sans itinéraire', 'horaires libres, comparaison, vélo + TC : la raison, aucune ligne Navigo', exp.coutSansItineraire.texte, pli.slice(0, 300) || null, pole);
  }

  // Abonnements
  if (exp.abonnements !== undefined) {
    if (exp.abonnements === null) {
      if (lu.abonnements) j.ecart(sc, GRAVITE.MAJEUR, 'bloc abonnements inattendu', 'bloc seulement pour TC avec itinéraire, Vélib\', vélo, vélo + TC, hors comparaison', '(absent)', lu.abonnements.phrases.join(' | '), pole);
      else j.ok();
    } else if (!lu.abonnements) {
      j.ecart(sc, GRAVITE.BLOQUANT, 'bloc abonnements absent', 'D-032', exp.abonnements.phrases.join(' | '), '(absent)', pole);
    } else {
      for (const ph of exp.abonnements.phrases) {
        const ok = lu.abonnements.phrases.some((x) => x === normalise(ph));
        if (ok) j.ok();
        else j.ecart(sc, GRAVITE.BLOQUANT, 'phrase de coût abonnement', 'D-032 : couvert = 0, supplément, inconnu dit tel quel, jamais 0', ph, rendu(lu.abonnements.phrases), pole);
      }
      listeP(GRAVITE.BLOQUANT, 'détail des sens ou titres', 'D-032', exp.abonnements.listes, lu.abonnements.liste);
    }
  }

  // Voiture
  if (exp.voiture !== undefined) {
    if (exp.voiture === null) {
      if (lu.voiture) j.ecart(sc, GRAVITE.MAJEUR, 'coût voiture inattendu', 'coût par véhicule seulement en mode voiture', '(absent)', lu.voiture.titre, pole);
      else j.ok();
    } else if (!lu.voiture) {
      j.ecart(sc, GRAVITE.BLOQUANT, 'coût voiture absent', 'D-029', exp.voiture.titre, '(absent)', pole);
    } else {
      egalP(GRAVITE.MINEUR, 'véhicule du coût', 'véhicule choisi', exp.voiture.titre, lu.voiture.titre);
      if (exp.voiture.pasPublie) {
        if (/pas encore publié/.test(lu.voiture.texte)) j.ok();
        else j.ecart(sc, GRAVITE.BLOQUANT, 'coût voiture non publié', 'sans distance, rien n\'est chiffré', 'Coût du trajet : pas encore publié', lu.voiture.texte.slice(0, 200), pole);
      } else if (exp.voiture.interdit) {
        if (/interdit aux deux-roues/.test(lu.voiture.texte)) j.ok();
        else j.ecart(sc, GRAVITE.BLOQUANT, 'deux-roues interdit au Duplex', 'D-029 : aucun coût calculé', 'phrase d\'interdiction', lu.voiture.texte.slice(0, 200), pole);
      } else {
        listeP(GRAVITE.BLOQUANT, 'coût voiture par sens', 'D-029 : distance x conso x prix, péages à l\'heure de passage', exp.voiture.lignes, lu.voiture.lignes);
        if (lu.voiture.phrases.some((x) => x === normalise(exp.voiture.total))) j.ok();
        else j.ecart(sc, GRAVITE.BLOQUANT, 'coût voiture aller-retour', 'total arrondi après la somme', exp.voiture.total, rendu(lu.voiture.phrases), pole);
      }
    }
    if (exp.trafic) {
      for (const l of exp.trafic) {
        if (lu.trafic.some((x) => x === normalise(l))) j.ok();
        else j.ecart(sc, GRAVITE.BLOQUANT, 'temps avec trafic', 'D-029 : indice DiRIF de la tranche', l, rendu(lu.trafic), pole);
      }
    }
  }

  // Comparer les moyens de transport
  if (exp.modes !== undefined) {
    if (exp.modes === null) {
      if (lu.modes.length) j.ecart(sc, GRAVITE.MAJEUR, 'tableau des modes inattendu', 'une commune, journée-type', '(absent)', `${lu.modes.length} lignes`, pole);
      else j.ok();
    } else {
      const lire = (ligne) => ({ tete: ligne.tete, cases: ligne.cases });
      const attendus = exp.modes.map((m) => {
        const cases = [m.aller, m.retour];
        if (m.verdict) cases.push(m.verdict);
        cases.push(m.cout, m.carbone);
        return `${m.nom}${m.courant ? ' (ciel affiché)' : ' afficher'} | ${cases.join(' | ')}`;
      });
      listeP(GRAVITE.BLOQUANT, 'tableau des modes', 'durées access/ de chaque mode, coût et carbone seulement publiés', attendus, lu.modes.map(lire).map((l) => `${l.tete} | ${l.cases.join(' | ')}`));
    }
  }

  // Emplois
  egalP(GRAVITE.BLOQUANT, 'postes de l\'astre (Emplois)', 'poles.json', exp.figureEmplois, lu.groupes.emplois?.chiffre ?? null);

  // Besoins
  if (exp.besoins) {
    const luA = lu.besoinsResume.find((b) => /\(aller\)/.test(b.titre));
    const luR = lu.besoinsResume.find((b) => /\(retour\)/.test(b.titre));
    if (exp.besoins.aller) listeP(GRAVITE.MAJEUR, 'besoins (aller)', 'D-034', exp.besoins.aller, luA?.lignes ?? []);
    if (exp.besoins.retour) listeP(GRAVITE.MAJEUR, 'besoins (retour)', 'D-034', exp.besoins.retour, luR?.lignes ?? []);
    const marqueLue = (lu.besoinsVerdict ?? '').startsWith(BESOINS.marqueVerdictOui);
    egalP(GRAVITE.MAJEUR, 'phrase de marque', 'D-034', exp.besoins.marque, marqueLue);
  }

  // Mode sources
  const codes = (lu.texteComplet.match(/\b(EMP0\d|TRA0\d|TRA01[BC]|COST0\d|ENV0\d|SUB0\d|QS0\d|GEO0\d)\b/g) ?? []);
  const estActive = lu.provenanceVisible > 0;
  if (sc.src === 0) {
    egalP(GRAVITE.MINEUR, 'mode sources coupé : codes visibles', 'D-033 : coupé, aucune source affichée', 0, codes.length);
  } else if (sc.src === 1) {
    egalP(GRAVITE.MINEUR, 'mode sources activé : note de provenance', 'D-033', true, estActive);
  }
}

const ligneCommuneTexte = (l) => (l.aller == null ? `${l.nom} | ${fmtInt(l.postes)} | ${l.titre}` : `${l.nom} | ${fmtInt(l.postes)} | ${l.titre} | ${l.aller} | ${l.retour}`);

function ligneCommuneLue(c) {
  const m = /^(.*?) · ([\d ]+) postes?(?: · (.*))?$/.exec(c.tete);
  if (!m) return c.tete;
  const titre = m[3] ?? '';
  if (c.cases.length) return `${m[1]} | ${m[2].trim()} | ${titre} | ${c.cases.join(' | ')}`;
  return `${m[1]} | ${m[2].trim()} | ${titre}`;
}

export function controlerOr(j, sc, attendus, lu, cartePoles, actif) {
  if (attendus == null) return;
  const lus = lu.astres.flatMap((a, i) => (a.aria.includes(OR_MENTION) ? [a.id ?? cartePoles[i].id] : []));
  const a = [...attendus].sort();
  const b = [...lus].sort();
  const regle = 'D-056 : gain vélo + TC, part TC commune par commune nulle';
  if (JSON.stringify(a) === JSON.stringify(b)) {
    if (actif) j.ok();
  } else if (actif) j.ecart(sc, GRAVITE.MAJEUR, 'astres en or', regle, a.join(', '), b.join(', '));
  else j.enAttente(sc, 'astres en or', regle, a, b);
}

export function controlerAlternatives(j, sc, couverture, pole, lu) {
  if (!couverture || !lu) return;
  const c = couverture.communes?.[sc.o];
  const iPole = couverture.poles.indexOf(pole);
  const lettre = sc.d && c ? c[sc.d]?.out?.[iPole] ?? 'n' : 'n';
  const texteAttendu = c == null || lettre === 'n' ? ALT_ETAT.pasEncore : lettre === 's' ? ALT_ETAT.sansAutre : null;
  const etats = lu.alternatives?.etat ?? [];
  // Lettre a ou s : la case est calculée ; « Calcul fait, non affiché » est permis (le vérificateur ne relit pas `a_lines`), jamais « Pas encore calculé »
  const nonAffiche = (lettre === 'a' || lettre === 's') && etats.some((e) => e.toLowerCase().includes(ALT_ETAT.nonAffiche.toLowerCase()));
  if (nonAffiche) j.ok();
  else if (texteAttendu) {
    // D-066 : la raison est écrite « Autres trajets : calculé, pas d'autre trajet. » (casse de la phrase)
    if (etats.some((e) => e.toLowerCase().includes(texteAttendu.toLowerCase()))) j.ok();
    else j.ecart(sc, GRAVITE.MAJEUR, 'état des trajets alternatifs', 'alternatives-1 : états stricts', texteAttendu, rendu(lu.alternatives?.etat), pole);
  } else if (lu.alternatives && lu.alternatives.onglets.length >= 2) j.ok();
  else j.ecart(sc, GRAVITE.MAJEUR, 'onglets des trajets alternatifs', 'alternatives-1 : état avec alternatives', 'onglets affichés', rendu(lu.alternatives?.onglets), pole);
}
