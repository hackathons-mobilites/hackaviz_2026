import { useRef, type ReactNode } from 'react';
import { useTourFold } from './useTourFold';
import './pfGroup.css';

/**
 * Pli du panneau de preuve (chantier C, lot 3, D-050) : un des six plis indépendants (jamais `<details name>` : l'étape 28 de
 * `smoke.mjs` ouvre tous les plis d'un coup). Le titre dit la rubrique ; `figure` est le chiffre clé quand il existe, lu fermé,
 * pour décider d'ouvrir en sachant ce qu'on y trouvera. `keep` : phrases qui changent le sens d'un chiffre et ne se replient
 * jamais (liste `keep-visible.json`), écrites sous le titre, pli fermé.
 * Classe `pf-fold` : celle que lisent déjà `smoke.mjs` et l'inventaire des phrases.
 *
 * Visite guidée (lot 5, D-052) : quand la visite pose `data-tour-focus` sur le pli ou sur un élément qu'il contient (`.pf-flows`,
 * `.pf-recruit`...), le pli s'ouvre et amène l'élément en haut du panneau (les sous-titres de la visite couvrent le bas du panneau) ; il se
 * referme quand la marque est retirée, s'il a été ouvert par la visite. Aucun lien avec les fichiers de `tour/` : la visite ne fait que
 * poser la marque.
 */
export function PfGroup({ id, title, figure, keep, children }: { id: string; title: string; figure?: string | null; keep?: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const fold = useRef<HTMLDetailsElement>(null);
  useTourFold(root, fold);

  return (
    <section ref={root} className="pf-group" aria-labelledby={`pf-group-${id}`} data-group={id}>
      <details ref={fold} className="pf-fold pf-group-fold">
        <summary>
          <span className="pf-group-title" id={`pf-group-${id}`}>
            {title}
          </span>
          {figure ? <span className="pf-group-figure">{figure}</span> : <span />}
          <svg className="pf-group-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="pf-group-body">{children}</div>
      </details>
      {keep ? <div className="pf-group-keep">{keep}</div> : null}
    </section>
  );
}
