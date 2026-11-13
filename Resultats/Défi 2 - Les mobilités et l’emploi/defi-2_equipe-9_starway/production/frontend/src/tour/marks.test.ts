import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isKnownTarget } from '../components/tourMarkTargets';
import { activeMark, cueOffsets, fragmentOffset, markTimeline, normalizeSpaces, offsetToMs, sentenceCues, type MarkCue } from './marks';
import type { ResolvedTour } from './resolve';
import { cueChunks, sentenceChunks } from './cues';
import { TOURS } from './registry';
import { stepFileStem, parseVtt } from './vtt';

describe('repères de la visite : fragment de texte → position dans le texte résolu', () => {
  const tpl = 'En transports en commun, {budget} minutes : {access.stars} s’allument. Soit {access.jobsOral}, hors sa commune.';
  const text = 'En transports en commun, 60 minutes : 24 étoiles s’allument. Soit près de 2,6 millions de postes, hors sa commune.';

  it('fragment littéral', () => {
    expect(fragmentOffset(tpl, text, 'Soit')).toBe(text.indexOf('Soit'));
  });
  it('fragment qui commence par une variable : position de sa valeur résolue', () => {
    expect(fragmentOffset(tpl, text, '{access.stars} s’allument')).toBe(text.indexOf('24 étoiles'));
    expect(fragmentOffset(tpl, text, '{budget} minutes')).toBe(text.indexOf('60 minutes'));
  });
  it('espaces insécables des nombres et retours à la ligne : sans effet', () => {
    const t2 = 'Depuis sa voisine, Montesson : une étoile, et plus de 87 000 postes. Le même ciel.';
    expect(fragmentOffset('Depuis sa voisine, {compare.oralName} : {compare.stars}, et {compare.jobsOral}. Le même ciel.', t2, 'Le même\nciel')).toBe(
      normalizeSpaces(t2).indexOf('Le même ciel'),
    );
  });
  it('fragment absent du texte de l’étape, ou texte d’une autre version : null', () => {
    expect(fragmentOffset(tpl, text, 'introuvable')).toBeNull();
    expect(fragmentOffset(tpl, 'Un tout autre texte.', 'Soit')).toBeNull();
  });
});

describe('repères de la visite : synchronisation avec les sous-titres WebVTT', () => {
  const text = 'En transports en commun, 60 minutes à l’aller comme au retour : 24 étoiles s’allument, en partie ou en entier. Soit près de 2,6 millions de postes, hors sa commune.';
  const cues: MarkCue[] = [
    { startMs: 8283, endMs: 14053, text: 'En transports en commun, 60 minutes à l’aller comme au retour : 24 étoiles' },
    { startMs: 14053, endMs: 16845, text: 's’allument, en partie ou en entier.' },
    { startMs: 16845, endMs: 20940, text: 'Soit près de 2,6 millions de postes, hors sa commune.' },
  ];

  it('chaque cue est retrouvée dans le texte, dans l’ordre', () => {
    expect(cueOffsets(text, cues)).toEqual([0, text.indexOf('s’allument'), text.indexOf('Soit')]);
  });
  it('un fragment qui ouvre une cue s’allume avec elle', () => {
    expect(offsetToMs(text.indexOf('Soit'), text, cues, 0)).toBe(16845);
    expect(offsetToMs(0, text, cues, 0)).toBe(8283);
  });
  it('dans une cue : au prorata de sa place (la voix y arrive plus tard), sans sortir de la cue', () => {
    const at = offsetToMs(text.indexOf('24 étoiles'), text, cues, 0);
    expect(at).toBeGreaterThan(8283 + (14053 - 8283) * 0.8);
    expect(at).toBeLessThan(14053);
  });
  it('sans cues (pas d’audio, sous-titres découpés) : au prorata de la durée de l’étape', () => {
    expect(offsetToMs(text.length / 2, text, null, 10000)).toBeCloseTo(5000, 0);
  });
  it('cues qui ne disent pas le texte (autre voix) : repli au prorata, jamais une erreur', () => {
    expect(offsetToMs(text.indexOf('Soit'), text, [{ startMs: 0, endMs: 1000, text: 'Autre chose' }], 10000)).toBeGreaterThan(0);
  });
  it('le repère dure jusqu’au suivant, puis jusqu’à la fin de l’étape ; `none` éteint ; rien avant le premier', () => {
    const tl = markTimeline(
      'En transports en commun, {budget} minutes à l’aller comme au retour : {access.stars} s’allument, en partie ou en entier. Soit {access.jobsOral}, hors sa commune.',
      text,
      [
        { at: 'Soit', target: 'counter' },
        { at: '{access.stars} s’allument', target: 'stars:lit' },
        { at: 'En partie', target: 'origin' },
        { at: 'hors sa commune', target: 'none' },
      ],
      cues,
      20940,
    );
    expect(tl.missing).toEqual(['En partie']);
    expect(tl.marks.map((m) => m.targets[0])).toEqual(['stars:lit', 'counter', 'none']);
    expect(activeMark(tl.marks, 1000)).toBeNull();
    expect(activeMark(tl.marks, 14000)?.targets).toEqual(['stars:lit']);
    expect(activeMark(tl.marks, 17000)?.targets).toEqual(['counter']);
    expect(activeMark(tl.marks, 60000)).toBeNull();
  });
});

describe('sous-titres par phrase, datés sur les cues WebVTT', () => {
  // VTT de test (forme de tools/tour-tts : coupure au mot, « comprise. » seul dans une cue)
  const text = 'Prenons Seine-Aval, autour de Poissy : 38 minutes à l’aller, 50 au retour, attente comprise. Poissy reste à sa portée, même le soir.';
  const vtt: MarkCue[] = [
    { startMs: 0, endMs: 7262, text: 'Prenons Seine-Aval, autour de Poissy : 38 minutes à l’aller, 50 au retour, attente' },
    { startMs: 7262, endMs: 8196, text: 'comprise.' },
    { startMs: 8196, endMs: 11516, text: 'Poissy reste à sa portée, même le soir.' },
  ];
  it('une phrase par sous-titre : « comprise. » n’est plus seul, chaque phrase part avec la voix', () => {
    // écran large (100 caractères en deux lignes) : la phrase entière
    const out = sentenceCues(text, sentenceChunks(text, 100), vtt)!;
    expect(out.map((c) => c.text)).toEqual([
      'Prenons Seine-Aval, autour de Poissy : 38 minutes à l’aller, 50 au retour, attente comprise.',
      'Poissy reste à sa portée, même le soir.',
    ]);
    expect(out.map((c) => c.startMs)).toEqual([0, 8196]);
    expect(out.at(-1)!.endMs).toBe(11516);
    // capacité de 84 caractères : la phrase de 93 caractères est coupée à la ponctuation la plus proche de son milieu
    expect(sentenceChunks(text)).toEqual([
      'Prenons Seine-Aval, autour de Poissy :',
      '38 minutes à l’aller, 50 au retour, attente comprise.',
      'Poissy reste à sa portée, même le soir.',
    ]);
  });
  it('une phrase par sous-titre, même courte : jamais deux phrases ensemble (le texte ne précède pas la voix)', () => {
    const t = 'Le même ciel. Pas les mêmes étoiles. C’est cela, une inégalité entre territoires.';
    const c: MarkCue[] = [
      { startMs: 0, endMs: 1500, text: 'Le même ciel.' },
      { startMs: 1500, endMs: 4100, text: 'Pas les mêmes étoiles.' },
      { startMs: 4100, endMs: 9500, text: 'C’est cela, une inégalité entre territoires.' },
    ];
    const out = sentenceCues(t, sentenceChunks(t, 40), c)!;
    // la 3e phrase (44 caractères) est coupée à sa virgule, jamais collée à une autre phrase
    expect(out.map((x) => x.text)).toEqual(['Le même ciel.', 'Pas les mêmes étoiles.', 'C’est cela,', 'une inégalité entre territoires.']);
    expect(out.slice(0, 3).map((x) => x.startMs)).toEqual([0, 1500, 4100]);
    expect(out[3]!.startMs).toBeGreaterThan(4100);
  });
  it('cues d’un autre texte : null (les cues restent telles quelles)', () => {
    expect(sentenceCues(text, sentenceChunks(text), [{ startMs: 0, endMs: 1, text: 'autre' }])).toBeNull();
  });
});

/**
 * Scripts réels : chaque repère de `lea` et `lea-video` est trouvé dans le texte de son étape (script et texte résolu de
 * tour.resolved.json), vise une cible connue (un astre de poles.json), et s'allume pendant la narration enregistrée, dans
 * la cue qui contient son fragment. CE TEST ÉCHOUE si un texte change sans que son fragment suive.
 */
/** Cues de test : le texte découpé comme les sous-titres sans audio (`cueChunks`), au prorata des caractères sur `totalMs`. */
function testCues(text: string, totalMs: number): MarkCue[] {
  const chunks = cueChunks(text);
  const sum = chunks.reduce((n, c) => n + c.length, 0);
  let t = 0;
  return chunks.map((c) => {
    const startMs = t;
    t += (c.length / sum) * totalMs;
    return { startMs, endMs: t, text: c };
  });
}

function poleIds(): Set<string> {
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/data/poles.json', import.meta.url)), 'utf-8')) as unknown;
  const list = Array.isArray(raw) ? raw : ((raw as { poles?: unknown[] }).poles ?? []);
  return new Set((list as { id: string }[]).map((p) => p.id));
}

for (const id of ['lea-video', 'lea'] as const) {
  describe(`repères de la visite « ${id} » (scripts et voix réels)`, () => {
    const script = TOURS[id]!;
    const dir = fileURLToPath(new URL(`../../public/tour/${id}/`, import.meta.url));
    const resolved = JSON.parse(readFileSync(dir + 'tour.resolved.json', 'utf-8')) as ResolvedTour;
    const ids = poleIds();

    it('chaque étape de la version courte porte des repères (retour de Cyril)', () => {
      if (id !== 'lea-video') return;
      expect(script.steps.filter((s) => !s.marks?.length).map((s) => s.id)).toEqual([]);
    });

    for (const [i, step] of script.steps.entries()) {
      if (!step.marks?.length) continue;
      it(`${step.id} : fragments trouvés, cibles connues, repères pendant la voix et dans la cue du fragment`, () => {
        const r = resolved.steps[i];
        expect(r?.id).toBe(step.id);
        for (const m of step.marks!) {
          expect(normalizeSpaces(step.narration).includes(normalizeSpaces(m.at)), `fragment « ${m.at} » absent du script de ${step.id}`).toBe(true);
          for (const t of typeof m.target === 'string' ? [m.target] : m.target) {
            expect(isKnownTarget(t), `cible inconnue ${t}`).toBe(true);
            if (t.startsWith('pole:')) expect(ids.has(t.slice(5)), `astre absent de poles.json : ${t}`).toBe(true);
          }
        }
        // Voix enregistrée pour CE texte : ses cues WebVTT ; sinon (texte réécrit, voix pas encore régénérée) des cues de test
        // tirées du texte (une par phrase, comme tools/tour-tts les découpe), sur la durée connue ou 10 s
        const vttPath = `${dir}${stepFileStem(i, step.id)}.vtt`;
        const real = r?.durationMs && existsSync(vttPath) ? (parseVtt(readFileSync(vttPath, 'utf-8'))?.cues ?? null) : null;
        const total = r?.durationMs ?? 10000;
        const cues = real && cueOffsets(r!.text, real) ? real : testCues(r!.text, total);
        const tl = markTimeline(step.narration, r!.text, step.marks, cues, total);
        expect(tl.missing, `fragments introuvables dans le texte résolu de ${step.id}`).toEqual([]);
        // Chaque repère tombe dans la cue qui contient son fragment
        const starts = cueOffsets(r!.text, cues);
        expect(starts, `cues de ${step.id} absentes du texte résolu`).not.toBeNull();
        for (const m of tl.marks) {
          const at = fragmentOffset(step.narration, r!.text, step.marks![m.index]!.at)!;
          let k = 0;
          starts!.forEach((s, j) => {
            if (s <= at) k = j;
          });
          expect(m.startMs).toBeGreaterThanOrEqual(cues[k]!.startMs);
          expect(m.startMs).toBeLessThanOrEqual(cues[k]!.endMs);
          expect(m.startMs).toBeLessThan(total);
          // Fragment qui ouvre sa cue : le repère s'allume avec le sous-titre
          if (starts![k] === at) expect(m.startMs).toBe(cues[k]!.startMs);
        }
      });
    }
  });
}
