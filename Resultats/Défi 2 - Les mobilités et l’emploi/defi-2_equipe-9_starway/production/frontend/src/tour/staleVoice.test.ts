import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ResolvedTour } from './resolve';
import { buildLea, defaultOptions } from './tours/lea.tour';
import { TOURS } from './registry';
import { parseVtt, stepAudio, stepFileStem } from './vtt';

/**
 * VOIX PÉRIMÉE ET ANCIENS TEXTES (07/11, décision de Nicolas : la PR de la visite se fusionne SANS la voix complète).
 *
 * Les MP3 et WebVTT de `public/tour/lea/` datent de la v3 (03/11) : ils disent d'anciens textes. Ils restent dans le dépôt (la voix sera
 * régénérée plus tard) mais ne doivent JAMAIS être lus. Le garde-fou est dans `stepAudio` (vtt.ts) : un MP3 n'est servi que si le
 * manifeste `tour.resolved.json` annonce un `durationMs` pour CETTE étape, avec le MÊME identifiant et le MÊME texte (contrôle par texte
 * résolu, `tools/tour-tts` ne l'écrit qu'après avoir écrit le MP3 de ce texte). Ces tests le vérifient sur les fichiers réels.
 * Aucune valeur de transports n'est écrite ici comme attendue : les nombres viennent des textes résolus (données publiées).
 */
const base = '/tour/';
const dirOf = (id: string) => fileURLToPath(new URL(`../../public/tour/${id}/`, import.meta.url));
const resolvedOf = (id: string) => JSON.parse(readFileSync(dirOf(id) + 'tour.resolved.json', 'utf-8')) as ResolvedTour;

describe.each(['lea', 'lea-video'])('visite « %s » : aucune voix périmée n’est jamais servie', (id) => {
  const resolved = resolvedOf(id);
  const dir = dirOf(id);

  it('un audio n’est servi que pour une étape dont le manifeste annonce un durationMs, et son MP3 existe alors sous son nom actuel', () => {
    resolved.steps.forEach((s, i) => {
      const a = stepAudio(resolved, i, s.id, s.text, `${base}${id}/`);
      expect(a !== null, `${id} étape ${i + 1} ${s.id}`).toBe(typeof s.durationMs === 'number' && s.durationMs > 0);
      if (a) expect(existsSync(`${dir}${stepFileStem(i, s.id)}.mp3`), `${a.mp3} existe`).toBe(true);
    });
  });

  it('un ancien texte, même associé à un durationMs, ne sert jamais d’audio (identifiant ou texte différent)', () => {
    // manifeste « truqué » : toutes les étapes annoncent une durée, comme si la voix v3 était encore valable
    const forged: ResolvedTour = { ...resolved, steps: resolved.steps.map((s) => ({ ...s, durationMs: 10_000 })) };
    resolved.steps.forEach((s, i) => {
      expect(stepAudio(forged, i, s.id, 'Pas le même horizon. Ancien texte de la v3.', `${base}${id}/`), `${s.id} : texte différent`).toBeNull();
      expect(stepAudio(forged, i, 'acte9-ancien', s.text, `${base}${id}/`), `${s.id} : identifiant différent`).toBeNull();
    });
    // les anciens .vtt du dépôt (v3) : le texte qu'ils portent n'est jamais celui d'une étape résolue d'aujourd'hui, sauf s'il est identique
    for (const f of existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.vtt')) : []) {
      const m = /^(\d{2})-(.+)\.vtt$/.exec(f)!;
      const index = Number(m[1]) - 1;
      const parsed = parseVtt(readFileSync(dir + f, 'utf-8'));
      const old = parsed?.cues.map((c) => c.text).join(' ') ?? '';
      const step = resolved.steps[index];
      const served = step ? stepAudio(forged, index, m[2]!, old, `${base}${id}/`) : null;
      // servi seulement si l'étape a le même identifiant ET exactement ce texte (alors la voix dit bien ce qui s'affiche)
      expect(served === null || (step!.id === m[2] && step!.text === old), `${f} : ancien sous-titre servi pour un autre texte`).toBe(true);
    }
  });
});

describe('anciens textes de la visite : aucun ne revient', () => {
  /** Phrases sans valeur de transports (jamais permises, ni dans un modèle de texte ni dans un texte résolu) */
  const STALE = [
    'Pas le même horizon',
    'Ce halo décrit qui vit ici',
    'bus de remplacement',
    'bus du RER A',
    'retour de 76',
    'regagne',
    'étoiles de moins',
    'offres d’emploi',
    "offres d'emploi",
    'emplois disponibles',
    'postes vacants',
  ];
  const templates = [
    TOURS.lea!,
    TOURS['lea-video']!,
    buildLea('gain', { ...defaultOptions('gain'), cout: true }),
    buildLea('gain', defaultOptions('gain'), { halo: true, moyens: true, carte: true }),
  ].flatMap((s) => s.steps.map((x) => ({ where: `${s.id} : ${x.id}`, text: x.narration })));
  const resolvedTexts = ['lea', 'lea-video'].flatMap((id) => resolvedOf(id).steps.map((s) => ({ where: `${id} résolu : ${s.id}`, text: s.text })));

  it.each(STALE)('« %s » n’est dit nulle part (modèles de texte, textes résolus du site et de la vidéo)', (phrase) => {
    for (const t of [...templates, ...resolvedTexts]) expect(t.text.replace(/\s+/g, ' '), t.where).not.toContain(phrase);
  });

  it('anciennes valeurs de transports : jamais écrites dans un modèle ; dans un texte résolu, seulement si les données publiées les donnent', () => {
    // un modèle ne porte aucun chiffre (lea.test.ts) ; ici, les valeurs de l'ancien calcul ne reviennent pas d'une trace de la v3
    const OLD_VALUES = ['26 étoiles', '3,8 millions'];
    for (const t of templates) for (const v of OLD_VALUES) expect(t.text, t.where).not.toContain(v);
    // texte résolu : tolérée seulement si elle est celle des données publiées du jour, c'est-à-dire si le même texte résolu la dit
    // pour les DEUX variantes (site et vidéo) : une valeur périmée figée dans un seul des deux fichiers serait un reste
    for (const v of OLD_VALUES) {
      const inSite = resolvedTexts.some((t) => t.where.startsWith('lea résolu') && t.text.includes(v));
      const inVideo = resolvedTexts.some((t) => t.where.startsWith('lea-video résolu') && t.text.includes(v));
      expect(inSite, `${v} : dit dans le site seulement ou dans la vidéo seulement`).toBe(inVideo);
    }
  });
});
