import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { legendNeedsRecallShown, NEEDS_EMPTY_HINT, needsCountText, needsRecallText, settingsSummary, SETTINGS_EMPTY, subscriptionsText, transitLabelOf, TRANSIT_TO_REVIEW, velibLabelOf, VELIB_TO_REVIEW } from './mySettings';
import type { SubscriptionsFile } from './subscriptions';

const FILE = {
  transit: { options: [{ id: 'navigo-annuel', label: 'Navigo Annuel' }, { id: 'sans-libelle' }] },
  velib: {
    offers: [
      { id: 'ticket-v', kind: 'ride', label: 'Ticket-V' },
      { id: 'v-plus', kind: 'subscription', label: 'V-Plus' },
    ],
  },
} as unknown as SubscriptionsFile;

describe('résumé de « Mes réglages »', () => {
  it('rien de réglé : « Aucun réglage »', () => {
    expect(settingsSummary({ transitLabel: null, velibLabel: null, needsCount: 0 })).toBe(SETTINGS_EMPTY);
  });
  it('abonnement et besoins, séparés par un point médian', () => {
    expect(settingsSummary({ transitLabel: 'Navigo Annuel', velibLabel: null, needsCount: 2 })).toBe('Navigo Annuel · 2 besoins');
    expect(settingsSummary({ transitLabel: 'Navigo Annuel', velibLabel: "Vélib' V-Plus", needsCount: 1 })).toBe("Navigo Annuel · Vélib' V-Plus · 1 besoin");
  });
  it('besoins seuls, singulier et pluriel', () => {
    expect(settingsSummary({ transitLabel: null, velibLabel: null, needsCount: 5 })).toBe('5 besoins');
    expect(needsCountText(0)).toBeNull();
    expect(needsCountText(1)).toBe('1 besoin');
    expect(needsRecallText(0)).toBe('aucun coché');
    expect(needsRecallText(1)).toBe('1 coché');
    expect(needsRecallText(3)).toBe('3 cochés');
  });
  it("pli « Ce qu'il me faut sur mon trajet » sans besoin coché : la phrase dit à quoi sert le pli (retour de Cyril, 11/11)", () => {
    expect(`${NEEDS_EMPTY_HINT.before}${NEEDS_EMPTY_HINT.link}${NEEDS_EMPTY_HINT.after}`).toBe(
      'Indiquez dans Mes réglages ce dont vous avez besoin sur un trajet : ce pli vous dira si celui-ci y répond.',
    );
    // le bouton porte le nom du dialogue qu'il ouvre
    expect(NEEDS_EMPTY_HINT.link).toBe('Mes réglages');
    // le pli du panneau demande la phrase ; la légende garde son rappel (rien quand aucune case n'est cochée)
    const here = dirname(fileURLToPath(import.meta.url));
    const panel = readFileSync(join(here, '../components/ProofPanel.tsx'), 'utf8');
    expect(panel).toMatch(/<PfGroup id="besoins"[^>]*>[\s\S]*?<NeedsRecall emptyHint \/>/);
    const needs = readFileSync(join(here, '../components/proof/ProofNeeds.tsx'), 'utf8');
    expect(needs).toMatch(/emptyHint && count === 0[\s\S]*?openDialog\(e\.currentTarget, 'needs'\)[\s\S]*?NEEDS_EMPTY_HINT\.link/);
  });
  it('abonnements seuls, pour l’onglet', () => {
    expect(subscriptionsText(null, null)).toBeNull();
    expect(subscriptionsText('Navigo Annuel', null)).toBe('Navigo Annuel');
  });
});

describe('libellés lus dans subscriptions.json', () => {
  it('fichier pas encore chargé ou pas de choix : rien n’est affirmé', () => {
    expect(transitLabelOf(null, 'navigo-annuel')).toBeNull();
    expect(transitLabelOf(FILE, null)).toBeNull();
    expect(velibLabelOf(null, 'v-plus')).toBeNull();
  });
  it('identifiant publié : son libellé', () => {
    expect(transitLabelOf(FILE, 'navigo-annuel')).toBe('Navigo Annuel');
    expect(transitLabelOf(FILE, 'sans-libelle')).toBe('sans-libelle');
    expect(velibLabelOf(FILE, 'v-plus')).toBe("Vélib' V-Plus");
  });
  it('ancien choix absent de la liste publiée : signalé, jamais masqué', () => {
    expect(transitLabelOf(FILE, 'retire')).toBe(TRANSIT_TO_REVIEW);
    expect(velibLabelOf(FILE, 'retire')).toBe(VELIB_TO_REVIEW);
  });
  it('le Ticket-V à la course vaut « aucun abonnement Vélib’ »', () => {
    expect(velibLabelOf(FILE, 'ticket-v')).toBeNull();
  });
});

describe('hors scénario', () => {
  const walk = (rel: string): string[] => {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    return (readdirSync(dir, { recursive: true }) as string[]).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n)).map((n) => join(dir, n));
  };
  it('le ciel, l’URL, la visite et le store du ciel ne lisent jamais les abonnements ni « Mes réglages »', () => {
    const files = ['../sky/', '../state/', '../tour/'].flatMap(walk);
    files.push(fileURLToPath(new URL('../store/useSkyStore.ts', import.meta.url)));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(readFileSync(f, 'utf-8'), f).not.toMatch(/subscriptionsStore|starway\.subscriptions|mySettings/);
  });
  it('le panneau lit le choix EN VIGUEUR (rien pendant la visite), pas le choix mémorisé', () => {
    const panel = readFileSync(new URL('../components/subscriptions/ProofSubscriptions.tsx', import.meta.url), 'utf-8');
    expect(panel).toContain('useEffectiveSubscriptions');
    expect(panel).not.toMatch(/useSubscriptionsStore\(\(s\) => s\.(transit|velib)\)/);
  });
});

// Audit d'affichage du 10/11, lot 4 : « aucun coché » est un réglage, pas une information
describe('légende : « Ce qu’il me faut sur mon trajet » est un réglage, écrit seulement avec au moins une case cochée', () => {
  it('aucun coché : rien dans la légende ; une case : le rappel', () => {
    const base = { published: true, origin: true, pearl: false };
    expect(legendNeedsRecallShown({ ...base, checked: 0 })).toBe(false);
    expect(legendNeedsRecallShown({ ...base, checked: 1 })).toBe(true);
    expect(legendNeedsRecallShown({ ...base, checked: 2, pearl: true })).toBe(false);
    expect(legendNeedsRecallShown({ ...base, checked: 2, origin: false })).toBe(false);
    expect(legendNeedsRecallShown({ ...base, checked: 2, published: false })).toBe(false);
  });
});
