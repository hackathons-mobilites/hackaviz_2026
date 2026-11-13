/**
 * Contrôle de l'affichage : ORACLE. Recalcule ce qui doit être affiché à partir des fichiers publiés et des règles écrites
 * (docs/methodologie.md, docs/decisions.md D-019, D-024, D-027, D-028, D-029, D-031, D-032, D-034, D-056, et le contrat
 * `contrats-donnees.md`). N'importe AUCUNE fonction du front (règle non négociable : un oracle qui reprendrait compute.ts ne prouverait rien).
 *
 * Valeurs de sortie : `undefined` = pas de contrôle, `null` = doit être absent.
 */
import { Donnees, allerSerie, retourSerie, scalaire } from './donnees.mjs';
import { BESOINS, NOM_COURT_COMMUNE, PHRASE, distanceTexte, faitsLigneCourts, fmtEur, fmtHeure, fmtInt, fmtKm, fmtPct, jourDeLaDate, minTroncon, normalise, titreTroncon } from './textes.mjs';

const NON_MESURE = new Set(['not_computed', 'origin_not_snapped']);

export function minutesDe(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  return m ? +m[1] * 60 + +m[2] : null;
}

/** Arrondi demi-centime vers le haut (D-029 : « au centime, demi-centime vers le haut », total arrondi après la somme) */
export const auCentime = (x) => Math.floor(x * 100 + 0.5) / 100;
/** Arrondi D-032 (`floor(x * 100 + 0,5 + 1e-7) / 100`) */
export const auCentimeAbonnement = (x) => Math.floor(x * 100 + 0.5 + 1e-7) / 100;

/** Voiture avec trafic moyen (D-029, règle du contrat `meta.car_congestion`) : temps retenu d'un sens. */
export function tempsTrafic(cc, sens, horloge, libre) {
  if (libre == null) return { libre: null, trafic: null, retenu: null, statut: null, periode: null };
  const pp = cc.periods.map((p) => ({ p, s: minutesDe(p.start), e: minutesDe(p.end) }));
  const hit = pp.find(({ s, e }) => (sens === 'out' ? s < horloge && horloge <= e : s <= horloge && horloge < e));
  if (!hit) return { libre, trafic: null, retenu: libre, statut: 'no_period', periode: null };
  const ix = Math.round(hit.p.index * 100);
  const portee = sens === 'out' ? (horloge - hit.s) * 100 >= libre * ix : (hit.e - horloge) * 100 >= libre * ix;
  if (!portee) return { libre, trafic: null, retenu: libre, statut: 'outside_period', periode: hit.p };
  const t = Math.floor((libre * ix + 50) / 100);
  return { libre, trafic: t, retenu: t, statut: 'ok', periode: hit.p };
}

export function etatDestination(out, ret, budget) {
  if (out.minutes == null) return out.reason && NON_MESURE.has(out.reason) ? 'unknown' : 'none';
  if (out.minutes > budget) return 'none';
  if (ret.minutes == null) return ret.reason && NON_MESURE.has(ret.reason) ? 'unknown' : 'out_only';
  return ret.minutes <= budget ? 'accessible' : 'out_only';
}

/** Coût d'un sens TC selon un abonnement (D-032, docs/methodologie.md § « Calcul d'un sens ») ; null si aucun abonnement. */
export function coutSensTc(trajet, option, extra, nonPrices) {
  if (!trajet || trajet.status !== 'ok') return { statut: 'no_trip', eur: null, items: [], raisons: [] };
  const tk = trajet.tickets ?? { status: 'unknown' };
  const raisonsExploitant = [];
  for (const l of trajet.legs ?? []) {
    const r = nonPrices[l.agency ?? ''];
    if (r && !raisonsExploitant.includes(r)) raisonsExploitant.push(r);
  }
  if (raisonsExploitant.length) return { statut: 'unknown', eur: null, items: [], raisons: raisonsExploitant };
  if (tk.status === 'unknown' || tk.cost_eur == null) return { statut: 'unknown', eur: null, items: [], raisons: [...(tk.reasons ?? [])] };
  if (!option) return { statut: 'tickets', eur: auCentimeAbonnement(tk.cost_eur), items: [], raisons: [] };
  const cov = option.covers;
  const rides = (trajet.legs ?? []).filter((l) => l.m !== 'walk');
  const nbOrly = rides.filter((l) => l.line === 'ORLYVAL').length;
  const nbTer = rides.filter((l) => l.m === 'ter').length;
  const raisons = [];
  const items = [];
  if (nbTer && cov.ter !== 'yes') raisons.push(option.unknown_reasons?.ter ?? '');
  const airport = tk.airport ?? 0;
  if (airport) {
    if (cov.airport_rail === 'unknown') raisons.push(option.unknown_reasons?.airport_rail ?? '');
    else if (cov.airport_rail === 'no') items.push({ titre: 'airport_ticket', n: airport });
  }
  if (nbOrly && cov.airport_rail !== 'no') {
    if (cov.orlyval === 'unknown') raisons.push(option.unknown_reasons?.orlyval ?? '');
    else if (cov.orlyval === 'no') items.push({ titre: 'orlyval_ticket', n: nbOrly });
  }
  if (raisons.length) return { statut: 'unknown', eur: null, items: [], raisons };
  let somme = 0;
  for (const i of items) {
    if (extra[i.titre]?.eur == null) return { statut: 'unknown', eur: null, items: [], raisons: ['titre complémentaire non publié'] };
    somme += extra[i.titre].eur * i.n;
  }
  return { statut: items.length ? 'extra' : 'included', eur: auCentimeAbonnement(somme), items, raisons: [] };
}

/** Coût d'une course Vélib' (D-032, CGAU) : tranches facturées au-delà des minutes incluses = (T - incluses) // 30 + 1 */
export function coutCourseVelib(minutes, offre) {
  if (minutes == null) return { statut: 'no_trip', eur: null, raison: null };
  const reg = offre.ride;
  const tranches = minutes < reg.included_min ? 0 : Math.floor((minutes - reg.included_min) / reg.step_min) + 1;
  if (tranches && reg.beyond_eur == null) return { statut: 'unknown', eur: null, raison: reg.beyond_reason ?? null };
  let eur = (reg.per_ride_eur ?? 0) + tranches * (reg.beyond_eur ?? 0);
  if (reg.cap_eur != null) eur = Math.min(eur, reg.cap_eur);
  eur = auCentimeAbonnement(eur);
  return { statut: eur === 0 ? 'included' : 'paid', eur, raison: null };
}

const PERIODE = { month: 'par mois', week: 'par semaine', year: 'par an', day: 'par jour', ride: 'la course' };
export function prixTexte(p) {
  if (p.eur == null) return p.text ?? p.reason ?? 'prix non publié';
  if (p.eur === 0) return 'gratuit';
  return `${fmtEur(p.eur)} ${PERIODE[p.per]}`;
}

function texteSensTc(c, extra, sens) {
  const lib = sens === 'out' ? 'Aller' : 'Retour';
  switch (c.statut) {
    case 'no_trip':
      return null;
    case 'unknown':
      return `${lib} : coût non calculé${c.raisons.length ? ` (${c.raisons.join(' ; ')})` : ''}.`;
    case 'included':
      return `${lib} : inclus dans votre abonnement.`;
    case 'tickets':
      return `${lib} : ${fmtEur(c.eur ?? 0)} au ticket.`;
    case 'extra': {
      const quoi = c.items.map((i) => `${i.n > 1 ? `${i.n} x ` : ''}${extra[i.titre]?.label ?? i.titre}`).join(', ');
      return `${lib} : ${fmtEur(c.eur ?? 0)} en plus (${quoi}, non couvert par votre abonnement).`;
    }
  }
  return null;
}

/** Péage d'un sens (contrat tolls-1, règle « du front » du contrat = `toll_publish.toll_leg`). */
export function peageSens(tj, cellule, classe, lo, hi, tarif = 'standard') {
  if (cellule == null) return { min: null, max: null, statut: 'no_route', items: [] };
  if (!Array.isArray(cellule)) return { min: null, max: null, statut: cellule.s, points: cellule.p, items: [] };
  if (cellule.length === 0) return { min: 0, max: 0, statut: 'sans_peage', items: [] };
  let bas = 0;
  let haut = 0;
  const items = [];
  for (const [e, s] of cellule) {
    const gs = tj.grids.filter((g) => g.e === e && g.s === s && g.c === classe);
    if (gs.some((g) => g.status === 'interdit')) return { min: null, max: null, statut: 'interdit', points: [e, s], items };
    if (gs.length === 0) return { min: null, max: null, statut: 'couple_absent', points: [e, s], items };
    const own = gs.filter((g) => g.t === tarif);
    if (own.length === 0) return { min: null, max: null, statut: 'tarif_absent', points: [e, s], items };
    const parJour = new Map(own.map((g) => [g.d ?? 0, g.slots ?? []]));
    const prix = new Set();
    let manque = null;
    if (hi === lo) {
      const d = Math.floor(lo / 1440);
      const slots = parJour.get(d);
      if (!slots) manque = 'jour_absent';
      else for (const [a, b, p] of slots) if (a <= lo - d * 1440 && lo - d * 1440 < b) prix.add(p);
    } else {
      for (let d = Math.floor(lo / 1440); d <= Math.floor((hi - 1) / 1440) && !manque; d++) {
        const slots = parJour.get(d);
        if (!slots) {
          manque = 'jour_absent';
          break;
        }
        const a0 = Math.max(lo - d * 1440, 0);
        const b0 = Math.min(hi - d * 1440, 1440);
        for (const [a, b, p] of slots) if (a < b0 && a0 < b) prix.add(p);
      }
    }
    if (manque || prix.size === 0) return { min: null, max: null, statut: manque ?? 'tranche_absente', points: [e, s], items };
    const tri = [...prix].sort((x, y) => x - y);
    bas += tri[0];
    haut += tri[tri.length - 1];
    items.push({ e, s, prix: tri });
  }
  const min = auCentime(bas);
  const max = auCentime(haut);
  return { min, max, statut: min === max ? 'ok' : 'fourchette', items };
}

export function nomPassage(tj, e, s) {
  const a = tj.points[e]?.label ?? '?';
  const b = tj.points[s]?.label ?? '?';
  return e === s ? a : `${a} > ${b}`;
}

const intervalleEur = (a, b) => (a === b ? fmtEur(a) : `de ${fmtEur(a)} à ${fmtEur(b)}`);

function limiteTexte(maxTrip) {
  const n = Math.round(maxTrip);
  return n % 60 === 0 ? `${n / 60} h` : `${n} min`;
}

export class Oracle {
  constructor(base) {
    this.base = base;
    this.d = new Donnees(base);
  }

  async charger() {
    this.meta = await this.d.json('meta.json', true);
    this.poles = await this.d.json('poles.json', true);
    this.communes = await this.d.json('communes.json', true);
    this.abonnements = await this.d.json('subscriptions.json', true);
    this.peages = await this.d.json('tolls.json', true);
    this.insights = await this.d.json('insights.json', true);
    this.altCouverture = await this.d.json('alternatives/coverage.json', true);
    this.parCode = new Map(this.communes.map((c) => [c.insee, c]));
    this.parPole = new Map(this.poles.map((p, i) => [p.id, { p, i }]));
    if (!this.meta || !this.poles || !this.communes) throw new Error("meta.json, poles.json ou communes.json introuvable sur l'URL visée");
    const lim = this.meta.max_trip_min;
    this.limite = typeof lim === 'number' ? limiteTexte(lim) : null;
    return this;
  }

  dossierOd(w) {
    const set = this.meta.walk_settings;
    const r = set?.settings?.find((s) => s.id === (w ?? set.default)) ?? set?.settings?.find((s) => s.id === set.default);
    return `od_walk${r.leg_limit_m}`;
  }

  jourType(sc) {
    return this.meta.day_types.find((d) => d.id === sc.d);
  }

  /** Horaire effectif (journée-type ou horaire libre `s` / `e`, en minutes) */
  horaires(sc) {
    if (sc.s != null && sc.e != null) return { start: sc.s, end: sc.e, libre: true };
    const j = this.jourType(sc);
    return { start: minutesDe(j.start), end: minutesDe(j.end), libre: false };
  }

  /** Journée-type dont les horaires sont exactement ceux du scénario (null sinon) */
  jourItineraire(sc, h) {
    if (!h.libre) return sc.d;
    return this.meta.day_types.find((d) => minutesDe(d.start) === h.start && minutesDe(d.end) === h.end)?.id ?? null;
  }

  /** Série d'un mode dans access/ (null si absente ou d'une autre longueur que les astres) */
  serieAccess(acc, mode, jour) {
    const m = acc?.modes?.[mode];
    if (!m) return null;
    const s = m[jour] ?? m.any ?? null;
    if (!s || s.out?.length !== this.poles.length || s.ret?.length !== this.poles.length) return null;
    return s;
  }

  /** Vrai si la table OD sert ce mode (section présente et couverture complète) */
  async tableOd(sc) {
    const dir = this.dossierOd(sc.w);
    const index = await this.d.json(`${dir}/index.json`, true);
    if (!index) return null;
    const tm = sc.m === 'car_traffic' ? 'car' : sc.m;
    const def = index.modes.find((x) => x.id === tm);
    if (!def || index.coverage?.[tm]?.complete !== true) return null;
    if (sc.m === 'car_traffic' && !this.meta.car_congestion) return null;
    return { dir, index, def };
  }

  couvert(mode, insee) {
    const liste = this.meta.mode_coverage?.[mode];
    return !liste || liste.includes(insee);
  }

  /**
   * État attendu du ciel : base de calcul, par pôle (statut, parts), totaux. Règle de la commune de départ : `index.self_pair`
   * (non mesurée, ni atteinte ni non atteinte, hors dénominateur, D-019).
   */
  async ciel(sc) {
    const h = this.horaires(sc);
    const t = await this.tableOd(sc);
    return t ? this.cielOd(sc, h, t) : this.cielAccess(sc);
  }

  async cielOd(sc, h, { dir, index, def }) {
    const f = await this.d.swod(dir, sc.o);
    const originIdx = index.communes.indexOf(sc.o);
    const section = f?.sections.get(def.code);
    if (!f || !section) throw new Error(`table OD : ${sc.o} sans section ${def.id} dans ${dir}`);
    const cc = sc.m === 'car_traffic' ? this.meta.car_congestion : null;
    const lookback = index.outbound_lookback_min;
    const dests = index.communes.map((insee, y) => {
      const base = { insee, y, jobs: index.jobs[y] ?? 0, pole: index.pole_of[y] ?? null };
      const r = section.records.get(y);
      if (y === originIdx) return { ...base, status: 'self', out: { minutes: null, reason: null }, ret: { minutes: null, reason: null } };
      if (!r) {
        const none = { minutes: null, reason: 'no_trip_within_120', dep: null };
        return { ...base, status: 'none', out: none, ret: none };
      }
      let out = section.kind === 'serie' ? allerSerie(f, r.out, h.start, lookback) : scalaire(f, r.out);
      let ret = section.kind === 'serie' ? retourSerie(f, r.ret, h.end) : scalaire(f, r.ret);
      if (cc) {
        out = { ...out, minutes: tempsTrafic(cc, 'out', h.start, out.minutes).retenu };
        ret = { ...ret, minutes: tempsTrafic(cc, 'ret', h.end, ret.minutes).retenu };
      }
      return { ...base, status: etatDestination(out, ret, sc.b), out, ret };
    });
    const poles = index.poles.map((p, i) => ({ index: i, id: p.id, jobs: p.jobs, measurable: p.jobs, reached: 0, notReached: 0, outOnly: 0, unknown: 0, self: 0, share: null, communes: [] }));
    for (const d of dests) {
      if (d.pole == null) continue;
      const s = poles[d.pole];
      s.communes.push(d);
      if (d.status === 'accessible') s.reached += d.jobs;
      else if (d.status === 'self') s.self += d.jobs;
      else if (d.status === 'unknown') s.unknown += d.jobs;
      else {
        s.notReached += d.jobs;
        if (d.status === 'out_only') s.outOnly += d.jobs;
      }
    }
    for (const s of poles) {
      s.measurable = Math.max(0, s.jobs - s.self);
      s.share = s.measurable > 0 ? s.reached / s.measurable : null;
      s.status = s.reached > 0 ? 'accessible' : s.outOnly > 0 ? 'out_only' : s.notReached > 0 ? 'none' : 'unknown';
      s.communesMesurees = s.communes.filter((d) => d.status !== 'self').length;
      s.communesAtteintes = s.communes.filter((d) => d.status === 'accessible').length;
    }
    const t = { reachedAll: 0, allJobs: 0, measurableJobs: 0, selfJobs: 0, unknownJobs: 0, reachedCommunes: 0, communes: 0 };
    for (const d of dests) {
      t.allJobs += d.jobs;
      if (d.status === 'self') {
        t.selfJobs += d.jobs;
        continue;
      }
      t.measurableJobs += d.jobs;
      t.communes += 1;
      if (d.status === 'accessible') {
        t.reachedAll += d.jobs;
        t.reachedCommunes += 1;
      } else if (d.status === 'unknown') t.unknownJobs += d.jobs;
    }
    return {
      base: 'od',
      neutre: false,
      timeDependent: def.kind === 'series',
      horaires: h,
      dir,
      index,
      poles,
      totaux: t,
      accessibleCount: poles.filter((s) => s.status === 'accessible').length,
    };
  }

  async cielAccess(sc) {
    const acc = await this.d.json(`access/${sc.o}.json`);
    const h = this.horaires(sc);
    const serie = this.couvert(sc.m, sc.o) ? this.serieAccess(acc, sc.m, sc.d) : null;
    const poles = this.poles.map((pole, index) => {
      if (!serie) return { index, id: pole.id, jobs: pole.jobs, status: 'unknown', out: null, ret: null, reason: 'not_computed', dep: null };
      const out = serie.out[index] ?? null;
      const ret = serie.ret[index] ?? null;
      const reason = serie.reason?.[index] ?? null;
      let status = 'none';
      if ((out == null || ret == null) && reason && NON_MESURE.has(reason)) status = 'unknown';
      else if (out != null && ret != null && out <= sc.b && ret <= sc.b) status = 'accessible';
      else if (out != null && out <= sc.b) status = 'out_only';
      return { index, id: pole.id, jobs: pole.jobs, status, out, ret, reason, dep: serie.dep?.[index] ?? null };
    });
    const accessibles = poles.filter((p) => p.status === 'accessible');
    const jobs = accessibles.reduce((t, p) => (t == null || p.jobs == null ? null : t + p.jobs), 0);
    const hasData = poles.some((p) => p.status !== 'unknown');
    const timeDependent = !!acc?.modes?.[sc.m]?.[sc.d];
    return { base: 'access', neutre: !hasData, timeDependent, horaires: h, acc, poles, jobs, hasData, accessibleCount: accessibles.length };
  }

  /** Marques des besoins (D-034) : astres marqués sur le ciel (seulement si des cases 1-3 cochées et itinéraires publiés) */
  async marques(sc, ciel) {
    if (!sc.needs?.length || !sc.needs.some((b) => BESOINS.ciel.includes(b))) return { etat: 'aucune', ids: new Set() };
    const info = await this.infoItineraires(sc, ciel.horaires);
    if (!info.fichier) return { etat: 'indisponible', ids: new Set(), raison: info.why };
    const ids = new Set();
    for (const pole of this.poles) {
      const i = info.fichier.poles.indexOf(pole.id);
      if (i < 0) return { etat: 'indisponible', ids: new Set(), raison: 'pending' };
      const out = info.fichier.days[info.jour]?.out?.[i];
      const ret = info.fichier.days[info.jour]?.ret?.[i];
      if (this.astreMarque(out, ret, sc.needs, sc.b)) ids.add(pole.id);
    }
    return { etat: 'pret', ids };
  }

  astreMarque(out, ret, selection, budget) {
    if (!out || !ret || out.status !== 'ok' || ret.status !== 'ok' || !out.legs?.length || !ret.legs?.length) return false;
    const mo = out.matrix_min ?? out.min;
    const mr = ret.matrix_min ?? ret.min;
    if (mo == null || mr == null || mo > budget || mr > budget) return false;
    const sel = BESOINS.ciel.filter((b) => selection.includes(b));
    if (sel.length === 0) return false;
    return [out, ret].every((t) => sel.every((b) => ['filled', 'no_station'].includes(this.etatCase(b, t.legs))));
  }

  etatCase(box, legs) {
    const r = (legs ?? []).filter((l) => l.m != null && l.m !== 'walk');
    if (r.length === 0) return 'no_ride';
    const combine = (etats) => (etats.some((s) => s === 'not_filled') ? 'not_filled' : etats.every((s) => s === 'filled') ? 'filled' : 'not_stated');
    const drap = (v) => (v === true ? 'filled' : v === false ? 'not_filled' : 'not_stated');
    const signe = (v) => (v === 'true' ? 'filled' : v === 'false' || v === 'partial' ? 'not_filled' : 'not_stated');
    const gare = (s) => {
      const lv = s?.level;
      if (lv === 4 || lv === 6) return 'filled';
      if (lv === 1 || lv === 3) return 'not_filled';
      return 'not_stated';
    };
    switch (box) {
      case 'wc_trip':
        return combine(r.map((l) => drap(l.wc_trip)));
      case 'wc_stops':
        return combine(r.flatMap((l) => [drap(l.wc_from), drap(l.wc_to)]));
      case 'audio':
        return combine(r.map((l) => signe(l.a11y?.audio)));
      case 'visual':
        return combine(r.map((l) => signe(l.a11y?.visual)));
      case 'station': {
        if (r.some((l) => !l.a11y)) return 'not_stated';
        const presents = r.flatMap((l) => ['st_from', 'st_to'].filter((k) => k in l.a11y).map((k) => l.a11y[k]));
        return presents.length ? combine(presents.map(gare)) : 'no_station';
      }
    }
    return 'not_stated';
  }

  /** Itinéraires du panneau : disponibles seulement en TC, réglage publié, journée-type, commune publiée (D-028) */
  async infoItineraires(sc, h) {
    const jour = this.jourItineraire(sc, h);
    if (sc.m !== 'transit') return { why: 'mode', fichier: null, jour };
    const key = this.cleMarche(sc);
    let dir = 'itineraries';
    let communes = this.meta.itineraries_communes;
    if (key) {
      const v = this.meta.itineraries_variants?.[key];
      if (!v) return { why: 'walk', fichier: null, jour };
      dir = v.dir;
      communes = v.communes;
    }
    if (!jour) return { why: 'shift', fichier: null, jour };
    if (sc.vs) return { why: 'compare', fichier: null, jour };
    if (!communes?.includes(sc.o)) return { why: 'not_published', fichier: null, jour };
    const suffixe = this.meta.itineraries_format?.suffix ?? '.json';
    const fichier = suffixe.endsWith('.gz') ? await this.d.jsonGz(`${dir}/${sc.o}${suffixe}`) : await this.d.json(`${dir}/${sc.o}${suffixe}`);
    if (!fichier) return { why: 'not_published', fichier: null, jour };
    return { why: null, fichier, jour, dir };
  }

  /** Clé de réglage de marche (variants / itineraries_variants) : null = réglage par défaut */
  cleMarche(sc) {
    if (sc.m !== 'transit' || !sc.w) return null;
    const set = this.meta.walk_settings;
    const r = set?.settings?.find((s) => s.id === sc.w);
    return r?.key ?? null;
  }

  phraseTemps(val, sens, od, h) {
    if (val.minutes != null) {
      if (!od.timeDependent) return `${sens === 'out' ? 'Aller' : 'Retour'} ${val.minutes} min`;
      if (sens === 'out') return `Aller ${val.minutes} min (départ ${fmtHeure(val.dep)}, arrivée ${fmtHeure(val.dep + val.minutes)})`;
      return `Retour ${val.minutes} min, attente comprise (fin du poste à ${fmtHeure(h.end)}, arrivée ${fmtHeure(h.end + val.minutes)})`;
    }
    if (!val.reason) return `${sens === 'out' ? 'Aller' : 'Retour'} : trajet non mesuré`;
    if (val.reason === 'not_computed') return `${sens === 'out' ? 'Aller' : 'Retour'} non calculé`;
    if (val.reason === 'origin_not_snapped') return `${sens === 'out' ? 'Aller' : 'Retour'} : point de départ ou d'arrivée non raccordé au réseau`;
    return sens === 'out' ? `Aller : ${PHRASE.aucunTrajetAller(this.limite, od.timeDependent)}` : `Retour : ${PHRASE.aucunTrajetRetour(this.limite, od.timeDependent)}`;
  }

  /** Une ligne du tableau des communes du pôle */
  ligneCommune(d, sc, ciel) {
    const nom = NOM_COURT_COMMUNE(this.parCode.get(d.insee)?.name ?? d.insee);
    if (d.status === 'self') return { nom, postes: d.jobs, titre: 'Votre commune', aller: null, retour: null };
    const titre = d.status === 'accessible' ? '' : this.titreVerdict(d, sc.b);
    return { nom, postes: d.jobs, titre, aller: this.phraseTemps(d.out, 'out', ciel, ciel.horaires), retour: this.phraseTemps(d.ret, 'ret', ciel, ciel.horaires) };
  }

  /** Titre du verdict d'une commune (D-019, texte de `proofVerdict`) */
  titreVerdict(d, budget) {
    const leg = (v) => (v == null ? 'none' : v <= budget ? 'ok' : 'too_long');
    if (d.out.reason && NON_MESURE.has(d.out.reason)) return 'Non calculé';
    const o = leg(d.out.minutes);
    const r = leg(d.ret.minutes);
    if (d.ret.reason && NON_MESURE.has(d.ret.reason)) {
      if (d.status === 'unknown') return d.ret.reason === 'not_computed' ? 'Retour non calculé' : 'Non calculé';
      return d.out.minutes == null ? "Aucun trajet trouvé à l'aller" : 'Aller trop long';
    }
    const OUT = { ok: '', too_long: 'aller trop long', none: "aucun trajet trouvé à l'aller" };
    const RET = { ok: '', too_long: 'retour trop long', none: 'aucun trajet trouvé au retour' };
    const t = o === 'too_long' && r === 'too_long' ? 'aller et retour trop longs' : o === 'none' && r === 'none' ? 'aucun trajet trouvé' : [OUT[o], RET[r]].filter(Boolean).join(', ');
    return `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
  }

  badgeOd(s, budget) {
    const max = `aller et retour ≤ ${budget} min`;
    if (s.reached > 0 && s.share != null && s.reached >= s.measurable) return { classe: 'accessible', texte: `Accessible · ${max}` };
    if (s.reached > 0) return { classe: 'accessible', texte: `En partie accessible · ${s.share != null ? `${fmtPct(s.share * 100)} des postes, ` : ''}${max}` };
    if (s.outOnly > 0) return { classe: 'out_only', texte: `Aller possible, retour hors de portée en ${budget} min` };
    if (s.notReached > 0) return { classe: 'blocked', texte: `Hors de portée en ${budget} min par sens` };
    if (s.self > 0 && s.measurable <= 0) return { classe: 'unknown', texte: 'Votre commune : trajet non mesuré' };
    return { classe: 'unknown', texte: 'Non calculé' };
  }

  /** Attendu du panneau pour un astre. Certaines parties sont `undefined` : pas de contrôle (règle non établie ici). */
  async preuve(sc, poleId, ciel) {
    const { p: pole, i: poleIndex } = this.parPole.get(poleId);
    const nomOrigine = NOM_COURT_COMMUNE(this.parCode.get(sc.o)?.name ?? sc.o);
    const h = ciel.horaires;
    const exp = { pole: poleId, titre: pole.name_official ?? pole.name };

    // Contexte
    const td = (ciel.base === 'od' ? ciel.timeDependent : !!ciel.acc?.modes?.[sc.m]?.[sc.d]) || sc.m === 'car_traffic';
    const jour = this.jourType(sc);
    const shift = h.libre ? `${fmtHeure(h.start)}-${fmtHeure(h.end)}` : `${fmtHeure(minutesDe(jour.start))}-${fmtHeure(minutesDe(jour.end))}`;
    // « mardi type » : mode sources seulement depuis le lot 6 (D-058, précaution de calcul)
    const wd = sc.src === 1 ? jourDeLaDate(this.meta.service_date) : null;
    exp.contexte = td ? `Depuis ${nomOrigine} · ${h.libre ? `horaires ${shift}` : `journée ${shift}`}${wd ? ` · ${wd} type` : ''}` : `Depuis ${nomOrigine}`; // audit d'affichage du 11/11 (P4)

    const s = ciel.poles[poleIndex];
    if (ciel.base === 'od') {
      exp.badge = this.badgeOd(s, sc.b);
      exp.od = {
        part: s.share != null ? fmtPct(s.share * 100) : null,
        ligne: PHRASE.atteintsLigne(s.reached, s.measurable, sc.src === 1),
        notes: [...(s.unknown > 0 ? [PHRASE.nonCalculesNote(s.unknown)] : []), ...(s.self > 0 ? [PHRASE.selfNote(s.self)] : [])],
      };
      exp.temps = null;
      const ordre = [...s.communes].sort((a, b) => b.jobs - a.jobs || a.y - b.y);
      exp.communes = ordre.map((d) => this.ligneCommune(d, sc, ciel));
      // Comparaison (lot 5 du 10/11) : le chiffre du pli dit les deux communes ; seule la colonne A est vérifiée ici
      exp.figureCommunes = sc.vs ? undefined : `${s.communesAtteintes} sur ${s.communesMesurees} atteintes`;
    } else {
      this.attenduTempsAccess(exp, sc, s, ciel, jour);
    }
    exp.figureEmplois = pole.jobs == null ? undefined : `${fmtInt(pole.jobs)} postes salariés (INSEE)`;

    // Itinéraires
    const info = await this.infoItineraires(sc, h);
    const itinJour = info.jour;
    const trajets = { out: null, ret: null };
    let entrees = { out: null, ret: null };
    if (info.fichier) {
      const i = info.fichier.poles.indexOf(poleId);
      if (i >= 0) {
        entrees = { out: info.fichier.days[itinJour]?.out?.[i] ?? null, ret: info.fichier.days[itinJour]?.ret?.[i] ?? null };
        for (const sens of ['out', 'ret']) if (entrees[sens]?.status === 'ok' && entrees[sens].legs?.length) trajets[sens] = entrees[sens];
      }
    }
    const texts = this.meta.line_facts?.texts;
    const blocs = {};
    for (const sens of ['out', 'ret']) {
      const t = trajets[sens];
      if (!t) {
        blocs[sens] = null;
        continue;
      }
      const rides = t.legs.filter((l) => l.m !== 'walk');
      blocs[sens] = {
        titre: PHRASE.transportsTitre(sens === 'out' ? 'aller' : 'retour', t.dep, t.arr, ciel.base === 'od'),
        lignes: rides.map((l) => ({ titre: titreTroncon(l), heures: `${l.dep} → ${l.arr} · ${minTroncon(l.min)} min`, faits: faitsLigneCourts(l, texts, sc.src === 1) })),
        troncons: t.legs.map((l) => {
          const walk = l.m === 'walk';
          const dist = walk ? distanceTexte(l.dist_m) : null;
          return { titre: titreTroncon(l), heures: `${l.dep} → ${l.arr} · ${minTroncon(l.min)} min${walk && dist ? ` · ${dist}` : ''}`, ou: !walk && (l.from || l.to) ? `${l.from ?? '?'} → ${l.to ?? '?'}` : null };
        }),
        delta: typeof t.delta_min === 'number' && t.delta_min !== 0 ? `Itinéraire détaillé à ${Math.abs(t.delta_min)} min près de la durée du calcul.` : null,
      };
    }
    exp.transports = blocs;

    // Phrases « pourquoi pas de détail »
    const manquant = [];
    if (info.why) {
      // Audit d'affichage du 11/11 : hors TC, aucune phrase (P27) ; horaires libres, phrase courte (P28, D9)
      if (info.why === 'shift') manquant.push(PHRASE.itinJournees());
    }
    exp.itinManquantContient = manquant;
    if (info.fichier) {
      const absents = [];
      for (const [sens, lib] of [
        ['out', 'Aller'],
        ['ret', 'Retour'],
      ]) {
        const t = entrees[sens];
        if (t && !trajets[sens]) {
          if (t.status === 'no_trip_in_matrix') absents.push(`${lib} : aucun trajet de ${this.limite} ou moins vers cet arrêt, rien à détailler.`);
          else if (t.status === 'no_itinerary_found') absents.push(`${lib} : détail indisponible (aucun itinéraire retrouvé pour ce trajet).`);
          else absents.push(`${lib} : détail non calculé.`);
        }
      }
      exp.itinManquantContient = [...exp.itinManquantContient, ...absents];
    }

    // Correspondances trop courtes (D-031 c)
    const clesTc = this.cleMarche(sc) ? this.meta.itineraries_variants?.[this.cleMarche(sc)]?.transfer_check : this.meta.transfer_check;
    if (clesTc && (trajets.out || trajets.ret)) {
      const phrases = [];
      for (const [sens, lib] of [
        ['out', 'Aller'],
        ['ret', 'Retour'],
      ]) {
        for (const tc of trajets[sens]?.transfer_check?.short ?? []) {
          const lieu = tc.at === tc.to ? `à ${tc.at}` : `entre ${tc.at} et ${tc.to}`;
          const regle = tc.source === 'navitia' ? `le calculateur d'IDFM en exige ${secondes(tc.min_s)}` : `le minimum publié par IDFM est de ${secondes(tc.min_s)}`;
          phrases.push(`${lib} : correspondance de ${secondes(tc.available_s)} ${lieu} : ${regle} ; ce trajet peut être plus long.`);
        }
      }
      exp.correspondances = phrases;
    }

    // Coût et carbone (audit d'affichage du 10/11) : UNE ligne de coût selon le cas, le carbone juste dessous, jamais le forfait
    // Navigo du contexte (faux depuis D-032). Le détail (titres, règles, méthode) est dans des « i », que la lecture retire.
    const coutOk = (t) => (t?.tickets && t.tickets.status === 'ok' && t.tickets.cost_eur != null ? t.tickets : null);
    const kO = coutOk(trajets.out);
    const kR = coutOk(trajets.ret);
    const pied = (k) => {
      const n = (k.metro_train_rer ?? 0) + (k.bus_tram ?? 0) + (k.airport ?? 0);
      return n === 0 && k.cost_eur === 0 ? 'à pied' : fmtEur(k.cost_eur);
    };
    const total = kO && kR ? auCentime(kO.cost_eur + kR.cost_eur) : null;
    const abo = this.abonnements;
    const option = sc.transit && abo ? abo.transit.options.find((o) => o.id === sc.transit) ?? null : null;
    const dual = !!sc.vs;
    const tcTrajets = sc.m === 'transit' && !dual && !!(trajets.out || trajets.ret);
    const unSens = this.limite ? `un sens n'a pas de trajet de ${this.limite} ou moins` : "un sens n'a pas de trajet";
    const sensManquant = tcTrajets && !(trajets.out && trajets.ret);
    const ok = (t) => (t?.co2_g?.status === 'ok' && typeof t.co2_g.value === 'number' ? t.co2_g.value : null);
    const co = ok(trajets.out);
    const cr = ok(trajets.ret);
    const co2Publie = [...new Set([trajets.out, trajets.ret].filter((t) => t?.co2_g && t.co2_g.status !== 'ok').map((t) => t.co2_g.reason).filter(Boolean))];
    // Raisons du coût au ticket (aucun abonnement choisi)
    const raisonsCout = [];
    if (tcTrajets && !option && total == null) {
      for (const t of [trajets.out, trajets.ret]) {
        let r = null;
        if (!t) r = [unSens];
        else if (!coutOk(t)) {
          if (t.tickets?.status === 'street_transfer_unverified') r = ['une correspondance par la rue entre deux gares reste à vérifier'];
          else r = (t.tickets?.reasons ?? []).filter(Boolean).length ? t.tickets.reasons.filter(Boolean) : ['prix non publié'];
        }
        for (const x of r ?? []) if (!raisonsCout.includes(x)) raisonsCout.push(x);
      }
    }
    // D-066 : tuiles Coût et Carbone du sens affiché (l'aller s'il existe, sinon le retour), ligne « Aller et retour » du trajet retenu
    exp.coutLigne = undefined;
    exp.trajetAR = undefined;
    const premier = trajets.out ? 'out' : trajets.ret ? 'ret' : null;
    const tuileCout = (t) => {
      const k = coutOk(t);
      if (!k) return 'Prix inconnu';
      const n = (k.metro_train_rer ?? 0) + (k.bus_tram ?? 0) + (k.airport ?? 0);
      return `${fmtEur(k.cost_eur)} ${n === 0 && k.cost_eur === 0 ? 'à pied, aucun ticket' : 'au ticket'}`;
    };
    const tuileCarbone = (t) => (ok(t) != null ? `${fmtInt(ok(t))} g CO2e estimation` : 'Non calculé');
    if (tcTrajets && !option && premier) {
      exp.coutLigne = tuileCout(trajets[premier]);
      if (trajets.out && trajets.ret) exp.coutRetour = tuileCout(trajets.ret);
    }
    exp.carbone = tcTrajets && premier ? tuileCarbone(trajets[premier]) : null;
    if (tcTrajets && trajets.out && trajets.ret) exp.carboneRetour = tuileCarbone(trajets.ret);
    if (tcTrajets && !option && trajets.out && trajets.ret) {
      const parts = [];
      if (typeof trajets.out.min === 'number' && typeof trajets.ret.min === 'number') parts.push(`${fmtInt(trajets.out.min + trajets.ret.min)} min`);
      if (total != null) parts.push(`${fmtEur(total)} au ticket`);
      if (co != null && cr != null) parts.push(`environ ${fmtInt(co + cr)} g CO2e (estimation)`);
      exp.trajetAR = parts.length ? `Aller et retour : ${parts.join(' · ')}` : null;
    }
    void pied;
    void sensManquant;
    void co2Publie;
    void raisonsCout;
    void unSens;
    // Sans itinéraire : la phrase du pli (horaires libres, comparaison, vélo + TC)
    const jours = this.meta.day_types.map((d) => d.label);
    const avecCarbone = sc.m !== 'velib';
    const quoi = avecCarbone ? 'Coût et carbone : calculés' : 'Coût : calculé';
    exp.coutSansItineraire = null;
    if (dual && ['transit', 'bike_transit', 'car', 'car_traffic', 'velib'].includes(sc.m)) exp.coutSansItineraire = { texte: `${quoi} pour une seule commune, hors comparaison.`, chiffre: 'hors comparaison' };
    else if (!dual && sc.m === 'transit' && info.why === 'shift')
      exp.coutSansItineraire = { texte: `${quoi} en journée-type seulement (${jours.join(', ')}).`, chiffre: `non ${avecCarbone ? 'calculés' : 'calculé'} en horaires libres` };
    // Chiffre lu sur le pli fermé
    const exemple = ciel.base === 'od' && (trajets.out || trajets.ret);
    if (exp.coutSansItineraire) exp.figureCout = exp.coutSansItineraire.chiffre;
    else if (tcTrajets && option && abo) {
      const extra = abo.transit.extra_titles;
      const np = abo.transit.unpriced_agencies ?? {};
      const a = coutSensTc(trajets.out, option, extra, np);
      const b = coutSensTc(trajets.ret, option, extra, np);
      let tot = a.eur != null && b.eur != null ? a.eur + b.eur : null;
      if (tot != null && option.kind === 'day' && option.price.eur != null) tot += option.price.eur;
      tot = tot == null ? null : auCentimeAbonnement(tot);
      exp.figureCout = tot == null ? undefined : option.kind === 'day' ? `Aller et retour : ${fmtEur(tot)} avec un ${option.label}` : tot === 0 ? 'rien en plus de votre abonnement' : `${fmtEur(tot)} en plus de votre abonnement`;
    } else exp.figureCout = tcTrajets ? null : undefined; // D-066 : le pli « Abonnements » n'a pas de chiffre sans abonnement choisi
    void exemple;

    // Abonnements (D-032)
    exp.abonnements = this.attenduAbonnements(sc, trajets, poleIndex, itinJour);

    // Voiture (D-029)
    if (sc.m === 'car' || sc.m === 'car_traffic') {
      const acc = ciel.base === 'access' ? ciel.acc : await this.d.json(`access/${sc.o}.json`);
      exp.voiture = this.attenduVoiture(sc, acc, poleIndex);
      exp.trafic = this.attenduTrafic(sc, acc, poleIndex, ciel);
    } else {
      exp.voiture = null;
    }

    // Comparer les moyens de transport
    let trajetsTc = trajets;
    if (sc.m !== 'transit' && itinJour && !sc.vs && this.meta.itineraries_communes?.includes(sc.o)) {
      const suffixe = this.meta.itineraries_format?.suffix ?? '.json';
      const fic = suffixe.endsWith('.gz') ? await this.d.jsonGz(`itineraries/${sc.o}${suffixe}`) : await this.d.json(`itineraries/${sc.o}${suffixe}`);
      const i = fic?.poles.indexOf(poleId) ?? -1;
      const pris = (t) => (t?.status === 'ok' && t.legs?.length ? t : null);
      trajetsTc = i >= 0 ? { out: pris(fic.days[itinJour]?.out?.[i]), ret: pris(fic.days[itinJour]?.ret?.[i]) } : { out: null, ret: null };
    }
    exp.modes = await this.attenduModes(sc, ciel, poleIndex, itinJour, trajetsTc);

    // Besoins (D-034)
    if (sc.needs?.length && (trajets.out || trajets.ret)) exp.besoins = this.attenduBesoins(sc, trajets);

    return exp;
  }

  attenduTempsAccess(exp, sc, s, ciel, jour) {
    const covOk = ciel.hasData;
    if (!covOk) {
      exp.badge = undefined;
      exp.temps = null;
      if (sc.m === 'velib' && this.meta.velib?.out_of_zone) exp.tempsManquant = `${normalise(this.meta.velib.out_of_zone)}.`;
      return;
    }
    const b = sc.b;
    const leg = (v) => (v == null ? 'none' : v <= b ? 'ok' : 'too_long');
    const o = leg(s.out);
    const r = leg(s.ret);
    if (s.status === 'unknown') {
      exp.badge = { classe: 'unknown', texte: 'Non calculé' };
    } else if (o === 'ok' && r === 'ok') {
      exp.badge = { classe: 'accessible', texte: `Accessible · aller et retour ≤ ${b} min` };
    } else {
      const OUT = { ok: '', too_long: 'aller trop long', none: "aucun trajet trouvé à l'aller" };
      const RET = { ok: '', too_long: 'retour trop long', none: 'aucun trajet trouvé au retour' };
      const t = o === 'too_long' && r === 'too_long' ? 'aller et retour trop longs' : o === 'none' && r === 'none' ? 'aucun trajet trouvé' : [OUT[o], RET[r]].filter(Boolean).join(', ');
      exp.badge = { classe: o === 'ok' ? 'out_only' : r === 'ok' ? 'in_only' : 'blocked', texte: `${t.charAt(0).toUpperCase()}${t.slice(1)}` };
    }
    const td = ciel.timeDependent;
    exp.temps = [
      {
        nom: 'Aller',
        minutes: s.out == null ? 'aucun trajet' : `${s.out} min`,
        heures: td && s.dep && s.out != null ? `${hhmm(minutesDe(s.dep))} → ${hhmm(minutesDe(s.dep) + s.out)}` : null,
      },
      {
        nom: 'Retour',
        minutes: s.ret == null ? 'aucun trajet' : `${s.ret} min`,
        heures: null,
        indice: td ? (s.ret != null ? `attente comprise (fin du poste à ${fmtHeure(minutesDe(jour.end))}, arrivée ${fmtHeure(minutesDe(jour.end) + s.ret)})` : `attente comprise, depuis la fin du poste à ${fmtHeure(minutesDe(jour.end))}`) : undefined,
      },
    ];
  }

  attenduAbonnements(sc, trajets, poleIndex, itinJour) {
    const file = this.abonnements;
    if (!file) return undefined;
    // Audit d'affichage du 10/11 : plus de ligne « Mes abonnements : … » ; les « i » et les boutons sont retirés à la lecture
    if (sc.vs) return null;
    const option = sc.transit ? file.transit.options.find((o) => o.id === sc.transit) ?? null : null;
    const offre = sc.velib ? file.velib.offers.find((o) => o.id === sc.velib) ?? null : null;
    const exp = { phrases: [], listes: [] };
    void itinJour;
    if (sc.m === 'transit' && (trajets.out || trajets.ret)) {
      const extra = file.transit.extra_titles;
      const np = file.transit.unpriced_agencies ?? {};
      const co = coutSensTc(trajets.out, option, extra, np);
      const cr = coutSensTc(trajets.ret, option, extra, np);
      let total = null;
      if (co.eur != null && cr.eur != null) {
        total = co.eur + cr.eur;
        if (option?.kind === 'day' && option.price.eur != null) total += option.price.eur;
        total = auCentimeAbonnement(total);
      }
      if (!option) {
        // Un seul sens : la ligne de coût dit pourquoi, aucun bloc d'abonnement (sauf abonnement enregistré inconnu)
        if (!(trajets.out && trajets.ret) && !sc.transit) return null;
        if (sc.transit) exp.phrases.push("Votre abonnement enregistré n'est plus dans la liste publiée : coût affiché hors abonnement.");
        if (trajets.out && trajets.ret) {
          const couvre = file.transit.options.filter((o) => {
            if (o.audience !== 'all') return false;
            const a = coutSensTc(trajets.out, o, extra, np);
            const b = coutSensTc(trajets.ret, o, extra, np);
            return a.statut === 'included' && b.statut === 'included';
          });
          const noms = couvre.filter((o) => o.kind === 'pass').map((o) => o.label);
          const ou = noms.length <= 1 ? noms[0] : `${noms.slice(0, -1).join(', ')} ou ${noms[noms.length - 1]}`;
          exp.phrases.push(noms.length ? `Avec un ${ou} : rien à payer en plus, hors coût de l'abonnement.` : 'Aucun titre tout public relevé ne couvre ce trajet sans supplément.');
        }
      } else if (option.kind === 'day') {
        exp.phrases.push(`Avec votre ${option.label} (${option.price.text ?? prixTexte(option.price)}) :`);
        exp.listes = [texteSensTc(co, extra, 'out'), texteSensTc(cr, extra, 'ret')].filter(Boolean);
        if (total != null) exp.phrases.push(`Aller et retour avec un ${option.label} : ${fmtEur(total)}.`);
      } else {
        const tete = `Avec votre ${option.label} (${option.price.text ?? prixTexte(option.price)}) : `;
        const unSens = this.limite ? `un sens n'a pas de trajet de ${this.limite} ou moins` : "un sens n'a pas de trajet";
        if (total === 0) exp.phrases.push(`${tete}rien à payer en plus pour ce trajet, hors coût de l'abonnement.`);
        else if (total != null) {
          const lib = (c) => c.items.map((i) => `${i.n > 1 ? `${i.n} x ` : ''}${(extra[i.titre]?.label ?? i.titre).replace(/^./, (x) => x.toLowerCase())}`).join(', ');
          const o = co.statut === 'extra' ? lib(co) : null;
          const r = cr.statut === 'extra' ? lib(cr) : null;
          const quoi = o && r && o === r ? `${o} à l'aller et au retour` : [o ? `${o} à l'aller` : null, r ? `${r} au retour` : null].filter(Boolean).join(' et ');
          exp.phrases.push(`${tete}reste à payer ${fmtEur(total)} (${quoi}), hors coût de l'abonnement.`);
        } else {
          const raisons = [];
          for (const c of [co, cr]) for (const x of c.statut === 'no_trip' ? [unSens] : c.raisons) if (x && !raisons.includes(x)) raisons.push(x);
          exp.phrases.push(`${tete}coût non calculé pour ce trajet${raisons.length ? ` (${raisons.join(' ; ')})` : ''}.`);
        }
      }
      return exp;
    }
    if (sc.m === 'velib') return this.attenduVelib(exp, sc, poleIndex, file, offre);
    if (sc.m === 'bike') {
      exp.phrases.push(file.bike.personal.text);
      return exp;
    }
    if (sc.m === 'bike_transit') {
      exp.phrases.push(file.bike.personal.text, file.bike.parking.text);
      return exp;
    }
    return null;
  }

  attenduVelib(exp, sc, poleIndex, file, offre) {
    const r = file.velib.rides[sc.o];
    if (!r || r.out.length !== this.poles.length || r.ret.length !== this.poles.length) return undefined;
    const out = r.out[poleIndex] ?? null;
    const ret = r.ret[poleIndex] ?? null;
    if (out == null && ret == null) return undefined;
    const sansAbo = file.velib.offers.find((o) => o.kind === 'ride') ?? null;
    const affiche = offre ?? sansAbo;
    if (!affiche) return null;
    const co = coutCourseVelib(out, affiche);
    const cr = coutCourseVelib(ret, affiche);
    // Audit d'affichage du 10/11 : la raison d'une course non calculée est dans le « i », dite une fois
    const texte = (c) => (c.statut === 'included' ? 'incluse' : c.statut === 'paid' && c.eur != null ? fmtEur(c.eur) : 'non calculée');
    let total = null;
    if (co.eur != null && cr.eur != null) total = auCentimeAbonnement(co.eur + cr.eur + (affiche.kind === 'day' && affiche.price.eur != null ? affiche.price.eur : 0));
    const dur = [out != null ? `aller ${out} min` : null, ret != null ? `retour ${ret} min` : null].filter(Boolean).join(', ');
    exp.phrases.push(`Partie à vélo (calculée) : ${dur}.`);
    const entete = offre ? `Avec votre ${offre.label} (${offre.price.text ?? prixTexte(offre.price)})` : `Hors abonnement (${affiche.label})`;
    exp.phrases.push(`${entete} : course aller ${texte(co)}, course retour ${texte(cr)}${total != null ? `, soit ${fmtEur(total)} l'aller-retour${affiche.kind === 'day' ? ' (prix du pass compris)' : ''}` : ''}.`);
    exp.listes = file.velib.offers
      .filter((o) => o.id !== affiche.id && o.kind === 'subscription')
      .map((o) => {
        const a = coutCourseVelib(out, o);
        const b = coutCourseVelib(ret, o);
        let tot = null;
        if (a.eur != null && b.eur != null) tot = auCentimeAbonnement(a.eur + b.eur);
        return `${o.label} (${prixTexte(o.price)}) : courses ${tot != null ? (tot === 0 ? 'incluses' : `${fmtEur(tot)} l'aller-retour en plus`) : 'non calculées'}`;
      });
    return exp;
  }

  attenduVoiture(sc, acc, poleIndex) {
    const costs = this.meta.car_costs;
    const vs = this.meta.vehicles ?? [];
    const v = vs.find((x) => x.id === sc.vh) ?? vs[0];
    if (!v || !costs) return undefined;
    const tj = this.peages;
    const trip = acc?.car_trip && acc.car_trip.dist_m?.out?.length === this.poles.length && acc.car_trip.dist_m?.ret?.length === this.poles.length ? acc.car_trip : null;
    const base = this.serieAccess(acc, 'car', 'any');
    const exp = { titre: `Coût et carbone : ${v.label.toLowerCase()}` };
    if (!trip || !base) {
      exp.pasPublie = true;
      return exp;
    }
    const h = this.horaires(sc);
    let dO = base.out[poleIndex] ?? null;
    let dR = base.ret[poleIndex] ?? null;
    if (sc.m === 'car_traffic' && this.meta.car_congestion) {
      dO = tempsTrafic(this.meta.car_congestion, 'out', h.start, dO).retenu;
      dR = tempsTrafic(this.meta.car_congestion, 'ret', h.end, dR).retenu;
    }
    const sens = (leg, clock, duree) => {
      const dist = trip.dist_m[leg][poleIndex] ?? null;
      const eNonArr = dist == null ? null : (dist / 1000) * v.cost_eur_per_km;
      const gNonArr = dist == null || v.co2_kg_per_km == null ? null : dist * v.co2_kg_per_km;
      const fen = duree == null ? null : leg === 'out' ? [clock - duree, clock] : [clock, clock + duree];
      const cell = trip.toll?.[leg]?.[poleIndex];
      const toll = tj && trip.toll && fen ? peageSens(tj, cell, v.toll_class, fen[0], fen[1]) : null;
      const ok = eNonArr != null && toll != null && toll.min != null && toll.max != null;
      return {
        dist,
        eNonArr,
        gNonArr,
        energie: eNonArr == null ? null : auCentime(eNonArr),
        toll,
        fen,
        totalMin: ok ? auCentime(eNonArr + toll.min) : null,
        totalMax: ok ? auCentime(eNonArr + toll.max) : null,
        co2: gNonArr == null ? null : Math.floor(gNonArr + 0.5),
      };
    };
    const a = sens('out', h.start, dO);
    const r = sens('ret', h.end, dR);
    if ([a.toll?.statut, r.toll?.statut].includes('interdit')) {
      exp.interdit = true;
      return exp;
    }
    const passage = (t) => t.items.map((x) => nomPassage(tj, x.e, x.s)).join(' ; ');
    const peageTxt = (t) => {
      if (t.statut === 'sans_peage') return 'aucun péage';
      if (t.min == null) {
        const lieux = (t.points ?? []).map((p) => tj.points[p]?.label).filter(Boolean);
        return `péage inconnu${lieux.length ? ` (${[...new Set(lieux)].join(', ')})` : ''} : ${tj.status_texts[t.statut] ?? t.statut}`;
      }
      return `péage ${intervalleEur(t.min, t.max)} (${passage(t)})`;
    };
    const ligne = (nom, f) => {
      if (f.dist == null) return `${nom} : aucun trajet en voiture trouvé.`;
      let s = `${nom} (${fmtKm(f.dist)} km) : énergie ${f.energie != null ? fmtEur(f.energie) : 'inconnue'} ; ${f.toll && tj ? peageTxt(f.toll) : 'péages en cours de chargement'}`;
      if (f.toll?.statut === 'fourchette' && f.fen) s += ` : l'heure de passage n'est connue qu'entre ${heureAvecMinutes(f.fen[0])} et ${heureAvecMinutes(f.fen[1])}`;
      if (f.totalMin != null && f.toll?.statut !== 'sans_peage') s += ` ; total ${intervalleEur(f.totalMin, f.totalMax)}`;
      if (f.co2 != null) s += ` ; ${fmtInt(f.co2)} g CO2e`;
      return `${s}.`;
    };
    exp.lignes = [ligne('Aller', a), ligne('Retour', r)];
    const eo = a.eNonArr;
    const er = r.eNonArr;
    const energie = eo == null || er == null ? null : auCentime(eo + er);
    const tolls = a.toll && r.toll && a.toll.min != null && r.toll.min != null ? [a.toll.min + r.toll.min, a.toll.max + r.toll.max] : null;
    const totMin = energie == null || !tolls ? null : auCentime(eo + er + tolls[0]);
    const totMax = energie == null || !tolls ? null : auCentime(eo + er + tolls[1]);
    const co2 = a.gNonArr == null || r.gNonArr == null ? null : Math.floor(a.gNonArr + r.gNonArr + 0.5);
    exp.total = `Aller et retour : ${totMin != null ? intervalleEur(totMin, totMax) : `total inconnu (péage non chiffré)${energie != null ? `, dont énergie ${fmtEur(energie)}` : ''}`}${co2 != null ? ` ; carbone environ ${fmtInt(co2)} g CO2e` : ''}.`;
    return exp;
  }

  attenduTrafic(sc, acc, poleIndex, ciel) {
    const cc = this.meta.car_congestion;
    if (!cc) return undefined;
    const base = this.serieAccess(acc, 'car', 'any');
    if (!base) return undefined;
    const libre = (l, c) => tempsTrafic(cc, l, c, base[l][poleIndex]);
    const h = ciel.horaires;
    const ph = (t) => {
      const fn = (x) => {
        const [a, b] = x.split(':');
        return b === '00' ? `${+a}h` : `${+a}h${b}`;
      };
      return `x ${t.index.toFixed(2).replace('.', ',')} (${fn(t.start)}-${fn(t.end)})`;
    };
    const ligne = (nom, t) => {
      if (t.libre == null) return `${nom} : aucun trajet en voiture trouvé`;
      if (t.statut === 'ok' && t.periode && t.trafic != null) return `${nom} : ${t.libre} min route vide, ${ph(t.periode)} : environ ${t.trafic} min avec le trafic moyen`;
      if (t.statut === 'outside_period') return `${nom} : ${t.libre} min route vide (${cc.texts.outside_period})`;
      return `${nom} : ${t.libre} min route vide (${cc.texts.no_period})`;
    };
    return [ligne('Aller', libre('out', h.start)), ligne('Retour', libre('ret', h.end))];
  }

  async attenduModes(sc, ciel, poleIndex, itinJour, trajets) {
    const od = ciel.base === 'od';
    if (od && !itinJour) return null;
    const jour = itinJour ?? sc.d;
    const acc = ciel.base === 'access' ? ciel.acc : await this.d.json(`access/${sc.o}.json`);
    const walkKey = this.cleMarche(sc);
    const cc = this.meta.car_congestion;
    const lignes = [];
    for (const m of this.meta.modes) {
      if (!this.couvert(m.id, sc.o)) continue;
      let serie = null;
      if (m.id === 'car_traffic') {
        const base = this.serieAccess(acc, 'car', 'any');
        const dj = this.meta.day_types.find((d) => d.id === jour);
        if (base && cc && dj) {
          const S = minutesDe(dj.start);
          const E = minutesDe(dj.end);
          serie = { out: base.out.map((t) => tempsTrafic(cc, 'out', S, t).retenu), ret: base.ret.map((t) => tempsTrafic(cc, 'ret', E, t).retenu), reason: base.reason };
        }
      } else if (m.id === 'transit' && walkKey) {
        const v = acc?.variants?.[walkKey]?.transit?.[jour];
        if (v && v.out?.length === this.poles.length) serie = v;
      } else serie = this.serieAccess(acc, m.id, jour);
      if (!serie) continue;
      const out = serie.out[poleIndex] ?? null;
      const ret = serie.ret[poleIndex] ?? null;
      const reason = serie.reason?.[poleIndex] ?? null;
      let verdict = 'Hors de portée';
      if ((out == null || ret == null) && reason && NON_MESURE.has(reason)) verdict = 'Non calculé';
      else if (out != null && ret != null && out <= sc.b && ret <= sc.b) verdict = 'Accessible aller et retour';
      else if (out != null && out <= sc.b) verdict = 'Aller seulement';
      else if (ret != null && ret <= sc.b) verdict = 'Retour seulement';
      const ligne = { mode: m.id, nom: m.label, aller: this.texteMin(out, verdict), retour: this.texteMin(ret, verdict), courant: m.id === sc.m };
      if (!od) ligne.verdict = verdict;
      if (m.id === 'transit') {
        const k = (t) => (t?.tickets?.status === 'ok' && t.tickets.cost_eur != null ? t.tickets.cost_eur : null);
        const a = k(trajets.out);
        const b = k(trajets.ret);
        ligne.cout = a != null && b != null ? `${fmtEur(auCentime(a + b))} au ticket` : 'non publié';
        const ca = trajets.out?.co2_g?.status === 'ok' ? trajets.out.co2_g.value : null;
        const cb = trajets.ret?.co2_g?.status === 'ok' ? trajets.ret.co2_g.value : null;
        ligne.carbone = ca != null && cb != null ? `${fmtInt(ca + cb)} g CO2e (estimation)` : 'non publié'; // V4 (audit du 11/11)
      } else if (m.id === 'car' || m.id === 'car_traffic') {
        const trip = acc?.car_trip;
        const parts = (this.meta.vehicles ?? [])
          .filter((v) => (v.family ?? 'car') === 'car')
          .map((v) => {
            const eo = trip?.dist_m?.out?.[poleIndex];
            const er = trip?.dist_m?.ret?.[poleIndex];
            if (eo == null || er == null || trip.dist_m.out.length !== this.poles.length) return null;
            return `${v.label.replace(/^Voiture /, '')} ${fmtEur(auCentime((eo / 1000) * v.cost_eur_per_km + (er / 1000) * v.cost_eur_per_km))}`;
          })
          .filter(Boolean);
        ligne.cout = parts.length ? `Énergie seule, péages non comptés : ${parts.join(' ; ')}` : 'non publié';
        ligne.carbone = 'non publié';
      } else {
        ligne.cout = 'non publié';
        ligne.carbone = 'non publié';
      }
      lignes.push(ligne);
    }
    return lignes;
  }

  texteMin(v, verdict) {
    if (verdict === 'Non calculé') return 'non calculé';
    return v == null ? 'aucun trajet' : `${v} min`;
  }

  attenduBesoins(sc, trajets) {
    const lignesPour = (t) =>
      t
        ? BESOINS.ordre.filter((b) => sc.needs.includes(b)).map((b) => `${BESOINS.libelle[b]} : ${BESOINS.etat[this.etatCase(b, t.legs)]}`)
        : null;
    const marque = !!(trajets.out && trajets.ret) && this.astreMarque(trajets.out, trajets.ret, sc.needs, sc.b);
    return { aller: lignesPour(trajets.out), retour: lignesPour(trajets.ret), marque };
  }

  /** Astres dorés attendus (D-056) : vélo + TC accessible, TC seuls (access/) non accessible et part TC commune par commune nulle */
  async orAttendu(sc, cielBikeTc) {
    if (sc.m !== 'bike_transit' || sc.s != null) return null;
    const acc = cielBikeTc.acc;
    const refSerie = this.serieAccess(acc, 'transit', sc.d);
    const couverte = cielBikeTc.hasData;
    if (!refSerie || !couverte) return null;
    const refOd = await this.ciel({ ...sc, m: 'transit', s: null, e: null, w: null });
    const statut = (o, r, reason) => {
      if ((o == null || r == null) && reason && NON_MESURE.has(reason)) return 'unknown';
      if (o != null && r != null && o <= sc.b && r <= sc.b) return 'accessible';
      if (o != null && o <= sc.b) return 'out_only';
      return 'none';
    };
    const ids = [];
    this.poles.forEach((pole, i) => {
      const sb = cielBikeTc.poles[i];
      const sa = statut(refSerie.out[i] ?? null, refSerie.ret[i] ?? null, refSerie.reason?.[i] ?? null);
      if (sa === 'unknown' || sb.status === 'unknown') return;
      if (sb.status !== 'accessible' || sa === 'accessible') return;
      const ref = refOd.poles[i];
      if (ref.status === 'unknown' || ref.reached !== 0 || ref.unknown !== 0) return;
      ids.push(pole.id);
    });
    return ids;
  }
}

/** Heure de la phrase du péage en fourchette : le site y écrit toujours les minutes (« 9h00 », pas « 9h ») */
function heureAvecMinutes(minutes) {
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${Math.floor(t / 60)}h${String(t % 60).padStart(2, '0')}`;
}

function hhmm(minutes) {
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function secondes(s) {
  const v = Math.max(0, Math.round(s));
  if (v < 60) return `${v} s`;
  const m = Math.floor(v / 60);
  const r = v % 60;
  return r === 0 ? `${m} min` : `${m} min ${String(r).padStart(2, '0')}`;
}
