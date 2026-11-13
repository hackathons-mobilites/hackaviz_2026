import { AnimatePresence, motion as m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Commune, Insight, InsightKind, InsightsStatus } from '../data/types';
import { INSIGHT_TITLE as KIND_TITLE, insightMetricLines, insightModeText, insightPlan, crosscheckNote } from '../data/insights';
import { returnFocus } from '../hooks/focusReturn';
import { openInsight } from '../store/insightPlayer';
import { SkySourceNote } from './provenance/ProofNotes';
import { useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';

const NO_INSIGHTS: Insight[] = [];
const NO_COMMUNES: Commune[] = [];

/**
 * Icône du type de découverte (blanc lunaire, jamais cyan ni or) : deux disques (deux ciels), un
 * croissant (éclipse), un rayon (gain), une flèche aller pleine et une flèche retour en tirets.
 */
export function InsightIcon({ kind }: { kind: InsightKind }) {
  return (
    <svg className="ins-icon" viewBox="0 0 20 20" aria-hidden="true">
      {kind === 'territorial_gap' && (
        <>
          <circle cx="6.5" cy="10" r="4" />
          <circle cx="13.5" cy="10" r="4" />
        </>
      )}
      {kind === 'eclipse' && <path d="M12.5 3.5 A6.5 6.5 0 1 0 12.5 16.5 A5 5 0 1 1 12.5 3.5 Z" className="is-fill" />}
      {kind === 'bike_gain' && (
        <>
          <circle cx="10" cy="10" r="2.2" className="is-fill" />
          <path d="M10 2.5 V5.5 M10 14.5 V17.5 M2.5 10 H5.5 M14.5 10 H17.5 M4.7 4.7 L6.8 6.8 M13.2 13.2 L15.3 15.3 M15.3 4.7 L13.2 6.8 M6.8 13.2 L4.7 15.3" />
        </>
      )}
      {kind === 'late_return' && (
        <>
          <path d="M3 7 H15 M12 4 L15 7 L12 10" />
          <path d="M17 13.5 H5 M8 10.5 L5 13.5 L8 16.5" strokeDasharray="2 2" />
        </>
      )}
    </svg>
  );
}

/**
 * Découvertes : scénarios remarquables CALCULÉS par le pipeline (insights.json), un clic applique
 * le scénario. Sans découverte publiée, état vide honnête : le statut et la raison écrits par le
 * pipeline (meta.insights). Rien n'est écrit à la main.
 */
export function Insights() {
  const insights = useSkyStore((s) => s.dataset?.insights ?? NO_INSIGHTS);
  const communes = useSkyStore((s) => s.dataset?.communes ?? NO_COMMUNES);
  const meta = useSkyStore((s) => s.dataset?.meta);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      returnFocus(trigger.current, wrap.current);
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const status = meta?.insights;
  if (!meta || (!insights.length && !status)) return null;
  const name = (insee: string | null | undefined) => communes.find((c) => c.insee === insee)?.name ?? insee ?? '';
  const dayLabel = (id: string | undefined) => meta.day_types.find((d) => d.id === id)?.label ?? id ?? '';
  const sorted = [...insights].sort((a, b) => a.rank - b.rank);
  // Les découvertes sont calculées aux budgets de meta.budgets (la jauge, elle, est continue : D-018)
  const studied = meta.budgets.length > 1 ? `${meta.budgets.slice(0, -1).join(', ')} et ${meta.budgets.at(-1)}` : meta.budgets.join('');
  const pending = status
    ? (Object.entries(status.kinds) as [InsightKind, NonNullable<InsightsStatus['kinds'][InsightKind]>][]).filter(
        ([, k]) => k.status !== 'ok',
      )
    : [];

  return (
    <div className="insights" ref={wrap}>
      <button ref={trigger} type="button" className="btn btn-ghost" aria-expanded={open} aria-controls="insights-list" onClick={() => setOpen(!open)}>
        Découvertes {insights.length > 0 && <span className="soon-badge">{insights.length}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <m.div
            id="insights-list"
            className="insights-list"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
          >
            {sorted.length > 0 && (
              <p className="ins-head">
                Écarts en postes salariés (INSEE) accessibles aller et retour
                {studied && `, calculés pour ${studied} min par sens`}
              </p>
            )}
            {sorted.length > 0 && (
              <ul>
                {sorted.map((ins) => {
                  const sc = ins.scenario;
                  const where = sc.vs ? `${name(sc.o)} / ${name(sc.vs)}` : name(sc.o);
                  const when = sc.compare_day ? `${dayLabel(sc.d)} comparé à ${dayLabel(sc.compare_day)}` : dayLabel(sc.d);
                  const metric = insightMetricLines(ins);
                  // Verbe et passage montré : la sous-ligne ne dépend pas du mouvement réduit (même texte)
                  const plan = insightPlan(ins, (id) => dayLabel(id));
                  return (
                    <li key={ins.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          void openInsight(ins);
                        }}
                      >
                        <span className="ins-kind">
                          <InsightIcon kind={ins.kind} />
                          {KIND_TITLE[ins.kind] ?? ins.kind}
                        </span>
                        <strong>{where}</strong>
                        <span className="ins-meta">
                          {when} · {insightModeText(ins)} · en {sc.b} min ou moins par sens
                        </span>
                        {metric.map((line, k) => (
                          <span key={k} className={`ins-metric ${ins.kind === 'late_return' || (ins.kind === 'bike_gain' && k > 0) ? 'is-text' : 'mono'}`}>
                            {line}
                          </span>
                        ))}
                        {!ins.robust && <span className="ins-meta">écart observé pour un seul de ces temps</span>}
                        {crosscheckNote(ins) && <span className="ins-meta">{crosscheckNote(ins)}</span>}
                        <span className="ins-verb">
                          {plan.verb}
                          {plan.subline && <span className="ins-verb-sub"> ({plan.subline})</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {/* Mode provenance : une ligne pour toutes les découvertes (calculées sur les mêmes sources) */}
            {sorted.length > 0 && <SkySourceNote mode="transit" className="ins-prov" />}
            {pending.length > 0 && (
              <div className="ins-pending">
                <p className="ins-kind">{sorted.length ? 'Pas encore calculées' : 'Découvertes pas encore calculées'}</p>
                <ul>
                  {pending.map(([kind, k]) => (
                    <li key={kind}>
                      <strong>{KIND_TITLE[kind] ?? kind}</strong>
                      {'reason' in k && k.reason ? <span className="ins-meta"> : {k.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
