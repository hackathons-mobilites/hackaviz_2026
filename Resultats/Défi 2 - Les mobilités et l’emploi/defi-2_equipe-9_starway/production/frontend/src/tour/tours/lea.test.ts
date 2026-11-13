import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AccessFile, Commune, ContextFile, Dataset, Meta, Pole } from '../../data/types';
import { readItinerariesFile, readOdOffline } from '../../../scripts/nodeData';
import { isBmoFile } from '../../data/bmo';
import { isBmoMetiersFile } from '../../data/bmoMetiers';
import { communeJobsOf } from '../../data/od/communeJobs';
import { odFolderFor } from '../../data/od/folders';
import type { OdIndex } from '../../data/od/types';
import { resolveTour } from '../resolve';
import { checkVariables, VARIABLES, type NarrationContext } from '../variables';
import { buildLea, defaultOptions, lea, leaVideo, LEA_PROFILE, LEA_REQUIRED_VARIABLES, PENDING_STEPS, VIDEO_MOYENS, type LeaOptions } from './lea.tour';
import { formatInt } from '../../data/format';
import { metierProjectsOral, type BmoMetiersFile } from '../../data/bmoMetiers';
import type { BmoFile } from '../../data/bmo';

// Visite « Le ciel de Léa » rejouée sur les VRAIES données exportées (public/data), comme npm run tour:resolve :
// elle se joue sur le ciel des 44 astres (racine de data/).
const SKY = '';
const url = (rel: string) => new URL(`../../../public/data/${rel}`, import.meta.url);
const dataRoot = fileURLToPath(new URL('../../../public/data', import.meta.url));
const readJson = <T,>(rel: string): T | null => (existsSync(url(rel)) ? (JSON.parse(readFileSync(url(rel), 'utf-8')) as T) : null);
const meta = readJson<Meta>(`${SKY}meta.json`);
// Itinéraires en `.json.gz` (gzip, 04/11) ou `.json` selon meta.itineraries_format
const hasItin = ['78358.json.gz', '78358.json'].some((f) => existsSync(url(`itineraries/${f}`)));
const hasData = !!meta && ['78358', '78418'].every((i) => existsSync(url(`${SKY}access/${i}.json`))) && hasItin;
const dataset: Dataset | null = meta
  ? { origin: 'real', meta, poles: readJson<Pole[]>(`${SKY}poles.json`)!, communes: readJson<Commune[]>('communes.json')!, insights: [], sources: [] }
  : null;
// Postes par commune (index de la table OD du réglage par défaut) : la commune de départ sort des totaux (point 4.1)
const odFolder = odFolderFor(meta, null);
const odIndex = odFolder ? readJson<OdIndex>(`${odFolder.path.replace(/^data\//, '')}index.json`) : null;
// Table commune x commune (D-019) : la base du compteur et du ciel du site, donc celle des chiffres de la visite (06/11)
const od = meta ? readOdOffline(fileURLToPath(new URL('../../../public', import.meta.url)), meta) : null;
const sources = () => ({
  dataset: dataset!,
  access: (insee: string) => readJson<AccessFile>(`${SKY}access/${insee}.json`),
  context: (insee: string) => readJson<ContextFile>(`context/${insee}.json`),
  itineraries: (insee: string) => readItinerariesFile(dataRoot, meta, insee),
  bmoMetiers: ((f) => (isBmoMetiersFile(f) ? f : null))(readJson<unknown>('bmo_metiers.json')),
  bmo: ((f) => (isBmoFile(f) ? f : null))(readJson<unknown>('bmo.json')),
  communeJobs: odIndex ? (insee: string) => communeJobsOf(odIndex, insee) : null,
  od,
});

const placeholders = (t: string) => [...t.matchAll(/\{([\w.]+)\}/g)].map((m) => m[1]!);
const ALL: LeaOptions = { carte: true, halo: true, voiture: true, bmo: true, cout: true, moyens: true };
const NONE: LeaOptions = { carte: false, halo: false, voiture: false, bmo: false, cout: false, moyens: false };
const pendingVars = new Set(Object.values(PENDING_STEPS).flatMap((p) => p.pending));
/** Variantes jouables aujourd'hui (sans les étapes en attente) */
const playable = () => [
  lea,
  buildLea('gain', { ...ALL, bmo: false, cout: false }),
  buildLea('sans_gain'),
  buildLea('retire', NONE),
  buildLea('gain', NONE),
];
const namesOf = (step: { narration: string; checks?: Readonly<Record<string, string>> }) => [...placeholders(step.narration), ...Object.keys(step.checks ?? {})];
/** Mots prononcés : jetons qui portent une lettre ou un chiffre (les « : » isolés ne comptent pas) */
const words = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

describe('script de Léa (forme)', () => {
  it('chaque variable des textes et des contrôles existe dans variables.ts (ou est déclarée en attente)', () => {
    for (const script of playable()) {
      for (const step of script.steps) for (const name of namesOf(step)) expect(VARIABLES[name], `${step.id} : ${name}`).toBeTypeOf('function');
    }
    for (const step of buildLea('gain', ALL).steps) {
      for (const name of namesOf(step)) expect(VARIABLES[name] != null || pendingVars.has(name), `${step.id} : ${name}`).toBe(true);
    }
    for (const name of LEA_REQUIRED_VARIABLES) expect(VARIABLES[name], name).toBeTypeOf('function');
  });
  it('étapes en attente : désactivées par défaut, condition écrite, variables pas encore définies ; BMO jouée sur le site (06/11)', () => {
    expect(defaultOptions('gain')).toEqual({ carte: true, halo: true, voiture: true, bmo: true, cout: false, moyens: true });
    for (const [k, p] of Object.entries(PENDING_STEPS)) {
      expect(p.condition.length, k).toBeGreaterThan(40);
      for (const name of p.pending) expect(VARIABLES[name], `${k} : ${name} (à retirer de pending une fois écrite)`).toBeUndefined();
    }
    const ids = lea.steps.map((s) => s.id);
    expect(ids).toContain('acte2-recrutement');
    expect(ids).not.toContain('acte4-cout');
  });
  it('décisions du 04/11 : halo gardé par défaut, carte gardée même avec l’étape BMO', () => {
    expect(lea.steps.map((s) => s.id)).toContain('halo');
    for (const opts of [ALL, { ...defaultOptions('gain'), bmo: true }]) expect(buildLea('gain', opts).steps.map((s) => s.id)).toContain('acte1-carte');
    expect(lea.steps.find((s) => s.id === 'acte2-pole')!.narration).toContain('{anchor.out}');
    // 11/11 : le pli « Communes du pôle » est ouvert à l'étape de Poissy, et le repère entoure sa ligne (minutes dites)
    expect(lea.steps.find((s) => s.id === 'acte2-pole')!.openFold).toEqual(['communes']);
  });
  it('retours de Cyril : « moyens de transport », « les émissions carbone » ; « opportunités d’emploi » n’est plus dit (audit du 12/11), la phrase BMO dit « recrutements prévus »', () => {
    for (const script of [...playable(), buildLea('gain', ALL)]) {
      for (const step of script.steps) {
        expect(step.narration, step.id).not.toMatch(/\bmodes?\b/i);
        expect(step.narration, step.id).not.toMatch(/\ble carbone\b/i);
        expect(step.narration, step.id).not.toMatch(/points? d.eau/i);
      }
    }
    const said = (script: { steps: readonly { narration: string }[] }) => script.steps.map((s) => s.narration).join(' ');
    // BMO jouée sur le site (06/11). 12/11 (audit de vérité) : « opportunités d'emploi », trop proche d'« emplois disponibles »,
    // n'est plus dit nulle part ; la phrase BMO dit « les recrutements prévus pour {année} »
    expect(said(lea)).not.toMatch(/opportunités/);
    expect(said(leaVideo)).not.toMatch(/opportunités/);
    expect(said(lea)).toContain('Ce sont les recrutements prévus pour {bmo.yearOral}');
    // moyens de transport : jouée par défaut, contrôlée (climatisation déclarée, carbone publié), « déclarées » jamais retiré
    const moyens = lea.steps.find((s) => s.id === 'acte4-moyens')!;
    expect(moyens.checks).toEqual({ 'moyens.climCase': 'declaree', 'moyens.carbonCase': 'publie' });
    expect(moyens.narration).toContain('comparer les moyens de transport : les émissions carbone de chaque trajet');
    expect(moyens.narration).toContain('les lignes déclarées climatisées');
    expect(said(buildLea('gain', { ...NONE, bmo: true }))).toContain('les recrutements prévus pour');
    for (const step of buildLea('gain', ALL).steps) expect(step.narration, step.id).not.toMatch(/opportunités/);
  });
  it('variables prononcées par la variante par défaut = LEA_REQUIRED_VARIABLES', () => {
    const used = new Set(lea.steps.flatMap((s) => placeholders(s.narration)));
    expect([...used].sort()).toEqual([...LEA_REQUIRED_VARIABLES].sort());
  });
  it('aucun chiffre écrit dans les textes, aucun tiret long, vocabulaire des postes', () => {
    for (const script of [...playable(), buildLea('gain', ALL), leaVideo]) {
      for (const step of script.steps) {
        const literal = step.narration.replace(/\{[\w.]+\}/g, '');
        expect(literal, step.id).not.toMatch(/\d/);
        expect(step.narration, step.id).not.toMatch(new RegExp('[\\u2013\\u2014]'));
        expect(step.narration, step.id).not.toMatch(/offres? d.emploi|emplois disponibles|postes vacants/i);
      }
    }
  });
  it('mots du défi n° 2 prononcés par la variante par défaut (brief IDFM)', () => {
    const all = lea.steps.map((s) => s.narration).join(' ');
    // « où l'emploi se concentre » retiré (audit du 09/11, C8) : les 44 astres couvrent tous les postes, pas seulement ceux des lieux de concentration
    // 11/11 17h (retour de Cyril, validé par Nicolas) : la première et seule mention dit « postes salariés recensés par l'INSEE »
    for (const w of ['postes salariés recensés par l’INSEE', 'flux domicile-travail', 'solution complémentaire', 'périmètre de recherche d’emploi', 'voiture'])
      expect(all, w).toContain(w);
    expect(all).not.toMatch(/où l.emploi se concentre/);
  });
  it('12/11 : le défi est implicite (décision de Nicolas) : le prologue pose la question de Léa, sans réciter le défi ; le reste des mots du brief reste', () => {
    const said = (script: { steps: readonly { narration: string }[] }) => script.steps.map((s) => s.narration).join(' ');
    for (const script of [lea, leaVideo]) {
      const all = said(script);
      for (const w of [
        'seulement les transports en commun : quels emplois peut-elle rejoindre ?',
        'élargir son horizon',
        'besoins du monde du travail',
        'une solution complémentaire',
        'inégalité entre territoires',
      ])
        expect(all, `${script.id} : ${w}`).toContain(w);
      // les moyens de transport : visite complète seulement depuis la mesure du 11/11 (courte à 189 s avec eux)
      if (script === lea) expect(all, 'lea : les moyens de transport').toContain('les moyens de transport');
      // plus de « Notre défi » récité ni de « En bas, Léa se donne » (décision de Nicolas du 12/11, texte d'ouverture) ; la question vient après Léa
      const prologue = script.steps[0]!.narration;
      expect(prologue, script.id).not.toContain('Notre défi');
      expect(prologue.indexOf('quels emplois'), script.id).toBeGreaterThan(prologue.indexOf('Léa'));
      expect(script.steps[1]!.narration, script.id).not.toMatch(/^En bas, /);
    }
    // le site dit aussi « réduire l'utilisation de la voiture » (étape des moyens) et qu'une journée-type est un scénario (règle 8)
    expect(said(lea)).toContain('réduire l’utilisation de la voiture');
    expect(said(lea)).toContain('Une journée-type est un scénario, pas un horaire réel.');
  });
  it('ordre du récit : le lieu (fiche de Paris 8e, recrutement, moyens de transport), puis l’heure, puis le mode (voiture, puis vélo)', () => {
    expect(lea.steps.map((s) => s.id)).toEqual([
      'prologue', 'acte1-ciel', 'acte1-carte', 'acte1-preuve', 'acte2-recrutement', 'acte4-moyens', 'acte3-horizons', 'halo', 'acte2-eclipse', 'acte2-pole',
      'acte4-voiture',
      'acte4-velo', 'epilogue',
    ]);
    expect(buildLea('gain', ALL).steps.map((s) => s.id)).toEqual([
      'prologue', 'acte1-ciel', 'acte1-carte', 'acte1-preuve', 'acte2-recrutement', 'acte4-moyens', 'acte3-horizons', 'halo', 'acte2-eclipse', 'acte2-pole',
      'acte4-voiture', 'acte4-cout', 'acte4-velo', 'epilogue',
    ]);
    expect(buildLea('retire', NONE).steps.map((s) => s.id)).toEqual([
      'prologue', 'acte1-ciel', 'acte1-preuve', 'acte3-horizons', 'acte2-eclipse', 'acte2-pole', 'epilogue',
    ]);
  });
  it('à aucun moment la fiche de Paris 8e n’est ouverte en 14h-22h (retour de 76 min non confirmé par Navitia, 06/11 16h40)', () => {
    for (const script of [...playable(), buildLea('gain', ALL), leaVideo]) {
      let day = 'd09';
      let pole: string | null = null;
      for (const step of script.steps) {
        if (step.state.day) day = step.state.day;
        if ('pole' in step.state) pole = step.state.pole ?? null;
        expect(day === 'd14' && pole === 'BE_1107_75108', `${script.id} : ${step.id} (journée ${day}, fiche ${pole})`).toBe(false);
      }
    }
  });
  it('un seul réglage à la fois ; une seule fois la journée-type change (9h-17h puis 14h-22h)', () => {
    for (const script of [...playable(), buildLea('gain', ALL)]) {
      const days: string[] = [];
      for (const step of script.steps.slice(1)) {
        // fermer la fiche du pôle ou la comparaison n'est pas un réglage
        const keys = Object.keys(step.state).filter((k) => !((k === 'pole' || k === 'compare') && step.state[k as 'pole' | 'compare'] === null));
        expect(keys.length, step.id).toBeLessThanOrEqual(1);
        if (step.state.day) days.push(step.state.day);
      }
      expect(days).toEqual(['d14']);
    }
  });
  it('halo : juste après Montesson, en 9h-17h, comparaison ouverte (jamais refermée entre les deux), refermée seulement par l’éclipse', () => {
    for (const script of [lea, buildLea('gain', ALL), buildLea('gain', defaultOptions('gain'), { halo: true })]) {
      const ids = script.steps.map((s) => s.id);
      expect(ids[ids.indexOf('acte3-horizons') + 1], script.id).toBe('halo');
      const halo = script.steps[ids.indexOf('halo')]!;
      expect(halo.state, 'le halo ne change que le halo').toEqual({ halo: 'income' });
      expect(halo.checks).toMatchObject({ 'halo.compareCase': 'deux_medianes' });
      // la comparaison est posée à l'étape précédente et la journée n'a pas changé : 9h-17h, deux communes
      expect(script.steps[ids.indexOf('acte3-horizons')]!.state).toMatchObject({ compare: '78418' });
      expect(script.steps.slice(1, ids.indexOf('halo')).some((s) => s.state.day)).toBe(false);
      const after = script.steps[ids.indexOf('halo') + 1]!;
      expect(after.id).toBe('acte2-eclipse');
      expect(after.state.compare).toBeNull();
    }
  });
  it('slogan « le même ciel, mais pas les mêmes étoiles » : UNE phrase liée (10/11), sur la variante « écart » seulement, parle des territoires, jamais des revenus', () => {
    const ecart = lea.steps.find((s) => s.id === 'acte3-horizons')!.narration;
    expect(ecart).toContain('Deux voisines, le même ciel, mais pas les mêmes étoiles : voilà une inégalité entre territoires.');
    const vid = leaVideo.steps.find((s) => s.id === 'acte3-horizons')!.narration;
    expect(vid).toContain('Le même ciel, mais pas les mêmes étoiles : voilà une inégalité entre territoires.');
    // retour de l'équipe (10/11) : jamais de point entre « le même ciel » et « pas les mêmes étoiles » (silence trop long à l'oral)
    for (const t of [ecart, vid]) expect(t).not.toMatch(/même ciel\s*[.!?]/i);
    // le slogan n'est dit nulle part ailleurs, ni sur le site ni dans la vidéo ; seule exception, la phrase de fin de l'épilogue
    // validée par Nicolas le 11/11 à 16h50 (« Nous vivons tous sous le même ciel. »), sans « pas les mêmes étoiles »
    const FIN = 'Nous vivons tous sous le même ciel.';
    for (const script of [lea, leaVideo]) {
      expect(script.steps.find((x) => x.id === 'epilogue')!.narration, script.id).toContain(FIN);
      for (const s of script.steps.filter((x) => x.id !== 'acte3-horizons')) expect(s.narration.replace(FIN, ''), `${script.id} : ${s.id}`).not.toMatch(/même ciel|pas les mêmes étoiles/i);
    }
    // aucun lien entre revenus (niveau de vie, pauvreté) et accès : ni dans les textes, ni dans l'étape qui parle du niveau de vie
    const haloText = lea.steps.find((s) => s.id === 'halo')!.narration;
    for (const script of [lea, leaVideo, buildLea('gain', defaultOptions('gain'), { halo: true })]) {
      for (const s of script.steps) {
        expect(s.narration, s.id).not.toMatch(/plus riches?|moins riches?|plus pauvres?|moins pauvres?|aisé|défavoris|favoris|\brevenus?\b/i);
        expect(s.narration, s.id).not.toMatch(/parce que|à cause|en raison|explique|donc|c’est pourquoi/i);
      }
    }
    expect(haloText).not.toMatch(/étoile|accès|accessib|portée/i);
    expect(haloText).toContain('Ce halo décrit qui y vit, pas ce que chacun peut atteindre.');
    expect(haloText, 'ancienne garde (une seule commune)').not.toContain('qui vit ici');
    expect(ecart).not.toMatch(/niveau de vie|revenu|pauvre|riche/i);
    expect(vid).not.toMatch(/niveau de vie|revenu|pauvre|riche/i);
    // retour de Sandra (10/11) : la voisine est vue avec les mêmes critères que Léa, dit sur le site et dans la vidéo
    for (const t of [ecart, vid]) expect(t).toContain('avec les mêmes réglages');
    // 11/11 : le site dit ce que sont ces réglages (seule la commune change à cette étape)
    expect(ecart).toContain('même journée, même temps de trajet, mêmes transports en commun');
  });
  it('vélo : le mot « voiture » reste entendu dans le site ET dans la vidéo', () => {
    for (const script of [lea, leaVideo]) {
      for (const s of script.steps) expect(s.narration, `${script.id} : ${s.id} (espaces doubles)`).not.toMatch(/ {2,}/);
      const velo = script.steps.find((s) => s.id === 'acte4-velo')!.narration;
      expect(velo, script.id).toMatch(/s’élargit, sans prendre la voiture\.$/);
    }
    // 11/11 (§ 0.11) : l'étape des moyens de transport, remise dans la courte, en est retirée de nouveau après la mesure
    // (measure-record.mjs : 189 s avec elle, au-dessus des 175 s visés) ; « voiture » reste entendu à l'étape du vélo
    expect(leaVideo.steps.map((s) => s.id)).not.toContain('acte4-moyens');
  });
  it('vocabulaire D-025 : jamais « budget » à l’oral', () => {
    for (const script of [...playable(), buildLea('gain', ALL), leaVideo]) {
      for (const step of script.steps) expect(step.narration.replace(/[{][\w.]+[}]/g, ''), step.id).not.toMatch(/budget/i);
    }
  });
});

describe.skipIf(!hasData)('script de Léa (données réelles, D-020)', () => {
  it('variante par défaut : résolution complète, constantes vérifiées', () => {
    const { tour, missing } = resolveTour(lea, sources());
    expect(missing).toEqual([]);
    const text = Object.fromEntries(tour.steps.map((s) => [s.id, s.text]));
    expect(text.prologue).toMatch(/^C’est l’aube\. Maisons-Laffitte dort encore, ou presque\. Les mêmes étoiles, pour (plus de )?\d+ millions? d’habitants d’Île-de-France\. Mais pas toutes à portée de main\. /);
    expect(text.prologue).toMatch(/Voici Léa, une habitante imaginaire, sous un ciel bien réel\. Léa cherche un emploi\. Elle n’a pas de voiture, mais un vélo, pour plus tard\. D’abord, seulement les transports en commun : quels emplois peut-elle rejoindre \? Et qu’est-ce qui pourrait élargir son horizon \?$/);
    expect(text['acte1-ciel']).toMatch(/^Léa se donne 60 minutes de transports en commun, à l’aller comme au retour\./);
    expect(text['acte1-ciel']).toMatch(
      /\d+ étoiles s’allument, en partie ou en entier\. En partie : quand Léa n’atteint que certaines communes de l’étoile, à l’aller et au retour\. Au compteur : (près de |plus de )?.+ postes à sa portée, hors sa commune\.$/,
    );
    expect(text['acte1-ciel']).toContain('un bassin d’emploi, ou un arrondissement de Paris');
    expect(text['acte1-carte']).toBe('La carte s’ouvre : chaque étoile retrouve sa place. Le ciel de Léa part du cœur habité de Maisons-Laffitte : un point, pas une adresse. Les temps sont calculés de commune à commune.');
    expect(text['acte1-preuve']).toMatch(/^Dans le panneau de droite, la fiche de Paris 8e\. Voici un exemple de trajet : pour arriver avant le début de sa journée de travail, l’aller prend \d+ minutes\. /);
    // PR 51 : le retour compte l'attente depuis la fin du poste ; jamais « départ à 17 heures »
    expect(text['acte1-preuve']).toMatch(/À la fin de sa journée de travail, le retour prend \d+ minutes, attente comprise\./);
    expect(text['acte1-preuve']).toMatch(
      /D’après les flux domicile-travail du recensement, (près de |plus de |environ )?[\d\s]+ habitants de Maisons-Laffitte y travaillent déjà\. Ce sont des déplacements réellement constatés, pas des trajets calculés par STARWAY\.$/,
    );
    expect(text['acte3-horizons']).toMatch(
      /^L’écran se partage en deux\. À droite, celui de sa voisine, Montesson, avec les mêmes réglages : même journée, même temps de trajet, mêmes transports en commun\. À gauche, Maisons-Laffitte : (une étoile|\d+ étoiles)\. À droite, seulement (une étoile|\d+ étoiles)\. En haut de son ciel : (près de |plus de )?.+ postes à sa portée\. Deux voisines, le même ciel, mais pas les mêmes étoiles : voilà une inégalité entre territoires\.$/,
    );
    expect(text['acte2-eclipse']).toBe(
      'Passons au soir : un poste de 14 heures à 22 heures. Un restaurant le propose à Léa, comme aide de cuisine. ' +
        'Les transports répondent-ils aux besoins du monde du travail, même avec des horaires décalés ? Même point de départ, même temps de trajet. ' +
        'Le ciel est recalculé : l’aller doit arriver avant 14 heures, et le retour compte à partir de la fin du poste. Une journée-type est un scénario, pas un horaire réel.',
    );
    expect(text['acte2-pole']).toMatch(
      /^Dans le panneau de droite, la fiche de Seine-Aval\. Dans la liste des communes du pôle, la ligne de Poissy\. L’aller prend \d+ minutes\. Le retour en prend \d+, attente comprise\. Poissy reste à sa portée, même le soir\. Ces temps ont été recoupés avec le calculateur d’Île-de-France Mobilités\.$/,
    );
    // 06/11 (recoupement Navitia) : plus de bus de remplacement, plus de « étoiles de moins » : ni l'un ni l'autre ne sont confirmés
    for (const s of tour.steps) expect(s.text, s.id).not.toMatch(/remplacement|bus du RER|étoiles? de moins|se voile/i);
    // « recoupés », jamais « validés » (Navitia est un contrôle, pas une vérité terrain : FAQ 18)
    for (const s of tour.steps) expect(s.text, s.id).not.toMatch(/validé/i);
    expect(text['acte4-voiture']).toMatch(
      /^Et si Léa avait une voiture \? Avec le trafic moyen estimé à l’aller, \d+ étoiles s’allumeraient\. Une estimation, à partir du trafic moyen mesuré par la direction des routes d’Île-de-France\. (Près de |Plus de )?.+ postes seraient à sa portée\. Mais Léa n’a pas de voiture\.$/,
    );
    // la phrase dit « estimé à l'aller » : l'indice DiRIF vaut pour l'aller de 14h, pas pour le retour de 22h (route vide)
    expect(meta!.car_congestion!.day_types.d14).toMatchObject({ out: expect.any(String), ret: null });
    for (const s of tour.steps) expect(s.text, s.id).not.toMatch(/…|null|undefined|NaN/);
  });
  it('ciel à 44 astres (05/11) : l’astre suivi existe, aucun reste de l’ancien ciel dans les textes', () => {
    const { tour } = resolveTour(lea, sources());
    expect(dataset!.poles).toHaveLength(44);
    for (const id of new Set([...lea.steps.map((s) => s.focusPole), ...lea.steps.map((s) => s.state.pole)].filter((x): x is string => !!x)))
      expect(dataset!.poles.some((p) => p.id === id), id).toBe(true);
    expect(lea.steps.every((s) => !JSON.stringify(s).includes('P_'))).toBe(true);
    for (const s of tour.steps) {
      expect(s.text, s.id).not.toMatch(/15 pôles|sur 15\b|quartier central/i);
      expect(s.text, s.id).not.toMatch(/\d[\d\s,]*\s?%\s+des postes/);
    }
  });
  it('halo à deux communes : les deux médianes viennent de context/{insee}.json (SOC01), aucune écrite dans le script', () => {
    const { tour, missing } = resolveTour(lea, sources());
    expect(missing).toEqual([]);
    const halo = tour.steps.find((s) => s.id === 'halo')!;
    const incomeOf = (insee: string) => readJson<ContextFile>(`context/${insee}.json`)!.income!.median_living_standard_eur!;
    const oral = (n: number) => `${formatInt(Math.max(100, Math.round(n / 100) * 100))} euros`;
    expect(halo.text).toBe(
      `Le halo s’ouvre : derrière chaque commune, des habitants. D’après l’INSEE, le niveau de vie médian est d’environ ${oral(incomeOf('78358'))} par an à Maisons-Laffitte. Il est d’environ ${oral(incomeOf('78418'))} à Montesson. Ce halo décrit qui y vit, pas ce que chacun peut atteindre.`,
    );
    // sans le fichier de la commune de comparaison, la résolution s'arrête (rien n'est inventé)
    const broken = resolveTour(lea, { ...sources(), context: (insee: string) => (insee === '78418' ? null : readJson<ContextFile>(`context/${insee}.json`)) });
    expect(broken.missing.find((m) => m.step === 'halo')!.variables).toEqual(expect.arrayContaining(['halo.compareIncomeMedianOral', 'halo.compareCase=null (attendu deux_medianes)']));
  });
  it('acte 4 : le vélo jusqu’à la gare élargit le périmètre, sans nombre d’étoiles en or ni de postes (06/11 16h30), sans étoile filante', () => {
    const { tour } = resolveTour(lea, sources());
    const velo = tour.steps.find((s) => s.id === 'acte4-velo')!;
    expect(velo.text).toBe(
      'Alors, une solution complémentaire : son vélo jusqu’à la gare, puis les transports en commun. Sans compter le temps pour le garer, son périmètre de recherche d’emploi s’élargit, sans prendre la voiture.',
    );
    expect(velo.text).not.toMatch(/\d|postes|étoile|en or/);
    expect(velo.focusPole).toBeUndefined();
    expect(tour.steps.find((s) => s.id === 'epilogue')!.text).toMatch(/Chaque chiffre renvoie à sa source\. À vous d’explorer : votre commune, votre heure, votre temps de trajet\. Nous vivons tous sous le même ciel\. À vous, maintenant, de découvrir vos étoiles\.$/);
  });
  it('variantes jouables aujourd’hui : résolues sans trou', () => {
    // buildLea('sans_gain') est exclue : les données montrent un gain, son contrôle doit l'arrêter
    for (const script of playable().filter((x) => x.steps.every((s) => s.checks?.['gain.case'] !== 'sans_gain')))
      expect(resolveTour(script, sources()).missing, script.steps.map((s) => s.id).join(',')).toEqual([]);
    expect(resolveTour(buildLea('sans_gain'), sources()).missing).toEqual([{ step: 'acte4-velo', variables: ['gain.case=gain (attendu sans_gain)'] }]);
  });
  it('étape BMO (jouée sur le site depuis le 06/11) : bassin de l’astre suivi, chiffre de la FAMILLE de métiers du panneau, année', () => {
    const { tour, missing } = resolveTour(lea, sources());
    expect(missing).toEqual([]);
    const bmo = tour.steps.find((s) => s.id === 'acte2-recrutement')!;
    expect(bmo.text).toMatch(
      /^À droite, plus bas : les projets de recrutement\. Léa vise un poste d’aide de cuisine\. Dans le bassin d’emploi T1 Paris, qui couvre tout Paris, les employeurs en prévoient (près de |plus de |au moins )?[\d\s]+ dans sa famille de métiers : les fonctions liées à la vente, au tourisme et aux services\. Ce sont les recrutements prévus pour 2026, d’après l’enquête BMO de France Travail\. Ces projets sont déclarés par les employeurs\.$/,
    );
    // Le chiffre vaut pour le bassin, jamais pour un seul arrondissement ; « qui couvre tout Paris » : tous les arrondissements portent ce bassin, et lui seul
    expect(bmo.text).not.toMatch(/Paris 8e/);
    const parisBassin = dataset!.poles.find((p) => p.id === 'BE_1107_75108')!.bassin!.code;
    const arrondissements = dataset!.poles.filter((p) => p.name_short_insee?.startsWith('751'));
    expect(new Set(arrondissements.map((p) => p.bassin!.code))).toEqual(new Set([parisBassin]));
    expect(dataset!.poles.filter((p) => p.bassin!.code === parisBassin)).toHaveLength(arrondissements.length);
    expect(bmo.text).toContain('les recrutements prévus pour');
    // le chiffre dit est celui de la ligne de la famille dans la liste du panneau (bmo.json), jamais celui du métier (bmo_metiers.json)
    const file = readJson<BmoFile>('bmo.json')!;
    const code = dataset!.poles.find((p) => p.id === 'BE_1107_75108')!.bassin!.code;
    const cell = file.bassins[code]!.families[LEA_PROFILE.bmoFamily]!.met;
    expect(bmo.text).toContain(metierProjectsOral(cell)!);
    const metier = readJson<BmoMetiersFile>('bmo_metiers.json')!.bassins[code]![LEA_PROFILE.bmoMetier]![0];
    if (metier != null && metier !== cell.n) expect(bmo.text, 'le chiffre du métier n’est pas dit').not.toContain(formatInt(metier));
    // la carte reste jouée avec l'étape BMO (décision du 04/11), et l'astre suivi ne change pas
    expect(tour.steps.map((s) => s.id)).toContain('acte1-carte');
    expect(lea.steps.find((s) => s.id === 'acte2-recrutement')).toMatchObject({ proofFocus: 'recruit', state: {} });
    expect(lea.steps.find((s) => s.id === 'acte4-moyens')).toMatchObject({ state: {} });
  });
  it('étape BMO : sans fichier publié ou sans bassin, la résolution s’arrête (rien n’est inventé)', () => {
    const script = buildLea('gain', { ...NONE, voiture: true, bmo: true });
    for (const broken of [{ bmoMetiers: null }, { bmo: null }]) {
      const { missing } = resolveTour(script, { ...sources(), ...broken });
      expect(missing.map((m) => m.step)).toEqual(['acte2-recrutement']);
      expect(missing[0]!.variables).toEqual(expect.arrayContaining(['bmo.familyProjectsOral', 'bmo.familyOral', `bmo.familyCase=null (attendu ${LEA_PROFILE.bmoFamily})`]));
    }
  });
  it('une constante de variante fausse arrête la résolution', () => {
    const script = buildLea('retire', NONE);
    const bad = { ...script, steps: script.steps.map((s) => (s.id === 'acte2-pole' ? { ...s, checks: { 'anchor.verdictCase': 'aller_oui_retour_non' } } : s)) };
    const { missing } = resolveTour(bad, sources());
    expect(missing).toEqual([{ step: 'acte2-pole', variables: ['anchor.verdictCase=allume (attendu aller_oui_retour_non)'] }]);
  });
  it('checkVariables : variable inconnue = écart', () => {
    expect(checkVariables({ 'x.inconnue': 'a' }, {} as NarrationContext)).toEqual(['x.inconnue=null (attendu a)']);
    expect(checkVariables(undefined, {} as NarrationContext)).toEqual([]);
  });
  it('visite complète « tout bien expliqué » (11/11, § 0.11) : 640 à 720 mots résolus', () => {
    const { tour } = resolveTour(lea, sources());
    const total = tour.steps.reduce((n, s) => n + words(s.text), 0);
    // Cible de Nicolas : environ 5 min 25 AVEC les transitions (plan final § 6). Estimation : 13 étapes, environ 70 s hors voix
    // (révélation 9 s, transitions de 2 à 6 s et pause de 0,9 s par étape, vol de la carte, générique 5 s : mesure du 06/11,
    // storyboard § 0.5 bis), voix r8 à 2,8 mots par seconde (499 mots en 179 s le 11/11) : 640 à 720 mots, soit 4 min 59 à
    // 5 min 27 en tout. À confirmer par measure-record.mjs après la voix.
    expect(total).toBeGreaterThanOrEqual(640);
    // 12/11 : +2 mots (« Voici un exemple de trajet », « qui s’allume … selon ses conditions », retours de Cyril et de Nicolas) : plafond à 730
    expect(total).toBeLessThanOrEqual(730);
  });
});

describe('vidéo du dépôt (lea-video) : textes courts réservés à l’enregistrement, mêmes étapes que le site', () => {
  const video = leaVideo;
  /** Étapes du site retirées de la courte seulement (carte : vol de caméra de 11 s ; halo : 13 s, mesure du 06/11) ; BMO : le site seulement. Moyens de transport : remis le 11/11 (§ 0.11) */
  const RETIRED = ['acte1-carte', 'halo', 'acte2-recrutement', 'acte4-moyens'];
  const said = (s: { steps: readonly { narration: string }[] }) => s.steps.map((x) => x.narration);
  /** Nombres d'un texte résolu (« 2,6 », « 87 000 », « 8 » de « Paris 8e ») */
  const numbers = (t: string) => t.match(/\d[\d\s,]*\d|\d/g) ?? [];
  it('mêmes étapes (sauf la carte et le halo, retirés de la vidéo seulement), mêmes états, contrôles et variables que le site ; seuls les mots changent', () => {
    expect(video.id).toBe('lea-video');
    expect(video.steps.map((s) => s.id)).toEqual(lea.steps.map((s) => s.id).filter((id) => !RETIRED.includes(id)));
    for (const s of video.steps) {
      const site = lea.steps.find((x) => x.id === s.id)!;
      // Les repères visuels (`marks`) suivent les mots de chaque version : comparés par marks.test.ts, pas ici
      expect({ ...s, narration: '', minDurationMs: 0, marks: [] }).toEqual({ ...site, narration: '', minDurationMs: 0, marks: [] });
      expect(s.minDurationMs ?? 0).toBeLessThanOrEqual(site.minDurationMs ?? 0);
      for (const name of namesOf(s)) expect(VARIABLES[name], `${s.id} : ${name}`).toBeTypeOf('function');
    }
    // le site garde toutes ses étapes
    expect(lea.steps.map((s) => s.id)).toEqual(expect.arrayContaining(RETIRED));
    expect(said(video)).not.toEqual(said(lea));
  });
  it('l’étape BMO n’est jamais dans la vidéo (décision de Nicolas du 06/11)', () => {
    expect(video.steps.map((s) => s.id)).not.toContain('acte2-recrutement');
    expect(() => buildLea('gain', defaultOptions('gain'), { bmo: true })).toThrow(/BMO/);
    expect(buildLea('gain', defaultOptions('gain'), true).steps.map((s) => s.id)).not.toContain('acte2-recrutement');
  });
  it('mêmes corrections que le site (plan final § 6) : vélo, aller et retour, point de départ', () => {
    const text = (id: string) => video.steps.find((s) => s.id === id)!.narration;
    expect(text('acte4-velo'), 'une seule phrase pour le site et la vidéo').toBe(lea.steps.find((s) => s.id === 'acte4-velo')!.narration);
    expect(text('acte4-velo')).toContain('Sans compter le temps pour le garer');
    expect(text('acte1-ciel')).toContain('à l’aller comme au retour');
    expect(text('acte2-eclipse')).toContain('Même point de départ');
    expect(text('acte2-eclipse')).toContain('aller et retour');
    // 11/11 : l'aller ET le retour de Paris 8e, « à la fin du poste » et « attente comprise » (PR 51)
    expect(text('acte1-preuve')).toContain('{trip.out}');
    expect(text('acte1-preuve')).toContain('À la fin de sa journée de travail, le retour en prend {trip.ret}, attente comprise.');
  });
  it('les textes courts tiennent les mêmes règles que le site : aucun chiffre écrit, aucun tiret long, vocabulaire de Cyril', () => {
    for (const step of video.steps) {
      const literal = step.narration.replace(/\{[\w.]+\}/g, '');
      expect(literal, step.id).not.toMatch(/\d/);
      expect(step.narration, step.id).not.toMatch(new RegExp('[\\u2013\\u2014]'));
      expect(step.narration, step.id).not.toMatch(/\bmodes?\b/i);
      expect(step.narration, step.id).not.toMatch(/\ble carbone\b/i);
      expect(literal, step.id).not.toMatch(/budget|offres? d.emploi|emplois disponibles|postes vacants|opportunités|remplacement/i);
    }
    const all = said(video).join(' ');
    // 11/11 17h (retour de Cyril, validé par Nicolas) : la première et seule mention dit « postes salariés recensés par l'INSEE »
    for (const w of ['postes salariés recensés par l’INSEE', 'flux domicile-travail', 'solution complémentaire', 'périmètre de recherche d’emploi', 'voiture'])
      expect(all, w).toContain(w);
    // l'étape des moyens de transport (retour de Cyril) : retirée de la courte après la mesure du 11/11 (189 s avec elle) ;
    // son texte court reste prêt si on la remet
    expect(video.steps.map((s) => s.id)).not.toContain('acte4-moyens');
    const withMoyens = buildLea('gain', defaultOptions('gain'), { moyens: true });
    expect(withMoyens.steps.find((s) => s.id === 'acte4-moyens')!.narration).toBe(VIDEO_MOYENS);
    // toute étape de la courte qui a un texte court ne ramène jamais le texte long du site
    const all3 = buildLea('gain', defaultOptions('gain'), { carte: true, halo: true, moyens: true });
    for (const id of [...RETIRED.filter((x) => x !== 'acte2-recrutement'), 'acte4-moyens']) {
      const s = all3.steps.find((x) => x.id === id)!;
      expect(s.narration, id).not.toBe(lea.steps.find((x) => x.id === id)!.narration);
      expect(s.narration.length, id).toBeLessThan(lea.steps.find((x) => x.id === id)!.narration.length);
    }
    expect(VIDEO_MOYENS).toContain('les moyens de transport');
    expect(VIDEO_MOYENS).toContain('les émissions carbone');
    expect(VIDEO_MOYENS).toContain('les lignes déclarées climatisées');
  });
  it('texte nettement plus court que celui du site (3 minutes au plus, sans dérogation : brief page 15)', () => {
    const size = (s: { steps: readonly { narration: string }[] }) => s.steps.reduce((n, x) => n + x.narration.replace(/\{[\w.]+\}/g, 'XXXXXXXX').length, 0);
    expect(size(video)).toBeLessThan(size(lea) * 0.6);
  });
  it('la voix guide l’œil (10/11) : chaque compteur cité dit où il est ; Léa est dite imaginaire au début et à la fin', () => {
    for (const s of video.steps) {
      // le compteur de la commune de départ est à droite de la barre du bas (ScenarioBar, grille « … counter toggle »)
      // 12/11 : « Au compteur, … » nomme l'élément (le repère l'entoure) : accepté à la place de « en bas à droite »
      // 12/11 (soir) : l'étape de la voiture dit seulement « Plus de N postes seraient à sa portée » (plus de « en bas à droite », décision de Nicolas)
      if (/\{access\.jobs(Oral|Count)\}/.test(s.narration)) expect(s.narration, s.id).toMatch(/en bas à droite|au compteur|\{access\.jobsOralCap\} seraient à sa portée/i);
      // les postes de la voisine ne se lisent pas sur le compteur du bas (il reste celui de la commune A en diptyque) : non cités
      expect(s.narration, s.id).not.toContain('{compare.jobsOral}');
    }
    // la fiche du pôle est le panneau de droite (ProofPanel), le ciel de la voisine est la moitié droite du diptyque ;
    // 11/11 16h50 (retour de Cyril) : « Dans le panneau de droite, la fiche de … » lève l'ambiguïté de « À droite »
    for (const id of ['acte1-preuve', 'acte2-pole', 'acte3-horizons']) expect(video.steps.find((s) => s.id === id)!.narration, id).toMatch(/à droite|panneau de droite/i);
    for (const id of ['acte1-preuve', 'acte2-pole']) expect(video.steps.find((s) => s.id === id)!.narration, id).toMatch(/^Dans le panneau de droite, la fiche de /);
    expect(video.steps[0]!.narration).toMatch(/imaginaire/);
    expect(video.steps[video.steps.length - 1]!.narration).toMatch(/imaginaire/);
  });
  it.skipIf(!hasData)('résolue sur les vraies données, sans trou, mêmes nombres que le site', () => {
    const { tour, missing } = resolveTour(video, sources());
    expect(missing).toEqual([]);
    const site = Object.fromEntries(resolveTour(lea, sources()).tour.steps.map((s) => [s.id, s.text]));
    const text = Object.fromEntries(tour.steps.map((s) => [s.id, s.text]));
    // le nombre d'étoiles allumées, de minutes et de postes dits dans la vidéo sont ceux du site (ordre et valeur)
    for (const id of ['acte1-ciel', 'acte1-preuve', 'acte3-horizons', 'acte2-eclipse', 'acte2-pole', 'acte4-voiture', 'acte4-velo'])
      for (const n of numbers(text[id]!)) expect(site[id], `${id} : ${n}`).toContain(n);
  });
  it.skipIf(!hasData)('facile à suivre et environ 3 min avec les transitions (11/11) : 295 à 340 mots résolus, au plus un chiffre par phrase', () => {
    const { tour } = resolveTour(video, sources());
    const total = tour.steps.reduce((n, s) => n + words(s.text), 0);
    // Cible de Nicolas (11/11, § 0.11) : 2 min 40 à 2 min 55 AVEC les transitions. Estimation : 10 étapes, environ 54 s hors voix
    // (révélation 9 s, environ 4 s de transition et de pause par étape, générique 5 s : mesure du 06/11, storyboard § 0.5 bis),
    // voix r8 à 2,8 mots par seconde (253 mots en 89,3 s le 11/11) : 295 à 335 mots, soit 2 min 39 à 2 min 54 en tout.
    // À confirmer par measure-record.mjs après la voix ; au-dessus de 2 min 55, retirer de nouveau les moyens de transport.
    expect(total).toBeGreaterThanOrEqual(295);
    // 11/11 17h50 : textes validés de 16h50 et 17h, 9 étapes (moyens de transport retirés), 336 mots ; measure-record.mjs :
    // 179 et 182 s avec les transitions (rendu logiciel). Plafond relevé à 340 mots : au-delà, la courte dépasse 3 min.
    // 12/11 : +11 mots (durées de l’exemple de trajet dites par la voix, phrase des étoiles de Cyril) : plafond à 350 ; la durée avec les
    // transitions (jamais au-dessus de 3 min) est vérifiée par measure-record.mjs, pas par ce compte de mots.
    expect(total).toBeLessThanOrEqual(350);
    for (const s of tour.steps) {
      for (const sentence of s.text.split(/(?<=[.!?])\s+/)) {
        // une plage horaire (« de 14 heures à 22 heures ») est UN repère : la journée-type
        const n = numbers(sentence.replace(/de \d+ heures( \d+)? à \d+ heures( \d+)?/g, 'de H'));
        expect(n.length, `${s.id} : « ${sentence} »`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('repères de la visite : datables sur la voix (11/11)', () => {
  // check-tour-sync.mjs date un repère sur un silence du MP3 : début d'une phrase, ou ponctuation suivie d'une vraie pause.
  // Un fragment au milieu d'une proposition (« seulement {compare.stars} », « son périmètre de recherche ») ne se date pas :
  // le repère s'allumerait au prorata, hors du mot dit. La présence du silence se vérifie sur les MP3 :
  // `node scripts/check-tour-sync.mjs --static both`.
  it.each([
    ['lea', lea],
    ['lea-video', leaVideo],
  ] as const)('%s : chaque repère commence le texte, une phrase ou suit une ponctuation', (_id, tour) => {
    for (const s of tour.steps) {
      for (const m of s.marks ?? []) {
        const at = s.narration.indexOf(m.at);
        expect(at, `${s.id} : « ${m.at} » introuvable`).toBeGreaterThanOrEqual(0);
        const before = s.narration.slice(0, at).trimEnd();
        expect(before === '' || /[.!?…,;:]$/.test(before), `${s.id} : « ${m.at} » au milieu d'une proposition`).toBe(true);
      }
    }
  });

  it('les quatre repères déplacés le 11/11 sont au début de leur proposition', () => {
    const marksOf = (tour: typeof lea, id: string) => tour.steps.find((s) => s.id === id)?.marks?.map((m) => m.at) ?? [];
    expect(marksOf(leaVideo, 'acte3-horizons')).toContain('on y voit s’allumer');
    for (const tour of [lea, leaVideo]) {
      expect(marksOf(tour, 'acte4-velo')).toContain('Sans compter le temps');
      expect(marksOf(tour, 'acte4-velo')).not.toContain('son périmètre de recherche');
    }
    expect(marksOf(lea, 'epilogue')).toContain('Léa est imaginaire');
  });

  it('11/11 (§ 0.11) : chaque étape changée ou ajoutée porte ses repères, sur les mots qui disent où regarder', () => {
    const marksOf = (tour: typeof lea, id: string) => tour.steps.find((s) => s.id === id)?.marks?.map((m) => m.at) ?? [];
    expect(marksOf(buildLea('gain', defaultOptions('gain'), { moyens: true }), 'acte4-moyens')).toEqual(['À droite, Léa peut comparer', 'les émissions carbone', 'Et les lignes déclarées climatisées']);
    expect(marksOf(leaVideo, 'acte1-preuve')).toContain('Voici un exemple de trajet');
    expect(marksOf(lea, 'acte3-horizons')).toEqual(['À droite, celui de sa voisine', 'À gauche, {origin.oralName}', 'À droite, seulement', 'En haut de son ciel', 'Deux voisines']);
    expect(marksOf(lea, 'halo')).toEqual(['Le halo s’ouvre']);
    expect(marksOf(lea, 'acte2-recrutement')).toEqual(['À droite, plus bas', 'les projets de recrutement']);
  });
});
