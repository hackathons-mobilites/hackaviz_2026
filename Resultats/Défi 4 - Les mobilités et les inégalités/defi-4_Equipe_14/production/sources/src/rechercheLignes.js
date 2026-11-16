// Recherche d'une ligne (réseau en service et projets) par son libellé : « M14 », « rer b », « t zen », « tram 11 »…
// Auto-complétion sans tenir compte des accents ni de la casse ; plusieurs mots se combinent.
// onChoix(entree) au choix d'une suggestion (clic ou Entrée), onEffacer() quand le champ est vidé ou sur Échap.
const SUGGESTIONS_MAX = 15;

const normaliser = (texte) =>
  String(texte ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

// Synonymes indexés en plus du libellé court : « M14 » -> « metro 14 », « T3a » -> « tram 3a »…
function motsCles({ ligne, mode, sousMode }) {
  const mots = [ligne, mode, sousMode];
  const m = ligne.match(/^([MTC])(\d.*)$/);
  if (m) mots.push(`${{ M: "metro", T: "tram", C: "cable" }[m[1]]} ${m[2]}`);
  if (sousMode === "Transilien") mots.push(`ligne ${ligne}`, `train ${ligne}`);
  return normaliser(mots.join(" "));
}

// features : tronçons du réseau en service et des projets (properties.ligne, mode, sousMode, couleur)
// -> une entrée par ligne, avec ses tronçons et ce qu'elle regroupe (en service, en projet)
export function installerRechercheLignes(conteneur, reseau, projets, onChoix, onEffacer) {
  const lignes = new Map();
  for (const [features, enProjet] of [
    [reseau, false],
    [projets, true],
  ]) {
    for (const f of features) {
      const p = f.properties;
      const entree = lignes.get(p.ligne) ?? { ligne: p.ligne, mode: p.mode, sousMode: p.sousMode, couleur: p.couleur, features: [] };
      entree.features.push(f);
      entree[enProjet ? "enProjet" : "enService"] = true;
      lignes.set(p.ligne, entree);
    }
  }
  const index = [...lignes.values()].map((e) => ({ ...e, cles: motsCles(e) }));

  conteneur.classList.add("recherche-lignes");
  const champ = document.createElement("input");
  champ.type = "search";
  champ.placeholder = "Rechercher une ligne…";
  champ.title = "Ligne en service ou en projet (M14, RER B, T11, T Zen 5…)";
  const liste = document.createElement("ul");
  conteneur.append(champ, liste);

  let resultats = [];
  let actif = -1;

  function afficherSuggestions() {
    const mots = normaliser(champ.value).split(/\s+/).filter(Boolean);
    liste.replaceChildren();
    actif = -1;
    if (!mots.length) {
      resultats = [];
      return;
    }
    resultats = index.filter((e) => mots.every((m) => e.cles.includes(m))).slice(0, SUGGESTIONS_MAX);
    if (!resultats.length) {
      const li = document.createElement("li");
      li.className = "vide";
      li.textContent = "Aucune ligne";
      liste.append(li);
      return;
    }
    resultats.forEach((e, i) => {
      const li = document.createElement("li");
      const pastille = document.createElement("span");
      pastille.className = "pastille";
      pastille.style.background = e.couleur;
      const etat = e.enService && e.enProjet ? "en service + projet" : e.enProjet ? "en projet" : "en service";
      li.append(pastille, `${e.ligne} `, Object.assign(document.createElement("span"), { className: "detail", textContent: `${e.sousMode} · ${etat}` }));
      li.addEventListener("mousedown", (ev) => {
        ev.preventDefault(); // garde le focus : pas de blur avant le choix
        choisir(i);
      });
      liste.append(li);
    });
  }

  function choisir(i) {
    const e = resultats[i];
    if (!e) return;
    champ.value = e.ligne;
    liste.replaceChildren();
    onChoix(e);
  }

  function marquerActif() {
    [...liste.children].forEach((li, i) => li.classList.toggle("actif", i === actif));
  }

  champ.addEventListener("input", () => {
    afficherSuggestions();
    if (!champ.value.trim()) onEffacer();
  });
  champ.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!resultats.length) return;
      actif = (actif + (ev.key === "ArrowDown" ? 1 : -1) + resultats.length) % resultats.length;
      marquerActif();
    } else if (ev.key === "Enter") {
      choisir(actif >= 0 ? actif : 0);
    } else if (ev.key === "Escape") {
      champ.value = "";
      liste.replaceChildren();
      onEffacer();
    }
  });
  champ.addEventListener("blur", () => liste.replaceChildren());
}
