// Champ de recherche avec suggestions, utilisé sur toutes les pages.
// On tape quelques lettres, le navigateur propose les noms correspondants ; dès qu'un nom
// de la liste est choisi, `surChoix(valeur)` est appelé.
//   options : Map(libellé affiché -> valeur)
import * as Inputs from "npm:@observablehq/inputs";

export function recherche(options, {label = "Rechercher", placeholder = "Tapez un nom…", surChoix} = {}) {
  const champ = Inputs.text({label, placeholder, datalist: [...options.keys()], autocomplete: "off", spellcheck: false});
  champ.classList.add("recherche");
  const sansAccent = (s) => String(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const index = new Map([...options].map(([libelle, valeur]) => [sansAccent(libelle), valeur]));
  champ.addEventListener("input", () => {
    const valeur = options.get(champ.value) ?? index.get(sansAccent(champ.value));
    if (valeur !== undefined && surChoix) surChoix(valeur);
  });
  return champ;
}
