import { useProvenanceStore } from '../../store/provenanceStore';
import { formatInt, formatPercent } from '../../data/format';
import { flowToPole, shortCommuneName, type FlowFact } from '../../data/proof';
import { shareFraction } from '../../data/shareBar';
import type { Pole } from '../../data/types';
import { usePalette } from '../../store/colorVisionStore';
import { FlowsSourceNote, JobsSourceNote } from '../provenance/ProofNotes';
import { flowShareReading } from '../../data/chartReading';
import { ChartReadingTip } from '../ChartReadingTip';
import { ShareBar } from './ShareBar';
import type { Side } from './sideFacts';

/**
 * Bloc « Emplois du pôle » (maquette) : postes salariés (INSEE, EMP01, millésime lu dans
 * poles.json), puis les actifs qui y travaillent déjà (EMP02). Projets de recrutement (BMO) et filtre
 * par secteur : masqués tant que les données ne sont pas publiées (docs/proposition-panneau-preuve.md).
 */
export function ProofJobs({ pole, sides, dual, showFlows }: { pole: Pole; sides: Side[]; dual: boolean; showFlows: boolean }) {
  return (
    // Audit d'affichage du 11/11 (E1) : le titre, le chiffre et la légende redisaient le chiffre du pli (« N postes salariés »)
    <section className="pf-section pf-jobs" aria-label="Emplois du pôle">
      <JobsSourceNote pole={pole} />
      {showFlows && <Flows sides={sides} pole={pole} dual={dual} />}
    </section>
  );
}

/** Flux observés EMP02 : une pratique, pas une possibilité calculée (jamais en cyan). */
function Flows({ sides, pole, dual }: { sides: Side[]; pole: Pole; dual: boolean }) {
  const facts = sides.map((s) => ({ name: shortCommuneName(s.view.origin!.name), fact: flowToPole(s.ctx, pole.id) }));
  if (!facts.some((f) => f.fact)) return null;
  return (
    <div className="pf-flows" role="group" aria-labelledby="pf-flows-title">
      <p className="pf-label" id="pf-flows-title">
        Ils y travaillent déjà
      </p>
      {/* E3 : « une pratique observée, pas une possibilité calculée » est dite dans le « i » de la barre de part (« En perle : … ») */}
      <div className={dual ? 'pf-cols' : ''}>
        {facts.map(({ name, fact }) => (
          <FlowLine key={name} name={name} fact={fact} dual={dual} />
        ))}
      </div>
      <FlowsSourceNote ctxs={sides.map((s) => s.ctx)} />
    </div>
  );
}

function FlowLine({ name, fact, dual }: { name: string; fact: FlowFact | null; dual: boolean }) {
  const palette = usePalette().color;
  const sourcesOn = useProvenanceStore((s) => s.on);
  if (!fact) return <p className="pf-dim">{dual ? `${name} : non disponible` : 'Non disponible.'}</p>;
  if (fact.flux == null) {
    return <p className="pf-dim">{dual ? `${name} : aucun flux publié` : `L'INSEE ne publie aucun flux de ${name} vers ce pôle.`}</p>;
  }
  const approx = fact.precision === 'order_of_magnitude';
  return (
    <div>
      <p>
        {approx && 'Environ '}
        <span className="pf-fact-value">{formatInt(fact.flux)}</span> habitants de {name} qui ont un emploi travaillent dans ce pôle
        {fact.share != null && (
          <>
            , soit <span className="pf-fact-value">{formatPercent(fact.share)}</span> des habitants en emploi de la commune
          </>
        )}
        {approx ? (
          <span className="pf-dim"> (ordre de grandeur{sourcesOn ? ', INSEE' : ''})</span>
        ) : fact.margin != null ? (
          <span className="pf-dim">
            {' '}
            {/* E4 : le millésime est dans le « i » de la barre de part ; écrit ici en mode sources */}
            ({sourcesOn ? `recensement ${fact.year ?? ''}, ` : 'estimation, '}± {formatInt(fact.margin)})
          </span>
        ) : (
          <span className="pf-dim"> ({sourcesOn ? `recensement ${fact.year ?? ''}, ` : ''}estimation)</span>
        )}
        .
        {/* « Comment lire ce graphique » de la barre de part : flux et part lus dans le fait publié (EMP02) */}
        {fact.share != null && (
          <>
            {' '}
            <ChartReadingTip chart={`part des habitants en emploi de ${name}`} reading={flowShareReading({ name, flux: fact.flux, share: fact.share, year: fact.year ?? null, approx })} placement="top" />
          </>
        )}
      </p>
      {fact.originInPole && <p className="pf-dim">{name} fait partie de ce pôle : ce chiffre compte aussi ceux qui travaillent sur place.</p>}
      {fact.share != null && <ShareBar fraction={shareFraction(fact.share)} color={palette.neutral} title={`${formatPercent(fact.share)} des habitants en emploi de ${name} travaillent dans ce pôle`} />}
    </div>
  );
}
