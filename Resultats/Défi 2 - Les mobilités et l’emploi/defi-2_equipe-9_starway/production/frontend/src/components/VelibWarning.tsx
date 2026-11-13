import { splitFirstSentence } from '../data/walkSettings';
import { SourceTip } from './proof/SourceTip';

/**
 * Avertissement Vélib' (D-027) : `meta.velib.warning` affiché TEL QUEL, première phrase en gras.
 * Aucun mot n'est ajouté ni retiré : le texte vient du pipeline.
 * `restTip` (panneau, audit d'affichage du 11/11, P17 et D3) : la première phrase reste écrite (garde de la valeur), la suite va dans un
 * « i », mots inchangés ; en mode sources, elle est écrite en clair (SourceTip).
 */
export function VelibWarning({ text, className = '', firstOnly = false, restTip = false }: { text: string; className?: string; firstOnly?: boolean; restTip?: boolean }) {
  const [first, rest] = splitFirstSentence(text);
  return (
    <p className={`velib-warning ${className}`} role="note">
      <strong>{first}</strong>
      {!firstOnly && rest ? (
        restTip ? (
          <>
            {' '}
            <SourceTip label="Que veut dire l'avertissement Vélib' ?" className="">
              {rest}
            </SourceTip>
          </>
        ) : (
          ` ${rest}`
        )
      ) : (
        ''
      )}
    </p>
  );
}
