import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadTerritoire } from './loaders';
import { chomagePart, METHODS, polarityPart, workTimePart } from './provenance';
import {
  CHOMAGE_DENOMINATOR,
  CHOMAGE_NOTES,
  EVOLUTION_NOTE,
  ZONE_SCALE_NOTE,
  POLARITY_TIP,
  chomageSource,
  communeTerritoire,
  departmentOf,
  evolutionDescription,
  frDate,
  isTerritoireFile,
  lastRate,
  ofName,
  pctText,
  polarityLine,
  provisionalNote,
  quarterLabel,
  rateText,
  stripDescription,
  workTimeSentences,
  workTimeSource,
  zoneLabel,
  zoneRank,
  zoneRankSentence,
  zoneRates,
  zoneSeries,
  type TerritoireFile,
} from './territoire';
import type { SourceEntry } from './types';

/**
 * Repères de territoire (D-048) : contrôles sur le fichier PUBLIÉ (frontend/public/data/territoire.json), jamais sur des valeurs écrites ici.
 * Les rangs et les taux sont recalculés autrement que par le code testé (tri, comptage direct).
 */
const read = <T,>(rel: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${rel}`, import.meta.url), 'utf-8')) as T;
const file = read<TerritoireFile>('territoire.json');
const sources = read<SourceEntry[]>('sources.json');
const ids = Object.keys(file.communes);

describe('territoire.json publié', () => {
  it('a la forme attendue (contrat territoire-1)', () => {
    expect(isTerritoireFile(file)).toBe(true);
  });

  it('refuse un fichier d\'un autre contrat, sans zones ou avec une série vide ou non numérique', () => {
    expect(isTerritoireFile(null)).toBe(false);
    expect(isTerritoireFile({ ...file, contract: 'territoire-2' })).toBe(false);
    expect(isTerritoireFile({ ...file, chomage: { ...file.chomage, zones: { x: { name: 'x', series: [] } } } })).toBe(false);
    expect(isTerritoireFile({ ...file, chomage: { ...file.chomage, zones: { x: { name: 'x', series: ['8'] } } } })).toBe(false);
    expect(isTerritoireFile({ ...file, temps_de_travail: { ...file.temps_de_travail, evening_pct: '27' } })).toBe(false);
  });

  it('chaque zone a un taux par trimestre, le dernier trimestre est celui du fichier', () => {
    const q = file.chomage.quarters;
    expect(q[q.length - 1]).toBe(file.chomage.quarter);
    for (const [id, z] of Object.entries(file.chomage.zones)) expect(z.series.length, `zone ${id}`).toBe(q.length);
  });

  it("toutes les communes de départ ont une zone d'emploi publiée et un département publié", () => {
    expect(ids.length).toBeGreaterThan(0);
    for (const insee of ids) {
      const t = communeTerritoire(file, insee);
      expect(t, insee).not.toBeNull();
      expect(t!.department, insee).not.toBeNull();
      expect(t!.department!.code).toBe(departmentOf(insee));
    }
  });

  it("une polarité est un nom non vide ou null, et chaque null est expliqué dans le fichier", () => {
    const polarities = ids.map((i) => file.communes[i]!.polarity);
    for (const p of polarities) expect(p === null || (typeof p === 'string' && p.length > 0)).toBe(true);
    expect(polarities.some((p) => p === null)).toBe(true);
    expect(file.null_reasons?.['communes.polarity']).toBeTruthy();
  });

  it('les arrondissements de Paris partagent la même zone et la même polarité', () => {
    const paris = ids.filter((i) => i.startsWith('751'));
    expect(paris.length).toBeGreaterThan(1);
    const first = file.communes[paris[0]!]!;
    for (const i of paris) expect(file.communes[i]).toEqual(first);
  });

  it('aucun tiret long, aucune « offre d\'emploi » dans les textes du fichier', () => {
    const text = JSON.stringify(file);
    expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(text).not.toMatch(/offres? d'emploi/i);
  });
});

describe('chômage', () => {
  const rates = zoneRates(file);

  it('un point par zone, triés du plus bas au plus haut, taux du dernier trimestre', () => {
    expect(rates.length).toBe(Object.keys(file.chomage.zones).length);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!.rate).toBeGreaterThanOrEqual(rates[i - 1]!.rate);
    for (const r of rates) {
      const series = file.chomage.zones[r.id]!.series;
      expect(r.rate).toBe(series[series.length - 1]);
      expect(lastRate(file.chomage.zones[r.id]!)).toBe(r.rate);
    }
  });

  it('le rang est recompté sans le code testé (strictement plus élevé, égalités dites)', () => {
    for (const [id, z] of Object.entries(file.chomage.zones)) {
      const mine = z.series[z.series.length - 1]!;
      const others = Object.entries(file.chomage.zones).filter(([k]) => k !== id).map(([, o]) => o.series[o.series.length - 1]!);
      const r = zoneRank(file, id)!;
      expect(r.above).toBe(others.filter((v) => v > mine).length);
      expect(r.tied).toBe(others.filter((v) => v === mine).length);
      expect(r.total).toBe(others.length + 1);
    }
    expect(zoneRank(file, 'inconnue')).toBeNull();
  });

  it('les phrases du rang suivent le plan (pluriel, extrême, égalité)', () => {
    expect(zoneRankSentence({ above: 0, tied: 0, total: 15 })).toBe("Le taux le plus élevé des 15 zones d'emploi d'Île-de-France.");
    expect(zoneRankSentence({ above: 1, tied: 0, total: 15 })).toBe("1 zone d'emploi sur 15 en Île-de-France a un taux plus élevé.");
    expect(zoneRankSentence({ above: 3, tied: 0, total: 15 })).toBe("3 zones d'emploi sur 15 en Île-de-France ont un taux plus élevé.");
    expect(zoneRankSentence({ above: 3, tied: 1, total: 15 })).toContain('(ex aequo avec 1 autre)');
    expect(zoneRankSentence({ above: 3, tied: 2, total: 15 })).toContain('(ex aequo avec 2 autres)');
  });

  it("le département et la région viennent du fichier ; Paris n'a pas le taux de sa zone d'emploi par construction du code", () => {
    const any = communeTerritoire(file, ids[0])!;
    expect(any.department!.rate).toBe(file.chomage.departments[departmentOf(ids[0]!)]!.rate);
    expect(file.chomage.region.rate).toBeGreaterThan(0);
  });

  it('formats : une décimale, trimestre, date, élision', () => {
    expect(rateText(8.6)).toBe('8,6\u00a0%');
    expect(rateText(8)).toBe('8,0\u00a0%');
    expect(pctText(27)).toBe('27\u00a0%');
    expect(quarterLabel('2026-T2')).toBe('2e trimestre 2026');
    expect(quarterLabel('2026-T1')).toBe('1er trimestre 2026');
    expect(quarterLabel('n/a')).toBe('n/a');
    expect(frDate('2026-09-18')).toBe('18/09/2026');
    expect(frDate('x')).toBeNull();
    expect(ofName('Étampes')).toBe("d'Étampes");
    expect(ofName('Paris')).toBe('de Paris');
    expect(zoneLabel('Évry-Courcouronnes')).toBe("Zone d'emploi d'Évry-Courcouronnes");
  });

  it('la source dit le trimestre, son caractère provisoire et la date de parution lus dans le fichier', () => {
    const s = chomageSource(file.chomage);
    expect(s).toContain('Source : Insee');
    expect(s).toContain(quarterLabel(file.chomage.quarter));
    expect(s).toContain(frDate(file.chomage.published)!);
    expect(s.includes('(provisoire)')).toBe(file.chomage.provisional);
    expect(provisionalNote(file.chomage) !== null).toBe(file.chomage.provisional);
    expect(provisionalNote({ quarter: '2026-T2', provisional: false })).toBeNull();
  });

  it('les notes toujours visibles disent la maille, le lieu de résidence et l\'absence de cause', () => {
    const all = CHOMAGE_NOTES.join(' ');
    // La maille est au « i » de la bande depuis le 10/11 (lot 6 de l'audit), mots inchangés
    expect(ZONE_SCALE_NOTE).toMatch(/plus large que la commune/);
    expect(ZONE_SCALE_NOTE).toMatch(/France Travail/);
    expect(all).toMatch(/lieu de résidence/);
    expect(CHOMAGE_DENOMINATOR).toMatch(/population active/);
    expect(all).toMatch(/aucun lien de cause/i);
    expect(EVOLUTION_NOTE).toMatch(/découpage 2020/);
    // jamais un verdict ni un mot de la grammaire des astres
    for (const t of [...CHOMAGE_NOTES, EVOLUTION_NOTE, ZONE_SCALE_NOTE, CHOMAGE_DENOMINATOR]) expect(t).not.toMatch(/accessible\b|offres? d'emploi|[\u2013\u2014]/i);
  });

  it("la description de la bande dit l'étendue et la valeur de la zone de chaque commune", () => {
    const insee = ids[0]!;
    const t = communeTerritoire(file, insee)!;
    const d = stripDescription(file, [{ tag: 'A', name: 'Test', zoneId: t.zoneId }]);
    expect(d).toContain(`${Object.keys(file.chomage.zones).length} zones d'emploi`);
    expect(d).toContain(rateText(lastRate(t.zone)));
    expect(d).toContain('A · Test');
  });

  it("l'évolution est lue telle quelle : premier et dernier trimestre, une valeur par trimestre", () => {
    const id = Object.keys(file.chomage.zones)[0]!;
    const s = zoneSeries(file, id);
    expect(s.length).toBe(file.chomage.quarters.length);
    expect(s[0]!.rate).toBe(file.chomage.zones[id]!.series[0]);
    const d = evolutionDescription(file, id)!;
    expect(d).toContain(rateText(s[0]!.rate));
    expect(d).toContain(quarterLabel(file.chomage.quarter));
    expect(zoneSeries(file, 'inconnue')).toEqual([]);
    expect(evolutionDescription(file, 'inconnue')).toBeNull();
  });
});

describe('temps de travail', () => {
  const lines = workTimeSentences(file.temps_de_travail);
  const text = [...lines, workTimeSource(file.temps_de_travail)].join(' ');

  it('la phrase reprend les valeurs du fichier, la source, le champ et la date', () => {
    const t = file.temps_de_travail;
    expect(text).toContain(`En ${t.year}, ${pctText(t.evening_pct)}`);
    expect(text).toContain(pctText(t.night_pct));
    expect(text).toContain(`enquête Emploi ${t.year}`);
    expect(text).toContain(t.scope);
    expect(text).toContain(frDate(t.published)!);
  });

  it("n'avance aucun chiffre pour la journée-type 6h-14h et dit que les journées-types sont choisies par l'équipe", () => {
    expect(text).toMatch(/aucun chiffre pour la journée-type 6h-14h/);
    expect(text).toMatch(/tôt le matin/);
    expect(text).toMatch(/choisies par l'équipe/);
    // la phrase n'emploie pas le fragment « choix de l'équipe » : il est réservé à la note du trafic (inventaire, keep-visible.json)
    expect(text).not.toMatch(/choix de l'équipe/);
    // les seuls nombres de la phrase des chiffres sont ceux du fichier
    const figures = lines[0]!.match(/\d+\u00a0%/g) ?? [];
    expect(figures).toEqual([pctText(file.temps_de_travail.evening_pct), pctText(file.temps_de_travail.night_pct)]);
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('polarité', () => {
  it('une ligne seulement quand la commune en a une', () => {
    expect(polarityLine(null)).toBeNull();
    expect(polarityLine(undefined)).toBeNull();
    expect(polarityLine('')).toBeNull();
    expect(polarityLine('Paris')).toBe('Polarité du SDRIF-E : Paris');
  });

  it("la bulle dit que ce n'est pas un classement d'accessibilité et cite la source, sans niveau 1 ou 2", () => {
    expect(POLARITY_TIP).toMatch(/Ce n'est pas un classement d'accessibilité/);
    expect(POLARITY_TIP).toMatch(/Institut Paris Region/);
    expect(POLARITY_TIP).not.toMatch(/niveau\s*[12]\b|[\u2013\u2014]/i);
  });
});

describe('provenance (mode sources)', () => {
  it('chaque bloc cite ses codes du manifeste, son millésime lu dans le fichier et sa méthode', () => {
    const c = chomagePart(sources, file, METHODS.chomage)!;
    expect(c.tags.map((t) => t.code)).toEqual(['SOC02', 'GEO05']);
    expect(c.tags[0]!.text).toContain(quarterLabel(file.chomage.quarter));
    expect(c.tags[0]!.text).toContain(frDate(file.chomage.published)!);
    expect(c.method).toBe(METHODS.chomage);
    const w = workTimePart(sources, file, METHODS.workTime)!;
    expect(w.tags.map((t) => t.code)).toEqual(['EMP05']);
    expect(w.tags[0]!.text).toContain(`enquête Emploi ${file.temps_de_travail.year}`);
    const p = polarityPart(sources, file, METHODS.polarity)!;
    expect(p.tags.map((t) => t.code)).toEqual(['GEO06']);
  });

  it('rien sans fichier valide, rien sans la source au manifeste', () => {
    expect(chomagePart(sources, null)).toBeNull();
    expect(workTimePart(sources, undefined)).toBeNull();
    expect(polarityPart(sources, null)).toBeNull();
    expect(chomagePart([], file)).toBeNull();
    expect(workTimePart([], file)).toBeNull();
  });

  it('les méthodes ne contiennent ni taux ni code de source', () => {
    for (const m of [METHODS.chomage, METHODS.workTime, METHODS.polarity]) {
      expect(m).not.toMatch(/\d+(?:[,.]\d+)?\s*%|[\u2013\u2014]/);
      expect(m).not.toMatch(/\b[A-Z]{3}\d{2}\b/);
    }
  });
});

describe('loadTerritoire', () => {
  const body = readFileSync(new URL('../../public/data/territoire.json', import.meta.url), 'utf-8');
  const ok = (async () => new Response(body, { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

  it('lit le fichier publié ; null en démonstration', async () => {
    const f = await loadTerritoire({ origin: 'real' }, ok);
    expect(f && isTerritoireFile(f)).toBe(true);
    expect(await loadTerritoire({ origin: 'demo' }, ok)).toBeNull();
  });
});
