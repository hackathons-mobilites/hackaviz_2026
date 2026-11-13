import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ItinerariesFile } from './itineraries';
import {
  ASSISTANCE_LINKS,
  legNeedsFacts,
  NEED_GREYED,
  NEED_HINT_PLAIN,
  NEED_LABEL,
  NEED_ORDER,
  NEEDS_LINE_NOTE,
  needsFixedText,
  needsNotes,
  needsSourceDates,
  parseStoredNeeds,
  serializeNeeds,
  SKY_NEEDS,
  stationText,
  stripNeedsSourceCodes,
  tripHasStation,
  valueText,
  type NeedsLeg,
  type NeedsMeta,
  type NeedsReadCtx,
} from './needs';
import { needsPart } from './provenance';
import type { Dataset, Meta, SourceEntry } from './types';

const readJson = <T,>(rel: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${rel}`, import.meta.url), 'utf-8')) as T;

/** Forme publiée par 06n (starway/needs.py, published_meta) : sans textes, les libellés exacts de TRA04 */
const META: NeedsMeta = {
  contract: 'needs-1',
  sources: ['TRA01', 'TRA03', 'TRA04'],
  needs: ['wc_trip', 'wc_stops', 'station', 'audio', 'visual'],
  station_levels: { '1': 'gare ou arrêt non accessible', '3': 'train accessible sur réservation préalable' },
};
const CTX: NeedsReadCtx = { meta: META, dates: { TRA01: '02/11/2026', TRA03: '03/11/2026', TRA04: '03/11/2026' } };

const RER: NeedsLeg = {
  m: 'rer',
  dep: '08:00',
  arr: '08:20',
  min: 20,
  dist_m: 9000,
  line: 'A',
  wc_trip: true,
  wc_from: false,
  wc_to: null,
  a11y: { line: 'false', audio: 'unknown', visual: 'partial', st_from: { level: 1 }, st_to: { level: 3, comment: 'quai 2' } },
};

describe('les six cases', () => {
  it('libellés exacts validés avec Sara, dans cet ordre', () => {
    expect(NEED_ORDER.map((id) => NEED_LABEL[id])).toEqual([
      'Véhicules déclarés adaptés au fauteuil roulant',
      'Arrêts déclarés adaptés au fauteuil roulant',
      "Gares sans réservation d'assistance",
      'Lignes déclarées climatisées',
      'Annonces sonores',
      'Annonces visuelles',
    ]);
  });
  it('seules les quatre premières cases peuvent marquer le ciel', () => {
    expect(SKY_NEEDS).toEqual(['wc_trip', 'wc_stops', 'station', 'ac']);
  });
  it('trois cases grisées, sans donnée ouverte', () => {
    expect(NEED_GREYED.map((g) => g.label)).toEqual(['Ascenseur de la rue au quai', 'Escalators', 'Guidage au sol']);
  });
  it('plus aucun classement par handicap dans les libellés', () => {
    const all = [...Object.values(NEED_LABEL), ...NEED_GREYED.map((g) => g.label)].join(' ');
    expect(all).not.toMatch(/aveugle|sourd|déficience|mobilité réduite|daltonisme|je suis|je me déplace/i);
    expect(ASSISTANCE_LINKS.every((l) => /^https:\/\//.test(l.url) && /^\d{4}-\d{2}-\d{2}$/.test(l.checked))).toBe(true);
  });
});

describe('mémorisation du réglage', () => {
  it('ne garde que les cinq cases, sans doublon, dans l’ordre du réglage', () => {
    expect(parseStoredNeeds('["audio","wc_trip","wc_trip","x"]')).toEqual(['wc_trip', 'audio']);
  });
  it('les anciens identifiants (handicap, daltonisme) sont ignorés', () => {
    expect(parseStoredNeeds('["wheelchair","visual","hearing","color"]')).toEqual(['visual']);
    expect(parseStoredNeeds('["wheelchair","hearing","color"]')).toEqual([]);
  });
  it('un contenu illisible vaut « aucune case »', () => {
    expect(parseStoredNeeds(null)).toEqual([]);
    expect(parseStoredNeeds('pas du json')).toEqual([]);
    expect(parseStoredNeeds('{"a":1}')).toEqual([]);
  });
  it('sérialisation dans l’ordre du réglage', () => {
    expect(serializeNeeds(['visual', 'wc_stops'])).toBe('["wc_stops","visual"]');
  });
});

describe('valeurs affichées', () => {
  it('une valeur absente est « non renseigné », jamais « non »', () => {
    expect(valueText(null)).toBe('non renseigné');
    expect(valueText(undefined)).toBe('non renseigné');
    expect(valueText('unknown')).toBe('non renseigné');
    expect(valueText('inconnue')).toBe('non renseigné');
    expect(valueText(true)).toBe('oui');
    expect(valueText(false)).toBe('non');
    expect(valueText('partial')).toBe('partiel');
  });
  it('gare : libellé exact du jeu, commentaire de la source, jamais un niveau inventé', () => {
    expect(stationText({ level: 1 }, META)).toBe('gare ou arrêt non accessible');
    expect(stationText({ level: 3, comment: 'quai 2' }, META)).toBe('train accessible sur réservation préalable (quai 2)');
    expect(stationText(null, META)).toBe('non renseigné');
    expect(stationText({ level: 9 }, META)).toBe('non renseigné');
    expect(stationText({ level: 1 }, null)).toBe('non renseigné');
  });
});

describe('texte fixe et dates des sources', () => {
  const SRC: SourceEntry[] = [
    { source_id: 'TRA01', titre: 'IDFM - Horaires', url_source: 'x', date_extraction: '2026-11-02T14:15Z', licence: 'x' },
    { source_id: 'TRA03', titre: 'IDFM - Lignes', url_source: 'x', date_extraction: '2026-11-03T15:44Z', licence: 'x' },
    { source_id: 'TRA04', titre: 'IDFM - Accessibilité en gare', url_source: 'x', date_extraction: '2026-11-03T15:44Z', licence: 'x' },
  ];
  it('dates lues dans sources.json, rien d’inventé', () => {
    expect(needsSourceDates(SRC)).toEqual({ TRA01: '02/11/2026', TRA03: '03/11/2026', TRA04: '03/11/2026' });
    expect(needsSourceDates([])).toEqual({});
    expect(needsSourceDates(undefined)).toEqual({});
  });
  it('« Ce que déclarent les sources à telle date. À confirmer avant de partir. »', () => {
    expect(needsFixedText({ TRA03: '03/11/2026', TRA04: '03/11/2026' })).toBe('Ce que déclarent les sources au 03/11/2026. À confirmer avant de partir.');
    expect(needsFixedText(needsSourceDates(SRC))).toBe(
      'Ce que déclarent les sources à la date de leur relevé (GTFS IDFM : 02/11/2026 ; référentiel des lignes IDFM : 03/11/2026 ; accessibilité en gare IDFM : 03/11/2026). À confirmer avant de partir.',
    );
    expect(needsFixedText({})).toBe('Ce que déclarent les sources. À confirmer avant de partir.');
  });
});

describe('faits par tronçon', () => {
  it('rien si aucune case n’est cochée ou si le tronçon est à pied', () => {
    expect(legNeedsFacts(RER, [], CTX)).toEqual([]);
    expect(legNeedsFacts({ ...RER, m: 'walk' }, ['wc_trip'], CTX)).toEqual([]);
  });
  it('chaque source est citée avec sa date, la ligne (TRA03) est toujours affichée sans entrer dans une case', () => {
    expect(legNeedsFacts(RER, ['wc_trip', 'wc_stops', 'station'], CTX)).toEqual([
      'Véhicule déclaré adapté au fauteuil roulant (GTFS IDFM, relevé du 02/11/2026) : oui',
      'Arrêts déclarés adaptés au fauteuil roulant (GTFS IDFM, relevé du 02/11/2026) : montée non, descente non renseigné',
      'Gare de montée (accessibilité en gare IDFM, relevé du 03/11/2026) : gare ou arrêt non accessible',
      'Gare de descente (accessibilité en gare IDFM, relevé du 03/11/2026) : train accessible sur réservation préalable (quai 2)',
      'Déclaration générale de la ligne (champ accessibility) (référentiel des lignes IDFM, relevé du 03/11/2026) : non',
    ]);
  });
  it('annonces sonores et visuelles', () => {
    expect(legNeedsFacts(RER, ['audio', 'visual'], CTX)).toEqual([
      'Annonces sonores (référentiel des lignes IDFM, relevé du 03/11/2026) : non renseigné',
      'Annonces visuelles (référentiel des lignes IDFM, relevé du 03/11/2026) : partiel',
      'Déclaration générale de la ligne (champ accessibility) (référentiel des lignes IDFM, relevé du 03/11/2026) : non',
    ]);
  });
  it('un tronçon sans a11y n’affiche pas de valeur de référentiel inventée', () => {
    const bare: NeedsLeg = { ...RER };
    delete bare.a11y;
    const facts = legNeedsFacts(bare, ['audio', 'station'], { meta: META, dates: {} });
    expect(facts).toEqual([
      'Annonces sonores (référentiel des lignes IDFM) : non renseigné',
      'Déclaration générale de la ligne (champ accessibility) (référentiel des lignes IDFM) : non renseigné',
    ]);
  });
  it('ligne absente du référentiel (null) : « non renseigné »', () => {
    const leg: NeedsLeg = { ...RER, a11y: { line: null, audio: null, visual: null } };
    expect(legNeedsFacts(leg, ['visual'], CTX)[0]).toBe('Annonces visuelles (référentiel des lignes IDFM, relevé du 03/11/2026) : non renseigné');
  });
  it('jamais « accessible » ni « sûr » dans les phrases écrites ici, hors libellés de TRA04 recopiés', () => {
    const all = [
      ...legNeedsFacts({ ...RER, a11y: { ...RER.a11y!, st_from: null, st_to: null } }, [...NEED_ORDER], CTX),
      ...needsNotes([...NEED_ORDER], true),
      needsFixedText(CTX.dates),
      ...Object.values(NEED_LABEL),
    ].join(' ');
    expect(all).not.toMatch(/\baccessibles?\b|\bsûr|faisable/i);
  });
});

describe('mode sources coupé (D-033, lot 6)', () => {
  const off: NeedsReadCtx = { ...CTX, withSources: false };

  it('chaque ligne garde la valeur, sans nom de source ni date de relevé', () => {
    const facts = legNeedsFacts(RER, [...NEED_ORDER], off);
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) expect(f).not.toMatch(/GTFS IDFM|référentiel des lignes IDFM|accessibilité en gare IDFM|relevé du/);
    expect(facts[0]).toMatch(/^Véhicule déclaré adapté au fauteuil roulant : /);
  });

  it('mode sources activé : la source et la date reviennent', () => {
    expect(legNeedsFacts(RER, ['wc_trip'], { ...CTX, withSources: true })[0]).toContain('(GTFS IDFM, relevé du 02/11/2026)');
    expect(legNeedsFacts(RER, ['wc_trip'], CTX)[0]).toContain('(GTFS IDFM, relevé du 02/11/2026)');
  });

  it('les aides des cases gardent la précision, pas la source ; les notes perdent le code', () => {
    for (const hint of Object.values(NEED_HINT_PLAIN)) expect(hint ?? '').not.toMatch(/GTFS|IDFM|référentiel/);
    expect(NEED_HINT_PLAIN.wc_stops).toBe('quais de montée et de descente');
    expect(stripNeedsSourceCodes(NEEDS_LINE_NOTE)).not.toContain('TRA03');
    expect(stripNeedsSourceCodes(NEEDS_LINE_NOTE)).toContain('champ accessibility');
  });
});

describe('notes de lecture', () => {
  it('seulement quand une case est cochée, adaptées à la case', () => {
    expect(needsNotes([], true)).toEqual([]);
    const base = needsNotes(['wc_trip'], false);
    expect(base[0]).toMatch(/trajet le plus rapide.*autre trajet peut exister.*Ascenseurs non couverts/);
    expect(needsNotes(['station'], true).length).toBe(base.length + 1);
    expect(needsNotes(['station'], false).length).toBe(base.length);
    expect(needsNotes(['audio'], false).length).toBe(base.length + 1);
  });
  it('gare présente dans le trajet', () => {
    expect(tripHasStation([RER])).toBe(true);
    expect(tripHasStation([{ ...RER, a11y: { line: 'true', audio: 'true', visual: 'true' } }])).toBe(false);
    expect(tripHasStation(undefined)).toBe(false);
  });
});

describe('provenance du bloc', () => {
  const SOURCES: SourceEntry[] = [
    { source_id: 'TRA01', titre: 'IDFM - Horaires prévus (GTFS Datahub)', url_source: 'x', millesime: 'offre prévue', date_extraction: '2026-11-02T14:15Z', licence: 'x' },
    { source_id: 'TRA03', titre: 'IDFM - Référentiel des lignes', url_source: 'x', millesime: 'instantané du 03/11/2026', date_extraction: '2026-11-03T15:44Z', licence: 'ODbL' },
    { source_id: 'TRA04', titre: 'IDFM - Accessibilité en gare', url_source: 'x', millesime: 'jeu modifié le 06/07/2026', date_extraction: '2026-11-03T15:44Z', licence: 'LO' },
  ];
  const ds = (needs: NeedsMeta | undefined, sources = SOURCES, origin: Dataset['origin'] = 'real') =>
    ({ origin, meta: { service_date: '2026-11-17', needs } as unknown as Meta, sources }) as Pick<Dataset, 'origin' | 'meta' | 'sources'>;

  it('jeu, millésime et code de chaque source, lus dans meta.needs.sources et sources.json', () => {
    const p = needsPart(ds(META));
    expect(p?.lead).toBe('Ce que déclarent les sources');
    expect(p?.tags.map((t) => t.text)).toEqual([
      'GTFS IDFM, mardi 17/11/2026 (TRA01)',
      'IDFM, extrait du 03/11/2026 (TRA03)',
      'IDFM, extrait du 03/11/2026 (TRA04)',
    ]);
    expect(p?.tags.map((t) => t.anchor)).toEqual(['fiche-TRA01', 'fiche-TRA03', 'fiche-TRA04']);
  });
  it('rien d’inventé : réglage non publié, démo, ou source absente de sources.json', () => {
    expect(needsPart(ds(undefined))).toBeNull();
    expect(needsPart(ds(META, SOURCES, 'demo' as Dataset['origin']))).toBeNull();
    expect(needsPart(ds(META, SOURCES.filter((s) => s.source_id !== 'TRA04')))?.tags.map((t) => t.code)).toEqual(['TRA01', 'TRA03']);
    expect(needsPart(ds(META, SOURCES.slice(0, 1)))?.tags.map((t) => t.code)).toEqual(['TRA01']);
    expect(needsPart(ds(META, []))).toBeNull();
  });
});

describe('données publiées par 06n', () => {
  const meta = readJson<Meta>('meta.json');
  it('meta.needs : sources dans sources.json, cinq cases, niveaux de gare, aucun classement par handicap ni texte', () => {
    if (!meta.needs) return; // réglage pas encore publié dans cette copie des données
    const sources = readJson<SourceEntry[]>('sources.json');
    for (const code of meta.needs.sources) expect(sources.some((s) => s.source_id === code)).toBe(true);
    expect(Object.keys(meta.needs.station_levels).length).toBeGreaterThan(0);
    // `ac` (climatisation, 12/11) est une case du front seulement : elle lit air_conditioning des tronçons, rien n'est publié pour elle par 06n
    expect(meta.needs.needs).toEqual(NEED_ORDER.filter((id) => id !== 'ac'));
    expect(Object.keys(meta.needs)).not.toContain('texts');
    expect(JSON.stringify(meta.needs)).not.toMatch(/[\u2013\u2014]|wheelchair"|hearing|color/);
  });
  it('un fichier d’itinéraires : a11y sur chaque tronçon en TC, jamais sur la marche', () => {
    if (!meta.needs) return;
    const file = JSON.parse(
      gunzipSync(readFileSync(new URL(`../../public/data/itineraries/${meta.itineraries_communes?.[0] ?? '75101'}.json.gz`, import.meta.url))).toString('utf-8'),
    ) as ItinerariesFile;
    let tc = 0;
    for (const dirs of Object.values(file.days)) {
      for (const row of [...(dirs?.out ?? []), ...(dirs?.ret ?? [])]) {
        for (const leg of (row.legs ?? []) as NeedsLeg[]) {
          if (leg.m === 'walk') expect(leg.a11y).toBeUndefined();
          else {
            tc += 1;
            expect(leg.a11y).toBeDefined();
            expect(['true', 'false', 'unknown', null]).toContain(leg.a11y!.line);
          }
        }
      }
    }
    expect(tc).toBeGreaterThan(0);
  });
});
