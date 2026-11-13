import { useId } from 'react';
import { useColorVisionStore } from '../store/colorVisionStore';
import { useFeaturesStore } from './featuresStore';

/**
 * Bouton « Couleurs adaptées au daltonisme » (barre du haut et écran titre : même composant, comme le
 * son). Libellé constant, état porté par `aria-pressed` ; l'icône le redit sans la couleur (moitié
 * droite vide ou hachurée). Le réglage ne change que des couleurs : mêmes états, mêmes formes, mêmes
 * positions et tailles (motion-spec, « Mode daltonien »).
 */
export function ColorVisionToggle({ className = 'icon-btn icon-btn-top tip-end' }: Readonly<{ className?: string }>) {
  const on = useColorVisionStore((s) => s.on);
  const setOn = useColorVisionStore((s) => s.setOn);
  const showToast = useFeaturesStore((s) => s.showToast);
  const clip = `cv-clip-${useId().replaceAll(':', '')}`;
  return (
    <button
      type="button"
      className={className}
      aria-pressed={on}
      aria-label="Couleurs adaptées au daltonisme"
      onClick={() => {
        const newState = !on;
        setOn(newState);
        showToast(newState ? 'Couleurs adaptées au daltonisme activées' : 'Couleurs adaptées au daltonisme désactivées');
      }}
      data-tip={
        on
          ? 'Couleurs adaptées au daltonisme : activées (or ambre, contrastes renforcés). Les formes, les états et les positions ne changent pas'
          : 'Couleurs adaptées au daltonisme (protanopie, deutéranopie, tritanopie) : or plus foncé, contrastes renforcés. Les formes ne changent pas'
      }
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            {/* moitié droite du disque : les hachures restent dans le cercle */}
            <path d="M12 4.75a7.25 7.25 0 0 1 0 14.5z" />
          </clipPath>
        </defs>
        <circle cx="12" cy="12" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 4.75a7.25 7.25 0 0 0 0 14.5z" fill="currentColor" />
        {on && (
          <g clipPath={`url(#${clip})`} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <path d="M10 10l6-6M10 14l9-9M11 17l9-9M14 18l6-6" />
          </g>
        )}
      </svg>
    </button>
  );
}
