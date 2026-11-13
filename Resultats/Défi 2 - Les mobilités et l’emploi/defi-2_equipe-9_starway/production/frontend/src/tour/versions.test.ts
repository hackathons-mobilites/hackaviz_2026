import { describe, expect, it } from 'vitest';
import { TOURS } from './registry';
import { lea, leaVideo } from './tours/lea.tour';
import { resumeScript, TOUR_VERSIONS, tourVersion } from './versions';

describe('choix de la version de la visite', () => {
  it('propose la version courte puis la complète, seulement des visites du registre, sans durée écrite', () => {
    expect(TOUR_VERSIONS.map((v) => v.script.id)).toEqual(['lea-video', 'lea']);
    for (const v of TOUR_VERSIONS) {
      expect(TOURS[v.script.id]).toBe(v.script);
      expect(`${v.label} ${v.note}`).not.toMatch(/\d/);
    }
  });

  it('les deux versions sont prêtes sans mécanisme réservé au développement', () => {
    expect(lea.ready).toBe(true);
    expect(leaVideo.ready).toBe(true);
  });

  it('la reprise (?visite=1) joue la version demandée, la complète par défaut ou si l’identifiant est inconnu', () => {
    expect(resumeScript(new URLSearchParams('visite=1'))).toBe(lea);
    expect(resumeScript(new URLSearchParams('visite=1&tour=lea-video'))).toBe(leaVideo);
    expect(resumeScript(new URLSearchParams('visite=1&tour=lea'))).toBe(lea);
    expect(resumeScript(new URLSearchParams('visite=1&tour=autre'))).toBe(lea);
  });

  it('retrouve le libellé de la version jouée', () => {
    expect(tourVersion('lea-video')?.label).toBe('Version courte');
    expect(tourVersion('lea')?.label).toBe('Version complète');
    expect(tourVersion(undefined)).toBeUndefined();
    expect(tourVersion('autre')).toBeUndefined();
  });
});
