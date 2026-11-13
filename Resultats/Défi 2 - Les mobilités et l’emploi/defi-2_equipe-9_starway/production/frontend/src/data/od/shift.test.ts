import { describe, expect, it } from 'vitest';
import {
  changeShift,
  endOptions,
  endsNextDay,
  formatShift,
  isNightShape,
  isValidShift,
  NIGHT_WINDOW,
  nightNetworkSources,
  setNightShift,
  shiftBounds,
  shiftFromDayType,
  shiftLengthText,
  startOptions,
  usesNightNetwork,
} from './shift';

// Bornes du contrat D-019 (grille 03:00-22:00 au pas de 5 min)
const contract = {
  grid: { first: '03:00', last: '22:00', step_min: 5, n_slots: 229 },
  starts: { first: '05:00', last: '22:05' },
  ends: { first: '03:00', last: '22:00' },
};

describe('shiftBounds', () => {
  const b = shiftBounds(contract)!;

  it('resserre les bornes publiées par la règle E > S', () => {
    expect(b).toEqual({
      step: 5,
      startMin: 300,
      startMax: 1315, // 21:55 : seul début qui laisse une fin (22:00) après lui
      endMin: 305, // 05:05 : première fin après le premier début
      endMax: 1320,
      published: { startMin: 300, startMax: 1325, endMin: 180, endMax: 1320 },
      // postes de nuit : fenêtre légale 21h-7h resserrée par les bornes publiées
      night: { startMin: 1260, startMax: 1325, endMin: 180, endMax: 420 },
    });
  });

  it('options au pas de la grille, bornes comprises', () => {
    const s = startOptions(b);
    const e = endOptions(b);
    expect(s[0]).toBe(300);
    expect(s.at(-1)).toBe(1315);
    expect(s.length).toBe((1315 - 300) / 5 + 1);
    expect(e[0]).toBe(305);
    expect(e.at(-1)).toBe(1320);
    expect(s.every((t) => t % 5 === 0)).toBe(true);
  });

  it('isValidShift : pas, bornes et E > S', () => {
    expect(isValidShift(b, { start: 540, end: 1020 })).toBe(true);
    expect(isValidShift(b, { start: 541, end: 1020 })).toBe(false);
    expect(isValidShift(b, { start: 540, end: 540 })).toBe(false);
    expect(isValidShift(b, { start: 1020, end: 540 })).toBe(false);
    expect(isValidShift(b, { start: 295, end: 1020 })).toBe(false);
    expect(isValidShift(b, { start: 540, end: 1325 })).toBe(false);
  });

  it('journées-types de meta.json : calculables dans ce jeu', () => {
    expect(shiftFromDayType(b, { start: '06:00', end: '14:00' })).toEqual({ start: 360, end: 840 });
    expect(shiftFromDayType(b, { start: '14:00', end: '22:00' })).toEqual({ start: 840, end: 1320 });
  });

  it('jeu sans poste possible : null', () => {
    expect(shiftBounds({ ...contract, starts: { first: '22:00', last: '22:05' } })).toBeNull();
    expect(shiftBounds({ ...contract, grid: { ...contract.grid, step_min: 0 } })).toBeNull();
  });
});

describe('postes de nuit : fin le lendemain matin (L3122-2, fenêtre 21h-7h)', () => {
  const b = shiftBounds(contract)!;

  it('la fenêtre est celle du Code du travail', () => {
    expect(NIGHT_WINDOW).toEqual({ from: 1260, until: 420 });
  });

  it('22h-6h et 21h-5h30 sont des postes de nuit valides', () => {
    expect(isValidShift(b, { start: 1320, end: 360 })).toBe(true);
    expect(isValidShift(b, { start: 1260, end: 330 })).toBe(true);
    expect(endsNextDay({ start: 1320, end: 360 })).toBe(true);
    expect(endsNextDay({ start: 540, end: 1020 })).toBe(false);
  });

  it('bornes de la fenêtre : 21h à 22h05 pour le début, 3h à 7h pour la fin', () => {
    expect(isValidShift(b, { start: 1260, end: 420 })).toBe(true); // 21h-7h
    expect(isValidShift(b, { start: 1325, end: 180 })).toBe(true); // 22h05-3h
    expect(isValidShift(b, { start: 1255, end: 360 })).toBe(false); // début 20h55, avant 21h
    expect(isValidShift(b, { start: 1330, end: 360 })).toBe(false); // début après 22h05 (non publié)
    expect(isValidShift(b, { start: 1320, end: 425 })).toBe(false); // fin 7h05, après 7h
    expect(isValidShift(b, { start: 1320, end: 175 })).toBe(false); // fin 2h55, non publiée
  });

  it('refuse les autres fins avant le début et les valeurs hors grille', () => {
    expect(isValidShift(b, { start: 1020, end: 540 })).toBe(false); // 17h-9h : pas un poste de nuit
    expect(isValidShift(b, { start: 540, end: 360 })).toBe(false); // 9h-6h
    expect(isValidShift(b, { start: 1200, end: 360 })).toBe(false); // 20h-6h : commence avant 21h
    expect(isValidShift(b, { start: 1320, end: 480 })).toBe(false); // 22h-8h : finit après 7h
    expect(isValidShift(b, { start: 1321, end: 360 })).toBe(false); // hors grille
    expect(isValidShift(b, { start: 1320, end: 361 })).toBe(false);
    expect(isValidShift(b, { start: 1320, end: 1320 })).toBe(false); // E = S
  });

  it('isNightShape : forme seule, sans bornes de la table', () => {
    expect(isNightShape(1320, 360)).toBe(true);
    expect(isNightShape(1320, 1320)).toBe(false);
    expect(isNightShape(1320, 1380)).toBe(false);
    expect(isNightShape(1200, 360)).toBe(false);
    expect(isNightShape(1320, 480)).toBe(false);
    expect(isNightShape(1320.5, 360)).toBe(false);
  });

  it('jeu sans fin de nuit publiée : aucun poste de nuit', () => {
    const none = shiftBounds({ ...contract, ends: { first: '07:05', last: '22:00' } })!;
    expect(none.night).toBeNull();
    expect(isValidShift(none, { start: 1320, end: 360 })).toBe(false);
  });

  it('changeShift en nuit : chaque borne reste dans ses bornes, jamais d’ajustement', () => {
    const night = { start: 1320, end: 360 };
    expect(changeShift(b, night, { start: 1000 })).toEqual({ shift: { start: 1260, end: 360 }, adjusted: null });
    expect(changeShift(b, night, { start: 2000 })).toEqual({ shift: { start: 1325, end: 360 }, adjusted: null });
    expect(changeShift(b, night, { end: 100 })).toEqual({ shift: { start: 1320, end: 180 }, adjusted: null });
    expect(changeShift(b, night, { end: 900 })).toEqual({ shift: { start: 1320, end: 420 }, adjusted: null });
  });

  it('setNightShift : vers la nuit (ramené dans les bornes), retour à la journée-type', () => {
    expect(setNightShift(b, { start: 540, end: 1020 }, true)).toEqual({ start: 1260, end: 420 });
    expect(setNightShift(b, { start: 1320, end: 360 }, true)).toEqual({ start: 1320, end: 360 });
    expect(setNightShift(b, { start: 1320, end: 360 }, false, { start: 540, end: 1020 })).toEqual({ start: 540, end: 1020 });
    // repli inutilisable (fin le lendemain) : premier poste du jour possible
    expect(setNightShift(b, { start: 1320, end: 360 }, false, { start: 1320, end: 360 })).toEqual({ start: 300, end: 305 });
    expect(setNightShift({ ...b, night: null }, { start: 540, end: 1020 }, true)).toBeNull();
  });
});

describe('changeShift : la fin reste après le début, l’autre borne est poussée', () => {
  const b = shiftBounds(contract)!;
  const base = { start: 540, end: 1020 };

  it('changement simple, ramené sur la grille', () => {
    expect(changeShift(b, base, { start: 482 })).toEqual({ shift: { start: 480, end: 1020 }, adjusted: null });
    expect(changeShift(b, base, { end: 2000 })).toEqual({ shift: { start: 540, end: 1320 }, adjusted: null });
  });

  it('début après la fin : la fin est poussée d’un pas', () => {
    expect(changeShift(b, base, { start: 1100 })).toEqual({ shift: { start: 1100, end: 1105 }, adjusted: 'end' });
    expect(changeShift(b, base, { start: 2000 })).toEqual({ shift: { start: 1315, end: 1320 }, adjusted: 'end' });
  });

  it('fin avant le début : le début est poussé d’un pas', () => {
    expect(changeShift(b, base, { end: 500 })).toEqual({ shift: { start: 495, end: 500 }, adjusted: 'start' });
    expect(changeShift(b, base, { end: 0 })).toEqual({ shift: { start: 300, end: 305 }, adjusted: 'start' });
  });
});

describe('textes', () => {
  it('formatShift et durée du poste, tiret simple', () => {
    expect(formatShift({ start: 540, end: 1020 })).toBe('9h-17h');
    expect(formatShift({ start: 390, end: 855 })).toBe('6h30-14h15');
    expect(shiftLengthText({ start: 540, end: 1020 })).toBe('8\u00a0h');
    expect(shiftLengthText({ start: 540, end: 1035 })).toBe('8\u00a0h\u00a015');
    expect(shiftLengthText({ start: 540, end: 585 })).toBe('45\u00a0min');
    // poste de nuit : la fin est le lendemain
    expect(formatShift({ start: 1320, end: 360 })).toBe('22h-6h');
    expect(formatShift({ start: 1260, end: 330 })).toBe('21h-5h30');
    expect(shiftLengthText({ start: 1320, end: 360 })).toBe('8\u00a0h');
    expect(shiftLengthText({ start: 1260, end: 330 })).toBe('8\u00a0h\u00a030');
  });
});

// D-040 : grille assemblée de 00:00 à 23:55 (288 départs), bornes lues dans l'index comme avant
describe('grille de 24 h (D-040) : fin après 22h, début avant 5h, poste qui passe minuit', () => {
  const full = {
    grid: { first: '00:00', last: '23:55', step_min: 5, n_slots: 288 },
    starts: { first: '02:00', last: '23:55' },
    ends: { first: '00:00', last: '23:55' },
  };
  const b = shiftBounds(full)!;

  it('bornes du poste du jour et du poste de nuit', () => {
    expect(b.published).toEqual({ startMin: 120, startMax: 1435, endMin: 0, endMax: 1435 });
    expect(b.startMin).toBe(120); // début dès 02h : la fenêtre de l'aller (120 min) tient dans la grille
    expect(b.endMax).toBe(1435); // fin jusqu'à 23h55
    expect(b.night).toEqual({ startMin: 1260, startMax: 1435, endMin: 0, endMax: 420 }); // 21h à 23h55 ; 0h à 7h
  });

  it('poste du jour : fin après 22h et début avant 5h', () => {
    expect(isValidShift(b, { start: 840, end: 1410 })).toBe(true); // 14h-23h30
    expect(isValidShift(b, { start: 1020, end: 1435 })).toBe(true); // 17h-23h55
    expect(isValidShift(b, { start: 180, end: 660 })).toBe(true); // 3h-11h
    expect(isValidShift(b, { start: 120, end: 600 })).toBe(true); // 2h-10h : premier début
    expect(isValidShift(b, { start: 115, end: 600 })).toBe(false); // 1h55 : fenêtre de l'aller incomplète
    expect(isValidShift(b, { start: 840, end: 1440 })).toBe(false); // 24h : hors de la grille
  });

  it('poste qui passe minuit, dans la fenêtre légale 21h-7h', () => {
    expect(isValidShift(b, { start: 1320, end: 360 })).toBe(true); // 22h-6h
    expect(isValidShift(b, { start: 1435, end: 0 })).toBe(true); // 23h55-0h : bornes extrêmes
    expect(isValidShift(b, { start: 1260, end: 0 })).toBe(true); // 21h-0h
    expect(isValidShift(b, { start: 1380, end: 420 })).toBe(true); // 23h-7h
    expect(isValidShift(b, { start: 1330, end: 360 })).toBe(true); // 22h10 : avant D-040, non publié
    expect(isValidShift(b, { start: 1080, end: 120 })).toBe(false); // 18h-2h : début avant 21h
    expect(isValidShift(b, { start: 1320, end: 425 })).toBe(false); // fin après 7h
  });

  it('options : tous les débuts de 02h à 23h50 et toutes les fins de 02h05 à 23h55 pour un poste du jour', () => {
    expect(startOptions(b)[0]).toBe(120);
    expect(startOptions(b).at(-1)).toBe(1430);
    expect(endOptions(b)[0]).toBe(125);
    expect(endOptions(b).at(-1)).toBe(1435);
  });

  it('bascule vers la nuit puis retour au jour', () => {
    expect(setNightShift(b, { start: 540, end: 1020 }, true)).toEqual({ start: 1260, end: 420 });
    expect(setNightShift(b, { start: 1320, end: 360 }, false, { start: 840, end: 1410 })).toEqual({ start: 840, end: 1410 });
  });

  it('formatShift et durée d’un poste jusqu’à minuit', () => {
    expect(formatShift({ start: 1260, end: 0 })).toBe('21h-0h');
    expect(shiftLengthText({ start: 1260, end: 0 })).toBe('3\u00a0h');
  });
});

describe('usesNightNetwork : départs lus sur le réseau de nuit', () => {
  const segments = [
    { name: 'matin', from: '00:00', to: '06:55' },
    { name: 'jour', from: '07:00', to: '22:00' },
    { name: 'soir', from: '22:05', to: '23:55' },
  ];
  const lookback = 120;
  const step = 5;

  it('poste du jour entre 9h et 17h : réseau d’origine seulement', () => {
    expect(usesNightNetwork(segments, { start: 540, end: 1020 }, lookback, step)).toBe(false);
  });

  it('le 6h-14h lit des départs avant 7h (aller) : réseau de nuit', () => {
    expect(usesNightNetwork(segments, { start: 360, end: 840 }, lookback, step)).toBe(true);
  });

  it('début à 9h : fenêtre de l’aller de 7h à 8h55, tout dans le segment jour ; début à 8h55 : 6h55 dans le matin', () => {
    expect(usesNightNetwork(segments, { start: 540, end: 1020 }, lookback, step)).toBe(false);
    expect(usesNightNetwork(segments, { start: 535, end: 1020 }, lookback, step)).toBe(true);
  });

  it('fin après 22h : retour lu dans le soir ; poste de nuit : aller le soir', () => {
    expect(usesNightNetwork(segments, { start: 840, end: 1325 }, lookback, step)).toBe(true);
    expect(usesNightNetwork(segments, { start: 840, end: 1320 }, lookback, step)).toBe(false);
    expect(usesNightNetwork(segments, { start: 1320, end: 360 }, lookback, step)).toBe(true);
  });

  it('ancien export sans segments : faux', () => {
    expect(usesNightNetwork(undefined, { start: 360, end: 840 }, lookback, step)).toBe(false);
  });
});

describe('nightNetworkSources : le matin et le soir ne sont pas sur le même GTFS dérivé', () => {
  const segments = [
    { name: 'matin', from: '00:00', to: '06:55', gtfs_source: 'TRA01B' },
    { name: 'jour', from: '07:00', to: '22:00', gtfs_source: 'TRA01' },
    { name: 'soir', from: '22:05', to: '23:55', gtfs_source: 'TRA01C' },
  ];
  const lookback = 120;
  const step = 5;

  it('poste du jour de 9h à 17h : aucun réseau de nuit', () => {
    expect(nightNetworkSources(segments, { start: 540, end: 1020 }, lookback, step)).toEqual([]);
  });

  it('6h-14h : aller lu le matin seulement (le code du matin), jamais celui du jour ni du soir', () => {
    expect(nightNetworkSources(segments, { start: 360, end: 840 }, lookback, step)).toEqual(['TRA01B']);
  });

  it('fin après 22h : retour lu dans le soir (le code du soir)', () => {
    expect(nightNetworkSources(segments, { start: 840, end: 1325 }, lookback, step)).toEqual(['TRA01C']);
  });

  it('poste de nuit : aller le soir (début après 22h05) et retour le matin, un code chacun, dans l’ordre de la grille', () => {
    expect(nightNetworkSources(segments, { start: 1350, end: 360 }, lookback, step)).toEqual(['TRA01B', 'TRA01C']);
    // début à 22h : la fenêtre de l’aller [20h, 21h55] est tout entière dans le jour, seul le retour du matin lit la nuit
    expect(nightNetworkSources(segments, { start: 1320, end: 360 }, lookback, step)).toEqual(['TRA01B']);
  });

  it('ancien export (sans segments ou sans gtfs_source) : aucun code inventé', () => {
    expect(nightNetworkSources(undefined, { start: 360, end: 840 }, lookback, step)).toEqual([]);
    expect(nightNetworkSources([{ name: 'matin', from: '00:00', to: '06:55' } as never], { start: 360, end: 840 }, lookback, step)).toEqual([]);
  });
});