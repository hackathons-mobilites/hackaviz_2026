import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripDecisionCodes, stripPersonalNotes } from './proof';
import { plainSourceText, sourceText } from './sourceText';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
type Source = Record<string, unknown>;
const SOURCES = JSON.parse(read('../../public/data/sources.json')) as Source[];
const LIMITES_MD = read('../../../docs/limites.md');

const TECH = /D-\d{3}|\.(py|json|csv|jar|sh|md)\b|~\//;
const PEOPLE = /(?<!Saint )\b(Nicolas|Maia|Cyril|Sara|Florian)\b/;
/** Champs de `sources.json` affichés par « Sources & limites » ; traitements et limites : mode sources seulement */
const SHOWN_ALWAYS = ['titre', 'licence', 'millesime', 'date_extraction', 'date_service_transport'] as const;
const SHOWN_IN_SOURCES = [...SHOWN_ALWAYS, 'traitements', 'limites'] as const;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

describe('Sources & limites : textes affichés', () => {
  it('mode normal : aucun code de décision, nom de fichier ni chemin dans les titres et licences', () => {
    for (const s of SOURCES) {
      for (const k of ['titre', 'licence', 'millesime', 'date_service_transport'] as const) {
        const shown = sourceText(str(s[k]), false);
        expect(TECH.test(shown), `${String(s.source_id)} ${k} : ${shown}`).toBe(false);
      }
    }
  });

  it('aucun prénom de l’équipe, dans aucun mode', () => {
    for (const s of SOURCES) {
      for (const k of SHOWN_ALWAYS) expect(PEOPLE.test(sourceText(str(s[k]), false)), `${String(s.source_id)} ${k}`).toBe(false);
      for (const k of SHOWN_IN_SOURCES) expect(PEOPLE.test(sourceText(str(s[k]), true)), `${String(s.source_id)} ${k} (mode sources)`).toBe(false);
    }
    expect(PEOPLE.test(stripPersonalNotes(LIMITES_MD)), 'limites, mode sources').toBe(false);
    expect(PEOPLE.test(stripDecisionCodes(LIMITES_MD)), 'limites, mode normal').toBe(false);
  });

  it('mode sources : le texte publié reste, codes et fichiers compris', () => {
    const t = 'Conveyal R5 - jar r5-walk3000-all.jar (limite de marche 3 000 m, D-024)';
    expect(sourceText(t, true)).toBe(t);
  });

  it('formes des codes et des fichiers', () => {
    expect(plainSourceText('Jar r5-walk7200-all.jar (variante D-022 non retenue)')).toBe('Jar (variante non retenue)');
    expect(plainSourceText('Durées au même arrêt, source du moteur corrigé (D-031 a2)')).toBe('Durées au même arrêt, source du moteur corrigé');
    expect(plainSourceText('Règle D-031 c appliquée')).toBe('Règle appliquée');
    expect(plainSourceText('Points d’origine (communes_idf_2026.csv), fichier dérivé')).toBe('Points d’origine, fichier dérivé');
    expect(plainSourceText('2026-11-17 (mardi ordinaire, 139 563 courses actives ; voir starway/config.py)')).toBe('2026-11-17 (mardi ordinaire, 139 563 courses actives)');
    expect(plainSourceText('Version (copie exacte de ~/d031/navitia_same_stop_min.csv)')).toBe('Version');
    expect(plainSourceText('Grille déposée à la main par Nicolas')).toBe('Grille déposée à la main par l’équipe'.replace('’', "'"));
  });
});
