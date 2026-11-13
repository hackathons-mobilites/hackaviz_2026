import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROVENANCE_COVERAGE, type CoverageEntry } from './provenanceCoverage';
import type { SourceEntry } from './types';

/**
 * Contrôle de couverture de la provenance (D-033) : un bloc chiffré sans source, ou dont la source est
 * écrite en dur, fait ÉCHOUER la suite. Voir `provenanceCoverage.ts` pour ajouter un bloc.
 */

const COMPONENTS = fileURLToPath(new URL('../components/', import.meta.url));
const SOURCES: SourceEntry[] = JSON.parse(readFileSync(new URL('../../public/data/sources.json', import.meta.url), 'utf-8'));
const MANIFEST_CODES = [...new Set(SOURCES.map((s) => s.source_id))];

const posix = (p: string) => p.split('\\').join('/');
const read = (file: string) => readFileSync(join(COMPONENTS, file), 'utf-8');

/** Fichiers du code sans commentaires (les commentaires peuvent citer les codes) */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Lignes où un code de source est écrit en dur (hors prop `code="..."`, comparaisons et champs `source_id`). */
function hardCodedSources(code: string, codes: readonly string[]): string[] {
  const re = new RegExp(`\\b(?:${codes.map((c) => c.replace(/[-]/g, '\\-')).join('|')})\\b`);
  return stripComments(code)
    .split('\n')
    .filter((l) => re.test(l) && !/\bcode="|===|!==|source_id|^\s*import\s/.test(l))
    .map((l) => l.trim());
}

/** Composants de preuve : Proof*.tsx, et tout composant des dossiers de blocs chiffrés. */
function scanned(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(posix(relative(COMPONENTS, full)));
    }
  };
  walk(COMPONENTS);
  return out.filter((f) => {
    if (!f.endsWith('.tsx') || f.includes('.test.') || f.startsWith('provenance/')) return false;
    const base = f.split('/').pop()!;
    return base.startsWith('Proof') || /^(subscriptions|needs|recruit|vehicles)\//.test(f);
  });
}

const byFile = new Map<string, CoverageEntry>(PROVENANCE_COVERAGE.map((e) => [e.file, e]));
const USES_NOTE = /<(?:ProvenanceNote|ProvenanceParts|CodeSourceNote|[A-Z]\w*SourceNote)\b/;

describe('registre de couverture de la provenance', () => {
  it('chaque composant de preuve est inscrit au registre ou exempté (raison écrite)', () => {
    const missing = scanned().filter((f) => !byFile.has(f));
    expect(missing, `à inscrire dans data/provenanceCoverage.ts : ${missing.join(', ')}`).toEqual([]);
  });

  it('chaque entrée du registre désigne un fichier existant, sans doublon', () => {
    expect(byFile.size).toBe(PROVENANCE_COVERAGE.length);
    for (const e of PROVENANCE_COVERAGE) expect(() => statSync(join(COMPONENTS, e.file)), e.file).not.toThrow();
  });

  it('une exemption a une raison écrite ; une couverture par un parent désigne un composant à notes', () => {
    for (const e of PROVENANCE_COVERAGE) {
      if (e.kind === 'exempt') expect((e.reason ?? '').length, `${e.file} : raison`).toBeGreaterThan(30);
      if (e.kind === 'covered') {
        const parent = e.coveredBy ? byFile.get(e.coveredBy) : undefined;
        expect(parent?.kind, `${e.file} : coveredBy`).toBe('notes');
        for (const c of e.codes) expect(parent?.codes, `${e.file} : ${c}`).toContain(c);
      }
    }
  });

  it("un composant inscrit utilise une note de provenance (ProvenanceNote, CodeSourceNote ou *SourceNote)", () => {
    for (const e of PROVENANCE_COVERAGE.filter((x) => x.kind === 'notes')) {
      const code = stripComments(read(e.file));
      expect(code, `${e.file} : aucune note de provenance`).toMatch(USES_NOTE);
      expect(code, `${e.file} : n'importe pas les notes`).toMatch(/from '(?:\.\.?\/)+provenance\/(?:ProofNotes|ProvenanceNote)'/);
      expect(e.codes.length, `${e.file} : codes`).toBeGreaterThan(0);
    }
  });

  it('un code cité par une prop code="..." est déclaré au registre', () => {
    for (const e of PROVENANCE_COVERAGE.filter((x) => x.kind === 'notes')) {
      for (const m of stripComments(read(e.file)).matchAll(/\bcode="([^"]+)"/g)) expect(e.codes, `${e.file} : ${m[1]}`).toContain(m[1]);
    }
  });

  it('chaque code du registre est publié dans sources.json', () => {
    for (const e of PROVENANCE_COVERAGE) for (const c of e.codes) expect(MANIFEST_CODES, `${e.file} : ${c} absent de sources.json`).toContain(c);
  });

  it("aucun composant n'écrit un code de source en dur (la note lit sources.json)", () => {
    const files = new Set([...scanned(), ...PROVENANCE_COVERAGE.map((e) => e.file)]);
    for (const f of files) expect(hardCodedSources(read(f), MANIFEST_CODES), `${f} : code de source écrit en dur`).toEqual([]);
  });

  it("la note ne s'affiche que mode actif : ProvenanceNote lit le store, ProofNotes passe toujours par elle", () => {
    const note = read('provenance/ProvenanceNote.tsx');
    expect(note).toMatch(/useProvenanceStore\(\(s\) => s\.on\)/);
    expect(note).toMatch(/if \(!on \|\| list\.length === 0\) return null/);
    const notes = stripComments(read('provenance/ProofNotes.tsx'));
    // chaque fonction rend une ProvenanceNote (ou rien) : aucun balisage de source propre
    expect(notes).not.toMatch(/<(?:p|span|a|div)\b/);
    const exported = [...notes.matchAll(/export function (\w+SourceNote)\b/g)].length;
    const rendered = [...notes.matchAll(/return <ProvenanceNote\b/g)].length;
    expect(exported).toBeGreaterThan(8);
    expect(rendered).toBe(exported);
  });
});

describe('détection des sources écrites en dur', () => {
  it('repère un code dans le texte ou une chaîne, pas dans un commentaire, une prop code= ni une comparaison', () => {
    const code = [
      "// ENV01 cité en commentaire",
      '/* TRA01 en bloc */',
      '<CodeSourceNote code="ENV01" />',
      "if (p.jobs_source === 'EMP01') run();",
      '<p>Itinéraire calculé sur les horaires IDFM (TRA01)</p>',
      "const s = `Source : INSEE (EMP02)`;",
    ].join('\n');
    expect(hardCodedSources(code, ['ENV01', 'TRA01', 'EMP01', 'EMP02'])).toEqual(['<p>Itinéraire calculé sur les horaires IDFM (TRA01)</p>', 'const s = `Source : INSEE (EMP02)`;']);
  });
});
