import type { ReactNode } from 'react';
import { useProvenanceStore } from '../../store/provenanceStore';
import { InfoTip } from '../InfoTip';

/**
 * Règle d'affichage finale du 11/11 (audit d'affichage, D-064) : sans le mode sources, seules la valeur, l'unité, le verdict et les gardes
 * courtes restent écrites ; une précision (portée, méthode, dénominateur, millésime) va dans un « i », MOTS INCHANGÉS. Avec le mode sources
 * (`&src=1`, bouton de la barre du haut), « tout revient » : la même précision est écrite en clair, au même endroit, sans bouton.
 * Un seul mécanisme pour tout le site : chaque phrase déplacée passe par ce composant (ou par `SourceTipView` dans les rendus purs testés).
 */
export function SourceTip(props: SourceTipProps) {
  const on = useProvenanceStore((s) => s.on);
  return <SourceTipView {...props} on={on} />;
}

export interface SourceTipProps {
  /** Nom accessible du bouton « i », en question (« Ce trait est-il l'itinéraire ? ») */
  label: string;
  children: ReactNode;
  placement?: 'top' | 'bottom';
  /** Classe du texte écrit en clair (mode sources) ; défaut `pf-src` */
  className?: string;
  /** Classe du « i » (sans mode sources) */
  tipClassName?: string;
  /** Mode sources : le texte en clair passe à la ligne (`pf-src-block`), comme une note sous le bloc */
  block?: boolean;
}

/** Rendu pur (testé sans le store) : `on` = mode sources actif. */
export function SourceTipView({ label, children, placement = 'top', className, tipClassName = '', block = false, on }: SourceTipProps & { on: boolean }) {
  if (on) return <span className={`${className ?? 'pf-src'}${block ? ' pf-src-block' : ''}`}>{children}</span>;
  return (
    <InfoTip label={label} placement={placement} className={tipClassName}>
      {children}
    </InfoTip>
  );
}
