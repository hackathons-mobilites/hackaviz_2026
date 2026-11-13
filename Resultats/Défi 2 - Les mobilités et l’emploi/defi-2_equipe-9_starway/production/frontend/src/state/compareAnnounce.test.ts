import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareAnnouncement } from './compareAnnounce';
import { DEFAULT_SCENARIO } from './scenario';
import { parseScenario, serializeScenario } from './url';

const srcRoot = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(srcRoot, rel), 'utf8');
const names: Record<string, string> = { '78358': 'Mantes-la-Jolie', '93066': 'Saint-Denis', '77186': 'Lieusaint' };
const nameOf = (insee: string) => names[insee] ?? insee;

describe('comparaison : annonce aux lecteurs d’écran (retours du testeur KBS, 10/11)', () => {
  it('entrée et changement de commune B : la commune B est nommée', () => {
    expect(compareAnnouncement(null, '93066', 'Mantes-la-Jolie', nameOf, false)).toBe('Comparaison avec Saint-Denis : deux ciels côte à côte.');
    expect(compareAnnouncement('93066', '77186', 'Mantes-la-Jolie', nameOf, false)).toBe('Comparaison avec Lieusaint : deux ciels côte à côte.');
  });

  it('sortie : le ciel de A seul, nommé', () => {
    expect(compareAnnouncement('93066', null, 'Mantes-la-Jolie', nameOf, false)).toBe('Comparaison quittée : ciel de Mantes-la-Jolie seul.');
    expect(compareAnnouncement('93066', null, null, nameOf, false)).toBe('Comparaison quittée.');
  });

  it('rien sans changement, rien en silence (visite, révélation)', () => {
    expect(compareAnnouncement('93066', '93066', 'Mantes-la-Jolie', nameOf, false)).toBe('');
    expect(compareAnnouncement(null, '93066', 'Mantes-la-Jolie', nameOf, true)).toBe('');
    expect(compareAnnouncement('93066', null, 'Mantes-la-Jolie', nameOf, true)).toBe('');
  });

  it('jamais de tiret cadratin ni demi-cadratin', () => {
    const texts = [compareAnnouncement(null, '93066', 'A', nameOf, false), compareAnnouncement('93066', null, 'A', nameOf, false)];
    for (const t of texts) expect(/[\u2013\u2014]/.test(t)).toBe(false);
  });
});

describe('comparaison : quitter et changer de commune B', () => {
  it("quitter la comparaison retire `vs` de l'URL, le reste du scénario est gardé", () => {
    const withB = parseScenario('?o=78358&d=d09&b=45&m=transit&vs=93066', DEFAULT_SCENARIO);
    expect(withB.compare).toBe('93066');
    const q = new URLSearchParams(serializeScenario({ ...withB, compare: null }));
    expect(q.has('vs')).toBe(false);
    expect(q.get('o')).toBe('78358');
    expect(q.get('d')).toBe('d09');
    expect(q.get('b')).toBe('45');
  });

  it("changer de commune B change `vs` seulement", () => {
    const withB = parseScenario('?o=78358&d=d09&b=45&m=transit&vs=93066', DEFAULT_SCENARIO);
    const q = new URLSearchParams(serializeScenario({ ...withB, compare: '77186' }));
    expect(q.get('vs')).toBe('77186');
    expect(q.get('o')).toBe('78358');
  });

  it('le ciel B porte un sélecteur de commune et un bouton « Quitter la comparaison », masqués pendant la visite', () => {
    const src = read('components/Diptych.tsx');
    expect(src).toMatch(/<CommuneSearch[\s\S]*?onSelect=\{\(c\) => void applyScenario\(\{ compare: c\.insee \}\)\}/);
    expect(src).toContain('Quitter la comparaison');
    expect(src).toMatch(/applyScenario\(\{ compare: null \}\)/);
    expect(src).toMatch(/side === 'B' && !touring/);
  });

  it('la barre du scénario annonce le changement dans une zone aria-live', () => {
    const src = read('components/ScenarioBar.tsx');
    expect(src).toMatch(/aria-live="polite">\s*\{compareMsg\}/);
  });
});

describe('carte et ciel : le bouton dit où il mène (retours du testeur KBS, 10/11)', () => {
  const src = read('components/MirrorMapButton.tsx');
  it('« Voir la carte » fermé, « Revenir au ciel » ouvert, en nom et en libellé visible', () => {
    expect(src).toContain("aria-label={open ? 'Revenir au ciel' : 'Voir la carte'}");
    expect(src).toContain("<span className=\"view-label\">{open ? 'Revenir au ciel' : 'Voir la carte'}</span>");
  });
  it('deux icônes différentes selon l’état', () => {
    expect([...src.matchAll(/<svg viewBox="0 0 24 24" aria-hidden="true">/g)].length).toBe(2);
  });
  it('Échap revient au ciel depuis la carte', () => {
    expect(read('components/MirrorMap.tsx')).toMatch(/e\.key !== 'Escape'[\s\S]{0,200}setOpen\(false\)/);
  });
  it('le libellé « Revenir au ciel » reste écrit même quand les libellés du groupe sont masqués', () => {
    expect(read('styles.css')).toMatch(/\.view-group \.map-toggle\.is-back \.view-label \{[\s\S]*?position: static;/);
  });
});

describe('Sources & limites : un seul accès, et « Retour en haut » (retours du testeur KBS, 10/11)', () => {
  it('le lien est dans la barre du haut, plus dans la bande du ciel', () => {
    expect(read('components/TopBar.tsx').match(/Sources &amp; limites/g)?.length).toBe(1);
    expect(read('components/SkyCredit.tsx')).not.toMatch(/>\s*Sources &amp; limites\s*</);
  });
  it('le tiroir a un bouton « Retour en haut » qui apparaît après défilement', () => {
    const src = read('components/SourcesDrawer.tsx');
    expect(src).toContain('Retour en haut');
    expect(src).toMatch(/\{scrolled && \(/);
    expect(src).toMatch(/onScroll=\{onBodyScroll\}/);
  });
});
