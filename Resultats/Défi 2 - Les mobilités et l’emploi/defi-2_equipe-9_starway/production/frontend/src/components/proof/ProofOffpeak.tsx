import type { OffpeakFact } from '../../data/offpeak';
import { InfoTip } from '../InfoTip';
import { OffpeakSourceNote } from '../provenance/ProofNotes';
import './carCost.css';
import './panneauLignes.css';

/**
 * Heure creuse (bloc `offpeak` publié par 06h, D-028) : « En partant à 11h00 : aller N min, retour M min ».
 * Audit d'affichage du 10/11 (demande de Nicolas, lot 4) : c'est une information sur le trajet, rangée dans le pli « Comparer les
 * moyens » ; la phrase de garde (départ choisi par l'équipe, pas une donnée ; le verdict du ciel ne change pas) est dans le « i »,
 * mots inchangés. Rendu seulement si le fichier publie le bloc.
 */
export function ProofOffpeak({ fact, anchorNote }: { fact: OffpeakFact; anchorNote?: string | null }) {
  return (
    <div className="pf-offpeak" role="group" aria-labelledby="pf-offpeak-title">
      <p className="pf-label pf-offpeak-title" id="pf-offpeak-title">
        Heure creuse
      </p>
      <p className="pf-offpeak-text">
        {fact.text}{' '}
        <InfoTip label="Pourquoi cette heure ?" placement="top">
          <span className="pf-tip-row">{fact.note}</span>
          {/* Commune par commune (table OD) : le temps va à l'arrêt d'ancrage du pôle, la phrase d'exemple le dit */}
          {anchorNote && <span className="pf-tip-row">{anchorNote}</span>}
        </InfoTip>
      </p>
      {/* Mode provenance : horaires et rues du calcul, avec la date de service */}
      <OffpeakSourceNote className="pf-prov" />
    </div>
  );
}
