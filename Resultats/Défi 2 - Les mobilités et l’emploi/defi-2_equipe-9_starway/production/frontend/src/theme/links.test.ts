import { describe, expect, it } from 'vitest';
import { DEPOT_DIR, REPO_URL, repoFile } from './links';

describe('liens vers la méthode (dépôt des organisateurs)', () => {
  it('pointe vers le dépôt des organisateurs', () => {
    expect(REPO_URL).toBe('https://github.com/hackathons-mobilites/hackaviz_2026');
  });

  it('vise le dossier defi-2_starway, encodé dans l\'URL', () => {
    expect(DEPOT_DIR.endsWith('/defi-2_starway')).toBe(true);
    const href = repoFile('docs/methodologie.md');
    expect(href).toBe(
      'https://github.com/hackathons-mobilites/hackaviz_2026/blob/main/Resultats/D%C3%A9fi%202%20-%20Les%20mobilit%C3%A9s%20et%20l%E2%80%99emploi/defi-2_starway/production/docs/methodologie.md',
    );
    expect(href).not.toMatch(/[\s\u2013\u2014]/);
  });
});
