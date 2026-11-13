/**
 * Lignes d'une bulle « i » du panneau de preuve, une phrase par ligne (`.pf-tip-line`, pfGroup.css). Une espace sépare les
 * lignes : le texte lu par un lecteur d'écran, copié ou relevé par l'inventaire (`textContent`) reste en phrases séparées.
 */
export function TipLines({ lines, breaks = false }: { lines: readonly string[]; /** Lignes sans point final (règle par sens) : un saut de ligne, lu comme une espace, les garde séparées */ breaks?: boolean }) {
  return (
    <>
      {lines.map((t, i) => (
        <span key={i} className="pf-tip-line">
          {t}
          {i < lines.length - 1 ? (breaks ? '\n' : ' ') : ''}
        </span>
      ))}
    </>
  );
}
