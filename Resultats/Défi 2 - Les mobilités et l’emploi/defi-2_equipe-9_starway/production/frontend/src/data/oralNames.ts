/**
 * Noms PRONONÇABLES des pôles pour la narration (les abréviations de labels.ts se lisent mal).
 * Repli : nom de poles.json sans la parenthèse.
 */
import type { Pole } from './types';

const POLE_ORAL: Record<string, string> = {
  P_PARIS_QCA: 'le quartier central des affaires de Paris',
  P_PARIS_RG: 'la rive gauche de Paris',
  // Point d'arrivée : Châtelet ; nom repris de poles.json (« Centre-est et nord-est »)
  P_PARIS_EST: 'le centre-est et le nord-est de Paris',
  P_DEFENSE: 'La Défense',
  P_BOULOGNE: 'Boulogne et Issy',
  // Point d'arrivée : Mairie de Saint-Ouen ; nom repris de poles.json (« Saint-Denis / Plaine Commune »)
  P_PLAINE: 'Saint-Denis et Plaine Commune',
  // Point d'arrivée : Aéroport CDG (Terminal 2)
  P_ROISSY: 'Roissy-Charles-de-Gaulle',
  P_ORLY: 'Orly et Rungis',
  // Point d'arrivée : Pointe du Lac (Créteil)
  P_CRETEIL: 'Créteil',
  P_SACLAY: 'Massy et Saclay',
  P_VERSAILLES: 'Versailles et Vélizy',
  P_SQY: 'Saint-Quentin-en-Yvelines',
  P_MARNE: 'Marne-la-Vallée',
  P_CERGY: 'Cergy-Pontoise',
  P_EVRY: 'Évry',
};

/**
 * Arrondissements de Paris du ciel à 44 astres (`BE_1107_751xx`, `name_short` = « 8e ») : « Paris 8e », comme
 * `shortCommuneName` pour les communes. Les autres astres du jeu (bassins d'emploi France Travail) gardent leur
 * nom officiel de poles.json (« T4 Paris Ouest La Défense », « Versailles Saclay »).
 */
const PARIS_ARRONDISSEMENT = /^BE_1107_751\d\d$/;

export function poleOralName(pole: Pick<Pole, 'id' | 'name'> & Partial<Pick<Pole, 'name_short'>>): string {
  if (PARIS_ARRONDISSEMENT.test(pole.id) && pole.name_short) return `Paris ${pole.name_short}`;
  return POLE_ORAL[pole.id] ?? pole.name.replace(/\s*\(.*\)\s*$/, '');
}
