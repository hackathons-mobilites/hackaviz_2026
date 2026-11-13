/**
 * Graphique « Projets de recrutement du bassin » (lot 4, D-051) : fonctions PURES, au-dessus de `bmo.ts` (les phrases viennent de là).
 * Une barre par famille de métiers, de la plus grande à la plus petite (projets publiés) ; une famille sans case publiée passe en dernier
 * et sa ligne dit « non diffusé » (jamais une barre de 0). Longueur de la barre : projets publiés rapportés à la plus grande famille du
 * bassin (`familyRows`) : un repère visuel, pas une part. Le bout d'une barre « au moins n » (cases « * » non comptées) est estompé.
 */
import { projectsPhrase, type FamilyRow } from './bmo';

export interface RecruitChartRow {
  code: string;
  label: string;
  /** Projets publiés (somme des cases diffusées), null = non diffusé */
  n: number | null;
  /** 0 à 1, rapporté à la plus grande famille ; 0 si non diffusé */
  bar: number;
  /** « au moins n » : des cases « * » ne sont pas comptées, le bout de la barre est estompé */
  atLeast: boolean;
  /** « au moins 32 926 », « 1 204 », « non diffusé » (`projectsPhrase`) */
  phrase: string;
  /** Famille choisie dans le sélecteur */
  selected: boolean;
  /** Phrase du survol et du focus */
  sentence: string;
}

export function recruitChartRows(rows: readonly FamilyRow[], family: string | null): RecruitChartRow[] {
  const built = rows.map((r, i) => {
    const phrase = projectsPhrase(r.cell);
    const row: RecruitChartRow = {
      code: r.code,
      label: r.label,
      n: r.cell?.n ?? null,
      bar: r.bar,
      atLeast: r.cell?.n != null && r.cell.masked > 0,
      phrase,
      selected: family === r.code,
      sentence: `${r.label} : ${phrase}${r.cell?.n != null ? ' projets de recrutement' : ''}.`,
    };
    return { row, i };
  });
  built.sort((a, b) => (a.row.n == null ? 1 : 0) - (b.row.n == null ? 1 : 0) || (b.row.n ?? 0) - (a.row.n ?? 0) || a.i - b.i);
  return built.map((b) => b.row);
}
