import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scenarioBar, targetSize } from './tokens';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const px = (css: string, name: string) => {
  const m = css.match(new RegExp(`${name}:\\s*(\\d+)px`));
  expect(m, `${name} doit être défini dans :root de styles.css`).not.toBeNull();
  return Number(m![1]);
};

/** Barre de scénario compacte (D-049) : jetons et miroirs CSS d'accord, tiroir hors du flux (ciel stable, D-021), disclosure accessible. */
describe('barre de scénario compacte (chantier C, lot 2)', () => {
  const styles = read('../styles.css');
  const barCss = read('../components/scenarioBar.css');
  const barTsx = read('../components/ScenarioBar.tsx');

  it('les variables --bar-* de styles.css sont le miroir des jetons scenarioBar', () => {
    expect(px(styles, '--bar-row-h')).toBe(scenarioBar.rowPx);
    expect(px(styles, '--bar-pad-y')).toBe(scenarioBar.padYPx);
    expect(px(styles, '--bar-control-h')).toBe(scenarioBar.controlPx);
    expect(px(styles, '--bar-drawer-max-w')).toBe(scenarioBar.drawerMaxPx);
  });

  it('les champs de la barre restent des cibles de 24 px au moins (WCAG 2.5.8)', () => {
    expect(scenarioBar.controlPx).toBeGreaterThanOrEqual(targetSize.minPx);
    expect(scenarioBar.rowPx).toBeGreaterThanOrEqual(scenarioBar.controlPx);
  });

  it('le seuil du téléphone est celui des requêtes de média de la barre', () => {
    expect(barCss).toContain(`@media (max-width: ${scenarioBar.phoneMaxPx}px)`);
  });

  it('le tiroir est hors du flux : position absolue au-dessus de la barre, la hauteur de la barre ne dépend pas de son ouverture', () => {
    expect(barCss).toMatch(/\.bar-drawer \{[^}]*position:\s*absolute[^}]*bottom:\s*calc\(100% \+/);
    // la hauteur de la ligne est fixée par le jeton, sur ordinateur
    expect(barCss).toMatch(/\.bar-row \{[^}]*height:\s*var\(--bar-row-h\)/);
    // la mesure de la barre (--bar-h) ne dépend pas de l'état du tiroir
    const effect = barTsx.match(/useEffect\(\(\) => \{\s*const el = ref\.current;[\s\S]*?\}, \[([^\]]*)\]\);/);
    expect(effect, 'effet de mesure de la barre').not.toBeNull();
    expect(effect![1]).toBe('setBarHeight');
    expect(barTsx).not.toMatch(/setBarHeight\([^)]*expanded/);
  });

  it('la flèche est un bouton « disclosure » : aria-expanded, aria-controls vers le tiroir, Échap referme et rend le focus', () => {
    expect(barTsx).toMatch(/aria-expanded=\{expanded\}/);
    expect(barTsx).toContain('aria-controls="scenario-drawer"');
    expect(barTsx).toContain('id="scenario-drawer"');
    expect(barTsx).toMatch(/hidden=\{!expanded\}/);
    expect(barTsx).toMatch(/e\.key === 'Escape' && expanded/);
    expect(barTsx).toMatch(/toggleRef\.current\?\.focus\(\)/);
  });

  it('les notes de mode qui changent le sens restent dans la ligne de la barre, pas dans le tiroir seul', () => {
    const row = barTsx.slice(barTsx.indexOf('className="bar-row"'), barTsx.indexOf('id="scenario-drawer"'));
    expect(row).toContain('mode-note');
    expect(row).toContain('velib-hint');
    for (const phrase of ["route vide : temps optimiste", "choix de l'équipe", "vélo jusqu'à la gare"]) {
      expect(barTsx).toContain(phrase);
    }
  });

  it('la légende du compteur tient dans la ligne de la barre : trois lignes au plus (10/11)', () => {
    // Constat de Nicolas pendant la visite : légende empilée sur cinq ou six lignes, coupée sous la barre
    // ligne unique (1280 px et plus) : sous 1280 px, la barre a deux rangées et la cellule du compteur grandit avec sa légende
    const oneLine = barCss.slice(barCss.indexOf('@media (min-width: 1280px) {'));
    const rule = oneLine.match(/section\.scenario-bar \.counter-caption \{([^}]*)\}/);
    expect(rule, 'règle de la légende du compteur').not.toBeNull();
    const body = rule![1] ?? '';
    const lines = Number(body.match(/(?:^|[^-])line-clamp:\s*(\d+)/)?.[1]);
    expect(body).toMatch(/-webkit-line-clamp:\s*\d+/);
    expect(body).toMatch(/overflow:\s*hidden/);
    const lineHeight = Number(body.match(/line-height:\s*([\d.]+)/)?.[1]);
    const fontPx = px(styles, '--type-label');
    expect(lineHeight).toBeGreaterThan(0);
    // les lignes permises tiennent dans la hauteur de la ligne de la barre (jeton scenarioBar.rowPx)
    expect(lines).toBeGreaterThan(0);
    expect(lines * lineHeight * fontPx).toBeLessThanOrEqual(scenarioBar.rowPx);
  });

  it('tout le compteur tient dans la ligne de la barre hors téléphone : nombre, filet, « i » et pastille de variation (11/11)', () => {
    // Constat de Nicolas sur le site en ligne : pastille au-dessus du bord haut de la barre, filet et « i » sous le nombre, hors de la barre
    const start = barCss.indexOf('@media (min-width: 761px) and (min-height: 481px), (min-width: 1024px) {');
    expect(start, 'règles du compteur hors téléphone').toBeGreaterThan(-1);
    // le bloc s'arrête à l'accolade de fin de la requête de média (colonne 0)
    const block = barCss.slice(start, barCss.indexOf('\n}', start));
    // le nombre et son filet dans la colonne 1, la légende dans la colonne 2, le « i » du filet en fin de légende
    expect(block).toMatch(/grid-template-areas:\s*'num caption tip'\s*'gauge caption tip'/);
    expect(block).toMatch(/\.counter-gauge-tip \{[^}]*grid-area:\s*tip/);
    // nombre plafonné : plafond + écart + épaisseur du filet <= hauteur de la ligne (jeton scenarioBar.rowPx)
    const cap = block.match(/\.counter-value \{[^}]*font-size:\s*min\(var\(--type-stat\),\s*calc\(var\(--bar-row-h\) - (\d+)px\)\)/);
    expect(cap, 'plafond du nombre').not.toBeNull();
    const reserved = Number(cap![1]);
    const gap = Number(block.match(/\.counter-block \{[^}]*row-gap:\s*(\d+)px/)?.[1]);
    const gauge = Number(styles.match(/\.counter-gauge \{[^}]*height:\s*(\d+)px/)?.[1]);
    expect(gap).toBeGreaterThan(0);
    expect(gauge).toBeGreaterThan(0);
    expect(gap + gauge).toBeLessThanOrEqual(reserved);
    // la pastille prend la case de la légende, jamais une position absolue qui la sortirait de la barre (téléphone compris)
    expect(block).toMatch(/\.counter-badge \{[^}]*grid-area:\s*caption/);
    const phone = barCss.slice(barCss.indexOf('@media (max-width: 760px), (max-width: 1023px) and (max-height: 480px) {'));
    expect(phone).toMatch(/\.counter-badge \{[^}]*grid-area:\s*caption/);
    expect(barCss).not.toMatch(/\.counter-badge \{[^}]*position:\s*absolute/);
  });

  it('la pastille de variation tient sur deux lignes au plus, jamais coupées, avec 4 px de marge dans la ligne (12/11)', () => {
    // Échec du test de fumée sous Linux : à 1280 px, le texte libre passait sur quatre lignes et dépassait la barre de 4 px
    const start = barCss.indexOf('@media (min-width: 761px) and (min-height: 481px), (min-width: 1024px) {');
    const block = barCss.slice(start, barCss.indexOf('\n}', start));
    const badge = block.match(/\.counter-badge \{([^}]*)\}/)?.[1] ?? '';
    const phone = barCss.slice(barCss.indexOf('@media (max-width: 760px), (max-width: 1023px) and (max-height: 480px) {'));
    const phoneBadge = phone.match(/\.counter-badge \{([^}]*)\}/)?.[1] ?? '';
    for (const rule of [badge, phoneBadge]) {
      // un écart par ligne (`BadgeParts`), jamais de retour à la ligne libre
      expect(rule).toMatch(/white-space:\s*nowrap/);
      expect(rule).toMatch(/flex-direction:\s*column/);
      // hauteur connue : deux lignes et la bordure, 4 px de marge en haut et en bas de la ligne de la barre
      const lineHeight = Number(rule.match(/line-height:\s*([\d.]+)/)?.[1]);
      expect(lineHeight).toBeGreaterThan(0);
      expect(2 * lineHeight * px(styles, '--type-label') + 2).toBeLessThanOrEqual(scenarioBar.rowPx - 2 * 4);
    }
    expect(barCss).toMatch(/\.counter-badge-part \{[^}]*display:\s*block/);
    const counter = read('../components/CounterBlock.tsx');
    expect(counter).toContain('className="counter-badge-part"');
    // deux écarts au plus : communes ou pôles, puis postes
    expect(counter).not.toMatch(/parts\.push\([^)]*\)[\s\S]*parts\.push\([^)]*\)[\s\S]*parts\.push\([^)]*\)[\s\S]*parts\.push\(/);
  });

  it('le tiroir se ferme aussi par une croix en haut, même effet que la flèche du bas (demande de Nicolas du 10/11)', () => {
    const drawer = barTsx.slice(barTsx.indexOf('id="scenario-drawer"'));
    const close = drawer.match(/<button[^>]*className="icon-btn drawer-close"[^>]*>/);
    expect(close, 'croix du tiroir').not.toBeNull();
    expect(close![0]).toContain('onClick={closeDrawer}');
    expect(close![0]).toContain('aria-label="Fermer les réglages du scénario"');
    // closeDrawer rend le focus au bouton d'ouverture
    expect(barTsx).toMatch(/const closeDrawer = \(\) => \{\s*setExpanded\(false\);\s*toggleRef\.current\?\.focus\(\);/);
    // la croix est le premier élément du tiroir (première étape de tabulation après la flèche) et elle est placée en haut à droite
    expect(drawer.indexOf('drawer-close')).toBeLessThan(drawer.indexOf('drawer-grid'));
    expect(barCss).toMatch(/\.bar-drawer \.drawer-close \{[^}]*position:\s*absolute[^}]*top:[^}]*right:/);
  });

  it('la feuille du bas ouverte efface la barre et la légende malgré le style en ligne de Motion (!important)', () => {
    expect(barCss).toMatch(/html\.sheet-open section\.scenario-bar,\s*html\.sheet-open \.legend \{[^}]*opacity:\s*0 !important[^}]*visibility:\s*hidden !important/);
  });
});
