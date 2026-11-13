/**
 * Contrôle de l'affichage : scénarios à jouer. Tirage reproductible (graine fixe, mulberry32) + cas limites explicites.
 * Un cas = une page chargée (URL de scénario, puis 1 à 3 astres ouverts en cliquant).
 */
import { PARAM_SOURCES } from './selecteurs.mjs';
import { minutesDe, peageSens } from './oracle.mjs';

export function generateur(graine) {
  let a = graine >>> 0;
  const suite = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    nombre: suite,
    entier: (n) => Math.floor(suite() * n),
    choisir: (liste) => liste[Math.floor(suite() * liste.length)],
    melange: (liste) => {
      const copie = [...liste];
      for (let i = copie.length - 1; i > 0; i--) {
        const j = Math.floor(suite() * (i + 1));
        [copie[i], copie[j]] = [copie[j], copie[i]];
      }
      return copie;
    },
  };
}

export class Cas {
  constructor(base, champs) {
    Object.assign(this, { d: 'd09', b: 45, m: 'transit', w: null, s: null, e: null, vh: null, transit: null, velib: null, needs: [], src: null, poles: [], tag: '', vs: null, ...champs });
    this.base = base;
  }

  /** Paramètres de l'URL (mêmes noms que state/url.ts) */
  parametres(pole) {
    const q = new URLSearchParams();
    q.set('o', this.o);
    if (this.s != null && this.e != null) {
      q.set('s', hhmmUrl(this.s));
      q.set('e', hhmmUrl(this.e));
    } else q.set('d', this.d);
    q.set('b', String(this.b));
    q.set('m', this.m);
    if (this.w) q.set('w', this.w);
    if (this.vh) q.set('vh', this.vh);
    if (pole ?? this.poles[0]) q.set('p', pole ?? this.poles[0]);
    if (this.src != null) q.set(PARAM_SOURCES, String(this.src));
    return q;
  }

  urlPage(pole) {
    return `${this.base}/?${this.parametres(pole).toString()}`;
  }

  /** URL à rejouer d'un écart : les réglages hors URL (abonnements, besoins) sont dits à côté */
  urlPourRejouer(pole) {
    const hors = [];
    if (this.transit) hors.push(`abonnement TC : ${this.transit}`);
    if (this.velib) hors.push(`abonnement Vélib' : ${this.velib}`);
    if (this.needs?.length) hors.push(`besoins cochés : ${this.needs.join(', ')}`);
    return `${this.urlPage(pole)}${hors.length ? ` [${hors.join(' ; ')}]` : ''}`;
  }
}

function hhmmUrl(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;
}

const MODES_ALEA = ['transit', 'transit', 'transit', 'walk', 'bike', 'car', 'car_traffic', 'bike_transit', 'velib'];

export const CAS_RECHERCHES = ['ticketsInconnus', 'co2Inconnu', 'sansItineraire', 'pasDeTrajet', 'orlyval', 'tarifAeroport', 'ter', 'tollFourchette', 'tollInconnu', 'tollPrix', 'interdit2r', 'besoinsMarque'];

/** Scanne les fichiers publiés pour trouver des cas particuliers (péages inconnus, tickets non calculés...). Fini en bornant le nombre de fichiers. */
export async function chercherCasParticuliers(oracle, g, maxFichiers) {
  const trouve = {};
  const meta = oracle.meta;
  const priorite = g.melange(oracle.communes.filter((c) => ['91', '94', '75', '93', '95'].includes(c.insee.slice(0, 2))).map((c) => c.insee));
  const reste = g.melange(oracle.communes.map((c) => c.insee).filter((c) => !priorite.includes(c)));
  const ordre = [...priorite, ...reste].slice(0, maxFichiers);
  const suffixe = meta.itineraries_format?.suffix ?? '.json';
  const fini = () => CAS_RECHERCHES.every((k) => trouve[k]);
  for (const insee of ordre) {
    if (fini()) break;
    if (meta.itineraries_communes?.includes(insee)) {
      const f = suffixe.endsWith('.gz') ? await oracle.d.jsonGz(`itineraries/${insee}${suffixe}`) : await oracle.d.json(`itineraries/${insee}${suffixe}`);
      if (f) {
        for (const jour of Object.keys(f.days)) {
          // Un astre réellement marqué : sans lui, le contrôle des marques ne porterait que sur des zéros
          if (!trouve.besoinsMarque) {
            const iMarque = f.poles.findIndex((_, i) => oracle.astreMarque(f.days[jour].out[i], f.days[jour].ret[i], ['wc_trip'], 120));
            if (iMarque >= 0) trouve.besoinsMarque = { o: insee, d: jour, b: 120, needs: ['wc_trip'], poles: [f.poles[iMarque]] };
          }
          for (const sens of ['out', 'ret']) {
            f.days[jour][sens].forEach((t, i) => {
              const pole = f.poles[i];
              const c = { o: insee, d: jour, poles: [pole] };
              if (t.status === 'no_itinerary_found') trouve.sansItineraire ??= c;
              if (t.status === 'no_trip_in_matrix' && i === 0) trouve.pasDeTrajet ??= c;
              if (t.status !== 'ok') return;
              if (t.tickets?.status === 'unknown') trouve.ticketsInconnus ??= c;
              if (t.co2_g && t.co2_g.status !== 'ok') trouve.co2Inconnu ??= c;
              if ((t.legs ?? []).some((l) => l.line === 'ORLYVAL')) trouve.orlyval ??= c;
              if ((t.tickets?.airport ?? 0) > 0) trouve.tarifAeroport ??= c;
              if ((t.legs ?? []).some((l) => l.m === 'ter')) trouve.ter ??= c;
            });
          }
        }
      }
    }
    if (!(trouve.tollFourchette && trouve.tollInconnu && trouve.tollPrix && trouve.interdit2r)) {
      const a = await oracle.d.json(`access/${insee}.json`);
      const toll = a?.car_trip?.toll;
      if (toll) {
        for (const sens of ['out', 'ret']) {
          toll[sens].forEach((cell, i) => {
            const pole = oracle.poles[i]?.id;
            if (!pole || cell == null) return;
            if (!Array.isArray(cell)) trouve.tollInconnu ??= { o: insee, poles: [pole] };
            else if (cell.length) {
              trouve.tollPrix ??= { o: insee, poles: [pole] };
              if (cell.some(([e]) => oracle.peages.points[e]?.system === 'DUPLEX_A86')) trouve.interdit2r ??= { o: insee, poles: [pole] };
              // Une vraie fourchette : la fenêtre de passage du sens recoupe plusieurs tranches de prix
              const duree = a.modes?.car?.any?.[sens]?.[i];
              for (const j of duree == null || trouve.tollFourchette ? [] : oracle.meta.day_types) {
                const h = minutesDe(sens === 'out' ? j.start : j.end);
                const fen = sens === 'out' ? [h - duree, h] : [h, h + duree];
                if (peageSens(oracle.peages, cell, 1, fen[0], fen[1]).statut === 'fourchette') trouve.tollFourchette = { o: insee, d: j.id, poles: [pole] };
              }
            }
          });
        }
      }
    }
  }
  return trouve;
}

/** Cas limites explicites, joués en mode rapide comme en mode complet (les trouvailles ci-dessus complètent). */
export function casExplicites(oracle, base, part) {
  const m = oracle.meta;
  const [histoire1, histoire2] = m.story_communes ?? [];
  const poles = oracle.poles;
  const grandPole = [...poles].sort((a, b) => (b.jobs ?? 0) - (a.jobs ?? 0))[0].id;
  const cas = [];
  const add = (tag, champs) => cas.push(new Cas(base, { tag, ...champs }));

  // Commune de la visite
  add('visite : commune du récit', { o: histoire1, d: 'd09', b: 45, m: 'transit', poles: [grandPole, 'BE_1107_75101'] });
  add('visite : seconde commune', { o: histoire2 ?? histoire1, d: 'd06', b: 60, m: 'transit', poles: [grandPole] });

  // Découvertes
  (oracle.insights ?? []).slice(0, part.rapide ? 2 : 8).forEach((ins) => {
    const s = ins.scenario;
    add(`découverte ${ins.id}`, { o: s.o, d: s.d, b: s.b, m: s.m, poles: [grandPole] });
  });

  // Marche, vélo, voiture, vélo + TC, Vélib', confort, nuit
  add('TC confort (1 km à pied)', { o: histoire1, d: 'd14', b: 45, m: 'transit', w: 'comfort', poles: [grandPole] });
  add('marche', { o: histoire1, d: 'd06', b: 30, m: 'walk', poles: [grandPole] });
  add('vélo', { o: histoire1, d: 'd14', b: 45, m: 'bike', poles: [grandPole] });
  add('voiture route vide', { o: histoire1, d: 'd09', b: 45, m: 'car', vh: null, poles: [grandPole] });
  add('voiture trafic moyen', { o: histoire1, d: 'd09', b: 45, m: 'car_traffic', vh: 'diesel', poles: [grandPole] });
  add('voiture trafic, journée sans mesure', { o: histoire1, d: 'd06', b: 45, m: 'car_traffic', vh: 'electric', poles: [grandPole] });
  add('deux-roues', { o: histoire1, d: 'd09', b: 45, m: 'car', vh: 'moto_125', poles: [grandPole] });
  const bt = m.mode_coverage?.bike_transit ?? [];
  if (bt.length) {
    add('vélo + TC', { o: histoire1, d: 'd09', b: 45, m: 'bike_transit', poles: [grandPole] });
    const hors = oracle.communes.find((c) => !bt.includes(c.insee));
    if (hors) add('vélo + TC hors couverture (non calculé)', { o: hors.insee, d: 'd09', b: 45, m: 'bike_transit', poles: [] });
  }
  const velib = m.mode_coverage?.velib ?? [];
  if (velib.length) {
    add("Vélib' dans la zone", { o: velib[0], d: 'd09', b: 45, m: 'velib', poles: [grandPole] });
    const horsV = oracle.communes.find((c) => !velib.includes(c.insee));
    if (horsV) add("Vélib' hors zone", { o: horsV.insee, d: 'd09', b: 45, m: 'velib', poles: [] });
  }
  add('horaires libres', { o: histoire1, s: 8 * 60 + 30, e: 16 * 60 + 30, b: 45, m: 'transit', poles: [grandPole] });
  add('poste de nuit (22h-6h)', { o: histoire1, s: 22 * 60, e: 6 * 60, b: 60, m: 'transit', poles: [grandPole] });
  add('commune de Paris (astre = commune de départ)', { o: '75102', d: 'd09', b: 30, m: 'transit', poles: ['BE_1107_75102', 'BE_1107_75101'] });

  // Abonnements
  add('sans abonnement', { o: histoire1, d: 'd09', b: 45, m: 'transit', transit: null, poles: [grandPole] });
  add('abonnement qui couvre (Navigo Mois)', { o: histoire1, d: 'd09', b: 45, m: 'transit', transit: 'navigo_month', poles: [grandPole] });
  add('titre d\'une journée (Navigo Jour)', { o: histoire1, d: 'd09', b: 45, m: 'transit', transit: 'navigo_day', poles: [grandPole] });
  add('abonnement TC + Vélib\' (plusieurs)', { o: velib[0] ?? histoire1, d: 'd09', b: 45, m: 'velib', transit: 'navigo_month', velib: 'v_plus', poles: [grandPole] });

  // Besoins, sources
  add('besoins cochés (tous)', { o: histoire1, d: 'd09', b: 60, m: 'transit', needs: ['wc_trip', 'wc_stops', 'station', 'audio', 'visual'], poles: [grandPole] });
  add('besoins (cases 4 et 5 seules)', { o: histoire1, d: 'd09', b: 60, m: 'transit', needs: ['audio', 'visual'], poles: [grandPole] });
  add('mode sources coupé', { o: histoire1, d: 'd09', b: 45, m: 'transit', src: 0, poles: [grandPole] });
  add('mode sources activé', { o: histoire1, d: 'd09', b: 45, m: 'transit', src: 1, poles: [grandPole] });

  // Cas extrêmes
  add('commune éloignée, petit temps', { o: oracle.communes.find((c) => c.dep === '77' && c.insee !== '77284')?.insee ?? histoire1, d: 'd09', b: 15, m: 'transit', poles: [grandPole] });
  return cas;
}

export function casDesTrouvailles(trouve, base) {
  const cas = [];
  const add = (cle, tag, champs) => {
    const t = trouve[cle];
    if (t) cas.push(new Cas(base, { tag, d: 'd09', b: 60, m: 'transit', ...t, ...champs }));
  };
  add('ticketsInconnus', 'ticket non calculé (raison affichée)', {});
  add('co2Inconnu', 'carbone non calculé', {});
  add('sansItineraire', 'trajet sans itinéraire (no_itinerary_found)', {});
  add('pasDeTrajet', 'aucun trajet dans la matrice', {});
  add('orlyval', 'Orlyval avec Navigo Mois (ticket en plus)', { transit: 'navigo_month' });
  add('tarifAeroport', 'aéroport avec Navigo Jour (ticket en plus)', { transit: 'navigo_day' });
  add('tarifAeroport', 'aéroport avec Solidarité 75 % Mois (non calculé)', { transit: 'solidarity75_month' });
  add('ter', 'TER avec Solidarité (non calculé)', { transit: 'solidarity75_month' });
  add('ter', 'TER avec Navigo Jour (non calculé)', { transit: 'navigo_day' });
  add('tollPrix', 'péage connu', { m: 'car', d: 'd09', b: 60 });
  add('tollFourchette', 'péage en fourchette', { m: 'car', b: 60 });
  add('tollInconnu', 'péage inconnu (non_trouve)', { m: 'car', d: 'd09', b: 60 });
  add('interdit2r', 'deux-roues sur le Duplex A86 (interdit)', { m: 'car', d: 'd09', b: 60, vh: 'moto_mid' });
  add('besoinsMarque', 'besoins : astre réellement marqué', {});
  return cas;
}

/** Tirage reproductible : `n` cas supplémentaires, couvrant les combinaisons. */
export function casAleatoires(oracle, base, g, n) {
  const m = oracle.meta;
  const communes = m.access_communes?.length ? m.access_communes : oracle.communes.map((c) => c.insee);
  const poles = oracle.poles;
  const budgets = [15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 90, 120];
  const cas = [];
  const bt = m.mode_coverage?.bike_transit ?? [];
  const velib = m.mode_coverage?.velib ?? [];
  const tcOptions = (oracle.abonnements?.transit?.options ?? []).map((o) => o.id);
  const velibOffres = (oracle.abonnements?.velib?.offers ?? []).filter((o) => o.kind !== 'ride').map((o) => o.id);
  const vehicules = (m.vehicles ?? []).map((v) => v.id);
  const jours = m.day_types.map((d) => d.id);
  const libresDebut = [7 * 60, 7 * 60 + 30, 8 * 60, 8 * 60 + 45, 9 * 60 + 15, 10 * 60, 12 * 60, 13 * 60 + 30, 15 * 60, 17 * 60];
  for (let i = 0; i < n; i++) {
    const mode = g.choisir(MODES_ALEA);
    let o = g.choisir(communes);
    if (mode === 'bike_transit' && bt.length && g.nombre() < 0.8) o = g.choisir(bt);
    if (mode === 'velib' && velib.length && g.nombre() < 0.8) o = g.choisir(velib);
    const c = { o, b: g.choisir(budgets), m: mode, d: g.choisir(jours), tag: `aléa ${String(i + 1).padStart(3, '0')}` };
    // Horaires libres seulement sur les modes de la table commune x commune
    if (['transit', 'walk', 'bike', 'car', 'car_traffic'].includes(mode) && g.nombre() < 0.25) {
      const s = g.choisir(libresDebut);
      const e = s + g.choisir([6, 7, 8, 9]) * 60;
      if (e < 23 * 60 + 55 && m.day_types.every((d) => minutesDe(d.start) !== s || minutesDe(d.end) !== e)) {
        c.s = s;
        c.e = e;
      }
    }
    if (mode === 'transit' && g.nombre() < 0.25) c.w = 'comfort';
    if ((mode === 'car' || mode === 'car_traffic') && vehicules.length) c.vh = g.choisir(vehicules);
    if (mode === 'transit' && g.nombre() < 0.5 && tcOptions.length) c.transit = g.choisir(tcOptions);
    if (mode === 'velib' && g.nombre() < 0.6 && velibOffres.length) c.velib = g.choisir(velibOffres);
    if (mode === 'velib' && g.nombre() < 0.3 && tcOptions.length) c.transit = g.choisir(tcOptions);
    if (mode === 'transit' && !c.s && g.nombre() < 0.2) c.needs = g.melange(['wc_trip', 'wc_stops', 'station', 'audio', 'visual']).slice(0, 1 + g.entier(3));
    if (g.nombre() < 0.15) c.src = 1;
    c.poles = g.melange(poles.map((p) => p.id)).slice(0, mode === 'transit' ? 2 : 1);
    cas.push(new Cas(base, c));
  }
  return cas;
}
