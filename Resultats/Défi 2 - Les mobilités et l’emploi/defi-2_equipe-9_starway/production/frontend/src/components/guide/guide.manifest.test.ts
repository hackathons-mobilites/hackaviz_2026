import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HALO_DIMENSIONS } from '../../data/halo';
import { aidePage, scenarioBar } from '../../theme/tokens';
import { GUIDE_CATEGORIES, GUIDE_COVERAGE, GUIDE_ENTRIES } from './guide.manifest';
import { GUIDE_CAPTURES } from './guide.captures';

const srcRoot = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(join(srcRoot, rel), 'utf8');
const componentsDir = join(srcRoot, 'components');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith('.tsx') && !p.includes('.test.') ? [p] : [];
  });
}

/** Composants JSX (`<Nom`) du rendu d'un fichier : après son premier `return (` */
function jsxComponents(source: string): Set<string> {
  const body = source.slice(source.indexOf('return ('));
  return new Set([...body.matchAll(/<([A-Z]\w+)/g)].map((m) => m[1]!));
}

const ids = new Set(GUIDE_ENTRIES.map((e) => e.id));
const texts = (e: (typeof GUIDE_ENTRIES)[number]) => [e.title, e.purpose, ...e.howTo, ...e.know, ...e.shots.map((s) => s.alt)];

describe('aide : structure du manifeste', () => {
  it('identifiants uniques, catégorie connue, texte et capture pour chaque entrée', () => {
    expect(ids.size).toBe(GUIDE_ENTRIES.length);
    const cats = new Set(GUIDE_CATEGORIES.map((c) => c.id));
    for (const e of GUIDE_ENTRIES) {
      expect(cats.has(e.category), `${e.id} : catégorie ${e.category}`).toBe(true);
      expect(e.purpose.length, `${e.id} : à quoi ça sert`).toBeGreaterThan(0);
      expect(e.howTo.length, `${e.id} : comment faire`).toBeGreaterThan(0);
      expect(e.know.length, `${e.id} : à savoir`).toBeGreaterThan(0);
      expect(e.shots.length, `${e.id} : au moins une capture`).toBeGreaterThan(0);
      for (const s of e.shots) {
        expect(s.alt.length, `${s.file} : texte alternatif`).toBeGreaterThan(0);
        expect(s.show.length, `${s.file} : élément montré`).toBeGreaterThan(0);
      }
    }
  });

  it('chaque catégorie a au moins une entrée', () => {
    for (const c of GUIDE_CATEGORIES) expect(GUIDE_ENTRIES.some((e) => e.category === c.id), c.id).toBe(true);
  });
});

describe('aide : captures', () => {
  const dir = fileURLToPath(new URL('../../../public/assets/guide/', import.meta.url));
  const onDisk = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.webp')).map((n) => n.slice(0, -5)).sort() : [];
  const declared = GUIDE_ENTRIES.flatMap((e) => e.shots.map((s) => s.file));

  it('noms de fichiers uniques', () => {
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('chaque capture du manifeste existe, avec ses dimensions (relancer scripts/capture-guide.mjs sinon)', () => {
    expect(onDisk.filter((f) => !GUIDE_CAPTURES[f]), 'dimensions manquantes').toEqual([]);
    for (const f of declared) expect(onDisk, `capture ${f}.webp manquante`).toContain(f);
  });

  it('chaque fichier de capture correspond à une entrée', () => {
    for (const f of onDisk) expect(declared, `fichier orphelin : ${f}.webp`).toContain(f);
  });
});

describe('aide : règles de texte', () => {
  it('jamais de tiret cadratin ni demi-cadratin', () => {
    for (const e of GUIDE_ENTRIES) for (const t of texts(e)) expect(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`).test(t), `${e.id} : ${t}`).toBe(false);
  });

  it("aucun chiffre : temps, postes et prix sont dans les captures, régénérées à la publication", () => {
    for (const e of GUIDE_ENTRIES) for (const t of texts(e)) expect(/\d/.test(t), `${e.id} : ${t}`).toBe(false);
  });

  it("vocabulaire : jamais d'« offres d'emploi »", () => {
    for (const e of GUIDE_ENTRIES) for (const t of texts(e)) expect(/offres? d.emploi/i.test(t), `${e.id} : ${t}`).toBe(false);
  });

  it("aucune source citée, sauf dans l'entrée du mode sources", () => {
    const names = /INSEE|IDFM|Île-de-France Mobilités|DiRIF|France Travail|OpenStreetMap|\bOSM\b|r5py|ADEME|Flores|Filosofi|Etalab|Choisir le service public|GTFS|Navitia|SDRIF|\bEMP0\d|\bTRA0\d/;
    // Exception étroite (D-065, vocabulaire des postes du 11/11) : le terme validé « postes salariés recensés par l'INSEE »,
    // court « postes salariés (INSEE) », est la définition de ce qu'on compte, pas une citation de source. Seuls ces deux
    // libellés exacts sont retirés avant le contrôle ; « Flores », le millésime ou tout autre « INSEE » restent interdits.
    const term = /postes salariés recensés par l['’]INSEE|postes salariés \(INSEE\)/g;
    for (const e of GUIDE_ENTRIES) {
      if (e.id === 'mode-sources') continue;
      for (const t of texts(e)) expect(names.test(t.replace(term, '')), `${e.id} : ${t}`).toBe(false);
    }
  });
});

describe("aide : couverture des fonctions (une fonction ajoutée sans aide fait échouer ce test)", () => {
  const known = (map: Record<string, string>) => {
    for (const [key, entry] of Object.entries(map)) expect(ids.has(entry), `${key} renvoie à une entrée inconnue : ${entry}`).toBe(true);
  };

  it('tous les boutons de la barre du haut sont documentés', () => {
    const src = read('components/TopBar.tsx');
    const found = new Set([...jsxComponents(src)].filter((c) => c !== 'Suspense'));
    // Noms de zones (la barre et son groupe) et logo : pas des fonctions à documenter à part
    const structure = new Set(['Actions', 'Autres lectures du ciel']);
    for (const [, l] of src.matchAll(/aria-label="([^"]+)"/g)) if (!l!.startsWith('STARWAY') && !structure.has(l!)) found.add(l!);
    if (src.includes('Sources &amp; limites')) found.add('Sources & limites');
    expect([...found].sort()).toEqual(Object.keys(GUIDE_COVERAGE.topBar).sort());
    known(GUIDE_COVERAGE.topBar);
  });

  it('tous les plis du panneau de preuve sont documentés', () => {
    const src = read('components/ProofPanel.tsx');
    const found = new Set([...src.matchAll(/<PfGroup\s+id="([^"]+)"/g)].map((m) => m[1]!));
    expect([...found].sort()).toEqual(Object.keys(GUIDE_COVERAGE.folds).sort());
    known(GUIDE_COVERAGE.folds);
  });

  it('toutes les cellules de la barre du scénario sont documentées', () => {
    const src = read('components/ScenarioBar.tsx');
    const found = new Set([...src.matchAll(/(?:bar-group bar|drawer-cell drawer)-(\w+)/g)].map((m) => m[1]!));
    expect([...found].sort()).toEqual(Object.keys(GUIDE_COVERAGE.bar).sort());
    known(GUIDE_COVERAGE.bar);
  });

  it('tous les onglets de « Derrière notre étoile » sont documentés', () => {
    expect(HALO_DIMENSIONS.map((d) => d.id).sort()).toEqual(Object.keys(GUIDE_COVERAGE.haloTabs).sort());
    known(GUIDE_COVERAGE.haloTabs);
  });

  it('tous les moyens de transport sont documentés', () => {
    const m = /MODE_IDS: readonly string\[\] = \[([^\]]+)\]/.exec(read('state/url.ts'));
    const found = [...m![1]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!);
    expect(found.sort()).toEqual(Object.keys(GUIDE_COVERAGE.modes).sort());
    known(GUIDE_COVERAGE.modes);
  });

  it('toutes les commandes de la visite sont documentées', () => {
    const src = read('components/TourOverlay.tsx');
    const found = [...src.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]!);
    expect(found.sort()).toEqual([...GUIDE_COVERAGE.tourControls].sort());
  });

  it("tous les paramètres d'un lien partagé sont documentés", () => {
    const m = /SCENARIO_KEYS = \[([^\]]+)\]/.exec(read('state/url.ts'));
    const found = [...m![1]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!);
    expect(found.sort()).toEqual(Object.keys(GUIDE_COVERAGE.urlParams).sort());
    known(GUIDE_COVERAGE.urlParams);
  });

  it('toutes les touches gérées par les composants sont décrites', () => {
    const found = new Set<string>();
    for (const f of tsxFiles(componentsDir)) {
      const src = readFileSync(f, 'utf8');
      for (const [, key] of src.matchAll(/\b(?:e|event)\.key\s*[!=]==\s*'([^']+)'/g)) found.add(key!);
      if (f.endsWith('MirrorMap.tsx')) for (const [, key] of src.matchAll(/case '([^']+)':/g)) found.add(key!);
    }
    // Inclusion et non égalité : une touche peut être déclarée avant la fusion du composant qui la gère (Début et Fin, onglets de la PR 109)
    const declared = new Set<string>(GUIDE_COVERAGE.keys);
    expect([...found].filter((k) => !declared.has(k)), 'touche sans description').toEqual([]);
    expect(GUIDE_ENTRIES.find((e) => e.id === 'raccourcis')?.shortcuts?.length).toBeGreaterThan(0);
  });

  it("tous les composants montés par l'application sont documentés ou déclarés techniques", () => {
    const found = jsxComponents(read('App.tsx'));
    const declared = new Set([...Object.keys(GUIDE_COVERAGE.app), ...GUIDE_COVERAGE.technical]);
    expect([...found].sort()).toEqual([...declared].sort());
    known(GUIDE_COVERAGE.app);
  });
});

describe('aide : styles', () => {
  const css = read('components/guide/guide.css');
  it('les seuils CSS sont le miroir des jetons', () => {
    expect(css).toContain(`@media (min-width: ${aidePage.twoColsMinPx}px)`);
    expect(css).toContain(`@media (max-width: ${scenarioBar.phoneMaxPx}px)`);
  });
});
