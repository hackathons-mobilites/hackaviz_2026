import { motion as m } from 'motion/react';
import type { ReactNode } from 'react';
import { clockRange, formatClock, longestLeg, noTripText, parseClock, shortCommuneName } from '../../data/proof';
import type { ModeId, SpeedsMeta } from '../../data/types';
import { equivalentDistance } from '../../state/budget';
import { motion } from '../../theme/tokens';
import { ProofBadgeLine } from './ProofBadgeLine';
import { returnHintText } from '../../data/od/texts';
import type { Side, SideFacts } from './sideFacts';

const cap = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;

/**
 * Bloc « Temps de trajet » (maquette) : aller et retour, chacun avec ses heures dérivées
 * (départ + durée), puis une barre du sens le plus long par rapport au temps choisi par sens.
 * Diptyque : une colonne par commune, chacune avec son badge.
 */
export function ProofTimes({
  sides,
  facts,
  dual,
  titleSuffix,
  titleTip,
}: {
  sides: Side[];
  facts: SideFacts[];
  dual: boolean;
  /** Garde courte écrite dans le titre (vélo + TC : « (durées minimales) », audit d'affichage du 11/11, D4) */
  titleSuffix?: string;
  /** Son « i » (SourceTip), hors du titre : la bulle hériterait de ses capitales */
  titleTip?: ReactNode;
}) {
  const title = (
    <h3 className="pf-label" id="pf-times-title">
      Temps de trajet{titleSuffix ? ` ${titleSuffix}` : ''}
    </h3>
  );
  return (
    <section className="pf-section pf-times" aria-labelledby="pf-times-title">
      {titleTip ? (
        <div className="pf-label-row">
          {title}
          {titleTip}
        </div>
      ) : (
        title
      )}
      <div className={dual ? 'pf-cols' : ''}>
        {sides.map((s, i) => (
          <SideTimes key={s.view.origin!.insee} side={s} facts={facts[i]!} dual={dual} />
        ))}
      </div>
    </section>
  );
}

function SideTimes({ side, facts, dual }: { side: Side; facts: SideFacts; dual: boolean }) {
  const { view } = side;
  const state = view.selectedState!;
  const { scenario, dataset } = view;
  const day = dataset.meta.day_types.find((d) => d.id === scenario.day);
  const td = facts.timeDependent;
  const maxTrip = dataset.meta.max_trip_min;
  const walkLegM = view.walkSetting?.leg_limit_m ?? null;
  const startTxt = day ? clockOf(day.start) : '';
  const endTxt = day ? clockOf(day.end) : '';
  const longest = longestLeg(state.out, state.ret, scenario.budget);
  const speeds = dataset.meta.speeds;

  return (
    <div className="pf-side">
      {dual && <p className="pf-side-head">Depuis {shortCommuneName(view.origin!.name)}</p>}
      {dual && <ProofBadgeLine badge={facts.badge} />}
      {facts.missing ? (
        <p className="pf-missing">{facts.missing}</p>
      ) : (
        <>
          <div className="pf-legpair">
            <LegCell
              name="Aller"
              minutes={state.out}
              clock={td ? clockRange(facts.outT) : null}
              hint={td && startTxt ? `arriver avant ${startTxt}` : null}
              reason={state.out == null ? cap(`${noTripText('out', maxTrip, td, walkLegM)}.`) : null}
              mode={scenario.mode}
              speeds={speeds}
            />
            <LegCell
              name="Retour"
              minutes={state.ret}
              clock={null}
              hint={td && endTxt ? returnHintText(endTxt, facts.retT.arrive) : null}
              reason={state.ret == null ? cap(`${noTripText('ret', maxTrip, td, walkLegM)}${td && facts.retT.depart != null ? ` (fin du poste ${formatClock(facts.retT.depart)})` : ''}.`) : null}
              mode={scenario.mode}
              speeds={speeds}
            />
          </div>
          {longest && (
            <div className={`pf-longest ${longest.within ? 'is-within' : 'is-over'}`}>
              <div className="pf-bar" aria-hidden="true">
                <m.span
                  className="pf-bar-fill"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: longest.fill }}
                  transition={{ duration: motion.light / 1000, ease: motion.cssEasing.light }}
                />
                <span className={`pf-bar-budget ${longest.mark > 0.85 ? 'is-end' : ''}`} style={{ left: `${longest.mark * 100}%` }}>
                  <span>{scenario.budget} min</span>
                </span>
              </div>
              {/* Audit d'affichage du 11/11 (P15) : « Sens le plus long » redisait les durées et le temps du verdict ; seul le dépassement est écrit */}
              {!longest.within && <p className="pf-longest-text">({longest.minutes - scenario.budget}&nbsp;min au-delà)</p>}
            </div>
          )}
          {/* Lot 6 : « Durée indépendante de l'heure » est dans « Méthode et sources » */}
        </>
      )}
    </div>
  );
}

function LegCell({
  name,
  minutes,
  clock,
  hint,
  reason,
  mode,
  speeds,
}: {
  name: string;
  minutes: number | null;
  clock: string | null;
  hint: string | null;
  reason: string | null;
  mode: ModeId;
  speeds: SpeedsMeta | undefined;
}) {
  // Distance équivalente (meta.speeds) : à pied et à vélo seulement, jamais une valeur par défaut
  const dist = minutes != null ? equivalentDistance(minutes, mode, speeds) : null;
  return (
    <div className="pf-legcell">
      <span className="pf-leg-name">{name}</span>
      <span className="pf-leg-min">
        {minutes == null ? (
          <span className="pf-none">aucun trajet</span>
        ) : (
          <>
            {minutes}
            <small> min</small>
          </>
        )}
      </span>
      {clock && <span className="pf-leg-clock">{clock}</span>}
      {hint && <span className="pf-leg-hint">{hint}</span>}
      {/* Lot 6 : la vitesse du calcul est écrite dans « Méthode et sources » */}
      {dist && <span className="pf-leg-hint">{dist.text}</span>}
      {reason && <p className="pf-leg-line">{reason}</p>}
    </div>
  );
}

function clockOf(hhmm: string): string {
  const c = parseClock(hhmm);
  return c == null ? hhmm : formatClock(c);
}
