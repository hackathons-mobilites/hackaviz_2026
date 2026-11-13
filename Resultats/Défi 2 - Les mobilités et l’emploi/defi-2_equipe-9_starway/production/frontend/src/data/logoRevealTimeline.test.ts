import { describe, expect, it } from 'vitest';
import { logoReveal } from '../theme/tokens';
import { LOGO_LETTERS, LOGO_SEGMENTS, LOGO_STARS, LOGO_SYMBOL_BOX } from './logoGeometry';
import { buildLogoTimeline, cameraAt, cometAt, popScale, sceneZoom } from './logoRevealTimeline';

describe('animation du logo', () => {
  const tl = buildLogoTimeline();

  it('une étoile par point du M, une lettre par lettre de STARWAY', () => {
    expect(LOGO_STARS).toHaveLength(5);
    expect(LOGO_SEGMENTS).toHaveLength(4);
    expect(LOGO_LETTERS).toHaveLength(7);
    expect(tl.arrivals).toHaveLength(5);
    expect(tl.letterAt).toHaveLength(7);
  });

  it('la comète accélère et chaque étoile se verrouille dans l’ordre, jusqu’au point final', () => {
    const d = tl.arrivals.slice(1).map((v, i) => v - (tl.arrivals[i] as number));
    for (let i = 1; i < d.length; i++) expect(d[i] as number).toBeLessThan(d[i - 1] as number);
    expect(tl.finalAt).toBe(tl.arrivals[4]);
  });

  it('le mot n’apparaît qu’après le verrouillage du point final', () => {
    expect(tl.letterAt[0] as number).toBeGreaterThan(tl.finalAt);
    for (let i = 1; i < 7; i++) expect(tl.letterAt[i] as number).toBeGreaterThan(tl.letterAt[i - 1] as number);
    expect(tl.end).toBeGreaterThan(tl.letterAt[6] as number);
  });

  it('la comète parcourt chaque segment, puis s’arrête', () => {
    const [first, , , fourth] = tl.arrivals as [number, number, number, number];
    expect(cometAt(tl, first - 1)).toBeNull();
    expect(cometAt(tl, first)).toEqual({ seg: 0, p: 0 });
    expect(cometAt(tl, fourth)?.seg).toBe(3);
    expect(cometAt(tl, tl.finalAt)).toBeNull();
  });

  it('une étoile verrouillée part de sa taille en sommeil et revient à sa taille du logo', () => {
    expect(popScale(0)).toBeCloseTo(logoReveal.dormantScale, 5);
    expect(popScale(0.3)).toBeCloseTo(logoReveal.lockPeak, 5);
    expect(popScale(1)).toBeCloseTo(1, 5);
  });

  it('la caméra reste sur le symbole, puis finit exactement à la place du logo', () => {
    expect(cameraAt(tl, 0)).toBe(0);
    expect(cameraAt(tl, tl.finalAt)).toBe(0);
    expect(cameraAt(tl, tl.pullAt)).toBe(0);
    expect(cameraAt(tl, (tl.pullAt + tl.pullEnd) / 2)).toBeCloseTo(0.5, 5);
    expect(cameraAt(tl, tl.pullEnd)).toBe(1);
    expect(cameraAt(tl, tl.end)).toBe(1);
  });

  it('au rejeu, la caméra part de la place du logo et rejoint le symbole', () => {
    expect(cameraAt(tl, 0, true)).toBe(1);
    expect(cameraAt(tl, logoReveal.cameraIn, true)).toBe(0);
    expect(logoReveal.cameraIn).toBeLessThanOrEqual(logoReveal.ignite);
  });

  it('le titre n’arrive qu’une fois le symbole presque rangé', () => {
    expect(tl.titleAt).toBeGreaterThan(tl.pullAt);
    expect(tl.titleAt).toBeLessThanOrEqual(tl.pullEnd);
  });

  it.each([
    ['1600 x 900', 1600, 620, 92 / 420],
    ['390 x 844', 390, 560, 54 / 420],
    ['1280 x 600', 1280, 400, 89.6 / 420],
  ])('le symbole grossi tient dans la zone libre (%s)', (_, viewportWidth, zoneHeight, restUnit) => {
    const zoom = sceneZoom({ viewportWidth, zoneHeight, restUnit, symbol: LOGO_SYMBOL_BOX });
    expect(zoom).toBeGreaterThan(1);
    expect(LOGO_SYMBOL_BOX.width * restUnit * zoom).toBeLessThanOrEqual(viewportWidth * logoReveal.sceneWidth + 1e-6);
    expect(LOGO_SYMBOL_BOX.height * restUnit * zoom).toBeLessThanOrEqual(zoneHeight * logoReveal.sceneHeight + 1e-6);
  });

  it('le symbole n’est jamais plus petit que le logo, même sans place', () => {
    expect(sceneZoom({ viewportWidth: 320, zoneHeight: 10, restUnit: 54 / 420, symbol: LOGO_SYMBOL_BOX })).toBe(1);
  });
});
