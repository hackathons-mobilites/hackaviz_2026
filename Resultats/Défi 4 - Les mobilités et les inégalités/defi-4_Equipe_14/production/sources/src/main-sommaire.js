// Page de présentation du projet (index-sommaire.html, publiée dans sommaire/) : fiches des cartes interactives.
// Liens : en développement, vers les pages du serveur Vite (./index-eau.html…) ; publiés, vers les répertoires eau/, air/,
// fauteuils/, ligne7/ placés au même niveau que la page du sommaire (contenu de sommaire/ déposé ex. dans IDFM/, à côté
// de IDFM/eau/, IDFM/air/…).
// Chaque fiche : capture d'écran de la page d'accueil de la carte (captures/<dossier>.png, à la racine du template, copiées
// dans le build ; ligne 7 : fin de l'animation, page ouverte avec ?fin), puis texte d'accompagnement (champ texte, À RÉDIGER :
// texte provisoire en attendant). Tant qu'une capture manque, un cadre vide la remplace.

const CARTES = [
  {
    dossier: "eau",
    page: "index-eau.html",
    titre: "Accès à l'eau",
    pastille: { texte: "💧", fond: "#dbe8f6" },
    // texte d'accompagnement (à rédiger)
    texte: "Est-il facile d'accéder à un point d'eau au niveau de chaque station ? Quelles lignes offrent un bon accès sur tout le trajet ?",
  },
  {
    dossier: "air",
    page: "index-air.html",
    titre: "Qualité de l'air",
    pastille: { texte: "≋", fond: "#d8f0e0" },
    texte: "Quelle est la pollution aux particules fines sur les quais ? De la ligne la moins polluée à la plus polluée.",
  },
  {
    dossier: "fauteuils",
    page: "index-fauteuils.html",
    titre: "Accessibilité en fauteuil",
    pastille: { texte: "♿", fond: "#e3e9f7" },
    texte: "Chaque station est-elle accessible en fauteuil roulant, seul ou avec assistance ?",
  },
  {
    dossier: "ligne7",
    page: "index-l7.html",
    titre: "Ligne 7, station par station",
    pastille: { texte: "7", fond: "#fa9aba" },
    texte: "Une rame parcourt la ligne 7 : à chaque station, la qualité de l'air sur le quai et la présence d'une fontaine.",
  },
];

// en développement (serveur Vite) : pages du template ; publié : répertoires eau/, air/, fauteuils/, ligne7/ au même niveau
// que la page du sommaire (ex. IDFM/index.html + IDFM/eau/…)
const lien = (c) => (import.meta.env.DEV ? `./${c.page}` : `${c.dossier}/`);
const echapper = (t) => t.replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[x]);

// rangées : une affiche (affiches/<nom>.png, cadre vide tant qu'elle manque) en regard de sa carte interactive ; thème
// sans carte (violences) : l'affiche seule
const AFFICHES = [
  { nom: "violences", titre: "Affiche violences", carte: null },
  { nom: "eau", titre: "Affiche eau", carte: "eau" },
  { nom: "ligne7", titre: "Affiche ligne 7", carte: "ligne7" }, // juste sous l'eau : l'animation montre aussi les fontaines
  { nom: "air", titre: "Affiche air", carte: "air" },
  { nom: "fauteuils", titre: "Affiche fauteuils", carte: "fauteuils" },
];
const fiche = (c) => `
  <a class="fiche" href="${lien(c)}" target="_blank" rel="noopener">
    <div class="tete">
      <span class="pastille" style="background:${c.pastille.fond}" aria-hidden="true">${c.pastille.texte}</span>
      <h3>${echapper(c.titre)}</h3>
    </div>
    <div class="capture"><img src="captures/${c.dossier}.png" width="2204" height="1564" alt="Capture d'écran : ${echapper(c.titre)}" loading="lazy" onerror="this.remove()" /></div>
    <p class="texte">${echapper(c.texte)}</p>
    <span class="lien">Voir la carte ↗</span>
  </a>`;
document.getElementById("cartes").insertAdjacentHTML(
  "beforeend",
  AFFICHES.map((a) => {
    const c = CARTES.find((x) => x.dossier === a.carte);
    return `
  <a class="affiche" href="affiches/${a.nom}.png" target="_blank" rel="noopener">
    <span class="titre">${echapper(a.titre)}</span>
    <div class="cadre"><img src="affiches/${a.nom}.png" alt="${echapper(a.titre)}" loading="lazy" onerror="this.remove()" /></div>
    <span class="lien">Voir l'affiche ↗</span>
  </a>
  ${c ? fiche(c) : "<div></div>"}`; // thème sans carte (violences) : l'affiche seule
  }).join(""),
);

// Croquis « à la main » (ordinateur, deux colonnes) : cercle autour du QR code de l'affiche, flèche vers la capture de la
// carte en regard et mention « Scannez-moi ! ». QR : carré en bas à droite des affiches (1414 × 2000 px, même place sur les
// 4 affiches), en fraction de l'image.
const QR = { x: 1059 / 1414, y: 1645 / 2000, l: 315 / 1414, h: 317 / 2000 };
const grille = document.getElementById("cartes");
const NS = "http://www.w3.org/2000/svg";
// hasard reproductible (même tracé à chaque redessin)
const hasard = (graine) => () => ((graine = (graine * 16807) % 2147483647) - 1) / 2147483646;

// cercle tracé à main levée : un peu plus d'un tour, rayon qui ondule et ne se referme pas exactement
function cercleMain(cx, cy, rx, ry, alea) {
  const a0 = -2.2 + alea() * 0.4, phi = alea() * 6, pts = [];
  for (let t = 0; t <= 2 * Math.PI + 0.55; t += 0.1) {
    const k = 1 + 0.05 * Math.sin(2 * t + phi) + 0.07 * (t / (2 * Math.PI));
    pts.push(`${(cx + rx * k * Math.cos(a0 + t)).toFixed(1)},${(cy + ry * k * Math.sin(a0 + t)).toFixed(1)}`);
  }
  return `M${pts.join("L")}`;
}

function dessinerCroquis() {
  grille.querySelector("svg.croquis")?.remove();
  if (matchMedia("(max-width: 700px)").matches) return; // mobile : la carte est sous l'affiche, pas de flèche
  const g = grille.getBoundingClientRect();
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "croquis");
  svg.setAttribute("aria-hidden", "true");
  let html = "";
  grille.querySelectorAll("a.affiche").forEach((aff, i) => {
    const capture = aff.nextElementSibling?.querySelector(".capture");
    const img = aff.querySelector(".cadre img");
    if (!capture || !img?.naturalWidth) return; // pas de carte en regard (violences) ou image absente
    // image en object-fit: contain : position réelle de l'image dans son cadre
    const b = img.getBoundingClientRect();
    const e = Math.min(b.width / img.naturalWidth, b.height / img.naturalHeight);
    const w = img.naturalWidth * e, h = img.naturalHeight * e;
    const x0 = b.left + (b.width - w) / 2 - g.left, y0 = b.top + (b.height - h) / 2 - g.top;
    const cx = x0 + (QR.x + QR.l / 2) * w, cy = y0 + (QR.y + QR.h / 2) * h;
    const rx = QR.l * w * 0.85, ry = QR.h * h * 0.85; // rayon du cercle : un peu plus que la demi-diagonale du QR code (0,71)
    // flèche : du haut droit du cercle vers le bas de la capture de la carte, en arc par-dessus
    const c = capture.getBoundingClientRect();
    const x1 = cx + rx * 0.75, y1 = cy - ry * 0.75;
    const x2 = c.left - g.left - 3, y2 = c.bottom - g.top - c.height * 0.3;
    const qx = x1 + (x2 - x1) * 0.35, qy = Math.min(y1, y2) - 30;
    const ang = Math.atan2(y2 - qy, x2 - qx), L = 13;
    const pointe = [-0.45, 0.45].map((d) => `M${x2},${y2}l${(-L * Math.cos(ang + d)).toFixed(1)},${(-L * Math.sin(ang + d)).toFixed(1)}`).join("");
    const alea = hasard(17 + i * 101);
    html += `
      <path d="${cercleMain(cx, cy, rx, ry, alea)}" />
      <path d="M${x1},${y1}Q${qx},${qy} ${x2},${y2}${pointe}" />
      <text x="${cx + rx + 6}" y="${cy + ry * 0.7}" transform="rotate(-6 ${cx + rx} ${cy})">Scannez-moi !</text>`;
  });
  svg.innerHTML = html;
  grille.append(svg);
}

grille.querySelectorAll(".cadre img, .capture img").forEach((img) => img.addEventListener("load", dessinerCroquis));
new ResizeObserver(dessinerCroquis).observe(grille);
document.fonts?.ready.then(dessinerCroquis);
