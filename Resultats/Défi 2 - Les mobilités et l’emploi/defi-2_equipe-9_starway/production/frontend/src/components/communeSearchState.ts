/**
 * État de la recherche de commune, sans React : une commune choisie s'affiche en bouton, la recherche ne s'ouvre qu'à la demande.
 * `active` vaut -1 quand aucune option n'est désignée : les suggestions d'un champ vide attendent un geste, Entrée n'y choisit rien.
 */
export interface ComboState {
  /** Recherche ouverte au-dessus d'une commune déjà choisie (bouton remplacé par le champ) */
  editing: boolean;
  query: string;
  open: boolean;
  active: number;
}

export type ComboEvent =
  | { type: 'start'; text: string }
  | { type: 'input'; text: string }
  | { type: 'open' }
  | { type: 'arrow'; delta: 1 | -1; count: number }
  | { type: 'hover'; index: number }
  | { type: 'close' };

export const COMBO_IDLE: ComboState = { editing: false, query: '', open: false, active: -1 };

/** Une frappe désigne le premier résultat (Entrée le choisit) ; sur un champ vide, rien n'est désigné. */
const firstActive = (query: string): number => (query.trim() ? 0 : -1);

export function comboReducer(state: ComboState, event: ComboEvent): ComboState {
  switch (event.type) {
    case 'start':
      return { editing: true, query: event.text, open: !!event.text.trim(), active: firstActive(event.text) };
    case 'input':
      return { ...state, query: event.text, open: true, active: firstActive(event.text) };
    case 'open':
      return { ...state, open: true, active: firstActive(state.query) };
    case 'arrow': {
      if (!event.count) return state;
      // Liste fermée : la flèche l'ouvre sur sa première (ou dernière) option, sans en sauter une
      if (!state.open) return { ...state, open: true, active: event.delta > 0 ? 0 : event.count - 1 };
      return { ...state, active: Math.min(event.count - 1, Math.max(0, state.active + event.delta)) };
    }
    case 'hover':
      return state.active === event.index ? state : { ...state, active: event.index };
    case 'close':
      return COMBO_IDLE;
  }
}

/** Ce qu'Entrée choisit : l'option désignée d'une liste visible, sinon rien. */
export function comboPick<T>(state: ComboState, results: readonly T[]): T | null {
  return state.open ? (results[state.active] ?? null) : null;
}

/** Une frappe sur le bouton de la commune : le caractère à reporter dans la recherche, sinon null. */
export function typedCharacter(key: string, modified: boolean): string | null {
  return !modified && key.length === 1 && key !== ' ' ? key : null;
}
