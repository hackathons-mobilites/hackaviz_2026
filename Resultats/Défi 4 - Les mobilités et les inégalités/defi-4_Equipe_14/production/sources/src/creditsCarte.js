// Contrôle des crédits du fond de carte, partagé par les pages légères (index-l7, index-eau)
// Crédits du fond de carte (obligatoires : DINUM / OpenMapTiles / OpenStreetMap) : contrôle maison qui reprend le
// balisage et les classes de l'attribution native de MapLibre (même visuel : « i » sur fond noir en mode compact), mais
// dont l'ouverture est pilotée ici : sur mobile (≤ 700 px), mode compact fermé par défaut, un clic sur « i » ouvre / ferme ;
// sur ordinateur, texte toujours affiché. Textes lus sur les sources chargées (TileJSON du fond de carte).
export class Credits {
  onAdd(carte) {
    this.el = document.createElement("details");
    this.el.className = "maplibregl-ctrl maplibregl-ctrl-attrib";
    this.el.setAttribute("open", ""); // comme la version native : visibilité réglée par les classes compact / compact-show
    const bouton = document.createElement("summary");
    bouton.className = "maplibregl-ctrl-attrib-button";
    bouton.title = "Crédits de la carte";
    bouton.setAttribute("aria-label", "Crédits de la carte");
    this.texte = document.createElement("div");
    this.texte.className = "maplibregl-ctrl-attrib-inner";
    this.el.append(bouton, this.texte);
    bouton.addEventListener("click", (e) => {
      e.preventDefault(); // pas de bascule native du <details>
      this.el.classList.toggle("maplibregl-compact-show");
    });
    const compact = window.matchMedia("(max-width: 700px)");
    const majCompact = () => {
      this.el.classList.toggle("maplibregl-compact", compact.matches);
      this.el.classList.remove("maplibregl-compact-show"); // fermé par défaut
    };
    compact.addEventListener("change", majCompact);
    majCompact();
    // getStyle() lève une erreur tant que le style n'est pas chargé (MapLibre 2)
    const remplir = () => {
      let ids;
      try {
        ids = Object.keys(carte.getStyle()?.sources ?? {});
      } catch {
        return;
      }
      const textes = ids.map((id) => carte.getSource(id)?.attribution).filter(Boolean);
      if (textes.length) this.texte.innerHTML = [...new Set(textes)].join(" | ");
    };
    carte.on("styledata", remplir);
    carte.on("sourcedata", (e) => e.sourceDataType === "metadata" && remplir());
    return this.el;
  }
  onRemove() {
    this.el.remove();
  }
}
