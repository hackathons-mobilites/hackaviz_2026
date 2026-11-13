import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ResolvedTour } from './resolve';
import { TOURS } from './registry';
import { checkVoice, voiceReportLines, type VoiceFiles } from './voiceCheck';

/**
 * VOIX DE LA VISITE, fichiers réels (05/11, demande de Nicolas) : dès qu'UNE étape a sa voix enregistrée, ce test ÉCHOUE
 * s'il manque un MP3 ou un WebVTT pour UNE SEULE étape de la visite jouée sur le site, ou si les sous-titres ne disent
 * pas le texte de la voix ou la dépassent. Pas de repli sur la voix du navigateur, pas de voix partielle.
 *
 * Tant qu'AUCUNE étape n'a de voix (état du 07/11 : textes refaits sur les 44 astres, voix pas encore régénérée ; décision de Nicolas du
 * 07/11 : la PR de la visite se fusionne SANS la voix complète, qui attend la publication du nouveau calcul), la visite se joue en
 * sous-titres seuls et ce contrôle n'a rien à vérifier : le contrôle STRICT reste `npm run tour:voice lea`, qui échoue tant que
 * la voix manque (il ne fait pas partie des contrôles de la PR). Les anciens MP3 de la v3 ne sont jamais lus : `staleVoice.test.ts`.
 */
const dir = fileURLToPath(new URL('../../public/tour/lea/', import.meta.url));
const real: VoiceFiles = {
  read: (name) => (existsSync(dir + name) ? new Uint8Array(readFileSync(dir + name)) : null),
  list: () => (existsSync(dir) ? readdirSync(dir) : []),
};

describe('voix de la visite « lea » : un MP3 et un WebVTT par étape, sans repli', () => {
  const resolved = JSON.parse(readFileSync(dir + 'tour.resolved.json', 'utf-8')) as ResolvedTour;
  const recorded = resolved.steps.some((s) => s.durationMs != null);

  it('tour.resolved.json décrit les étapes de la visite jouée (mêmes identifiants, même ordre)', () => {
    expect(resolved.steps.map((s) => s.id)).toEqual(TOURS.lea!.steps.map((s) => s.id));
  });
  it('sans voix enregistrée : aucune étape n’annonce de durée audio (sous-titres seuls, jamais une voix périmée)', () => {
    if (recorded) return;
    expect(resolved.steps.filter((s) => s.durationMs != null)).toEqual([]);
  });
  it.skipIf(!recorded)('chaque étape : MP3, WebVTT du même texte, durées d’accord (npm run tour:voice lea pour le détail)', () => {
    const report = checkVoice(resolved, real);
    expect(report.ok, `\n${voiceReportLines(report).join('\n')}\n`).toBe(true);
  });
});
