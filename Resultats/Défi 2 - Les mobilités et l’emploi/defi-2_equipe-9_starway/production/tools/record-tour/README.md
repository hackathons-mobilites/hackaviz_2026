# tools/record-tour : enregistrement reproductible de la vidéo

Produit la vidéo de STARWAY exigée par le dépôt (3 min maximum) **à partir de l'application réelle** : la visite guidée pilote l'app, Playwright filme la page, ffmpeg pose la narration pré-générée et les sous-titres.

```text
frontend/dist (build)  ──►  Chromium 1920x1080, ?tour=<id>&record=1&subs=0   (Playwright recordVideo, WebM sans son)
                                  │  événements « starway:record » : ready, step (x N), end
                                  ▼
                        .work/<id>/raw.webm + timeline.json
                                  │  ffmpeg : chaque MP3 posé sur l'image de son étape (repérée dans le WebM)
                                  ▼
design/video/starway-<id>.mp4                (H.264 1080p + AAC)
design/video/starway-<id>-sous-titres.mp4    (idem, sous-titres incrustés depuis les .vtt)
design/video/starway-<id>.vtt                (sous-titres fusionnés, à joindre si la plateforme les accepte)
```

L'outil ne calcule ni n'écrit aucune donnée : il lit `frontend/public/tour/<id>/` (produit par `npm run tour:resolve` puis `tools/tour-tts`) et filme ce que l'application affiche.

## Prérequis

| Outil | Version testée | Installation | Licence |
|---|---|---|---|
| Node.js | 24.13 | déjà présent | MIT |
| `playwright` (npm) | 1.64.1, version figée | `npm install` | Apache-2.0 |
| Navigateur Chromium de Playwright | build v1248 | `npm run install:browser` (**chromium seulement**) | voir « Licences » |
| ffmpeg + ffprobe, build « full » | 8.1.2 (gyan.dev) | `winget install Gyan.FFmpeg`, puis rouvrir le terminal | GPL-3.0 (outil externe, non redistribué) |

ffmpeg doit proposer `libx264`, `aac` et le filtre `subtitles` (libass) : c'est le cas de la build « full » de Gyan. S'il n'est pas dans le `PATH`, indiquer son chemin dans `FFMPEG_PATH` et `FFPROBE_PATH`. Le paquet npm `ffmpeg-static` n'est **pas** utilisé : ffmpeg reste un outil installé sur le poste, rien de GPL n'entre dans le dépôt.

```bash
cd tools/record-tour
npm install
npm run install:browser      # ne télécharge que Chromium (déjà présent si une autre install Playwright 1.64 existe)
```

## Commandes

```bash
cd tools/record-tour

# 1. Vérifier les entrées, sans rien enregistrer
npm run dry-run -- lea

# 2. Enregistrer et assembler (sert frontend/dist sur 127.0.0.1, port libre)
cd ../../frontend && npm run build && cd ../tools/record-tour
npm run record -- lea --headed

# 3. Réassembler sans refilmer (ex. après correction de --av-offset-ms ou du style des sous-titres)
npm run record -- lea --assemble-only --av-offset-ms 120
npm run record -- lea --assemble-only --av-offset-ms -500    # valeur négative acceptée, avec espace ou avec « = »

# Tests unitaires (alignement, contrôle final, ligne de commande), sans navigateur ni ffmpeg
npm test

# Test de l'outil sur les fixtures FICTIVES (bips + mire de test), sans navigateur
npm run test:sample
```

Options principales (`node src/cli.mjs --help` pour la liste complète) :

| Option | Effet |
|---|---|
| `--dry-run` | valide `tour.resolved.json`, chaque MP3 (présence, durée ffprobe), chaque VTT (syntaxe, ordre, fin de la dernière cue), les fichiers orphelins, `processing_version` contre `meta.json`, la copie dans `frontend/dist`, ffmpeg et ses capacités ; affiche la durée de narration estimée. Code de sortie 1 en cas d'erreur. |
| `--url <url>` | filme une URL au lieu de servir `frontend/dist` (ex. `http://localhost:5173/` avec `npm run dev`). |
| `--tour-dir <dossier>` | autre dossier d'entrée (ex. `samples/fictif`). |
| `--headed` | navigateur visible : WebGL tourne sur le GPU. **Recommandé** pour la vidéo finale. |
| `--fps <n>` | cadence de capture et du MP4, 30 par défaut. |
| `--front-subtitles` | laisse le front afficher ses propres sous-titres (sinon `subs=0` est ajouté à l'URL, et seule la variante incrustée en porte). |
| `--sync <bar\|events>` | `bar` (défaut) : chaque MP3 est posé sur l'image de son étape, mesurée dans le WebM ; échec explicite si la barre de progression n'est pas lisible. `events` : horloges seules, réservé aux fixtures sans barre (`test:sample`). |
| `--end-hold <s>` | garde la page ouverte après `end` pour recevoir les dernières images (12 s par défaut, au-dessus du plus grand retard mesuré le 09/11 : 10,4 s). |
| `--av-offset-ms <n>` | décale tout l'audio et les sous-titres (positif = son plus tard, négatif = son plus tôt). 0 par défaut ; à n'utiliser qu'après contrôle visuel. |
| `--preset <p>` | preset libx264 (`slow` par défaut, CRF 18). |
| `--browser-path <exe>` | utilise un autre exécutable Chromium (voir « Licences »). |
| `--no-subtitled` | ne produit pas la variante sous-titrée. |

## Sorties

| Fichier | Contenu |
|---|---|
| `design/video/starway-<id>.mp4` | H.264 High, 1920x1080, `--fps`, yuv420p, AAC 48 kHz stéréo 192 kb/s, `+faststart`. |
| `design/video/starway-<id>-sous-titres.mp4` | idem, sous-titres incrustés (libass, Arial blanc contour sombre ; `--subtitle-style` pour changer). |
| `design/video/starway-<id>.vtt` | tous les cues des étapes, recalés sur la vidéo. |
| `tools/record-tour/.work/<id>/` | `raw.webm`, `timeline.json` (événements horodatés), `subs.srt`, `console.log` de la page. Ignoré par git. |

La vidéo va de l'événement `ready` à l'événement `end`, situés sur l'image (voir ci-dessous). Chaque MP3 `NN-<stepId>.mp3` est posé à l'instant où son étape apparaît à l'écran (pas à une somme théorique de `durationMs` : la durée des transitions du ciel n'est connue qu'à l'exécution). Les `.vtt` de chaque étape sont décalés de la même façon. L'outil signale, sans rien corriger en silence :
- une étape absente, répétée ou dans le désordre (visite mise en pause ou sautée) : erreur ;
- une barre de progression illisible dans le WebM : erreur ;
- un audio qui chevauche l'étape suivante ou dépasse la fin de la vidéo : avertissement ;
- une fin de générique perdue parce que le WebM s'arrête trop tôt : avertissement ;
- image et son de durées différentes dans le MP4 : erreur (contrôle final, ci-dessous) ;
- une vidéo de plus de 3 min (limite du brief) : avertissement, rien n'est coupé.

## Alignement image / son

L'essai à blanc du 09/11 (poste à 100 % de CPU, rendu logiciel) a montré que les horloges ne suffisent pas. Le WebM de 156,4 s avait 10,07 s de moins que l'horloge de l'enregistreur (166,5 s), et la coupe ancrée sur `videoStartedAt` donnait un MP4 avec 146,8 s d'image pour 156,8 s de son. Mesure faite dans le WebM (`ffmpeg`, luminance de la barre de progression image par image) :

| Étape | Signal `step` après `ready` | Cran de la barre dans le WebM | Retard de l'image |
|---|---|---|---|
| 2 | 22,868 s | 29,967 s | 7,10 s |
| 3 | 44,819 s | 51,300 s | 6,48 s |
| 4 | 72,850 s | 77,800 s | 4,95 s |
| 5 | 87,934 s | 92,267 s | 4,33 s |
| 6 | 102,131 s | 108,500 s | 6,37 s |
| 7 | 116,171 s | 126,533 s | 10,36 s |
| 8 | 130,354 s | 136,233 s | 5,88 s |
| 9 | 144,106 s | 149,867 s | 5,76 s |

Deux causes s'additionnent : le WebM commence à la **première image peinte** (Playwright supprime le vide avant elle), et sous charge **l'image est en retard sur les signaux du front**, d'un retard qui varie d'une étape à l'autre. Le WebM s'arrête aussi avant le générique : la page est fermée dès `end`, alors que l'image a plusieurs secondes de retard. Aucun décalage constant, ni ancrage sur le début ou sur la fin du WebM, ne recale donc la vidéo : un ancrage sur la fin aurait placé `ready` à -0,4 s du WebM, alors que l'écran-titre y disparaît à 6,5 s.

L'outil mesure donc l'image (`src/sync.mjs`) :
1. Il repère la barre de progression sur une image de la fin du WebM (la ligne la plus claire du bas de l'écran), en remontant jusqu'à 30 s avant la fin : sur un poste au repos (`--headed`, 11/11), l'image n'a plus de retard, et les 12 s de `--end-hold` puis le générique montrent le ciel sans panneau.
2. Il lit sa luminance image par image : la barre avance d'un cran à chaque étape, dans le même tour de boucle que le signal `step` (`TourPlayer.goTo`). Le prologue n'a pas de cran : il garde son écart de signaux avec l'étape 2.
3. Chaque MP3 est posé sur le cran de son étape. La vidéo commence à `ready`, situé dans le WebM par le plus petit retard observé, ce qui garde l'écran-titre. Sa fin suit le dernier cran, sans dépasser le WebM.

L'enregistreur garde la page ouverte `--end-hold` secondes après `end` pour que le générique arrive jusqu'au WebM. Les fixtures FICTIVES n'ont pas de barre : `test:sample` utilise `--sync events`.

## Procédure du jour de l'enregistrement (jeudi)

Poste au repos (aucun calcul ni build en parallèle), visite `lea-video` avec la voix validée :

```bash
cd frontend && npm run build && cd ../tools/record-tour
npm run dry-run -- lea-video
npm run record -- lea-video --headed
```

**À lire dans la sortie, avant de regarder la vidéo :**

1. La ligne de chaque étape : `retard sur le signal` doit rester stable et petit sur un poste au repos. Un retard de plusieurs secondes, ou très variable, signale un poste chargé : refilmer.
2. Aucune ligne `ATTENTION : Il manque ... ms d'image à la fin du WebM` (générique perdu) ni `chevauche l'étape suivante`.
3. Le bloc final **`Contrôle final (ffprobe)`**, pour chaque MP4 :

   ```text
   OK : design/video/starway-lea-video.mp4
     durée finale 2 min 32.1 s (152100 ms) ; image 152100 ms, son 152100 ms ; tolérance 100 ms
   ```

   (Sortie réelle du réassemblage de l'essai du 09/11. Jeudi, seules les valeurs changeront.)

   `ÉCHEC` (code de sortie 1) : image et son diffèrent de plus de 100 ms, ou l'image ne fait pas la durée prévue. Ne pas livrer ce fichier.
4. `ATTENTION : durée finale ... AU-DELÀ DE LA LIMITE STRICTE DE 180 s` : le brief (p. 15) n'accorde pas de dérogation. Il faut raccourcir la visite, pas la vidéo.

Puis regarder la vidéo avec le son : l'écran-titre doit être entier, chaque phrase doit tomber avec le changement de ciel qu'elle commente, et le générique doit aller au bout. Si l'image est trop lente, refilmer : `--av-offset-ms` ne corrige qu'un décalage constant, et `--assemble-only` suffit pour le réglage du son ou des sous-titres.

## Hook à ajouter dans le front

**État constaté** (`frontend/src/tour/`, 2026-11-02) : `TourPlayer` ne joue pas encore l'audio et n'émet aucun signal exploitable hors du store React ; `record=1` n'est lu nulle part ; la visite ne démarre qu'au clic sur « Lancer la visite », et `?tour=<id>` ne la rend jouable qu'en dev. Sans ce hook, `npm run record` échoue après `--hook-timeout` secondes avec un message explicite (testé). Le hook est à implémenter dans `frontend/` par l'agent `starway-viz-engineer` ; cet outil n'y touche pas.

### Contrat

En mode enregistrement, la page émet sur `window` des `CustomEvent('starway:record')` dont le `detail` est :

```ts
// frontend/src/tour/recordSignal.ts (proposition)
export type RecordSignal =
  | { type: 'ready'; tourId: string }            // début de la vidéo : données chargées, ciel rendu, écran-titre visible
  | { type: 'step'; index: number; id: string }  // la narration de l'étape commence (sous-titre affiché = début du MP3)
  | { type: 'end' }                              // fin naturelle, générique terminé : on peut couper
  | { type: 'abort'; reason: string };           // visite interrompue (variable manquante, stop…)

export const isRecordMode = (): boolean => new URLSearchParams(window.location.search).get('record') === '1';

export function recordSignal(s: RecordSignal): void {
  if (!isRecordMode()) return;
  const detail = { ...s, t: performance.timeOrigin + performance.now() }; // horodatage en ms epoch
  window.dispatchEvent(new CustomEvent('starway:record', { detail }));
  document.documentElement.dataset.recordState = s.type;                  // aide au débogage
}
```

L'enregistreur s'abonne à cet événement avant le chargement de la page (`addInitScript` + `exposeBinding`) ; `t` est comparé à l'horloge de l'enregistreur (même machine).

### Points d'insertion

1. **Démarrage automatique** (`main.tsx` ou `App.tsx`) : si `record=1` et `tour=<id>`, une fois le dataset chargé et le premier rendu du ciel terminé, masquer curseur et contrôles, afficher l'écran-titre, émettre `ready`, puis lancer `startTour(script)` après la temporisation prévue par le skill (« démarrage après 2 s »). En build de production, ne démarrer que si `script.ready === true` (sinon `abort` avec la raison) : on ne filme pas un cas non validé.
2. **`step`** (`TourPlayer.goTo`) : juste après `this.subtitle = text; this.emit();`, c'est-à-dire au moment exact où l'audio de l'étape démarre. Le plus propre : un callback optionnel `onStepStart?: (step, index) => void` dans `TourDeps`, branché dans `controller.ts` sur `recordSignal({ type: 'step', index, id: step.id })`.
3. **`end` / `abort`** : distinguer la fin naturelle (`next()` sur la dernière étape) d'un `stop()` manuel ou d'un `onMissing`. Fin naturelle : générique de fin, puis `end`. Sinon : `abort` avec la raison (ex. `variable manquante : access.jobs`).
4. **Durée des étapes = durée de l'audio** : en mode enregistrement, le lecteur doit lire `tour.resolved.json` et appeler `stepDuration(text, step.minDurationMs, resolved.steps[i].durationMs)` (le paramètre `audioMs` existe déjà dans `timing.ts` mais n'est pas encore passé). Sinon une étape peut finir avant son MP3 : l'enregistreur le détecte (« chevauche l'étape suivante »).
5. **Cohérence du texte** : en mode enregistrement, comparer le texte résolu en direct à `resolved.steps[i].text` et émettre `abort` s'ils diffèrent (l'audio prononcerait un autre chiffre que l'écran).
6. **`subs=0`** : ne pas afficher les sous-titres du front (ils sont incrustés par ffmpeg dans la variante dédiée ; la version principale reste propre). Sans `subs=0`, comportement du skill : sous-titres en grand.
7. Le son de la page n'est pas capté (Chromium est lancé avec `--mute-audio`, et la vidéo Playwright n'a pas de piste audio) : le front peut jouer ses MP3 normalement, l'autoplay est autorisé (`--autoplay-policy=no-user-gesture-required`). **Choix du front (03/11)** : en `?record=1`, il ne joue pas la voix (aucune requête MP3) ; la durée de chaque étape est `durationMs`, et ses sous-titres (avec `--front-subtitles`) suivent les cues du `.vtt` de l'étape. Hors enregistrement, le site lit les MP3 (README racine, « Voix dans le site »).

## Tests réalisés (2026-11-02)

- `npm run test:sample` sur `samples/fictif/` (**FICTIF** : 3 étapes de texte de test, MP3 = bips sinusoïdaux, vidéo = mire `testsrc2` de ffmpeg, timeline simulée au rythme de `TourPlayer`) :
  - dry-run sans MP3 : 3 erreurs « introuvable », code 1 ; après `npm run sample:audio` : entrées valides, code 0 ;
  - assemblage : MP4 H.264 High 1920x1080 30 i/s + AAC 48 kHz stéréo ; `silencedetect` retrouve les bips exactement aux instants des événements `step` (0,5 s, 5,4 s, 8,8 s) ; image extraite à 9,5 s : la mire affiche 11,0 s (coupe de 1,5 s correcte) et le bon sous-titre incrusté, accents compris.
- Serveur statique : `frontend/dist` servi (200, types MIME), fichier absent en 404, remontée de dossier refusée (403).
- Playwright sur le build actuel (headless, une seule instance) : l'app s'affiche correctement en 1920x1080 avec WebGL (SwiftShader), WebM 1920x1080 à 30 i/s ; faute de hook, échec propre « Aucun événement starway:record de type ready ».
- Non testé : un enregistrement réel de bout en bout (la visite `lea` est `ready: false`, l'audio n'est pas généré, le hook n'existe pas encore).

## Contrôles du correctif de décalage (2026-11-09)

Réassemblage (`--assemble-only`, preset `veryfast`) du WebM de l'essai à blanc, MP3 de silence, sans nouvel enregistrement :

- Avant : 146,8 s d'image pour 156,8 s de son. Le contrôle final, appliqué à cet ancien MP4, échoue (écart de 10 018 ms).
- Après : coupe à 4,333 s du WebM, 152,1 s d'image et 152,1 s de son (ffprobe), contrôle `OK` sur les deux MP4, écran-titre présent au début.
- La barre de progression du MP4 change de cran entre 0,3 s avant et 0,3 s après sept des huit instants où le son est posé. La huitième, `acte4-velo` (131,9 s), est calée sur le cran fugitif d'une seule image, avec le changement de compteur ; la barre ne s'installe que 2,7 s plus tard.
- Non vérifiable sur cet essai : l'écoute (les MP3 sont du silence). Le générique de fin manque dans cet essai (6,1 s, avertissement affiché) : `--end-hold` vise ce défaut et n'a pas été éprouvé sur un enregistrement réel.
- `npm test` : 15 tests, sur les mesures réelles de l'essai (`samples/essai-2026-11-09/`, mesurées avec la bande du pipeline).

## Limites

- **Qualité d'image** : `recordVideo` encode lui-même un WebM (VP9 temps réel depuis Playwright 1.64) à débit non réglable ; les fins détails du ciel peuvent s'adoucir et le réencodage H.264 ne les récupère pas. Si le rendu ne suffit pas, l'option OBS Studio du skill reste valable, ou une évolution vers `page.screencast` (Playwright 1.64, option `quality`).
- **Fluidité** : en headless, WebGL tourne sur le CPU (SwiftShader) ; sous charge, l'image prend plusieurs secondes de retard sur les signaux du front (voir « Alignement image / son ») et le mouvement peut saccader. Le son suit l'image, mais rien ne rend à la vidéo sa fluidité. Enregistrer avec `--headed`, machine au repos.
- **Repère d'alignement** : la mesure dépend de la barre de progression de la visite (`.tour-progress`), en 1920x1080. Si elle disparaît ou change de principe, l'assemblage échoue avec un message clair : il faut alors adapter `src/sync.mjs`. Sur un poste saturé, le cran peut s'afficher plusieurs secondes après le signal (10,4 s à l'étape 7 de l'essai, environ 6 s pour ses voisines) : le son suit ce cran.
- **Fin de la vidéo** : `--end-hold` a servi pour la première fois le 11/11 (vidéo de contrôle de `lea-video`, `--headed`) : générique complet, aucune ligne `Il manque ... ms d'image`, image et son de 122,1 s.
- **Prologue** : sans cran de barre, il est placé d'après l'écart de signaux avec l'étape 2.
- **Écart d'horloge** : l'outil affiche l'écart entre la durée du WebM et l'horloge de l'enregistreur. C'est un simple constat : il ne donne pas la valeur à passer à `--av-offset-ms`.
- **Police des sous-titres incrustés** : Arial (libass a besoin d'une police TTF/OTF installée, les polices du front sont en woff2). Modifiable par `--subtitle-style`.
- **Durée** : l'outil avertit au-delà de 3 min mais ne coupe pas ; c'est le script de la visite qui doit tenir (cible du skill : 2 min 45 de narration).
- **Poids** : un MP4 1080p CRF 18 de 3 min pèse plusieurs dizaines de Mo ; GitHub refuse les fichiers de plus de 100 Mo. Décider en équipe si `design/video/` est versionné ou livré à part.
- Windows testé uniquement ; le code est portable (Node, chemins `path`), non vérifié sous Linux ou macOS.

## Licences

- `playwright` : Apache-2.0 (seule dépendance npm, version figée).
- Navigateur : Playwright 1.64 télécharge les builds **Chrome for Testing** de Google (affiché par `npx playwright install --dry-run chromium`), binaires distribués par Google et non compilés depuis les sources Chromium (conditions de licence à vérifier avant de s'en prévaloir comme open source). C'est un outil de production de la vidéo, non distribué ni embarqué dans le livrable ; si l'équipe veut un outillage 100 % open source, passer un Chromium open source avec `--browser-path` (mêmes fonctions, non testé ici).
- ffmpeg (build Gyan « full ») : GPL-3.0, avec libx264 (GPL-2.0+) et libass (ISC). Utilisé comme programme externe, non redistribué dans le dépôt.
- Code de l'outil : licence du dépôt (MIT).

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/cli.mjs` | ligne de commande, enchaîne validation → enregistrement → assemblage |
| `src/validate.mjs` | contrôles du dry-run (lit `STEP_PAUSE_MS` dans `frontend/src/tour/timing.ts`, pas de copie) |
| `src/server.mjs` | serveur statique minimal (`node:http`) avec repli SPA |
| `src/record.mjs` | Playwright : contexte 1920x1080, `recordVideo`, écoute de `starway:record` |
| `src/assemble.mjs` | plan de montage, sous-titres fusionnés, encodage ffmpeg, contrôle final |
| `src/sync.mjs` | alignement du son sur l'image : barre de progression mesurée dans le WebM |
| `src/args.mjs` | prétraitement de la ligne de commande (valeurs négatives) |
| `src/sync.test.mjs` | tests unitaires (`npm test`) sur les mesures réelles de l'essai du 09/11 |
| `samples/essai-2026-11-09/` | extraits de cet essai (luminance de la barre, timeline), MP3 de silence, aucune donnée STARWAY |
| `src/vtt.mjs` | lecture WebVTT, écriture SRT / WebVTT |
| `scripts/make-sample-audio.mjs` | génère les fixtures FICTIVES (`npm run sample:audio`) |
| `samples/fictif/` | `tour.resolved.json` et `.vtt` FICTIFS ; MP3 et `work/` générés, ignorés par git |
