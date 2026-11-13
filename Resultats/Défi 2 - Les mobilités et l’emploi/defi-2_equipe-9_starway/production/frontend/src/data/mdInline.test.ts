import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inlineToPlainText, parseInline } from './mdInline';
import { stripDecisionCodes, stripPersonalNotes } from './proof';

describe('parseInline : gras, liens externes, liens du dépôt privé', () => {
  it('gras et texte', () => {
    expect(parseInline('a **b** c')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' c' },
    ]);
  });

  it('lien vers un fichier du dépôt (privé) : le libellé seul, jamais le Markdown brut', () => {
    expect(parseInline('voir l’[analyse](analyse-limite-marche-r5.md) du 03/11')).toEqual([
      { kind: 'text', text: 'voir l’' },
      { kind: 'text', text: 'analyse' },
      { kind: 'text', text: ' du 03/11' },
    ]);
    expect(inlineToPlainText('([méthodologie, § 5](methodologie.md))')).toBe('(méthodologie, § 5)');
    expect(inlineToPlainText('[méthodologie, § 5 quindecies](methodologie.md)')).toBe('méthodologie, § 5 quindecies');
  });

  it('lien externe public : un vrai lien, le libellé affiché', () => {
    expect(parseInline('[JORF n° 0177](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569470)')).toEqual([
      { kind: 'link', text: 'JORF n° 0177', href: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569470' },
    ]);
  });

  it('un crochet sans cible reste du texte', () => {
    expect(inlineToPlainText('x [non lien] y')).toBe('x [non lien] y');
  });

  it('un gras qui contient une étoile seule (« * » non diffusé) est bien rendu en gras', () => {
    expect(parseInline('a **Les cases « * » sont non diffusées** b')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'Les cases « * » sont non diffusées' },
      { kind: 'text', text: ' b' },
    ]);
  });
});

/** Les .md importés par l'interface (`import x from '…/fichier.md?raw'`), lus sur le disque. */
function importedMarkdown(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/from\s+'([^']+\.md)\?raw'/g)) {
          const file = resolve(dirname(p), m[1]!);
          out.push({ file, text: readFileSync(file, 'utf8') });
        }
      }
    }
  };
  walk(resolve(process.cwd(), 'src'));
  return out;
}

describe('les .md affichés par le tiroir « Sources & limites » : aucun lien Markdown brut', () => {
  const docs = importedMarkdown();

  it('docs/limites.md est bien importé par l’interface', () => {
    expect(docs.some((d) => /limites\.md$/.test(d.file))).toBe(true);
  });

  it('limites.md : la limite du ciel à 44 astres n’affiche aucun backtick', () => {
    const limites = docs.find((d) => /limites\.md$/.test(d.file))!.text.split(/\r?\n/);
    const shown = (start: string) => {
      const line = limites.find((l) => l.startsWith(start));
      expect(line, start).toBeDefined();
      return inlineToPlainText(line!.trim().replace(/^- /, ''));
    };
    const astres = shown('- **Astres = bassins');
    expect(astres).not.toContain('`');
    expect(astres).toMatch(/100 % des postes salariés recensés par l'INSEE/);
  });

  it.each(docs.map((d) => [d.file, d.text] as const))('%s', (_file, text) => {
    const raw: string[] = [];
    text.split(/\r?\n/).forEach((line, i) => {
      const shown = inlineToPlainText(line.trim().replace(/^(- |## )/, ''));
      // `](` : une cible de lien restée à l'écran ; `.md)` : un nom de fichier du dépôt ; `**` : un gras non rendu
      if (/\]\(|\.md\)|\*\*/.test(shown)) raw.push(`ligne ${i + 1} : ${shown.slice(0, 120)}`);
    });
    expect(raw).toEqual([]);
  });
});

describe('limites.md affiché hors mode sources (C3, audit du 09/11)', () => {
  const text = readFileSync(new URL('../../../docs/limites.md', import.meta.url), 'utf-8');
  it('aucun code de décision après filtrage', () => {
    expect(stripDecisionCodes(text)).not.toMatch(/D-\d{3}/);
  });
  it('ni fichiers internes, ni jars, ni scripts dans le texte', () => {
    expect(text).not.toMatch(/\.(py|jar)\b|\bjars?\b|transfers\.txt|Tarifs_|tolls\.json/);
  });
});

describe('textes publiés : ni consigne de personne, ni code de décision hors mode sources', () => {
  it('retire la mention de consigne, partout', () => {
    expect(stripPersonalNotes('Prix du ticket (demande de Nicolas, 05/11) au 1er janvier.')).toBe('Prix du ticket au 1er janvier.');
    expect(stripPersonalNotes('Valeur choisie (décision de Nicolas du 04/11).')).toBe('Valeur choisie.');
    expect(stripPersonalNotes('Texte sans mention (D-033).')).toBe('Texte sans mention (D-033).');
  });
  it('stripDecisionCodes retire les deux', () => {
    expect(stripDecisionCodes('Valeur (D-024) choisie (décision de Nicolas du 04/11).')).toBe('Valeur choisie.');
  });
});
