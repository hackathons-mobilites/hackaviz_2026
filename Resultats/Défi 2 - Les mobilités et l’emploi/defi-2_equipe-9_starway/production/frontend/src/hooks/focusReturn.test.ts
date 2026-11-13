import { describe, expect, it, vi } from 'vitest';
import { returnFocus, returnFocusToTourButton } from './focusReturn';

const body = { name: 'body' } as unknown as HTMLElement;
const inside = { name: 'inside' } as unknown as Element;
const elsewhere = { name: 'elsewhere' } as unknown as Element;
const menu = { contains: (n: Node | null) => (n as unknown as Element) === inside };
const doc = (activeElement: Element | null) => ({ activeElement, body });

describe('returnFocus : audit du 09/11, Échap dans « Affiche » et « Découvertes »', () => {
  it('rend le focus au déclencheur quand il était dans le menu fermé', () => {
    const trigger = { focus: vi.fn() };
    expect(returnFocus(trigger, menu, doc(inside))).toBe(true);
    expect(trigger.focus).toHaveBeenCalledOnce();
  });

  it('rend le focus quand il est perdu sur BODY', () => {
    const trigger = { focus: vi.fn() };
    expect(returnFocus(trigger, menu, doc(body))).toBe(true);
    expect(returnFocus(trigger, null, doc(null))).toBe(true);
    expect(trigger.focus).toHaveBeenCalledTimes(2);
  });

  it('ne déplace pas un focus posé ailleurs par l’utilisateur', () => {
    const trigger = { focus: vi.fn() };
    expect(returnFocus(trigger, menu, doc(elsewhere))).toBe(false);
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it('sans cible, ne fait rien', () => {
    expect(returnFocus(null, menu, doc(body))).toBe(false);
  });
});

describe('returnFocusToTourButton : audit du 09/11, après « Quitter la visite »', () => {
  const withButton = (activeElement: Element | null, button: { focus: () => void } | null) =>
    ({ ...doc(activeElement), querySelector: vi.fn(() => button) }) as unknown as Parameters<typeof returnFocusToTourButton>[1] & { querySelector: ReturnType<typeof vi.fn> };

  it('bouton Quitter retiré, focus sur BODY : retour sur « Lancer la visite » de la barre', () => {
    const button = { focus: vi.fn() };
    const d = withButton(body, button);
    expect(returnFocusToTourButton(null, d)).toBe(true);
    expect(button.focus).toHaveBeenCalledOnce();
    expect(d.querySelector).toHaveBeenCalledWith('.top-bar .btn-tour');
  });

  it('focus encore dans les commandes de la visite : même retour', () => {
    const button = { focus: vi.fn() };
    expect(returnFocusToTourButton(menu, withButton(inside, button))).toBe(true);
    expect(button.focus).toHaveBeenCalledOnce();
  });

  it('focus posé ailleurs (retour au titre, panneau) : rien ne bouge', () => {
    const button = { focus: vi.fn() };
    expect(returnFocusToTourButton(menu, withButton(elsewhere, button))).toBe(false);
    expect(button.focus).not.toHaveBeenCalled();
  });
});
