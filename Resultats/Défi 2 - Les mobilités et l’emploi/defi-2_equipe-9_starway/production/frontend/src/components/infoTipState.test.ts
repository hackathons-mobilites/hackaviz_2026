import { describe, expect, it } from 'vitest';
import { TIP_CLOSED, TIP_GAP, anchorStillVisible, isTipVisible, placeTip, tipNudge, tipReduce, type TipEvent, type TipState } from './infoTipState';

/** Rejoue une suite d'événements depuis l'état fermé. */
const run = (...events: TipEvent[]): TipState => events.reduce(tipReduce, TIP_CLOSED);

describe('InfoTip : états (WCAG 1.4.13)', () => {
  it('le survol ouvre, la sortie de la souris ferme', () => {
    expect(isTipVisible(run('enter'))).toBe(true);
    expect(isTipVisible(run('enter', 'leave'))).toBe(false);
  });

  it('survolable : tant que la souris est sur le bouton ou sur la bulle, la bulle reste (aucune sortie reçue)', () => {
    // bouton puis bulle : le composant ne reçoit pas « leave » quand la souris passe de l'un à l'autre (la bulle est dans le survol)
    expect(isTipVisible(run('enter', 'enter', 'enter'))).toBe(true);
  });

  it('persistante : elle ne se ferme pas toute seule, ni au défilement de la souris, seulement par une action', () => {
    expect(isTipVisible(run('click', 'enter', 'leave'))).toBe(true); // fixée par un clic : la sortie de la souris ne la ferme pas
    expect(isTipVisible(run('enter', 'click', 'leave'))).toBe(true); // ouverte au survol puis fixée
  });

  it('Échap ferme sans bouger la souris, et la bulle ne revient pas tant que la souris n\'est pas sortie puis revenue', () => {
    const closed = run('enter', 'escape');
    expect(isTipVisible(closed)).toBe(false);
    expect(closed.hover).toBe(true); // la souris est toujours dessus
    expect(isTipVisible(tipReduce(closed, 'enter'))).toBe(true); // un nouvel « enter » (sortie puis retour) la rouvre
    expect(isTipVisible(run('enter', 'escape', 'leave'))).toBe(false);
    expect(isTipVisible(run('enter', 'escape', 'leave', 'enter'))).toBe(true);
  });

  it('Échap ferme aussi une bulle fixée par le clavier ou par un clic', () => {
    expect(isTipVisible(run('click', 'escape'))).toBe(false);
    expect(run('click', 'escape').pinned).toBe(false);
  });

  it('Échap sur une bulle fermée ne change rien (il revient alors au panneau)', () => {
    expect(run('escape')).toEqual(TIP_CLOSED);
  });

  it('un clic fixe la bulle ; un second clic la ferme, même avec la souris dessus', () => {
    expect(isTipVisible(run('click'))).toBe(true);
    const twice = run('enter', 'click', 'click');
    expect(isTipVisible(twice)).toBe(false);
    expect(twice.dismissed).toBe(true);
  });

  it('au doigt (pas de survol), le clic ouvre et un clic ailleurs ferme', () => {
    expect(isTipVisible(run('click'))).toBe(true);
    expect(isTipVisible(run('click', 'outside'))).toBe(false);
  });

  it('un clic ailleurs ne ferme pas une bulle seulement survolée (la sortie de la souris s\'en charge)', () => {
    expect(isTipVisible(run('enter', 'outside'))).toBe(true);
  });

  it('le bouton sorti de la zone visible du panneau ferme tout, survol compris', () => {
    expect(run('click', 'enter', 'anchor-gone')).toEqual(TIP_CLOSED);
  });
});

describe('InfoTip : placement (jamais coupée)', () => {
  const viewport = { width: 1000, height: 700 };
  const pop = { width: 300, height: 120 };
  const anchor = (left: number, top: number) => ({ left, top, right: left + 24, bottom: top + 24 });

  it('s\'ouvre du côté voulu quand elle tient', () => {
    expect(placeTip(anchor(100, 100), pop, viewport, 'bottom').side).toBe('below');
    expect(placeTip(anchor(100, 400), pop, viewport, 'top').side).toBe('above');
  });

  it('se retourne de l\'autre côté quand elle ne tient pas', () => {
    expect(placeTip(anchor(100, 650), pop, viewport, 'bottom').side).toBe('above');
    expect(placeTip(anchor(100, 20), pop, viewport, 'top').side).toBe('below');
  });

  it('laisse l\'espace du « pont » de survol entre le bouton et la bulle', () => {
    const a = anchor(100, 300);
    expect(placeTip(a, pop, viewport, 'bottom').top).toBe(a.bottom + TIP_GAP);
    expect(placeTip(a, pop, viewport, 'top').top).toBe(a.top - TIP_GAP - pop.height);
  });

  it('reste dans la fenêtre, à gauche comme à droite', () => {
    expect(placeTip(anchor(0, 100), pop, viewport, 'bottom').left).toBeGreaterThanOrEqual(0);
    const right = placeTip(anchor(990, 100), pop, viewport, 'bottom');
    expect(right.left + pop.width).toBeLessThanOrEqual(viewport.width);
  });

  it('une bulle qui dépasse encore de la fenêtre après placement est ramenée dedans', () => {
    expect(tipNudge({ left: -12, right: 308 }, 1280)).toBe(20);
    expect(tipNudge({ left: 1000, right: 1300 }, 1280)).toBe(-28);
    expect(tipNudge({ left: 11, right: 331 }, 1280)).toBe(0);
  });

  it('le bouton n\'est plus « visible » dès qu\'il sort du conteneur défilant', () => {
    const container = { left: 0, top: 100, right: 400, bottom: 500 };
    expect(anchorStillVisible(anchor(10, 200), container)).toBe(true);
    expect(anchorStillVisible(anchor(10, 90), container)).toBe(true); // en partie visible
    expect(anchorStillVisible(anchor(10, 60), container)).toBe(false); // sorti par le haut
    expect(anchorStillVisible(anchor(10, 520), container)).toBe(false); // sorti par le bas
  });
});
