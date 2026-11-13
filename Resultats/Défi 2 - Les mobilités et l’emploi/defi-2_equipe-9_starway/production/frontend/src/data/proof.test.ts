import { describe, expect, it } from 'vitest';
import {
  barDomain,
  flowToPole,
  formatClock,
  outboundTimes,
  parseClock,
  poleCommuneNames,
  proofVerdict,
  returnTimes,
  shortCommuneName,
  filosofiGridLabel,
  proofSources,
  transitCost,
  tripLimitText,
  usesCalcOrigin,
  withinLimit,
  walkDistanceText,
  noTripText,
  stateReasonText,
  reasonContext,
} from './proof';
import type { Commune, ContextFile, SourceEntry } from './types';

describe('heures', () => {
  it('lit les formats de la matrice', () => {
    expect(parseClock('08:15')).toBe(495);
    expect(parseClock('2026-11-17 08:15:00')).toBe(495);
    expect(parseClock('2026-11-17T05:40:00')).toBe(340);
    expect(parseClock('2026-11-17T05:40:00+01:00')).toBe(340);
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('')).toBeNull();
    expect(parseClock(null)).toBeNull();
    expect(parseClock('demain')).toBeNull();
  });
  it('formate à la française', () => {
    expect(formatClock(495)).toBe('8h15');
    expect(formatClock(540)).toBe('9h');
    expect(formatClock(1020 + 41)).toBe('17h41');
    expect(formatClock(1440 + 5)).toBe('0h05');
  });
  it('aller : arrivée = départ + durée ; sans départ, rien inventé', () => {
    expect(outboundTimes('08:15', 37)).toEqual({ depart: 495, arrive: 532 });
    expect(outboundTimes(undefined, 37)).toEqual({ depart: null, arrive: null });
    expect(outboundTimes('08:15', null)).toEqual({ depart: 495, arrive: null });
  });
  it('retour : départ à la fin du poste', () => {
    expect(returnTimes('17:00', 41)).toEqual({ depart: 1020, arrive: 1061 });
    expect(returnTimes('22:00', null)).toEqual({ depart: 1320, arrive: null });
  });
  it('domaine des barres = max(aller, retour, budget)', () => {
    expect(barDomain(38, 52, 45)).toBe(52);
    expect(barDomain(null, null, 45)).toBe(45);
  });
});

describe('verdict mesuré', () => {
  const s = (out: number | null, ret: number | null, reason: 'no_trip_within_120' | null = null) => ({
    status: 'none' as const,
    out,
    ret,
    reason,
  });
  it('accessible aller ET retour', () => {
    const v = proofVerdict({ ...s(38, 41), status: 'accessible' }, 45);
    expect(v.kind).toBe('accessible');
    expect(v.title).toBe('Accessible aller et retour en 45 min ou moins par sens');
    expect(v.detail).toContain('38 min');
    expect(v.detail).toContain('41 min');
  });
  it('retour trop long', () => {
    const v = proofVerdict(s(38, 52), 45);
    expect(v.title).toBe('Retour trop long');
    expect(v.detail).toBe('Retour 52 min (7 min au-delà), avec 45 min au plus par sens.');
  });
  it('aller trop long', () => {
    expect(proofVerdict(s(50, 40), 45).title).toBe('Aller trop long');
  });
  it('les deux', () => {
    const v = proofVerdict(s(50, 61), 45);
    expect(v.title).toBe('Aller et retour trop longs');
    expect(v.detail).toBe('Aller 50 min (5 min au-delà) ; retour 61 min (16 min au-delà), avec 45 min au plus par sens.');
  });
  it('aucun trajet trouvé, sens par sens', () => {
    expect(proofVerdict(s(null, null, 'no_trip_within_120'), 45).title).toBe('Aucun trajet trouvé');
    const v = proofVerdict(s(30, null, 'no_trip_within_120'), 45, 120);
    expect(v.title).toBe('Aucun trajet trouvé au retour');
    expect(v.detail).toBe('Retour : aucune arrivée trouvée dans les 2 h après la fin du poste, avec 45 min au plus par sens.');
    const a = proofVerdict(s(null, 40, 'no_trip_within_120'), 45, 120);
    expect(a.detail).toBe('Aller : aucun départ dans les 2 h avant le début du poste n’arrive à l’heure, avec 45 min au plus par sens.');
    // mode indépendant de l'heure (marche, vélo, voiture) : pas de début ni de fin de poste
    expect(proofVerdict(s(null, null, 'no_trip_within_120'), 45, 120, false).detail).toContain('aucun trajet trouvé en 2 h ou moins');
    expect(proofVerdict(s(60, null, 'no_trip_within_120'), 45).title).toBe('Aller trop long, aucun trajet trouvé au retour');
  });
  it('non calculé', () => {
    expect(proofVerdict({ status: 'unknown', out: null, ret: null, reason: 'not_computed' }, 45).kind).toBe('unknown');
  });
  it('aucun tiret long dans les textes', () => {
    const v = proofVerdict(s(50, null, 'no_trip_within_120'), 45);
    expect(`${v.title}${v.detail}`).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('communes du pôle', () => {
  const communes = [
    { insee: '75108', name: 'Paris 8e Arrondissement' },
    { insee: '92062', name: 'Puteaux' },
  ] as Commune[];
  it('noms courts, code en repli', () => {
    expect(shortCommuneName('Paris 8e Arrondissement')).toBe('Paris 8e');
    expect(poleCommuneNames({ communes: ['75108', '92062', '99999'] }, communes)).toEqual(['Paris 8e', 'Puteaux', '99999']);
  });
});

describe('flux EMP02 (lecture tolérante)', () => {
  const base = { insee: '93048' } as ContextFile;
  it('absent → null', () => {
    expect(flowToPole(base, 'P_DEFENSE')).toBeNull();
    expect(flowToPole(null, 'P_DEFENSE')).toBeNull();
  });
  it('objet par pôle', () => {
    const ctx = {
      ...base,
      flows_to_poles: { source: 'EMP02', year: 2023, status: 'ok', actifs_occupes: 52013, poles: { P_DEFENSE: { flux: 1200, share_pct: 2.3 } } },
    } as ContextFile;
    expect(flowToPole(ctx, 'P_DEFENSE')).toEqual({
      flux: 1200, share: 2.3, total: 52013, margin: null, precision: 'ok', originInPole: false, source: 'EMP02', year: 2023,
    });
    expect(flowToPole(ctx, 'P_ROISSY')).toBeNull();
  });
  it('liste', () => {
    const ctx = { ...base, flows_to_poles: { source: 'EMP02', year: 2023, status: 'ok', poles: [{ pole_id: 'P_ORLY', flux: 80 }] } } as ContextFile;
    expect(flowToPole(ctx, 'P_ORLY')?.flux).toBe(80);
  });
  it('contrat EMP02 : ordre de grandeur, aucun flux publié (jamais 0), pôle de la commune', () => {
    const ctx = {
      ...base,
      flows_to_poles: {
        source: 'EMP02', year: 2023, status: 'ok', actifs_occupes: 8991, origin_pole: 'P_PARIS_QCA',
        poles: {
          P_CERGY: { flux: 10, share_pct: 0.1, precision: 'order_of_magnitude' },
          P_X: { flux: null, share_pct: null, precision: 'no_flow_in_file' },
          P_PARIS_QCA: { flux: 3000, share_pct: 33.4, precision: 'ok' },
        },
      },
    } as unknown as ContextFile;
    expect(flowToPole(ctx, 'P_CERGY')?.precision).toBe('order_of_magnitude');
    expect(flowToPole(ctx, 'P_X')).toMatchObject({ flux: null, precision: 'no_flow_in_file' });
    expect(flowToPole(ctx, 'P_PARIS_QCA')?.originInPole).toBe(true);
  });
  it('statut non ok → masqué', () => {
    const ctx = { ...base, flows_to_poles: { source: 'EMP02', year: 2023, status: 'to_compute', poles: { P_ORLY: { flux: 80 } } } } as ContextFile;
    expect(flowToPole(ctx, 'P_ORLY')).toBeNull();
  });
});

describe('coût COST01', () => {
  const ctx = {
    insee: '93048',
    cost: { status: 'ok', method: 'm', transit_month_eur: 90.8, transit_source: 'COST01 - forfait', car_per_trip_eur: null },
  } as ContextFile;
  it('affiché pour les modes TC seulement', () => {
    expect(transitCost(ctx, 'transit')).toEqual({ monthEur: 90.8, label: null, source: 'COST01 - forfait', url: null, scope: null });
    expect(transitCost(ctx, 'bike_transit')?.monthEur).toBe(90.8);
    expect(transitCost(ctx, 'car')).toBeNull();
    expect(transitCost(null, 'transit')).toBeNull();
  });
});

describe('microcopie (relecture v0.5, D-017)', () => {
  it('point de départ : le texte suit la donnée publiée (communes.json → origin, D-017)', async () => {
    const { originPointPhrase, calcOrigin } = await import('./proof');
    const methods = {
      gravity: 'centre de gravité de la population (INSEE Filosofi 2021, carreaux de 200 m)',
      nearest_inhabited: 'centre du carreau habité le plus proche du centre de gravité (celui-ci tombe dans un carreau vide)',
    };
    // export D-017 : libellé de meta.origin_methods
    expect(originPointPhrase({ origin: { lon: 2.36, lat: 48.94, method: 'gravity' } }, methods)).toBe(
      'Point de départ du calcul : centre de gravité de la population (INSEE Filosofi 2021, carreaux de 200 m)',
    );
    expect(originPointPhrase({ origin: { lon: 2.36, lat: 48.94, method: 'nearest_inhabited' } }, methods)).toContain('carreau habité le plus proche');
    // export antérieur : pas d'origin → centre de la commune
    expect(originPointPhrase({}, methods)).toBe('Point de départ du calcul : centre de la commune (API Géo)');
    expect(originPointPhrase({ origin: null }, undefined)).toBe('Point de départ du calcul : centre de la commune (API Géo)');
    // libellé manquant : le code brut, jamais un libellé deviné
    expect(originPointPhrase({ origin: { lon: 2.36, lat: 48.94, method: 'gravity' } }, undefined)).toBe('Point de départ du calcul : méthode « gravity »');
    // point illisible : ignoré
    expect(calcOrigin({ origin: { lon: Number.NaN, lat: 48.9, method: 'gravity' } })).toBeNull();
  });
  it('point de départ sans mode sources (D-033, lot 6) : la méthode reste, le nom de la source part', async () => {
    const { originPointPhrase, stripSourceParen } = await import('./proof');
    const methods = {
      gravity: 'centre de gravité de la population (INSEE Filosofi 2021, carreaux de 200 m)',
      nearest_inhabited: 'centre du carreau habité le plus proche du centre de gravité (celui-ci tombe dans un carreau vide)',
    };
    const gravity = { origin: { lon: 2.36, lat: 48.94, method: 'gravity' } };
    expect(originPointPhrase(gravity, methods, false)).toBe('Point de départ du calcul : centre de gravité de la population');
    expect(originPointPhrase({}, methods, false)).toBe('Point de départ du calcul : centre de la commune');
    // une parenthèse qui n'est pas une source reste
    expect(originPointPhrase({ origin: { lon: 2.36, lat: 48.94, method: 'nearest_inhabited' } }, methods, false)).toContain('(celui-ci tombe dans un carreau vide)');
    expect(originPointPhrase(gravity, methods, true)).toContain('INSEE Filosofi 2021');
    expect(stripSourceParen('recensement (INSEE, 2023) et marge (± 3)')).toBe('recensement et marge (± 3)');
  });
  it('portée du forfait sans redite', async () => {
    const { costScopeNote } = await import('./proof');
    expect(
      costScopeNote("identique pour toutes les communes ; forfaits zonés, tarifs réduits et prise en charge par l'employeur non modélisés"),
    ).toBe("Forfaits zonés, tarifs réduits et prise en charge par l'employeur non modélisés.");
    expect(costScopeNote(null)).toBeNull();
    expect(costScopeNote('identique pour toutes les communes')).toBeNull();
  });
});

describe('horizon de recherche (meta.max_trip_min)', () => {
  it('texte lu dans la donnée, jamais de valeur par défaut', () => {
    expect(tripLimitText(120)).toBe('2 h');
    expect(tripLimitText(90)).toBe('90 min');
    expect(tripLimitText(undefined)).toBeNull();
    expect(tripLimitText(Number.NaN)).toBeNull();
    expect(withinLimit(undefined)).toBe('');
    expect(withinLimit(180)).toBe(' en moins de 3 h');
  });
  it('sans borne publiée, le verdict ne cite aucune durée de recherche', () => {
    const v = proofVerdict({ status: 'none', out: 30, ret: null, reason: 'no_trip_within_120' }, 45);
    expect(v.detail).toBe('Retour : aucune arrivée trouvée après la fin du poste, avec 45 min au plus par sens.');
    expect(v.detail).not.toMatch(/\bh\b|moins de/);
  });
});

describe('sources du pied (sources.json)', () => {
  const src = [
    { source_id: 'EMP01' },
    { source_id: 'TRA01' },
    { source_id: 'CYC01' },
    { source_id: 'GEO01' },
    { source_id: 'GEO02', titre: 'INSEE Filosofi 2021 - données au carreau de 200 m (y compris données imputées), csv', millesime: 'revenus 2021' },
  ] as SourceEntry[];
  const placed = { origin: { lon: 2.44, lat: 48.86, method: 'gravity' } };
  it('GEO02 à côté d’API Géo quand le point de départ en vient', () => {
    expect(filosofiGridLabel(src)).toBe('INSEE Filosofi 2021, carreaux de 200 m');
    expect(proofSources(src, [placed])).toEqual([
      'INSEE Flores (EMP01)',
      'horaires IDFM (TRA01)',
      "© les contributeurs d'OpenStreetMap (CYC01)",
      'API Géo (GEO01)',
      'INSEE Filosofi 2021, carreaux de 200 m (GEO02)',
    ]);
    expect(usesCalcOrigin([null, placed])).toBe(true);
  });
  it('sans point publié, ou sans GEO02 dans sources.json : pas de Filosofi', () => {
    expect(proofSources(src, [{ origin: null }]).join()).not.toContain('Filosofi');
    expect(proofSources(src.slice(0, 4), [placed]).join()).not.toContain('Filosofi');
    expect(filosofiGridLabel([])).toBeNull();
  });
  it('sources.json vide (démo) : liste fixe des sources du calcul', () => {
    expect(proofSources([], [])).toHaveLength(4);
  });
});

describe('retour nul en TC : le texte cite le réglage de marche (D-024)', () => {
  const nb = (s: string) => s.replace(/\u00a0/g, ' ');
  // Distances de test : la vraie vient de meta.walk_settings.settings[].leg_limit_m
  it('distance et durée lues dans meta.json, jamais écrites en dur', () => {
    expect(nb(walkDistanceText(3000)!)).toBe('3 km');
    expect(nb(walkDistanceText(1500)!)).toBe('1,5 km');
    expect(nb(walkDistanceText(800)!)).toBe('800 m');
    expect(walkDistanceText(undefined)).toBeNull();
    expect(nb(noTripText('ret', 120, true, 4000))).toBe('aucune arrivée trouvée dans les 2 h après la fin du poste, avec au plus 4 km à pied à chaque bout');
    expect(nb(noTripText('out', 120, true, 500))).toBe(
      'aucun départ dans les 2 h avant le début du poste n’arrive à l’heure, avec au plus 500 m à pied à chaque bout',
    );
    // sans réglage (autres modes) : aucune distance citée
    expect(nb(noTripText('ret', 120, true))).toBe('aucune arrivée trouvée dans les 2 h après la fin du poste');
  });
  it('verdict « Aucun trajet trouvé au retour », jamais « retour non mesuré »', () => {
    const v = proofVerdict({ status: 'out_only', out: 40, ret: null, reason: 'no_trip_within_120' }, 60, 120, true, 4000);
    expect(v.title).toBe('Aucun trajet trouvé au retour');
    expect(nb(v.detail)).toBe(
      'Retour : aucune arrivée trouvée dans les 2 h après la fin du poste, avec au plus 4 km à pied à chaque bout, avec 60 min au plus par sens.',
    );
    expect(`${v.title} ${v.detail}`).not.toMatch(/non mesuré/);
  });
  it('raison d’une ligne (liste, infobulle, carte) : premier sens nul, réglage cité', () => {
    const ctx = reasonContext({ max_trip_min: 120 }, true, { leg_limit_m: 4000 });
    expect(ctx).toEqual({ maxTripMin: 120, timeDependent: true, walkLegM: 4000 });
    expect(nb(stateReasonText({ out: 40, ret: null, reason: 'no_trip_within_120' }, ctx)!)).toBe(
      'aucune arrivée trouvée dans les 2 h après la fin du poste, avec au plus 4 km à pied à chaque bout',
    );
    expect(nb(stateReasonText({ out: null, ret: null, reason: 'no_trip_within_120' }, ctx)!)).toMatch(/^aucun départ dans les 2 h/);
    expect(stateReasonText({ out: 40, ret: 70, reason: null }, ctx)).toBeNull();
    // mode sans horaire (Vélib', marche…) : pas de réglage
    expect(stateReasonText({ out: null, ret: null, reason: 'no_trip_within_120' }, reasonContext({ max_trip_min: 120 }, false))).toBe(
      'aucun trajet trouvé en 2 h ou moins',
    );
  });
});
