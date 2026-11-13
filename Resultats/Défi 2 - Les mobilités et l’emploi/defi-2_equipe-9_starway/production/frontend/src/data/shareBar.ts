/** Part de 0 à 1 d'un pourcentage publié (0 à 100) : bornée ; une valeur absente ou non finie ne dessine aucune barre (jamais inventée). */
export function shareFraction(percent: number | null | undefined): number | null {
  if (percent == null || !Number.isFinite(percent)) return null;
  return Math.min(1, Math.max(0, percent / 100));
}
