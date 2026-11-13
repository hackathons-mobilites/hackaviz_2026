import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccessFile, Meta, SourceEntry, TollsFile } from '../../data/types';
import { carCostText } from '../../data/modesCompare';
import { DEFAULT_SCENARIO, sanitizeScenario, type Scenario } from '../../state/scenario';
import { parseScenario, serializeScenario } from '../../state/url';
import { CarCostView } from './ProofCarCost';

/**
 * Contrôle sur les données PUBLIÉES (frontend/public/data), pas sur des fixtures : la mise en ligne est
 * automatique à la fusion sur main. Mode sources coupé (défaut D-033), aucun texte « null », « NaN » ou
 * « undefined » à l'écran, distances de la version corrigée seulement, anciens liens partagés lisibles.
 */
const read = <T,>(rel: string): T => JSON.parse(readFileSync(new URL(`../../../public/data/${rel}`, import.meta.url), 'utf-8')) as T;
const meta = read<Meta>('meta.json');
const tolls = read<TollsFile>('tolls.json');
const sources = read<SourceEntry[]>('sources.json');
const communes = meta.access_communes ?? [];
// access/ suit le ciel de meta.access_sky (44 astres depuis le 05/11, 15 pôles avant)
const N_POLES = meta.access_sky?.poles ?? 15;
const accessOf = (insee: string) => read<AccessFile>(`access/${insee}.json`);

const BAD = /\bnull\b|\bundefined\b|\bNaN\b|Infinity|\[object|\bnull\s*€|€\s*null/;

function render(access: AccessFile, pole: number, scenario: Partial<Scenario>, tj: TollsFile | null = tolls): string {
  return renderToStaticMarkup(createElement(CarCostView, { meta, access, poleIndex: pole, polesCount: N_POLES, scenario: { ...DEFAULT_SCENARIO, ...scenario }, tolls: tj, sources }));
}

describe('données publiées : distances voiture v2', () => {
  it('meta dit que les distances viennent de la version corrigée (carSpeed fixé) et sont complètes', () => {
    const d = meta.car_costs?.distances as Record<string, unknown> | undefined;
    expect(d?.status).toBe('ok');
    expect(d?.run).toBe('car_dist_carspeed_v2');
    expect(d?.pairs).toBe(communes.length * N_POLES * 2);
    expect(d?.car_speed_mps).toBeGreaterThan(0);
  });

  it('chaque commune publie ses distances aller et retour pour tous les pôles, sans ancien champ de coût', { timeout: 120_000 }, () => {
    for (const insee of communes) {
      const a = accessOf(insee);
      const t = a.car_trip;
      expect(t, insee).toBeTruthy();
      for (const leg of ['out', 'ret'] as const) {
        expect(t!.dist_m[leg].length, `${insee} ${leg}`).toBe(t!.reason[leg].length);
        expect(t!.dist_m[leg].length, `${insee} ${leg} pôles`).toBe(N_POLES);
        for (let i = 0; i < N_POLES; i++) {
          const dm = t!.dist_m[leg][i];
          // une distance ou une raison, jamais les deux, jamais 0 de substitution
          expect(dm == null, `${insee} ${leg} ${i}`).toBe(t!.reason[leg][i] != null);
          if (dm != null) expect(dm, `${insee} ${leg} ${i}`).toBeGreaterThan(0);
        }
      }
      expect(Object.keys(t!), insee).not.toContain('cost_eur');
    }
  });
});

describe('données publiées : bloc « Coût et carbone » (mode sources coupé)', () => {
  const ids = (meta.vehicles ?? []).map((v) => v.id);

  it('7 véhicules publiés, le premier est le défaut', () => {
    expect(ids).toEqual(['petrol', 'diesel', 'electric', 'moto_125', 'maxiscooter', 'moto_mid', 'moto_900']);
  });

  it('véhicule par défaut (aucun choix), voiture route vide : aucune valeur manquante affichée, aucune provenance', { timeout: 120_000 }, () => {
    let rendered = 0;
    const sample = communes.filter((_, i) => i % 5 === 0);
    for (const insee of sample) {
      const a = accessOf(insee);
      for (let pole = 0; pole < 15; pole++) {
        const html = render(a, pole, { mode: 'car' });
        expect(html, `${insee} pôle ${pole}`).not.toMatch(BAD);
        expect(html, `${insee} pôle ${pole}`).not.toContain('prov-note');
        expect(html).not.toMatch(/[\u2013\u2014]/);
        rendered++;
      }
    }
    expect(rendered).toBe(sample.length * 15);
  });

  it('chaque véhicule, trafic moyen et route vide, sur un échantillon de communes : rien de faux affiché', { timeout: 120_000 }, () => {
    for (const insee of communes.filter((_, i) => i % 53 === 0)) {
      const a = accessOf(insee);
      for (const vehicle of ids) {
        for (const mode of ['car', 'car_traffic'] as const) {
          for (let pole = 0; pole < 15; pole++) {
            const html = render(a, pole, { mode, vehicle });
            expect(html, `${insee} ${vehicle} ${mode} pôle ${pole}`).not.toMatch(BAD);
            expect(html).not.toContain('prov-note');
          }
        }
      }
    }
  });

  it('« Comparer les modes » : coût voiture lu dans car_trip publié, sans valeur manquante affichée', { timeout: 120_000 }, () => {
    let shown = 0;
    for (const insee of communes.filter((_, i) => i % 53 === 0)) {
      const a = accessOf(insee);
      for (let pole = 0; pole < 15; pole++) {
        const t = carCostText(meta, a, pole, N_POLES);
        if (t == null) continue;
        shown++;
        expect(t, `${insee} ${pole}`).not.toMatch(BAD);
        expect(t).toMatch(/^Énergie seule, péages non comptés : essence [\d\s\u00a0\u202f,]+€ ; diesel /);
      }
    }
    expect(shown).toBeGreaterThan(0);
  });

  it('péages pas encore chargés, ou fichier absent d’une commune : phrase d’attente, pas de crash ni de 0 €', () => {
    const a = accessOf(communes[0]!);
    expect(render(a, 0, { mode: 'car' }, null)).not.toMatch(BAD);
    const sansTrip = { ...a, car_trip: undefined } as AccessFile;
    const html = render(sansTrip, 0, { mode: 'car' });
    expect(html).not.toMatch(BAD);
    expect(html).toContain('pas encore publié');
  });

  it('un trajet à péage inconnu (grilles Sanef) ne donne jamais un total à 0 €', { timeout: 120_000 }, () => {
    let unknown = 0;
    for (const insee of communes.filter((_, i) => i % 17 === 0)) {
      const a = accessOf(insee);
      for (let pole = 0; pole < 15; pole++) {
        const html = render(a, pole, { mode: 'car' });
        if (html.includes('Total inconnu')) {
          unknown++;
          // D-066 : la tuile « Aller et retour » écrit « Total inconnu », jamais un montant
          expect(html, `${insee} ${pole}`).not.toMatch(/pf-carcost-total[^]*?pf-tile-figure[^>]*>0,00/);
        }
      }
    }
    expect(unknown).toBeGreaterThan(0);
  });
});

describe('données publiées : crédit du producteur de chaque péage chiffré (accord du 09/11/2026, D-060)', () => {
  it('chaque point tarifé de tolls.json porte un crédit', () => {
    const priced = new Set(tolls.grids.filter((g) => g.slots).flatMap((g) => [g.e, g.s]));
    for (const i of priced) expect(tolls.points[i]?.credit, tolls.points[i]?.id).toMatch(/^tarif /);
  });

  it('mode sources coupé : un montant de péage affiché est toujours suivi du crédit, VINCI Autoroutes compris', { timeout: 120_000 }, () => {
    let priced = 0;
    let vinci = 0;
    for (const insee of communes.filter((_, i) => i % 17 === 0)) {
      const a = accessOf(insee);
      for (let pole = 0; pole < N_POLES; pole++) {
        const html = render(a, pole, { mode: 'car' });
        // une ligne par sens (<li>) : un montant de péage y est suivi du crédit, après le nom des passages
        for (const m of html.matchAll(/<li>(.*?)<\/li>/g)) {
          if (!/péage (?:de )?\d/.test(m[1]!)) continue;
          priced++;
          expect(m[1], `${insee} pôle ${pole}`).toMatch(/ ; tarif /);
        }
        if (html.includes('© VINCI Autoroutes')) vinci++;
      }
    }
    expect(priced).toBeGreaterThan(0);
    expect(vinci).toBeGreaterThan(0);
  });
});

describe('anciens liens partagés', () => {
  const known = new Set(communes);
  const poles = new Set(['P_DEFENSE', 'P_PARIS_QCA']);

  it('un lien d’avant le sélecteur (sans vh) s’ouvre sur le véhicule par défaut et se réécrit sans vh', () => {
    const s = parseScenario('?o=75101&d=d09&b=45&m=car&p=P_DEFENSE');
    expect(s.vehicle ?? null).toBeNull();
    const sane = sanitizeScenario(s, meta, known, poles);
    expect(sane.mode).toBe('car');
    expect(sane.vehicle ?? null).toBeNull();
    expect(serializeScenario(sane)).not.toContain('vh=');
  });

  it('un véhicule inconnu ou mal formé retombe sur le défaut, un véhicule publié est gardé', () => {
    for (const vh of ['velo_electrique', 'x'.repeat(40), '<script>']) {
      const sane = sanitizeScenario(parseScenario(`?o=75101&m=car&vh=${encodeURIComponent(vh)}`), meta, known, poles);
      expect(sane.vehicle ?? null, vh).toBeNull();
    }
    const keep = sanitizeScenario(parseScenario('?o=75101&m=car&vh=moto_125'), meta, known, poles);
    expect(keep.vehicle).toBe('moto_125');
    expect(serializeScenario(keep)).toContain('vh=moto_125');
  });

  it('un lien avec un mode voiture et un véhicule dans un autre mode ne change pas le mode', () => {
    const sane = sanitizeScenario(parseScenario('?o=75101&m=transit&vh=diesel'), meta, known, poles);
    expect(sane.mode).toBe('transit');
  });
});
