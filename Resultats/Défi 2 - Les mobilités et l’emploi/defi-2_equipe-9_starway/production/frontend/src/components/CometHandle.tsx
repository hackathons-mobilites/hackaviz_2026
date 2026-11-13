import { useId, type CSSProperties } from 'react';
import { starAgeOpacities } from '../state/budget';
import { starAgeUrls } from '../theme/assets';
import { color, comet } from '../theme/tokens';

/**
 * Poignée « comète » de la jauge du temps de trajet (L-05, motion-spec « Ajouts v0.6 ») : la queue de
 * l'étoile filante, blanc lunaire, dessinée en SVG ; la tête est une **étoile qui vieillit** (IMG-20,
 * demande de Nicolas du 03/11) : plus le temps choisi s'allonge, plus elle vieillit (le temps passé
 * dans les transports use la journée). Six sprites (`star-age-1` à `6`) superposés ; seuls les deux
 * stades voisins de la position p ∈ [0, 1] sont visibles, en fondu continu (`starAgeOpacities`) :
 * aucun palier, aucun stade lié à une durée. L'image ne porte aucune donnée : la valeur reste écrite
 * en chiffres à côté et annoncée au lecteur d'écran. Jamais cyan (« accessible ») ni or (« gain
 * démontré »), jamais une étoile à quatre branches (glyphe de l'étoile-guide).
 *
 * Fondu additif (`mix-blend-mode: plus-lighter` dans un groupe isolé) : (1 - f) × A + f × B, sans
 * creux de luminosité au milieu du fondu. Sous l'étoile, sa silhouette couleur panneau (masque CSS
 * des mêmes sprites) cache la piste et la queue : l'étoile est devant, pas transparente. Un cœur
 * lunaire de 3 px monte en continu avec le dernier stade : la braise ne disparaît jamais.
 *
 * Purement décorative (`aria-hidden`) : l'input range natif reste dessous (clavier, lecteur d'écran,
 * `aria-valuetext`) avec un curseur transparent de 18 px (44 px au doigt). États pilotés par le CSS :
 * survol de la jauge, `.is-dragging`, focus de l'input (`input:focus-visible ~ .budget-comet`).
 * viewBox `-26 -12 38 24`, tête en (0, 0) ; la queue pointe vers les petits temps. Même rendu en
 * mouvement réduit (rien n'est animé : les opacités suivent la valeur).
 */
export function CometHandle({ value, p, dragging }: { value: number; p: number; dragging: boolean }) {
  const id = useId().replace(/:/g, '');
  const opacities = starAgeOpacities(p, starAgeUrls.length);
  const coreOpacity = comet.coreAlpha * (opacities[opacities.length - 1] ?? 0);
  const box = {
    '--star-box': `${comet.starBox}px`,
    '--star-box-touch': `${comet.starBoxTouch}px`,
    '--star-core': `${comet.core}px`,
  } as CSSProperties;
  return (
    <span className={`budget-comet ${dragging ? 'is-dragging' : ''}`} aria-hidden="true" style={box}>
      <svg viewBox="-26 -12 38 24" width="38" height="24">
        <defs>
          <linearGradient id={`${id}-tail`} x1="-24" y1="0" x2="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={color.text} stopOpacity="0" />
            <stop offset="1" stopColor={color.text} stopOpacity="0.55" />
          </linearGradient>
          <radialGradient id={`${id}-glow`}>
            <stop offset="0" stopColor={color.text} stopOpacity="1" />
            <stop offset="1" stopColor={color.text} stopOpacity="0" />
          </radialGradient>
        </defs>
        <path className="comet-tail" d="M -24 0 Q -10 -1.6 0 -3.4 L 0 3.4 Q -10 1.6 -24 0 Z" fill={`url(#${id}-tail)`} />
        <circle className="comet-glow" r={comet.glow} fill={`url(#${id}-glow)`} />
      </svg>
      {/* Silhouette de l'étoile couleur panneau : la piste et la queue passent derrière, pas à travers */}
      <span className="comet-occluder">
        {starAgeUrls.map((url, i) => {
          // trois couches du même masque : alpha 1 - (1 - a)³, la piste ne transparaît plus dans le corps de l'étoile
          const mask = Array(3).fill(`url(${url})`).join(', ');
          return <span key={url} style={{ opacity: opacities[i], maskImage: mask, WebkitMaskImage: mask }} />;
        })}
      </span>
      <span className="comet-star">
        <span className="comet-core" style={{ opacity: coreOpacity }} />
        {starAgeUrls.map((url, i) => (
          <img
            key={url}
            src={url}
            alt=""
            width={comet.starBox}
            height={comet.starBox}
            draggable={false}
            decoding="async"
            style={{ opacity: opacities[i] }}
          />
        ))}
      </span>
      <svg className="comet-focus-svg" viewBox="-26 -12 38 24" width="38" height="24">
        <circle className="comet-focus" r={comet.starFocus} />
      </svg>
      {dragging && <span className="budget-bubble">{value} min</span>}
    </span>
  );
}
