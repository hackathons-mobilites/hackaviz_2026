import { Fragment } from 'react';
import type { ProvPart, SourceTag } from '../../data/provenance';
import { useProvenanceStore } from '../../store/provenanceStore';
import { useSkyStore } from '../../store/useSkyStore';
import './provenance.css';

/** Ouvre « Sources & limites » sur la fiche de la source (le focus y va, Échap revient ici). */
function openFiche(anchor: string): void {
  useSkyStore.getState().setSourcesOpen(true, anchor);
}

function FicheLink({ tag }: { tag: SourceTag }) {
  return (
    // Lien d'ancre (il se coupe en fin de ligne, contrairement à un bouton) : ouvre le tiroir sur la fiche,
    // l'adresse ne change pas (elle porte le scénario)
    <a
      href={`#${tag.anchor}`}
      className="prov-link"
      onClick={(e) => {
        e.preventDefault();
        openFiche(tag.anchor);
      }}
      aria-label={`${tag.text} : fiche dans Sources et limites`}
    >
      {tag.text}
    </a>
  );
}

function joinTags(list: SourceTag[]) {
  return list.map((t, i) => (
    <Fragment key={t.code}>
      {i > 0 && (i === list.length - 1 ? ' et ' : ', ')}
      <FicheLink tag={t} />
    </Fragment>
  ));
}

/**
 * Contenu d'une ou plusieurs lignes de provenance, sans conteneur (réutilisé par la bande du ciel).
 * `compact` (téléphone) : les sources seules, séparées par « · », sans « Postes : » ni « calcul r5py ».
 */
export function ProvenanceParts({ parts, compact = false }: { parts: ProvPart[]; compact?: boolean }) {
  if (compact) {
    const all = parts.flatMap((p) => p.tags).filter((t, i, a) => a.findIndex((x) => x.code === t.code) === i);
    return (
      <>
        {all.map((t, i) => (
          <Fragment key={t.code}>
            {i > 0 && ' · '}
            <FicheLink tag={t} />
          </Fragment>
        ))}
      </>
    );
  }
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={`${p.lead ?? 'src'}-${i}`}>
          {i > 0 && ' · '}
          {p.lead ? `${p.lead} : ` : parts.length === 1 ? 'Source : ' : ''}
          {p.engine && `${p.engine} sur `}
          {joinTags(p.tags)}
          {p.method && `, méthode : ${p.method}`}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Ligne de provenance d'un bloc chiffré (motion-spec, « Provenance des données ») : 12 px, texte
 * secondaire, ni cyan ni or, sans animation. Rendue seulement quand le mode est actif et qu'au moins une
 * source est publiée ; coupée, elle est retirée du DOM (les mentions de source et de licence
 * existantes, elles, restent toujours).
 */
export function ProvenanceNote({ parts, className = '' }: { parts: readonly (ProvPart | null | undefined)[]; className?: string }) {
  const on = useProvenanceStore((s) => s.on);
  const list = parts.filter((p): p is ProvPart => !!p && p.tags.length > 0);
  if (!on || list.length === 0) return null;
  return (
    <p className={`prov-note ${className}`}>
      <ProvenanceParts parts={list} />
    </p>
  );
}
