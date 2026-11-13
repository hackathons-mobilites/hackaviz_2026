import type { ItinTrip } from '../../data/itineraries';
import { codePart } from '../../data/provenance';
import {
  boundText,
  minimumSourceText,
  OD_SCOPE_TEXT,
  RISK_BADGE_TEXT,
  RISK_GUARD,
  SHIFT_NOT_COVERED_TEXT,
  shortTransferText,
  sideRisks,
  statusText,
  transferCheckOf,
  transferSourceCodes,
  verdictAtRisk,
  type TransferCheckMeta,
  type TransferSource,
} from '../../data/transferCheck';
import { useSkyStore } from '../../store/useSkyStore';
import { ProvenanceNote } from '../provenance/ProvenanceNote';
import { InfoTip } from '../InfoTip';
import type { SourceEntry } from '../../data/types';
import './transferCheck.css';

const NO_SOURCES: SourceEntry[] = [];

/** Glyphe « à vérifier » : triangle à point d'exclamation, forme seule (le texte dit le sens). */
function CheckGlyph() {
  return (
    <svg className="tc-glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M8 1.8 L14.6 13.6 H1.4 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6 V9.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.9" fill="currentColor" />
    </svg>
  );
}

interface Props {
  /** Annonce `meta.transfer_check` (null : aucun marquage publié, rien n'est rendu) */
  meta: TransferCheckMeta | null;
  out: ItinTrip | null;
  ret: ItinTrip | null;
  /** Budget par sens du scénario (min) */
  budget: number;
  /** Verdict allumé par la matrice (journées-types, `access/`) ; false en commune par commune */
  lit: boolean;
  /** Table commune par commune (D-019) : l'itinéraire est un exemple, le verdict n'en vient pas */
  od: boolean;
  /** TC, horaires libres hors journée-type : aucun itinéraire, donc aucun contrôle (on le dit) */
  shiftNotCovered: boolean;
  maxTripMin?: number | null;
  /**
   * Lot 6 : `alert` = premier niveau du panneau, rendu seulement si un minimum n'est pas respecté (ce qui change le sens du trajet) ;
   * `detail` = pli « Méthode et sources » (bilan du contrôle, portée, source du minimum). Défaut : tout le bloc.
   */
  view?: 'all' | 'alert' | 'detail';
}

/**
 * Marque discrète de l'en-tête du panneau (D-031 c) : verdict allumé dont un sens repose sur une correspondance
 * plus courte que le minimum d'IDFM et dont la borne dépasse le budget. Jamais sur le ciel (stable).
 */
export function TransferRiskBadge({ meta, out, ret, budget, lit, od }: Pick<Props, 'meta' | 'out' | 'ret' | 'budget' | 'lit' | 'od'>) {
  if (!meta || od || !verdictAtRisk(lit, transferCheckOf(out), transferCheckOf(ret), budget)) return null;
  return (
    <p className="pf-badge tc-badge">
      <CheckGlyph />
      <span>{RISK_BADGE_TEXT}</span>
    </p>
  );
}

/**
 * Bloc « Correspondances » sous l'itinéraire (D-031 c) : une phrase par correspondance plus courte que le minimum
 * (temps disponible, minimum, source), la borne recalée sur les mêmes lignes et, si le verdict allumé est à
 * vérifier, la garde « pessimiste, pas faux ». Ailleurs, une phrase dit ce qui n'est pas contrôlé.
 */
export function ProofTransferCheck({ meta, out, ret, budget, lit, od, shiftNotCovered, maxTripMin, view = 'all' }: Props) {
  const sources = useSkyStore((s) => s.dataset?.sources ?? NO_SOURCES);
  if (!meta) return null;
  if (shiftNotCovered) return view === 'alert' ? null : <p className="pf-note tc-note">{SHIFT_NOT_COVERED_TEXT}</p>;
  const tcOut = transferCheckOf(out);
  const tcRet = transferCheckOf(ret);
  if (!tcOut && !tcRet) return null;
  const shorts = [
    ...(tcOut?.short ?? []).map((t) => ({ t, side: 'out' as const })),
    ...(tcRet?.short ?? []).map((t) => ({ t, side: 'ret' as const })),
  ];
  const statuses = [statusText(tcOut, 'out'), statusText(tcRet, 'ret')].filter((x): x is string => !!x);
  if (shorts.length === 0 && statuses.length === 0) return null;
  const risks = sideRisks(tcOut, tcRet, budget);
  const atRisk = !od && verdictAtRisk(lit, tcOut, tcRet, budget);
  const used = [...new Set(shorts.map((x) => x.t.source))] as TransferSource[];
  const codes = transferSourceCodes(meta, used);
  const alert = atRisk || shorts.length > 0;
  if (view === 'alert' && !alert) return null;
  const titleId = view === 'detail' ? 'pf-tc-title-detail' : 'pf-tc-title';
  // Retours KBS du 10/11 (règle d'affichage V5) : la source du minimum, mots inchangés, dans un « i » au bout du bilan
  const minimumSource = minimumSourceText(meta, used.length ? used : ['gtfs']);
  const sourceTip = (
    <InfoTip label="D'où vient le minimum de correspondance ?" placement="top">
      <span className="pf-tip-line">{minimumSource}</span>
    </InfoTip>
  );
  const body = (
    <>
      {statuses.map((s, i) => (
        <p key={s} className="pf-src">
          {s}
          {i === statuses.length - 1 && <> {sourceTip}</>}
        </p>
      ))}
      {od && <p className="pf-src">{OD_SCOPE_TEXT}</p>}
      {statuses.length === 0 && <p className="pf-src">{minimumSource}</p>}
      <ProvenanceNote className="pf-prov" parts={codes.map((c) => codePart(sources, c))} />
    </>
  );
  // Pli « Méthode et sources » : le bilan du contrôle, sans le verdict à vérifier, qui reste au premier niveau
  if (view === 'detail') {
    return (
      <section className="pf-section tc-section" aria-labelledby={titleId}>
        <h3 className="pf-label" id={titleId}>
          Correspondances
        </h3>
        {body}
      </section>
    );
  }
  return (
    <section className={`pf-section tc-section${atRisk ? ' is-risk' : ''}`} aria-labelledby={titleId}>
      <h3 className="pf-label" id={titleId}>
        Correspondances
      </h3>
      {atRisk && (
        <p className="tc-risk">
          <CheckGlyph />
          <span>
            <strong>Verdict à vérifier.</strong> {RISK_GUARD}
          </span>
        </p>
      )}
      {shorts.length > 0 && (
        <ul className="tc-list">
          {shorts.map(({ t, side }, i) => (
            <li key={`${side}-${i}`}>{shortTransferText(t, side)}</li>
          ))}
          {risks.map((r) => (
            <li key={`bound-${r.side}`} className="tc-bound">
              {boundText(r, !od && lit ? budget : null, maxTripMin)}
            </li>
          ))}
        </ul>
      )}
      {view === 'all' && body}
    </section>
  );
}
