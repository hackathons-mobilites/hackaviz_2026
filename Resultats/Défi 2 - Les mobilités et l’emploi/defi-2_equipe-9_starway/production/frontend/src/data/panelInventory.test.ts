import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error module de script sans types : logique pure partagée avec scripts/panel-inventory.mjs
import { compareInventories, matchesKeep, neutralize, phrasesOf, validateExceptions, zoneFromTexts } from '../../scripts/lib/panelInventory.mjs';

/**
 * Filet de sécurité du chantier « alléger sans rien perdre » : aucune phrase ne disparaît de l'interface sans une
 * exception écrite et justifiée. Les phrases se comparent chiffres neutralisés : une relance de calculs (flux GTFS,
 * temps de trajet) ne change aucun résultat de ce fichier. Le relevé du navigateur (scripts/panel-inventory.mjs)
 * est joué par scripts/smoke.mjs ; ici on teste la logique et les fichiers versionnés.
 */

const dir = fileURLToPath(new URL('../../scripts/inventory/', import.meta.url));
const readJson = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf-8'));

interface Zone {
  visible: string[];
  fold: string[];
  tip: string[];
}
interface Inventory {
  scenarios: { id: string; zones: Record<string, Zone> }[];
}
const mk = (zone: Partial<Zone>): Inventory => ({ scenarios: [{ id: 'tc', zones: { panneau: { visible: [], fold: [], tip: [], ...zone } } }] });

describe('neutralisation des phrases', () => {
  it('remplace les chiffres, ignore la casse et les espaces insécables', () => {
    expect(neutralize('1\u202f234,5 postes  en 60 min')).toBe('# postes en # min');
    expect(neutralize('Ce n’est PAS une offre')).toBe("ce n'est pas une offre");
  });

  it('découpe en phrases, sans doublon ni ligne sans lettre', () => {
    expect(phrasesOf('Une phrase. Une autre phrase.\n12 %\nUne phrase.')).toEqual(['une phrase.', 'une autre phrase.']);
  });

  it('classe visible, replié et bulle sans compter deux fois la même phrase', () => {
    const z = zoneFromTexts({ closed: 'Visible.', opened: 'Visible.\nReplié.', tips: 'Replié.\nBulle.' });
    expect(z).toEqual({ visible: ['visible.'], fold: ['replié.'], tip: ['bulle.'] });
  });
});

describe('comparaison à la référence', () => {
  const baseline = mk({ visible: ['aller et retour.'], fold: ['durées minimales.'] });

  it('échoue quand une phrase disparaît sans exception', () => {
    const r = compareInventories({ baseline, current: mk({ visible: ['aller et retour.'] }) });
    expect(r.missing.map((m: { phrase: string }) => m.phrase)).toEqual(['durées minimales.']);
  });

  it('accepte une phrase qui change de place (repli, bulle)', () => {
    const r = compareInventories({ baseline, current: mk({ fold: ['aller et retour.'], tip: ['durées minimales.'] }) });
    expect(r.missing).toEqual([]);
  });

  it('accepte une disparition couverte par une exception, pas ailleurs', () => {
    const ex = [{ phrase: 'durées minimales.', scenarios: ['tc'], zone: 'panneau' }];
    expect(compareInventories({ baseline, current: mk({ visible: ['aller et retour.'] }), exceptions: ex }).missing).toEqual([]);
    const other = [{ phrase: 'durées minimales.', scenarios: ['velib'] }];
    expect(compareInventories({ baseline, current: mk({ visible: ['aller et retour.'] }), exceptions: other }).missing).toHaveLength(1);
  });

  it("signale un scénario qu'on n'a pas relevé", () => {
    const r = compareInventories({ baseline, current: { scenarios: [] } });
    expect(r.missing).toHaveLength(1);
  });

  it('refuse qu\'une phrase à garder visible le devienne moins, sauf en la laissant visible', () => {
    const keep = [{ fragment: 'aller et retour', zone: 'panneau' }];
    expect(compareInventories({ baseline, current: mk({ fold: ['aller et retour.'], tip: ['durées minimales.'] }), keepVisible: keep }).degraded).toHaveLength(1);
    expect(compareInventories({ baseline, current: mk({ visible: ['aller et retour.'], tip: ['durées minimales.'] }), keepVisible: keep }).degraded).toEqual([]);
  });

  it('en mode strict, toute phrase à garder visible de la page courante doit être lue sans rien ouvrir (phrases nouvelles comprises)', () => {
    const keep = [{ fragment: 'arrêt le plus desservi' }];
    const current = mk({ visible: ['aller et retour.'], fold: ['durées minimales.', "jusqu'à l'arrêt le plus desservi."] });
    expect(compareInventories({ baseline, current, keepVisible: keep, strict: true }).notVisible).toHaveLength(1);
    expect(compareInventories({ baseline, current, keepVisible: keep }).notVisible).toEqual([]);
  });

  it('« au_moins: fold » (lot 4 de l’audit d’affichage) : pli ouvert suffit en mode strict, jamais un « i » seul', () => {
    const keep = [{ fragment: 'non calculés pour cette commune', au_moins: 'fold' }];
    const inFold = mk({ visible: ['aller et retour.'], fold: ['durées minimales.', "non calculés pour cette commune : vélib'."] });
    expect(compareInventories({ baseline, current: inFold, keepVisible: keep, strict: true }).notVisible).toEqual([]);
    const inTip = mk({ visible: ['aller et retour.'], fold: ['durées minimales.'], tip: ["non calculés pour cette commune : vélib'."] });
    expect(compareInventories({ baseline, current: inTip, keepVisible: keep, strict: true }).notVisible).toHaveLength(1);
    // un autre fragment sans « au_moins » qui couvre la même phrase garde l'exigence la plus forte
    const both = [...keep, { fragment: 'cette commune' }];
    expect(compareInventories({ baseline, current: inFold, keepVisible: both, strict: true }).notVisible).toHaveLength(1);
  });

  it('matchesKeep respecte les scénarios et la zone', () => {
    const keep = [{ fragment: 'vélib', scenarios: ['velib'], zone: 'panneau' }];
    expect(matchesKeep(keep, { scenario: 'velib', zone: 'panneau', phrase: "vélib' : vélo" })).toBe(true);
    expect(matchesKeep(keep, { scenario: 'tc', zone: 'panneau', phrase: "vélib' : vélo" })).toBe(false);
    expect(matchesKeep(keep, { scenario: 'velib', zone: 'barre', phrase: "vélib' : vélo" })).toBe(false);
  });
});

describe('contrôle des exceptions', () => {
  const baseline = mk({ visible: ['durées minimales.'] });
  const good = { phrase: 'durées minimales.', scenarios: ['tc'], lot: 2, justification: 'La phrase est reformulée plus court au lot 2, même sens.' };

  it('accepte une exception complète', () => {
    expect(validateExceptions([good], baseline)).toEqual([]);
  });

  it('exige justification, lot, scénarios, phrase neutralisée et existante, sans tiret long', () => {
    const bad: [RegExp, Record<string, unknown>][] = [
      [/justification/, { ...good, justification: 'court' }],
      [/lot non indiqué/, { ...good, lot: undefined }],
      [/scénarios manquants/, { ...good, scenarios: [] }],
      [/neutralisée/, { ...good, phrase: 'Durées Minimales 12.' }],
      [/périmée/, { ...good, phrase: 'phrase inconnue.' }],
      [/tiret/, { ...good, justification: `Un tiret long \u2014 est interdit, même dans une justification assez longue.` }],
    ];
    for (const [expected, e] of bad) expect(validateExceptions([e], baseline).join(' | ')).toMatch(expected);
  });
});

describe('fichiers versionnés', () => {
  const baseline: Inventory = readJson('panel-baseline.json');
  const exceptions = readJson('panel-exceptions.json').exceptions;
  const keep = readJson('keep-visible.json').entrees;

  it('la référence couvre les huit scénarios demandés, panneau relevé, plis ouverts', () => {
    expect(baseline.scenarios.map((s) => s.id)).toEqual(['tc', 'velo-tc', 'velib', 'voiture', 'voiture-trafic', 'horaires-libres', 'poste-de-nuit', 'comparaison']);
    for (const s of baseline.scenarios) {
      const z = s.zones.panneau;
      expect(z, s.id).toBeDefined();
      expect(z?.visible.length, s.id).toBeGreaterThan(0);
      expect(z?.fold.length, s.id).toBeGreaterThan(0);
    }
  });

  it('la référence ne contient aucune valeur chiffrée (relance des calculs sans effet) ni tiret long', () => {
    const all = JSON.stringify(baseline);
    expect(/[\u2013\u2014]/.test(all)).toBe(false);
    for (const s of baseline.scenarios)
      for (const z of Object.values(s.zones)) for (const p of [...z.visible, ...z.fold, ...z.tip]) expect(p).toBe(neutralize(p));
  });

  it('chaque exception est justifiée et vise une phrase de la référence', () => {
    expect(validateExceptions(exceptions, baseline)).toEqual([]);
  });

  it('les entrées « à garder visible » sont neutralisées, expliquées, et vues dans la référence (sauf phrase à venir)', () => {
    for (const k of keep) {
      expect(k.fragment, k.fragment).toBe(neutralize(k.fragment));
      expect(k.pourquoi?.length, k.fragment).toBeGreaterThan(10);
      expect(/[\u2013\u2014]/.test(JSON.stringify(k))).toBe(false);
    }
    // seules les gardes écrites dans un titre par l'audit d'affichage du 11/11 (après le relevé de la référence) peuvent en être absentes :
    // « Trajet, exemple de trajet » (D-066, titre du bloc « Trajet ») et « Temps de trajet (durées minimales) » ; et la phrase du pli « Ce qu'il me
    // faut sur mon trajet » sans besoin coché (retour de Cyril, 11/11)
    const missing = keep.filter(
      (k: { fragment: string }) => !baseline.scenarios.some((s) => Object.values(s.zones).some((z) => [...z.visible, ...z.fold, ...z.tip].some((p) => p.includes(k.fragment)))),
    );
    expect(missing.map((k: { fragment: string }) => k.fragment)).toEqual([
      'trajet, exemple de trajet',
      '(durées minimales)',
      'indiquez dans mes réglages ce dont vous avez besoin sur un trajet : ce pli vous dira si celui-ci y répond',
    ]);
  });
});
