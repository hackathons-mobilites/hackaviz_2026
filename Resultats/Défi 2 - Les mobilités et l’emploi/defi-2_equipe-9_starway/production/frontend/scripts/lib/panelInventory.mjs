/**
 * Inventaire des phrases de l'interface : logique pure, sans navigateur (testée dans src/data/panelInventory.test.ts).
 *
 * But (chantier C, « alléger sans rien perdre ») : aucune phrase ne disparaît d'un lot à l'autre sans une
 * exception écrite et justifiée. On compare des PHRASES, jamais des valeurs : les chiffres sont neutralisés, de sorte qu'une
 * relance de calculs ne fait échouer aucun contrôle.
 *
 * Trois états pour une phrase, du plus visible au moins visible :
 * - `visible` : lue sans rien ouvrir ;
 * - `fold`    : lue seulement après ouverture d'un repli ;
 * - `tip`     : lue dans une explication « i » (bulle).
 */

/** Du plus visible au moins visible. */
export const STATES = ['visible', 'fold', 'tip'];

const RANK = { visible: 0, fold: 1, tip: 2 };

/** Chiffres neutralisés : « 1 234,5 min » devient « # min ». Aucune valeur n'entre dans la comparaison. */
const NUMBER = /\d+(?:[\u00a0\u202f ]\d{3})*(?:[.,]\d+)?/g;

/** Texte comparable : espaces insécables et apostrophes normalisés, casse ignorée (les titres du panneau sont mis en capitales par la feuille de style), chiffres remplacés par « # ». */
export function neutralize(text) {
  return String(text)
    .normalize('NFC')
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/[\u2019\u2018]/g, "'")
    .replace(NUMBER, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Phrases d'un texte (une par ligne, puis une par phrase), neutralisées, dédoublonnées, sans les lignes sans lettre. */
export function phrasesOf(text) {
  const out = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    // fin de phrase suivie d'une majuscule, d'un guillemet français ou d'une parenthèse
    for (const sentence of line.split(/(?<=[.!?\u2026])\s+(?=[A-Z\u00c0-\u00d6\u00d8-\u00dd\u00ab("])/)) {
      const n = neutralize(sentence);
      if (/\p{L}/u.test(n)) out.add(n);
    }
  }
  return [...out];
}

/** Zone relevée : { visible: string[], fold: string[], tip: string[] } à partir des trois lectures brutes. */
export function zoneFromTexts({ closed, opened, tips }) {
  const visible = phrasesOf(closed);
  const seen = new Set(visible);
  const fold = phrasesOf(opened).filter((p) => !seen.has(p));
  const known = new Set([...visible, ...fold]);
  const tip = phrasesOf(tips).filter((p) => !known.has(p));
  return { visible: visible.sort(), fold: fold.sort(), tip: tip.sort() };
}

/** État le plus visible d'une phrase dans une zone, ou null si elle est absente. */
export function stateOf(zone, phrase) {
  for (const s of STATES) if (zone?.[s]?.includes(phrase)) return s;
  return null;
}

/** Une exception couvre-t-elle cette phrase de ce scénario et de cette zone ? */
export function isExcepted(exceptions, { scenario, zone, phrase }) {
  return exceptions.some(
    (e) => e.phrase === phrase && (e.scenarios.includes('*') || e.scenarios.includes(scenario)) && (!e.zone || e.zone === zone),
  );
}

/** Phrase à garder visible : sa neutralisation contient le fragment (déjà neutralisé) de la liste. */
export function matchesKeep(keepVisible, { scenario, zone, phrase }) {
  return keepVisible.some(
    (k) => phrase.includes(k.fragment) && (!k.scenarios || k.scenarios.includes('*') || k.scenarios.includes(scenario)) && (!k.zone || k.zone === zone),
  );
}

/**
 * Niveau minimal exigé d'une phrase à garder (champ `au_moins` de keep-visible.json, défaut `visible`) : le plus exigeant des
 * fragments qui la couvrent. `fold` (audit d'affichage du 10/11, lot 4) : la phrase doit rester lisible dans son pli, jamais
 * seulement dans un « i » ni disparaître ; `--strict` ne l'exige pas pli fermé.
 */
export function keepLevel(keepVisible, { scenario, zone, phrase }) {
  let level = null;
  for (const k of keepVisible) {
    if (!matchesKeep([k], { scenario, zone, phrase })) continue;
    const l = k.au_moins === 'fold' ? 'fold' : 'visible';
    if (level === null || RANK[l] < RANK[level]) level = l;
  }
  return level;
}

/**
 * Compare le relevé courant à la référence. Retourne :
 * - `missing`  : phrases de la référence absentes du relevé courant et sans exception (ÉCHEC) ;
 * - `degraded` : phrases à garder visibles (liste `keepVisible`) devenues moins visibles qu'à la référence (ÉCHEC) ;
 * - `notVisible` : phrases à garder visibles qui ne le sont pas (information ; ÉCHEC avec `strict`) ;
 * - `added`    : phrases nouvelles (information).
 */
export function compareInventories({ baseline, current, exceptions = [], keepVisible = [], strict = false }) {
  const missing = [];
  const degraded = [];
  const notVisible = [];
  const added = [];
  for (const sc of baseline.scenarios) {
    const now = current.scenarios.find((s) => s.id === sc.id);
    if (!now) {
      missing.push({ scenario: sc.id, zone: '*', phrase: '(scénario non relevé)' });
      continue;
    }
    for (const zone of Object.keys(sc.zones)) {
      const before = sc.zones[zone];
      const after = now.zones[zone];
      for (const s of STATES) {
        for (const phrase of before[s] ?? []) {
          const nowState = stateOf(after, phrase);
          if (!nowState) {
            if (!isExcepted(exceptions, { scenario: sc.id, zone, phrase })) missing.push({ scenario: sc.id, zone, phrase, was: s });
            continue;
          }
          if (matchesKeep(keepVisible, { scenario: sc.id, zone, phrase })) {
            if (RANK[nowState] > RANK[s]) degraded.push({ scenario: sc.id, zone, phrase, was: s, now: nowState });
          }
        }
      }
      for (const s of STATES) {
        for (const phrase of after?.[s] ?? []) {
          if (!stateOf(before, phrase)) added.push({ scenario: sc.id, zone, phrase, now: s });
          // strict : toute phrase à garder visible de la page COURANTE (y compris une phrase nouvelle) doit être lue sans rien ouvrir
          // (`au_moins: fold` : lue pli ouvert suffit ; jamais dans un « i » seulement)
          const need = strict ? keepLevel(keepVisible, { scenario: sc.id, zone, phrase }) : null;
          if (need && RANK[s] > RANK[need]) notVisible.push({ scenario: sc.id, zone, phrase, now: s });
        }
      }
    }
  }
  return { missing, degraded, notVisible, added };
}

/**
 * Contrôle de la liste d'exceptions : chaque exception dit pourquoi (justification), à quel lot elle a été décidée,
 * vise une phrase qui existe dans la référence (sinon elle est périmée) et ne contient aucun tiret long.
 * Retourne la liste des problèmes (vide si tout va bien).
 */
export function validateExceptions(exceptions, baseline) {
  const problems = [];
  exceptions.forEach((e, i) => {
    const where = `exception ${i + 1}`;
    if (!e.phrase || neutralize(e.phrase) !== e.phrase) problems.push(`${where} : la phrase doit être écrite neutralisée (minuscules, chiffres remplacés par #)`);
    if (!Array.isArray(e.scenarios) || e.scenarios.length === 0) problems.push(`${where} : scénarios manquants (« * » pour tous)`);
    if (!e.justification || e.justification.trim().length < 30) problems.push(`${where} : justification absente ou trop courte`);
    if (!e.lot) problems.push(`${where} : lot non indiqué`);
    if (/[\u2013\u2014]/.test(JSON.stringify(e))) problems.push(`${where} : tiret cadratin ou demi-cadratin`);
    const exists = baseline.scenarios.some((sc) =>
      Object.entries(sc.zones).some(
        ([zone, z]) => (e.scenarios?.includes('*') || e.scenarios?.includes(sc.id)) && (!e.zone || e.zone === zone) && stateOf(z, e.phrase),
      ),
    );
    if (!exists) problems.push(`${where} : la phrase n'est pas dans la référence (exception périmée) : « ${e.phrase} »`);
  });
  return problems;
}
