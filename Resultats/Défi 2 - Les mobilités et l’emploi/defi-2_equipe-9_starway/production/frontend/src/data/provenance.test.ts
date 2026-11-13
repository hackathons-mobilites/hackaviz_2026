import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { provenance } from '../theme/tokens';
import {
  bassinPart,
  costPart,
  dayDate,
  engineFor,
  ficheAnchor,
  flowsPart,
  haloPart,
  initialProvenance,
  jobsPart,
  mainEntry,
  mapProvenance,
  METHODS,
  originPart,
  producerLabel,
  recordsPart,
  skyProvenance,
  sourceIdsOf,
  sourceTag,
  stopPart,
  travelCodes,
  travelPart,
  tripFactsPart,
} from './provenance';
import type { ContextFile, Dataset, Meta, Pole, SourceEntry } from './types';

const readJson = <T,>(rel: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${rel}`, import.meta.url), 'utf-8')) as T;

/** Entrées réduites, recopiées des formes publiées dans sources.json */
const SOURCES: SourceEntry[] = [
  {
    source_id: 'EMP01',
    titre: "INSEE Flores - Nombre d'établissements et effectifs salariés fin 2023",
    url_source: 'https://example.org/flores.zip',
    millesime: '2023 (postes salariés présents la dernière semaine de décembre 2023)',
    date_extraction: '2026-11-02T14:14Z',
    licence: 'Licence Ouverte',
  },
  { source_id: 'EMP01', titre: 'INSEE Flores - aide à la lecture (documentation)', url_source: 'x', licence: 'LO' },
  {
    source_id: 'TRA01',
    titre: "IDFM - Horaires prévus sur les lignes de TC d'Île-de-France (GTFS Datahub, jeu offre-horaires-tc-gtfs-idfm)",
    url_source: 'https://example.org/gtfs.zip',
    millesime: 'offre prévue sur les 30 jours suivant la date d’extraction',
    date_extraction: '2026-11-02T14:15Z',
    licence: 'ODbL',
    traitements: 'aucun (entrée directe de r5py)',
  },
  {
    source_id: 'CYC01',
    titre: 'OpenStreetMap - extrait Île-de-France (Geofabrik)',
    url_source: 'https://example.org/idf.osm.pbf',
    millesime: "extrait du jour indiqué dans l'URL résolue",
    date_extraction: '2026-11-02T14:20Z',
    licence: 'ODbL',
    traitements: 'aucun (entrée directe de r5py : marche, vélo, voiture)',
  },
  { source_id: 'GEN04', titre: 'INSEE RP 2023 - Population par sexe et âge', url_source: 'x', millesime: 'RP 2023 (enquêtes 2021 à 2025)', licence: 'LO' },
  { source_id: 'EMP02', titre: 'INSEE RP 2023 - Mobilités professionnelles', url_source: 'x', millesime: 'RP 2023', licence: 'LO' },
  { source_id: 'COST01', titre: 'IDFM - page tarifaire du forfait Navigo Mois', url_source: 'x', millesime: 'tarifs applicables au 1er janvier 2026', date_extraction: '2026-11-02T15:54Z', licence: 'page publique' },
  { source_id: 'GEO01', titre: 'API Géo - communes de la région Île-de-France', url_source: 'x', millesime: 'géographie (COG) en vigueur', date_extraction: '2026-11-02T14:26Z', licence: 'LO' },
  { source_id: 'GEO02', titre: 'INSEE Filosofi 2021 - données au carreau de 200 m', url_source: 'x', millesime: 'revenus 2021, publié le 12/02/2026', date_extraction: '2026-11-02T22:06Z', licence: 'LO' },
  { source_id: 'VEL01', titre: "Vélib' Métropole - localisation des stations", url_source: 'x', date_extraction: '2026-11-03T11:12Z', licence: 'ODbL' },
];

const POLE: Pole = {
  id: 'P1',
  name: 'Pôle',
  communes: ['92050'],
  jobs: 1000,
  jobs_year: 2023,
  jobs_source: 'EMP01',
  point: { lon: 2, lat: 48, method: 'arrêt le plus desservi le 17/11/2026 (7262 départs) : Gare (IDFM:1, GTFS IDFM)' },
  sky: { x: 0.5, y: 0.5 },
};

const META = {
  service_date: '2026-11-17',
  velib: { warning: 'w', source: 'VEL01' },
  origin_methods: { gravity: 'centre de gravité', nearest_inhabited: 'carreau habité' },
} as unknown as Meta;

const DS: Pick<Dataset, 'origin' | 'meta' | 'sources' | 'poles'> = { origin: 'real', meta: META, sources: SOURCES, poles: [POLE] };

const texts = (p: { tags: { text: string }[] } | null) => p?.tags.map((t) => t.text) ?? [];

describe('initialProvenance', () => {
  it("l'URL prime, puis le choix mémorisé, puis le défaut", () => {
    expect(initialProvenance('?src=1', 'off', false)).toBe(true);
    expect(initialProvenance('?src=0', 'on', true)).toBe(false);
    expect(initialProvenance('', 'on', false)).toBe(true);
    expect(initialProvenance('', 'off', true)).toBe(false);
    expect(initialProvenance('', null, false)).toBe(false);
    expect(initialProvenance('', null, true)).toBe(true);
    expect(initialProvenance('?src=oui', 'bizarre', false)).toBe(false);
  });
  it('la vidéo (record=1) suit le défaut sauf src explicite', () => {
    expect(initialProvenance('?record=1', null, false)).toBe(false);
    expect(initialProvenance('?record=1&src=1', null, false)).toBe(true);
  });
});

/**
 * D-033 (Nicolas, 04/11) : la provenance est COUPÉE par défaut, activée par le bouton de la barre du haut
 * ou par `?src=1`. Ces tests figent le défaut, y compris pour la visite et l'enregistrement vidéo.
 */
describe('défaut de la provenance (D-033)', () => {
  it('le jeton `provenance.defaultOn` est false', () => {
    expect(provenance.defaultOn).toBe(false);
  });
  it('sans ?src ni valeur mémorisée : coupée, visite et vidéo comprises', () => {
    for (const search of ['', '?record=1&tour=lea', '?tour=lea', '?record=1', '?demo=1', '?astres=44']) {
      expect(initialProvenance(search, null, provenance.defaultOn), search).toBe(false);
    }
  });
  it('seul ?src=1 l’active (les autres valeurs ne changent rien)', () => {
    expect(initialProvenance('?src=1', null, provenance.defaultOn)).toBe(true);
    expect(initialProvenance('?record=1&tour=lea&src=1', null, provenance.defaultOn)).toBe(true);
    for (const search of ['?src=0', '?src=', '?src=true', '?src=oui', '?src=2', '?SRC=1']) {
      expect(initialProvenance(search, null, provenance.defaultOn), search).toBe(false);
    }
  });
  it('un choix mémorisé « off » reste coupé, même avec ?record=1&tour=lea', () => {
    expect(initialProvenance('?record=1&tour=lea', 'off', provenance.defaultOn)).toBe(false);
  });
  it("ni la visite guidée ni l'enregistrement vidéo n'écrivent dans le store de la provenance", () => {
    const root = new URL('../', import.meta.url);
    const files = [
      ...readdirSync(new URL('tour/', root)).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.')).map((f) => `tour/${f}`),
      'components/RecordDirector.tsx',
      'components/TourOverlay.tsx',
      'components/TourButton.tsx',
    ];
    for (const f of files) {
      const code = readFileSync(new URL(f, root), 'utf-8');
      expect(code, f).not.toMatch(/provenanceStore|useProvenanceStore|starway\.provenance|[?&]src=/);
    }
  });
});

describe('sources.json', () => {
  it("l'entrée principale n'est pas une documentation", () => {
    expect(mainEntry('EMP01', SOURCES)?.titre).toMatch(/^INSEE Flores - Nombre/);
    expect(mainEntry('ZZZ', SOURCES)).toBeNull();
  });
  it('le producteur est lu dans le titre publié', () => {
    expect(producerLabel(SOURCES[0]!)).toBe('INSEE Flores');
    expect(producerLabel(SOURCES[2]!)).toBe('GTFS IDFM');
    expect(producerLabel({ titre: 'OpenStreetMap - extrait' })).toBe('OpenStreetMap');
  });
  it('date de service : jour de la semaine calculé', () => {
    expect(dayDate('2026-11-17')).toBe('mardi 17/11/2026');
    expect(dayDate('pas une date')).toBeNull();
  });
});

describe('sourceTag', () => {
  it('millésime porté par la donnée, sinon par sources.json, sinon date d’extraction', () => {
    expect(sourceTag('EMP01', SOURCES, { year: 2023 })?.text).toBe('INSEE Flores 2023 (EMP01)');
    expect(sourceTag('EMP01', SOURCES)?.text).toBe('INSEE Flores 2023 (EMP01)');
    expect(sourceTag('TRA01', SOURCES, { serviceDate: '2026-11-17' })?.text).toBe('GTFS IDFM, mardi 17/11/2026 (TRA01)');
    expect(sourceTag('CYC01', SOURCES)?.text).toBe('OpenStreetMap, extrait du 02/11/2026 (CYC01)');
    expect(sourceTag('COST01', SOURCES)?.text).toBe('IDFM, extrait du 02/11/2026 (COST01)');
  });
  it("pas d'année en double quand le titre la porte déjà", () => {
    expect(sourceTag('GEN04', SOURCES, { year: 2023 })?.text).toBe('INSEE RP 2023 (GEN04)');
    expect(sourceTag('GEN04', SOURCES, { year: 2022 })?.text).toBe('INSEE RP 2023, millésime 2022 (GEN04)');
    expect(sourceTag('GEO02', SOURCES)?.text).toBe('INSEE Filosofi 2021 (GEO02)');
  });
  it('code absent de sources.json : rien (aucune source inventée)', () => {
    expect(sourceTag('ENV01', SOURCES)).toBeNull();
    expect(sourceTag(null, SOURCES)).toBeNull();
    expect(sourceTag('EMP01', [])).toBeNull();
  });
  it('ancre de la fiche dans Sources & limites', () => {
    expect(sourceTag('EMP01', SOURCES)?.anchor).toBe('fiche-EMP01');
    expect(ficheAnchor('CO2-01')).toBe('fiche-CO2-01');
  });
});

describe('éléments affichés', () => {
  it('IDFM seulement pour les modes qui prennent les TC', () => {
    expect(travelCodes('transit', META)).toEqual(['TRA01', 'CYC01']);
    expect(travelCodes('bike_transit', META)).toEqual(['TRA01', 'CYC01']);
    expect(travelCodes('walk', META)).toEqual(['CYC01']);
    expect(travelCodes('car', META)).toEqual(['CYC01']);
    expect(travelCodes('velib', META)).toEqual(['CYC01', 'VEL01']);
    expect(texts(travelPart(DS, 'walk'))).toEqual(['OpenStreetMap, extrait du 02/11/2026 (CYC01)']);
  });
  it('« calcul r5py » seulement si sources.json le nomme', () => {
    expect(engineFor(['TRA01'], SOURCES)).toBe('calcul r5py');
    expect(engineFor(['EMP01'], SOURCES)).toBeNull();
    expect(travelPart(DS, 'transit')?.engine).toBe('calcul r5py');
  });
  it('bande du ciel : postes puis temps de trajet', () => {
    const parts = skyProvenance(DS, 'transit');
    expect(parts.map((p) => p.lead)).toEqual(['Postes', 'Temps de trajet']);
    expect(texts(parts[1]!)).toEqual(['GTFS IDFM, mardi 17/11/2026 (TRA01)', 'OpenStreetMap, extrait du 02/11/2026 (CYC01)']);
  });
  it('jeu de démonstration : aucune provenance (le bandeau dit « données fictives »)', () => {
    const demo = { ...DS, origin: 'demo' as const };
    expect(skyProvenance(demo, 'transit')).toEqual([]);
    expect(mapProvenance(demo, 'transit')).toEqual([]);
    expect(jobsPart(demo)).toBeNull();
  });
  it('point de départ GEO02 seulement si une commune affichée en vient', () => {
    expect(originPart(DS, [{ origin: { lon: 0, lat: 0, method: 'gravity' } }])?.tags[0]?.code).toBe('GEO02');
    expect(originPart(DS, [{ origin: null }])).toBeNull();
    expect(originPart(DS, [{ origin: { lon: 0, lat: 0, method: 'autre' } }])).toBeNull();
  });
  it("arrêt du pôle : TRA01 seulement si la méthode publiée cite le GTFS", () => {
    expect(texts(stopPart(DS, POLE))).toEqual(['GTFS IDFM, mardi 17/11/2026 (TRA01)']);
    expect(stopPart(DS, { point: { lon: 0, lat: 0, method: 'centroïde' } })).toBeNull();
  });
  it('flux, coût, halo : code et millésime lus dans context/{insee}.json', () => {
    const ctx = {
      insee: '93048',
      flows_to_poles: { source: 'EMP02', year: 2023, status: 'ok', poles: {} },
      population_age: { source: 'GEN04', year: 2023, status: 'ok', bins: [], total: 1, shares: [] },
    } as unknown as ContextFile;
    expect(texts(flowsPart(SOURCES, [null, ctx]))).toEqual(['INSEE RP 2023 (EMP02)']);
    expect(flowsPart(SOURCES, [null, ctx])?.method).toBe(METHODS.flows);
    expect(METHODS.flows).toMatch(/arrondissements pour Paris/);
    expect(texts(haloPart(SOURCES, ctx, 'age'))).toEqual(['INSEE RP 2023 (GEN04)']);
    expect(haloPart(SOURCES, ctx, 'income')).toBeNull();
    expect(texts(costPart(SOURCES, 'COST01 - IDFM, page « Forfait Navigo Mois »'))).toEqual(['IDFM, extrait du 02/11/2026 (COST01)']);
    expect(costPart(SOURCES, 'texte sans code')).toBeNull();
  });
});

describe('blocs ajoutés (couverture)', () => {
  const bassin = { code: '1107', name: 'T1 Paris', source: "GEO04, France Travail, bassins d'emploi 2026" };
  const GEO04: SourceEntry = {
    source_id: 'GEO04',
    titre: "France Travail - Bassins d'emploi 2026 (table commune -> bassin d'emploi)",
    url_source: 'x',
    millesime: "2026 (bassins d'emploi 2026)",
    licence: 'x',
  };
  it("bassins d'emploi : code lu dans le bassin publié de l'astre, rien au jeu de 15 pôles", () => {
    const withBassin = { ...POLE, bassin };
    expect(texts(bassinPart([...SOURCES, GEO04], [withBassin]))).toEqual(['France Travail 2026 (GEO04)']);
    expect(bassinPart([...SOURCES, GEO04], [POLE])).toBeNull();
    expect(bassinPart(SOURCES, [withBassin])).toBeNull();
    const ds = { ...DS, sources: [...SOURCES, GEO04], poles: [withBassin] };
    expect(skyProvenance(ds, 'transit').map((p) => p.lead)).toEqual(['Postes', 'Temps de trajet', "Bassins d'emploi"]);
    expect(skyProvenance(DS, 'transit').map((p) => p.lead)).toEqual(['Postes', 'Temps de trajet']);
  });
  it('codes lus dans les enregistrements publiés, sans doublon', () => {
    const rec = { price: { record: { source_id: 'SUB01' }, quotes: [{ source_id: 'COST01' }, { source_id: 'SUB01' }] }, other: [{ source_id: 'SUB02' }], source_id_text: 'SUB09' };
    expect(sourceIdsOf(rec, null, undefined, 'texte', [{ source_id: 'SUB02' }])).toEqual(['SUB01', 'COST01', 'SUB02']);
    expect(sourceIdsOf()).toEqual([]);
  });
  it('recordsPart : un code absent de sources.json ne produit rien', () => {
    expect(recordsPart(SOURCES, [{ source_id: 'COST01' }, { source_id: 'SUB99' }])?.tags.map((t) => t.code)).toEqual(['COST01']);
    expect(recordsPart(SOURCES, [{ source_id: 'SUB99' }])).toBeNull();
    expect(recordsPart(SOURCES, [])).toBeNull();
  });
  it('faits de ligne : codes TRA03, TRA04, QS01 seulement si le tronçon les porte et si sources.json les publie', () => {
    const trip = { legs: [{ m: 'metro', air_conditioning: 'true', accessibility: 'true' }] } as never;
    expect(tripFactsPart(SOURCES, trip)).toBeNull();
    const tra03: SourceEntry = { source_id: 'TRA03', titre: 'IDFM - Référentiel des lignes', url_source: 'x', millesime: '2026', licence: 'x' };
    expect(tripFactsPart([...SOURCES, tra03], trip)?.tags.map((t) => t.code)).toEqual(['TRA03']);
    expect(tripFactsPart([...SOURCES, tra03], { legs: [{ m: 'walk' }] } as never)).toBeNull();
  });
});

describe('abonnements publiés (subscriptions.json)', () => {
  const sources = readJson<SourceEntry[]>('sources.json');
  const file = readJson<{ transit: { options: unknown[]; extra_titles: unknown }; velib: { offers: unknown[] }; employer: unknown }>('subscriptions.json');
  it('chaque prix affiché porte un code publié dans sources.json (SUB01 à SUB05)', () => {
    const codes = recordsPart(sources, [file.transit.options, file.transit.extra_titles, file.velib.offers, file.employer])?.tags.map((t) => t.code) ?? [];
    for (const c of ['SUB01', 'SUB02', 'SUB03', 'SUB04', 'SUB05']) expect(codes).toContain(c);
    const ids = sourceIdsOf(file);
    for (const id of ids) expect(sources.some((s) => s.source_id === id), id).toBe(true);
  });
});

describe('données publiées', () => {
  const sources = readJson<SourceEntry[]>('sources.json');
  const meta = readJson<Meta>('meta.json');
  const poles = readJson<Pole[]>('poles.json');
  const ds = { origin: 'real' as const, meta, sources, poles };

  it('bande du ciel en TC : postes et temps de trajet sourcés', () => {
    const parts = skyProvenance(ds, 'transit');
    expect(parts).toHaveLength(3);
    expect(parts[0]!.tags[0]!.code).toBe(poles[0]!.jobs_source);
    expect(parts[1]!.tags.map((t) => t.code)).toEqual(['TRA01', 'CYC01']);
    expect(parts[2]!.tags.map((t) => t.code)).toEqual(['GEO04']); // bassins d'emploi des 44 astres
  });
  it('contexte publié : halo, flux et coût ont leur source', () => {
    const ctx = readJson<ContextFile>('context/93048.json');
    for (const dim of ['age', 'commute', 'income'] as const) expect(haloPart(sources, ctx, dim)).not.toBeNull();
    expect(flowsPart(sources, [ctx])).not.toBeNull();
    expect(costPart(sources, ctx.cost?.transit_source)).not.toBeNull();
  });
  it('aucun tiret cadratin ni demi-cadratin dans les textes produits', () => {
    const all = [...skyProvenance(ds, 'transit'), ...mapProvenance(ds, 'velib')].flatMap((p) => p.tags.map((t) => t.text));
    for (const t of all) expect(t).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`));
  });
});
