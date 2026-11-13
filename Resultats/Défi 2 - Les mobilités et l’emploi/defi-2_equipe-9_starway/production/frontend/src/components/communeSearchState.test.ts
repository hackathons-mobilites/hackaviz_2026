import { describe, expect, it } from 'vitest';
import { COMBO_IDLE, comboPick, comboReducer, typedCharacter, type ComboEvent, type ComboState } from './communeSearchState';

const play = (events: ComboEvent[], from: ComboState = COMBO_IDLE) => events.reduce(comboReducer, from);

describe('recherche de commune', () => {
  it('« Changer » ouvre un champ vide, sans liste ; la première lettre ouvre la liste sur le premier résultat', () => {
    const edit = play([{ type: 'start', text: '' }]);
    expect(edit).toEqual({ editing: true, query: '', open: false, active: -1 });
    expect(play([{ type: 'input', text: 'm' }], edit)).toEqual({ editing: true, query: 'm', open: true, active: 0 });
  });

  it('une frappe sur le bouton passe dans le champ et ouvre la liste', () => {
    expect(play([{ type: 'start', text: 'c' }])).toEqual({ editing: true, query: 'c', open: true, active: 0 });
    expect(typedCharacter('c', false)).toBe('c');
    expect(typedCharacter(' ', false)).toBeNull(); // Espace garde son rôle de bouton
    expect(typedCharacter('Enter', false)).toBeNull();
    expect(typedCharacter('c', true)).toBeNull(); // Ctrl+C reste un raccourci
  });

  it('la désignation repart de zéro à chaque ouverture', () => {
    const down: ComboEvent = { type: 'arrow', delta: 1, count: 5 };
    const moved = play([{ type: 'input', text: 'sa' }, down, down, down]);
    expect(moved.active).toBe(3);
    expect(play([{ type: 'close' }, { type: 'input', text: 'sa' }], moved).active).toBe(0);
    expect(play([{ type: 'open' }], { ...moved, open: false }).active).toBe(0);
  });

  it('la flèche sur une liste fermée l’ouvre sans sauter d’option', () => {
    const closed = { ...COMBO_IDLE, query: 'sa' };
    expect(play([{ type: 'arrow', delta: 1, count: 4 }], closed)).toMatchObject({ open: true, active: 0 });
    expect(play([{ type: 'arrow', delta: -1, count: 4 }], closed)).toMatchObject({ open: true, active: 3 });
    expect(play([{ type: 'arrow', delta: 1, count: 0 }], closed)).toEqual(closed);
  });

  it('les flèches restent dans la liste', () => {
    const start = { ...COMBO_IDLE, open: true, active: 1 };
    expect(play([{ type: 'arrow', delta: 1, count: 2 }, { type: 'arrow', delta: 1, count: 2 }], start).active).toBe(1);
    expect(play([{ type: 'arrow', delta: -1, count: 2 }, { type: 'arrow', delta: -1, count: 2 }], start).active).toBe(0);
  });

  it('Entrée sans résultat, sans désignation ou liste fermée ne choisit rien', () => {
    expect(comboPick({ ...COMBO_IDLE, open: true, active: 0 }, [])).toBeNull();
    expect(comboPick({ ...COMBO_IDLE, open: true, active: -1 }, ['a'])).toBeNull();
    expect(comboPick({ ...COMBO_IDLE, open: false, active: 0 }, ['a'])).toBeNull();
    expect(comboPick({ ...COMBO_IDLE, open: true, active: 1 }, ['a', 'b'])).toBe('b');
  });

  it('une suggestion de champ vide attend un geste : aucune n’est désignée à l’ouverture', () => {
    const open = play([{ type: 'open' }]);
    expect(open).toMatchObject({ open: true, active: -1 });
    expect(comboPick(open, ['Maisons-Laffitte'])).toBeNull();
    expect(play([{ type: 'arrow', delta: 1, count: 3 }], open).active).toBe(0);
  });

  it('fermer efface tout : rien du texte tapé ne reste', () => {
    expect(play([{ type: 'start', text: 'ma' }, { type: 'close' }])).toEqual(COMBO_IDLE);
  });
});
