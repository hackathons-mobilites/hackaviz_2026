#!/usr/bin/env node
/**
 * Joue la visite guidée de bout en bout dans Chromium, sur le ciel PAR DÉFAUT (44 astres), en temps réel (≈ 3 à 4 min) :
 *
 *   node scripts/smoke-tour.mjs <url-de-base> [lea|lea-video]
 *   ex. node scripts/smoke-tour.mjs http://127.0.0.1:4390
 *
 * Sans version : joue les DEUX (version complète `lea`, version courte `lea-video`), puis contrôle le mode d'enregistrement.
 * Le clic sur « Lancer la visite » ouvre le choix de la version (Échap referme sans lancer, contrôlé), la version est prise au
 * clavier. La visite passe par TOUTES les étapes de `public/tour/<id>/tour.resolved.json`
 * dans l'ordre, avec le texte résolu, sans erreur de console ni exception. Aucune étape n'est « jouée » à voix
 * haute ici (Chromium sans son) : c'est le texte annoncé de chaque étape qui est contrôlé. Un seul navigateur, fermé à la
 * fin ; à lancer sous le verrou (NIGHT-RULES).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const { chromium } = await import(pathToFileURL(resolve(here, '../../tools/record-tour/node_modules/playwright/index.mjs')).href);
const base = (process.argv[2] ?? '').replace(/\/$/, '');
const versionArg = process.argv.slice(3).find((a) => !a.startsWith('--'));
const TOUR_IDS = versionArg ? [versionArg] : ['lea', 'lea-video'];
/** `--son` : joue avec le son et la voix demandés (`&sound=on&voice=on`) ; sans lui, les réglages par défaut. Dans les deux cas, aucun ancien MP3 ne doit être demandé. */
const withSound = process.argv.includes('--son');
if (!base) {
  console.error('Usage : node scripts/smoke-tour.mjs <url-de-base> [tour]');
  process.exit(2);
}
let tourId;
let resolved;
let expected;
const norm = (t) => t.replace(/\s+/g, ' ').trim();

/**
 * CONTRÔLE « la visite dit les chiffres du site » (06/11) dans le navigateur : à chaque étape qui cite le compteur ou
 * le ciel, le nombre dit est comparé à ce que la page AFFICHE (détail du compteur, résumé du ciel, en-tête B du diptyque).
 * `oralToNumber` lit « près de 2,6 millions de postes », « près de 55 000 » ; la tolérance est le demi-pas de l'arrondi oral.
 */
const digits = (s) => Number(String(s).replace(/\D/g, ''));
function oralToNumber(s) {
  const m = /([\d\u00a0\u202f ]+(?:,\d+)?)\s*(millions?)?/.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/[\u00a0\u202f ]/g, '').replace(',', '.'));
  return m[2] ? { value: n * 1e6, tol: 50_000 } : { value: n, tol: n >= 100_000 ? 5_000 : 500 };
}
const near = (oral, shown) => {
  const o = oralToNumber(oral);
  return !!o && Math.abs(o.value - shown) <= o.tol;
};
async function pageFigures(page) {
  return page.evaluate(() => ({
    counter: document.querySelector('.counter-caption .sr-only')?.textContent ?? '',
    summary: [...document.querySelectorAll('p.sr-only[aria-live]')].map((e) => e.textContent ?? '').find((t) => /éclairé/.test(t)) ?? '',
    panes: [...document.querySelectorAll('.pane-stat')].map((e) => e.textContent ?? ''),
    // textContent : les plis fermés du panneau (lot 5) restent lisibles par le test, la ligne d'une commune y est même fermée
    panel: document.body.textContent ?? '',
    day: new URL(location.href).searchParams.get('d'),
    pole: new URL(location.href).searchParams.get('p'),
    halo: new URL(location.href).searchParams.get('h'),
    vs: new URL(location.href).searchParams.get('vs'),
    haloPanel: document.querySelector('.halo-panel')?.textContent ?? '',
    haloTitle: document.querySelector('#halo-title')?.textContent ?? '',
    // Lot 5 (D-052) : plis du panneau de preuve ouverts, et ouverture des blocs commentés par les étapes recrutement et moyens
    openGroups: [...document.querySelectorAll('.pf-group')].filter((g) => g.querySelector('details.pf-group-fold')?.open).map((g) => g.getAttribute('data-group')),
    recruitOpen: (() => { const d = document.querySelector('.pf-recruit')?.closest('details'); return d ? d.open : null; })(),
    transportsOpen: (() => { const ds = [...document.querySelectorAll('.pf-transports details')]; return ds.length ? ds.some((d) => d.open) : null; })(),
    // Barre compacte : le curseur du temps de trajet reste visible et n'est recouvert par rien (ni tiroir ni sous-titres)
    budget: (() => {
      const el = document.getElementById('budget-range');
      if (!el) return { present: false };
      const r = el.getBoundingClientRect();
      const inView = r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { present: true, inView, covered: !(hit && (hit === el || el.contains(hit) || hit.closest('.budget-range, .field, .scenario-bar') != null)), hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null };
    })(),
  }));
}
function checkFigures(stepId, text, f, failures) {
  const reached = (/^\W*([\d\s\u00a0\u202f]+) postes salariés sont atteints aller et retour/.exec(f.counter) ?? [])[1];
  const stars = (/(\d+) pôles? sur \d+ éclairés? en partie ou en entier/.exec(f.summary) ?? [])[1];
  const said = (re) => (re.exec(text) ?? [])[1];
  const fail = (m) => failures.push(`étape ${stepId} : ${m}`);
  // Lot 5 (D-052) : plis du panneau. Recrutement : le bloc des projets de recrutement est ouvert ; moyens : « Détail du trajet »,
  // « Coût et carbone » et « Comparer les moyens » sont ouverts et le pli du recrutement s'est refermé.
  if (stepId === 'acte2-recrutement' && f.recruitOpen !== true) fail(`le pli « Emplois et recrutement » n'est pas ouvert (recruitOpen=${f.recruitOpen})`);
  if (stepId === 'acte4-moyens') {
    if (f.transportsOpen !== true) fail(`le pli « Détail du trajet » n'est pas ouvert (transportsOpen=${f.transportsOpen})`);
    for (const g of ['cout', 'moyens']) if (!f.openGroups.includes(g)) fail(`le pli « ${g} » n'est pas ouvert (ouverts : ${f.openGroups.join(', ') || 'aucun'})`);
    if (f.recruitOpen === true) fail('le pli du recrutement est resté ouvert à l\'étape des moyens de transport');
  }
  // Barre compacte : le curseur du temps de trajet reste visible, rien ne le recouvre (la carte miroir est une vue à part)
  if (stepId !== 'acte1-carte' && stepId !== 'prologue') {
    if (!f.budget.present) fail('le curseur du temps de trajet n\'est plus dans la page');
    else if (!f.budget.inView || f.budget.covered) fail(`le curseur du temps de trajet n'est pas visible ou est recouvert (${JSON.stringify(f.budget)})`);
  }
  // Étapes BMO et moyens de transport : la fiche de Paris 8e est ouverte en 9h-17h, jamais en 14h-22h (06/11 : retour de 76 min
  // non confirmé par Navitia). Aucun temps écrit ici : les minutes attendues sont celles que l'étape « preuve » dit (lues dans
  // les données publiées par la résolution) et le panneau doit les afficher telles quelles.
  if (stepId === 'acte2-recrutement' || stepId === 'acte4-moyens') {
    if (f.day !== 'd09' || f.pole !== 'BE_1107_75108') fail(`la fiche attendue est Paris 8e en 9h-17h, l'écran est en ${f.day} avec ${f.pole}`);
    const preuve = norm(resolved.steps.find((s) => s.id === 'acte1-preuve')?.text ?? '');
    // version courte (11/11) : « L’aller prend 53 minutes. […] le retour en prend 53, attente comprise. »
    const out = (/(?:arriver avant [^:]*: |l’aller prend )(\d+) minutes/i.exec(preuve) ?? [])[1];
    const ret = (/le retour (?:en )?prend (\d+)/i.exec(preuve) ?? [])[1];
    const panel = f.panel.replace(/\s+/g, ' ');
    if (!out || !ret) fail('les temps de Paris 8e ne se lisent pas dans l’étape « preuve »');
    else if (!new RegExp(`aller(?: ·)? ${out} min`, 'i').test(panel) || !new RegExp(`retour(?: ·)? ${ret} min`, 'i').test(panel)) fail(`le bloc « Trajet » de Paris 8e n’affiche pas « Aller · ${out} min » et « Retour · ${ret} min » (ceux de l’étape preuve : les durées de l’exemple de trajet)`);
  }
  if (stepId === 'acte1-ciel' || stepId === 'acte4-voiture') {
    const n = said(/(\d+) étoiles/);
    if (n && n !== stars) fail(`le texte dit ${n} étoiles, le ciel affiche « ${stars ?? 'rien'} éclairés »`);
    // version courte : « : près de 2,6 millions de postes », « , plus de 4,2 millions de postes »
    const jobs = said(/(?:Soit |et |: |, )((?:près de |plus de )?[\d,\u00a0\u202f ]+(?: millions?)?) de postes/);
    if (!reached) fail('aucun compteur affiché');
    else if (!jobs || !near(jobs.replace(/^(près de|plus de) /, ''), digits(reached))) fail(`le texte dit « ${jobs} », le compteur affiche ${reached}`);
  }
  // 06/11 (recoupement Navitia) : l'éclipse ne dit aucun nombre ; le compteur reste affiché par le site
  if (stepId === 'acte2-eclipse' && !reached) fail('aucun compteur affiché');
  // Le soir : les temps dits sont ceux de la ligne de la commune d'ancrage (Poissy) dans le panneau de preuve
  if (stepId === 'acte2-pole') {
    const out = said(/[Ll]’aller prend (\d+) minutes/) ?? said(/(\d+) minutes à l’aller/);
    // « Le retour en prend » (vidéo réécrite le 10/11, PR 148) ou « le retour en prend » (site)
    const ret = said(/[Ll]e retour en prend (\d+),/) ?? said(/, (\d+) au retour/);
    const panel = f.panel.replace(/\s+/g, ' ');
    const row = /Poissy.{0,200}/.exec(panel)?.[0] ?? '';
    if (!out || !ret) fail('aller ou retour absent du texte');
    else if (!new RegExp(`aller ${out} min`, 'i').test(panel) || !new RegExp(`retour ${ret} min`, 'i').test(panel)) fail(`le texte dit ${out} et ${ret} minutes, le panneau n'affiche pas « aller ${out} min » et « retour ${ret} min » (ligne Poissy : ${row.slice(0, 120)})`);
  }
  if (stepId === 'halo') {
    // 06/11 20h41 : le halo s'ouvre sur DEUX communes, en 9h-17h, la comparaison restant ouverte (A · commune de Léa, B · Montesson)
    if (f.day !== 'd09') fail(`le halo doit être en 9h-17h, l'écran est en ${f.day}`);
    if (f.halo !== 'income') fail(`le halo « niveau de vie » n'est pas ouvert (h=${f.halo})`);
    if (!f.vs) fail('la comparaison n’est plus ouverte pendant le halo (vs absent) : une seule commune est affichée');
    if (!/A · .+ et B · /.test(f.haloTitle)) fail(`le halo n'affiche pas les deux communes (titre : « ${f.haloTitle} »)`);
    // chaque nom de commune dit par le texte est lu dans le panneau
    // texte réécrit le 11/11 : une commune par phrase (« … par an à A. Il est d’environ … euros à B. Ce halo … »)
    for (const name of [(/ par an à ([^.]+)\./.exec(text) ?? [])[1], (/ euros à ([^.]+)\. Ce halo/.exec(text) ?? [])[1]])
      if (!name || !f.haloPanel.includes(name)) fail(`le panneau du halo n'affiche pas « ${name ?? '?'} »`);
  }
  if (stepId === 'acte3-horizons') {
    const jobs = said(/(plus de [\d\u00a0\u202f ]+|près de [\d\u00a0\u202f ]+) postes/);
    const b = (f.panes[1] ?? '').match(/^([\d\s\u00a0\u202f]+) postes/)?.[1];
    if (!b || !jobs || !near(jobs.replace(/^(près de|plus de) /, ''), digits(b))) fail(`le texte dit « ${jobs} », l'en-tête B affiche ${b ?? 'rien'}`);
  }
}

const failures = [];

/**
 * CONTRÔLE « aucun ancien MP3, aucun ancien texte » (07/11) : les MP3 et WebVTT de `public/tour/lea/` datent de la v3 (03/11) et sont
 * périmés ; la visite se joue en sous-titres seuls tant que `tour.resolved.json` ne porte aucun `durationMs`. (1) Aucune requête vers un
 * `.mp3` ou un `.vtt` de `/tour/` n'est permise, sauf pour une étape dont le manifeste annonce un `durationMs` (voix régénérée, texte
 * identique : `stepAudio`). (2) Aucune ancienne phrase ne doit s'afficher : le sous-titre (toujours) et la page entière (phrases qui n'ont
 * pas d'autre raison d'être à l'écran) sont relus à chaque cycle. Une phrase périmée n'est tolérée que si le texte RÉSOLU de la
 * visite (lu dans les données publiées, site ou vidéo) la dit : aucune valeur de transports n'est écrite ici comme attendue.
 */
const norm2 = (t) => norm(t).replace(/[’‘]/g, "'");
const resolvedAll = ['lea', 'lea-video']
  .map((id) => {
    try {
      return JSON.parse(readFileSync(resolve(here, `../public/tour/${id}/tour.resolved.json`), 'utf-8')).steps.map((s) => s.text).join(' ');
    } catch {
      return '';
    }
  })
  .join(' ');
const resolvedNorm = norm2(resolvedAll);
const STALE_ALWAYS = ['Pas le même horizon', 'Ce halo décrit qui vit ici', '26 étoiles', '3,8 millions', 'retour de 76', 'retour 76 min'];
const STALE_SUBTITLE_ONLY = ['bus de remplacement', 'bus du RER A', "offres d'emploi", 'emplois disponibles', 'postes vacants', 'regagne', 'étoiles de moins'];
const staleAllowed = (p) => resolvedNorm.includes(norm2(p)) || (/76/.test(p) && /\b76 minutes\b/.test(resolvedNorm));
const staleHits = (haystack, phrases) => phrases.filter((p) => haystack.includes(norm2(p)) && !staleAllowed(p));
let allowedAudio;
let audioRequests;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu', '--mute-audio'] });
/** Ouvre le choix, vérifie Échap (ferme sans lancer, focus rendu au bouton), puis prend la version au clavier. */
async function chooseVersion(page, id) {
  const trigger = page.getByRole('button', { name: /Lancer la visite/ }).first();
  const dialog = page.locator('.tour-choice');
  await trigger.click({ timeout: 90000 });
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForFunction(() => document.activeElement?.classList.contains('tour-choice-option'), null, { timeout: 5000 }).catch(() => failures.push('le focus n’arrive pas sur une version à l’ouverture du choix'));
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 5000 });
  if ((await page.locator('.tour-overlay').count()) > 0) failures.push('Échap sur le choix a lancé la visite');
  if (!(await trigger.evaluate((el) => el === document.activeElement))) failures.push('après Échap, le focus n’est pas revenu sur « Lancer la visite »');
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  const ids = await page.locator('.tour-choice-option').evaluateAll((els) => els.map((el) => el.dataset.tourVersion));
  if ([...ids].sort().join() !== 'lea,lea-video') failures.push(`versions proposées inattendues : ${ids.join()}`);
  for (let i = 0; i < ids.indexOf(id); i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}

/** Mode enregistrement (vidéo) : la visite courte démarre sans aucun geste et sans afficher le choix ; son fichier est servi. */
async function checkRecordMode() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  try {
    const manifest = await page.request.get(`${base}/tour/lea-video/tour.resolved.json`);
    if (!manifest.ok() || !(manifest.headers()['content-type'] ?? '').includes('json')) failures.push(`/tour/lea-video/tour.resolved.json non servi (HTTP ${manifest.status()})`);
    await page.goto(`${base}/?tour=lea-video&record=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => ['step', 'abort'].includes(document.documentElement.dataset.recordState ?? ''), null, { timeout: 120000 });
    const state = await page.evaluate(() => document.documentElement.dataset.recordState);
    if (state !== 'step') failures.push(`mode enregistrement : état « ${state} » au lieu de « step »`);
    if ((await page.locator('.tour-choice').count()) > 0) failures.push('le choix de la version s’affiche en mode enregistrement');
    console.log(`Mode enregistrement (?tour=lea-video&record=1) : état « ${state} », aucun choix affiché.`);
  } finally {
    await page.close();
  }
}

/** Joue une version de bout en bout, de la page d'accueil à la dernière étape. */
async function playVersion() {
  audioRequests = [];
  allowedAudio = new Set(
    resolved.steps
      .map((s, i) => (typeof s.durationMs === 'number' && s.durationMs > 0 ? `${String(i + 1).padStart(2, '0')}-${s.id}` : null))
      .filter(Boolean),
  );
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', (m) => {
    const t = m.text();
    if (/Refused to/i.test(t)) failures.push(`violation CSP : ${t.slice(0, 200)}`);
    else if (m.type() === 'error' && !/Failed to load resource/.test(t)) failures.push(`erreur console : ${t.slice(0, 200)}`);
    else if (/visite|tour/i.test(t) && m.type() === 'warning') console.log(`  (avertissement) ${t.slice(0, 200)}`);
  });
  page.on('pageerror', (e) => failures.push(`exception : ${e.message.slice(0, 200)}`));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (r.status() >= 400 && u.pathname.startsWith('/data/')) failures.push(`${r.status()} sur ${u.pathname}`);
  });

  page.on('request', (r) => {
    const u = new URL(r.url());
    const m = /\/tour\/([^/]+)\/([^/]+)\.(mp3|vtt)$/.exec(u.pathname);
    if (!m) return;
    audioRequests.push(u.pathname);
    if (m[1] === tourId && allowedAudio.has(m[2])) return;
    failures.push(`ancien fichier de voix demandé pendant la visite : ${u.pathname} (aucun durationMs dans tour.resolved.json pour cette étape : voix périmée)`);
  });

  await page.goto(`${base}/?o=78358&d=d09&b=60&m=transit${withSound ? '&sound=on&voice=on' : ''}`, { waitUntil: 'load' });
  await chooseVersion(page, tourId);
  console.log(`Visite ${tourId} lancée sur le ciel`);

  const seen = [];
  const t0 = Date.now();
  let ended = false;
  while (Date.now() - t0 < 9 * 60 * 1000 && !ended) {
    await page.waitForTimeout(400);
    // 06/11 16h40 : à aucun moment la fiche de Paris 8e ne doit être affichée en 14h-22h (retour de 76 min non confirmé par Navitia)
    {
      const q = new URL(page.url()).searchParams;
      if (q.get('d') === 'd14' && q.get('p') === 'BE_1107_75108') {
        const msg = `la fiche de Paris 8e est affichée en 14h-22h (${page.url().slice(-80)})`;
        if (!failures.includes(msg)) failures.push(msg);
      }
    }
    const text = await page.evaluate(() => document.querySelector('.tour-overlay .sr-only')?.textContent ?? null).catch(() => null);
    // Anciens textes : relus à chaque cycle, dans le sous-titre (tout le bloc de la visite) et dans la page entière
    {
      const dom = await page
        .evaluate(() => ({ overlay: document.querySelector('.tour-overlay')?.textContent ?? '', page: document.body.innerText ?? '' }))
        .catch(() => null);
      if (dom) {
        const ov = norm2(dom.overlay);
        const pg = norm2(dom.page);
        for (const p of staleHits(ov, [...STALE_ALWAYS, ...STALE_SUBTITLE_ONLY])) failures.push(`ancien texte dans le sous-titre : « ${p} »`);
        for (const p of staleHits(pg, STALE_ALWAYS)) failures.push(`ancien texte à l'écran : « ${p} »`);
      }
    }
    if (text) {
      const t = norm(text);
      if (!seen.length || seen[seen.length - 1] !== t) {
        seen.push(t);
        const idx = expected.findIndex((e) => norm(e) === t);
        console.log(`  [${String(Math.round((Date.now() - t0) / 1000)).padStart(3)} s] ${idx >= 0 ? `étape ${idx + 1}` : 'texte hors visite'} : ${t.slice(0, 70)}`);
        if (idx >= 0) {
          // le ciel est posé quand le texte s'affiche, sauf le glisser de la jauge (acte 1) et le diptyque qui s'ouvre : on relit
          // l'écran jusqu'à ce qu'il dise le texte (30 s au plus, ou jusqu'à la fin de l'étape) ; une vérification est un échec seulement
          // si elle n'a été vraie à AUCUN moment de l'étape (un pli ouvert par la visite se referme à l'étape suivante)
          const id = resolved.steps[idx].id;
          let f = await pageFigures(page);
          let errs = [];
          let persistent = null;
          for (let k = 0; k < 60; k++) {
            errs = [];
            checkFigures(id, t, f, errs);
            persistent = persistent ? persistent.filter((m) => errs.includes(m)) : errs;
            if (!persistent.length) break;
            await page.waitForTimeout(500);
            const now = await page.evaluate(() => document.querySelector('.tour-overlay .sr-only')?.textContent ?? '').catch(() => '');
            if (norm(now) !== t) break;
            f = await pageFigures(page);
          }
          errs = persistent ?? [];
          failures.push(...errs);
          if (!errs.length)
            console.log(`      écran : compteur ${(f.counter.match(/[\d\s\u00a0\u202f]+ postes salariés sont atteints/) ?? ['-'])[0].trim()} ; ${f.panes[1] ? `en-tête B ${f.panes[1].slice(0, 30)} ; ` : ''}ciel ${(f.summary.match(/\d+ pôles? sur \d+ éclairés?/) ?? ['-'])[0]} : même chiffre que le texte`);
        }
      }
      // fin : dernier texte de CETTE version, une fois toutes ses étapes passées
      ended = t === norm(expected[expected.length - 1]) && seen.length > expected.length - 1;
    }
  }
  // ordre des étapes
  const order = seen.map((t) => expected.findIndex((e) => norm(e) === t)).filter((i) => i >= 0);
  const missing = expected.map((_, i) => i).filter((i) => !order.includes(i));
  if (missing.length) failures.push(`étapes jamais affichées : ${missing.map((i) => `${i + 1} (${resolved.steps[i].id})`).join(', ')}`);
  if (order.some((v, i) => i > 0 && v < order[i - 1])) failures.push(`étapes dans le désordre : ${order.join(',')}`);
  if (!ended) failures.push('la visite ne s’est pas terminée dans le délai');
  const url = new URL(page.url());
  if (url.searchParams.has('astres')) failures.push(`le paramètre astres a reparu dans l'adresse : ${url.search}`);
  if (url.searchParams.has('visite')) failures.push('le paramètre visite=1 est resté dans l’adresse');
  console.log(`Étapes vues : ${order.length} sur ${expected.length} en ${Math.round((Date.now() - t0) / 1000)} s.`);
  console.log(`Requêtes vers des .mp3 ou .vtt de /tour/ pendant la visite${withSound ? ' (son et voix demandés)' : ''} : ${audioRequests.length}${audioRequests.length ? ` (${audioRequests.slice(0, 5).join(', ')})` : ''} ; anciens textes cherchés : ${[...STALE_ALWAYS, ...STALE_SUBTITLE_ONLY].length} phrases, relus à chaque cycle.`);
  await page.close();
}

try {
  for (const id of TOUR_IDS) {
    tourId = id;
    resolved = JSON.parse(readFileSync(resolve(here, `../public/tour/${tourId}/tour.resolved.json`), 'utf-8'));
    expected = resolved.steps.map((s) => s.text);
    await playVersion();
  }
  if (!versionArg || versionArg === 'lea-video') await checkRecordMode();
} catch (e) {
  failures.push(String(e).slice(0, 300));
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\nVisite en échec :\n- ${[...new Set(failures)].join('\n- ')}`);
  process.exit(1);
}
console.log(`\nVisite (${TOUR_IDS.join(', ')}) jouée de bout en bout sur le ciel à 44 astres.`);
