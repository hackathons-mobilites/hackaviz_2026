import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { UpdateNotice } from '../components/AppErrorBoundary';
import {
  BUNDLE_RELOAD_LABEL,
  BUNDLE_UPDATED_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE,
  installBundleUpdateGuard,
  isBundleStale,
  isDynamicImportFailure,
  resetBundleStaleForTests,
  stateFromError,
  subscribeBundleStale,
} from './bundleUpdate';

afterEach(() => resetBundleStaleForTests());

describe('isDynamicImportFailure : l’échec de chargement d’un module à la demande', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x.test/assets/Diptych-AbC123.js',
    'error loading dynamically imported module: https://x.test/assets/MirrorMap-1.js',
    'Importing a module script failed.',
    'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
    'Unable to preload CSS for /assets/Diptych-1.css',
  ])('%s', (message) => {
    expect(isDynamicImportFailure(new TypeError(message))).toBe(true);
    expect(isDynamicImportFailure(message)).toBe(true);
  });

  it('ChunkLoadError, et pas une erreur ordinaire', () => {
    const e = new Error('Loading chunk 7 failed.');
    e.name = 'ChunkLoadError';
    expect(isDynamicImportFailure(e)).toBe(true);
    expect(isDynamicImportFailure(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(isDynamicImportFailure(null)).toBe(false);
    expect(isDynamicImportFailure(undefined)).toBe(false);
    expect(isDynamicImportFailure(42)).toBe(false);
  });
});

describe('garde des échecs de chargement (vite:preloadError, import() en échec)', () => {
  it('vite:preloadError marque le site comme mis à jour, sans supprimer l’erreur (pas de preventDefault)', () => {
    const target = new EventTarget();
    const off = installBundleUpdateGuard(target);
    const seen: number[] = [];
    subscribeBundleStale(() => seen.push(1));
    const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: new Error('x') });
    target.dispatchEvent(event);
    expect(isBundleStale()).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(seen).toEqual([1]);
    off();
  });

  it('un import() en échec non rattrapé (unhandledrejection) marque aussi le site, une erreur ordinaire non', () => {
    const target = new EventTarget();
    const off = installBundleUpdateGuard(target);
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new TypeError('autre chose') }));
    expect(isBundleStale()).toBe(false);
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new TypeError('Failed to fetch dynamically imported module: /assets/a.js') }));
    expect(isBundleStale()).toBe(true);
    off();
  });

  it('les écouteurs sont retirés', () => {
    const target = new EventTarget();
    installBundleUpdateGuard(target)();
    target.dispatchEvent(new Event('vite:preloadError'));
    expect(isBundleStale()).toBe(false);
  });
});

describe('limite d’erreur : message, bouton, aucun rechargement automatique', () => {
  it('un échec de chargement de module donne « Le site vient d’être mis à jour. Rechargez la page. » et un bouton', () => {
    expect(stateFromError(new TypeError('Failed to fetch dynamically imported module: /assets/Diptych-1.js'))).toEqual({ failed: true, stale: true });
    const html = renderToStaticMarkup(createElement(UpdateNotice, { stale: true })).replaceAll('&#x27;', "'");
    expect(html).toContain("Le site vient d'être mis à jour. Rechargez la page.");
    expect(BUNDLE_UPDATED_MESSAGE).toBe("Le site vient d'être mis à jour. Rechargez la page.");
    expect(html).toContain('<button');
    expect(html).toContain(BUNDLE_RELOAD_LABEL);
    expect(html).toContain('role="alert"');
  });

  it('une autre erreur de rendu : message neutre, même bouton', () => {
    expect(stateFromError(new Error('boom'))).toEqual({ failed: true, stale: false });
    const html = renderToStaticMarkup(createElement(UpdateNotice, { stale: false })).replaceAll('&#x27;', "'");
    expect(html).toContain(UNEXPECTED_ERROR_MESSAGE);
    expect(html).not.toContain('mis à jour');
    expect(html).toContain('<button');
  });

  it('aucun rechargement automatique : le seul location.reload est dans le gestionnaire du bouton', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['src/state/bundleUpdate.ts', 'src/components/AppErrorBoundary.tsx']) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const calls = src.match(/location\.(reload|replace|assign)\(|location\.href\s*=/g) ?? [];
      expect(calls.length).toBe(f.endsWith('AppErrorBoundary.tsx') ? 1 : 0);
      if (calls.length) expect(src).toMatch(/onClick=\{\(\) => window\.location\.reload\(\)\}/);
    }
  });
});
