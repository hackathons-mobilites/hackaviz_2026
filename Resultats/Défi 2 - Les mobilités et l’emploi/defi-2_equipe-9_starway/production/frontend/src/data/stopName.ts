/**
 * Nom de l'arrêt de référence d'un pôle, lu dans `point.method` (poles.json).
 * Module sans d3-geo : le panneau de preuve l'utilise sans faire entrer la carte miroir dans le
 * bundle de démarrage.
 */

/** « arrêt le plus desservi … : Gare Saint-Lazare (IDFM:71370, GTFS IDFM) » → « Gare Saint-Lazare ». */
export function stopNameFromMethod(method: string | undefined): string | null {
  if (!method) return null;
  const m = /:\s*([^:]+?)\s*\((?:IDFM:|[^)]*GTFS)[^)]*\)\s*$/.exec(method);
  return m ? m[1]!.trim() : null;
}
