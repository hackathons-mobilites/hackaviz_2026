import { DAY_TYPES_HYPOTHETICAL } from '../../data/labels';
import { METHODS } from '../../data/provenance';
import { workTimeSentences, workTimeSource, type TerritoireFile } from '../../data/territoire';
import { useProvenanceStore } from '../../store/provenanceStore';
import { InfoTip } from '../InfoTip';
import { WorkTimeSourceNote } from '../provenance/ProofNotes';
import './territoire.css';
import { useTerritoire } from './useTerritoire';

/** Les phrases du temps de travail (D-048, T2) : part des salariés du soir et de la nuit, enquête Emploi, niveau national. Rien sans fichier valide. */
function Sentences({ file }: { file: TerritoireFile }) {
  const on = useProvenanceStore((s) => s.on);
  return (
    <>
      {workTimeSentences(file.temps_de_travail).map((s) => (
        <span key={s} className="worktime-line">
          {s}
        </span>
      ))}
      {/* Citation de l'Insee (D-033 : mode sources seulement ; toujours dans « Sources & limites ») */}
      {on && <span className="worktime-line">{workTimeSource(file.temps_de_travail)}</span>}
      <WorkTimeSourceNote file={file} method={METHODS.workTime} />
    </>
  );
}

/**
 * Bulle « i » de la journée-type (D-048, T2) : répond à « pourquoi ces horaires ? » au moment où on les choisit. Part des salariés qui ont
 * travaillé au moins une fois le soir (20h-0h) et la nuit (0h-5h) sur quatre semaines, enquête Emploi de l'Insee, NIVEAU NATIONAL : aucune
 * valeur par territoire, aucun chiffre pour la journée-type 6h-14h (la source n'a pas de catégorie « tôt le matin »). Les trois journées-types
 * restent un choix de l'équipe. Sans fichier valide, le bouton n'est pas affiché.
 */
export function WorkTimeTip() {
  const state = useTerritoire();
  // Audit de vérité du 11/11 : la bulle dit d'abord que ces horaires sont des scénarios hypothétiques ; elle existe donc toujours,
  // même sans le fichier du territoire (les phrases de l'enquête Emploi manquent alors, rien n'est inventé)
  return (
    <InfoTip label="Pourquoi ces journées-types ? Scénarios hypothétiques, travail le soir et la nuit" placement="top" className="worktime-tip">
      <span className="worktime-text">
        <span className="worktime-hypo">{DAY_TYPES_HYPOTHETICAL}</span>
        {state.status === 'ready' && (
          <>
            {'\n'}
            <Sentences file={state.file} />
          </>
        )}
      </span>
    </InfoTip>
  );
}

/**
 * Pli « Méthode et sources » du panneau (retours KBS du 10/11, règle d'affichage V5) : les mêmes phrases, dans un « i » au bout de la
 * ligne de la journée-type (mots inchangés) ; une phrase par ligne, séparées par un saut de ligne (lu comme une espace). La source est
 * à part (`WorkTimeFoldSources`), en mode sources seulement.
 */
export function WorkTimeFold() {
  const state = useTerritoire();
  if (state.status !== 'ready') return null;
  const lines = workTimeSentences(state.file.temps_de_travail);
  return (
    <>
      {' '}
      <InfoTip label="Pourquoi ces journées-types ? Travail le soir et la nuit" placement="top" className="worktime-tip">
        {lines.map((s, i) => (
          <span key={s} className="pf-tip-line">
            {s}
            {i < lines.length - 1 ? '\n' : ''}
          </span>
        ))}
      </InfoTip>
    </>
  );
}

/** Source du temps de travail sous le pli « Méthode et sources » : mode sources seulement (D-033), comme dans la bulle de la journée-type. */
export function WorkTimeFoldSources() {
  const state = useTerritoire();
  const on = useProvenanceStore((s) => s.on);
  if (state.status !== 'ready' || !on) return null;
  return (
    <div className="worktime-fold">
      <span className="worktime-line">{workTimeSource(state.file.temps_de_travail)}</span>
      <WorkTimeSourceNote file={state.file} method={METHODS.workTime} />
    </div>
  );
}
