// Enregistrement de la visite avec Playwright (Chromium, recordVideo en WebM, sans audio).
//
// Contrat attendu du front (voir README, « Hook à ajouter dans le front ») : en mode ?record=1, la page émet
//   window.dispatchEvent(new CustomEvent('starway:record', { detail }))
// avec detail.type = 'ready' | 'step' | 'end' | 'abort' et detail.t = performance.timeOrigin + performance.now().
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';
import { rel } from './paths.mjs';

export const RECORD_EVENT = 'starway:record';
export const VIEWPORT = { width: 1920, height: 1080 };

const require = createRequire(import.meta.url);

function playwrightVersion() {
  try {
    return require('playwright/package.json').version;
  } catch {
    return null;
  }
}

/** Construit l'URL de la visite en mode enregistrement. */
export function recordUrl(baseUrl, tourId, { frontSubtitles }) {
  const u = new URL(baseUrl);
  u.searchParams.set('tour', tourId);
  u.searchParams.set('record', '1');
  if (!frontSubtitles) u.searchParams.set('subs', '0');
  return u.toString();
}

/**
 * Ouvre la visite, attend « ready » puis « end », enregistre la vidéo.
 * Écrit dans workDir : raw.webm, timeline.json, console.log.
 */
export async function recordTour({ tourId, url, workDir, headed, fps, hookTimeoutMs, endTimeoutMs, endHoldMs = 0, expectedSteps, browserPath }) {
  mkdirSync(workDir, { recursive: true });
  const videoTmp = path.join(workDir, 'playwright');
  const events = [];
  const consoleLines = [];
  let resolveReady, resolveEnd;
  const ready = new Promise((r) => (resolveReady = r));
  const end = new Promise((r) => (resolveEnd = r));

  const args = ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--hide-scrollbars'];
  // Sans GPU (headless), Chromium n'active WebGL en logiciel (SwiftShader) qu'avec ce drapeau.
  if (!headed) args.push('--enable-unsafe-swiftshader');
  const browser = await chromium.launch({ headless: !headed, args, ...(browserPath ? { executablePath: browserPath } : {}) });
  let timeline;
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      locale: 'fr-FR',
      recordVideo: { dir: videoTmp, size: VIEWPORT, fps },
    });
    await context.exposeBinding('__starwayRecord', (_source, detail) => {
      const ev = { ...detail, receivedAt: Date.now() };
      if (typeof ev.t !== 'number') ev.t = ev.receivedAt;
      events.push(ev);
      const label = ev.type === 'step' ? `étape ${ev.index + 1}/${expectedSteps} « ${ev.id} »` : ev.type;
      console.log(`  [${new Date(ev.receivedAt).toISOString().slice(11, 23)}] ${label}${ev.reason ? ` : ${ev.reason}` : ''}`);
      if (ev.type === 'ready') resolveReady(ev);
      if (ev.type === 'end' || ev.type === 'abort') resolveEnd(ev);
    });
    await context.addInitScript((eventName) => {
      window.addEventListener(eventName, (e) => {
        // eslint-disable-next-line no-undef
        window.__starwayRecord?.(e.detail ?? {});
      });
    }, RECORD_EVENT);

    const page = await context.newPage();
    // La vidéo Playwright commence à la création de la page : c'est l'origine des temps.
    const videoStartedAt = Date.now();
    page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

    console.log(`  Ouverture de ${url}`);
    await page.goto(url, { waitUntil: 'load' });

    const readyEv = await Promise.race([ready, delay(hookTimeoutMs).then(() => null)]);
    if (!readyEv) {
      await context.close();
      writeFileSync(path.join(workDir, 'console.log'), consoleLines.join('\n'), 'utf8');
      throw new Error(
        `Aucun événement « ${RECORD_EVENT} » de type « ready » après ${hookTimeoutMs / 1000} s.\n` +
          `Le front n'expose pas encore le mode enregistrement : voir tools/record-tour/README.md, « Hook à ajouter dans le front ».\n` +
          `Console de la page : ${rel(path.join(workDir, 'console.log'))}`,
      );
    }
    const endEv = await Promise.race([end, delay(endTimeoutMs).then(() => null)]);
    // Sous charge, l'image a plusieurs secondes de retard sur les signaux : fermer dès « end » perdrait le générique.
    if (endEv?.type === 'end' && endHoldMs > 0) {
      console.log(`  Attente de ${endHoldMs / 1000} s pour recevoir les dernières images`);
      await delay(endHoldMs);
    }
    const closeRequestedAt = Date.now();
    const video = page.video();
    await page.close();
    const rawPath = path.join(workDir, 'raw.webm');
    await video.saveAs(rawPath);
    await context.close();
    await video.delete().catch(() => {});

    timeline = {
      _comment: 'Écrit par tools/record-tour. Temps en millisecondes depuis l\'époque Unix (horloge de la machine).',
      tourId,
      url,
      viewport: VIEWPORT,
      fps,
      headed: Boolean(headed),
      playwright: playwrightVersion(),
      videoStartedAt,
      closeRequestedAt,
      endHoldMs,
      timedOut: !endEv,
      events,
    };
    writeFileSync(path.join(workDir, 'timeline.json'), JSON.stringify(timeline, null, 2) + '\n', 'utf8');
    writeFileSync(path.join(workDir, 'console.log'), consoleLines.join('\n'), 'utf8');
    if (!endEv) throw new Error(`Pas d'événement « end » après ${endTimeoutMs / 1000} s : enregistrement interrompu (vidéo brute conservée dans ${rel(rawPath)}).`);
    if (endEv.type === 'abort') throw new Error(`La visite s'est arrêtée (abort) : ${endEv.reason ?? 'raison non précisée'}. Voir ${rel(path.join(workDir, 'console.log'))}.`);
  } finally {
    await browser.close();
  }
  return timeline;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
