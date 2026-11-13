import { useState } from 'react';
import { periodText, trafficLeg, trafficLegText, type TrafficLeg } from '../../data/congestion';
import { parseClock, shortCommuneName, stripDecisionCodes, stripPersonalNotes } from '../../data/proof';
import { guardSeries, SERIES_REFUSED_TEXT } from '../../data/seriesGuard';
import { trafficChartModel } from '../../data/trafficChart';
import type { CarCongestionMeta } from '../../data/types';
import { CodeSourceNote } from '../provenance/ProofNotes';
import { InfoTip } from '../InfoTip';
import { useProvenanceStore } from '../../store/provenanceStore';
import type { Side } from './sideFacts';
import { TipLines } from './TipLines';
import { TrafficChart } from './TrafficChart';

const CHART_TITLE = 'Temps de trajet en voiture : route vide et trafic moyen';
/** Portée de l'exemple en commune par commune (P21) */
const OD_RULE_TEXT = 'Les temps des communes ci-dessus suivent cette règle. Exemple vers le point du pôle :';

/**
 * Bloc « Voiture et trafic » du panneau de preuve (D-029), modes `car` et `car_traffic` :
 * pour chaque sens, le temps route vide (R5), l'indice DiRIF de sa tranche et le temps avec le trafic
 * moyen, ou « pas de mesure de la DiRIF à cette heure ». Source, mois et incertitude toujours cités.
 * En commune par commune (table OD), le bloc dit l'indice de chaque sens (les temps des communes
 * sont dans la liste au-dessus).
 */
export function ProofTraffic({ sides, cc, od, optimistic = null }: { sides: Side[]; cc: CarCongestionMeta; od: boolean; optimistic?: string | null }) {
  const sourcesOn = useProvenanceStore((s) => s.on);
  const first = sides[0];
  if (!first) return null;
  const { scenario, dataset } = first.view;
  const traffic = scenario.mode === 'car_traffic';
  const day = dataset.meta.day_types.find((d) => d.id === scenario.day);
  const start = scenario.shift?.start ?? parseClock(day?.start);
  const end = scenario.shift?.end ?? parseClock(day?.end);
  if (start == null || end == null) return null;
  const dual = sides.length > 1;
  const verdictText = traffic
    ? 'Le verdict de ce mode utilise le temps avec le trafic moyen quand un indice s’applique, sinon le temps route vide.'
    : 'Le verdict de ce mode utilise le temps route vide.';
  return (
    <section className="pf-section pf-traffic" aria-labelledby="pf-traffic-title">
      <h3 className="pf-label" id="pf-traffic-title">
        {traffic ? 'Voiture avec le trafic moyen' : 'Voiture : route vide et trafic moyen'}
      </h3>
      {/* Audit d'affichage du 11/11 (P18, P20, P21) : sans mode sources, la règle de chaque sens et la portée de l'exemple sont dans le « i » du
          bloc, mots inchangés ; le mot « exemple » reste dans le titre du graphique (garde V2) */}
      {sourcesOn && optimistic && <p className="pf-note">{optimistic}</p>}
      {sourcesOn && od && (
        <>
          <ul className="pf-traffic-legs">
            <li>Aller : {periodLine(cc, 'out', start)}</li>
            <li>Retour : {periodLine(cc, 'ret', end)}</li>
          </ul>
          <p className="pf-src">{OD_RULE_TEXT}</p>
        </>
      )}
      {sides.map((s) => {
          const idx = s.view.dataset.poles.findIndex((p) => p.id === s.view.selectedPole?.id);
          const raw = s.access?.modes?.car?.any;
          // Séries par position : garde de longueur (arbitrage du 05/11). Une série d'un autre jeu d'astres est refusée : « non calculé »
          const base = guardSeries(s.view.dataset.poles.length, raw);
          if (idx < 0 || !raw) return null;
          if (!base) {
            return (
              <div key={s.view.origin?.insee ?? 'x'}>
                {dual && s.view.origin && <p className="pf-src">{shortCommuneName(s.view.origin.name)}</p>}
                <p className="pf-src">{SERIES_REFUSED_TEXT}</p>
              </div>
            );
          }
          const out = trafficLeg(cc, 'out', start, base.out[idx]);
          const ret = trafficLeg(cc, 'ret', end, base.ret[idx]);
          return (
            <div key={s.view.origin?.insee ?? 'x'}>
              {dual && s.view.origin && <p className="pf-src">{shortCommuneName(s.view.origin.name)}</p>}
              <SideLegs cc={cc} out={out} ret={ret} title={od ? `${CHART_TITLE} (exemple vers le point du pôle)` : CHART_TITLE} />
            </div>
          );
        })}
      {sourcesOn ? (
        <>
          <p className="pf-note">
            {verdictText} {stripPersonalNotes(cc.texts.choice)}
          </p>
          <span className="pf-src">
            Source :{' '}
            {cc.url ? (
              <a href={cc.url} target="_blank" rel="noopener noreferrer">
                {cc.publisher}, {cc.title}
              </a>
            ) : (
              `${cc.publisher}, ${cc.title}`
            )}{' '}
            ; {cc.texts.label} ; mesuré sur les {cc.network}, pas sur les rues.
          </span>
        </>
      ) : (
        // Règle d'affichage finale du 11/11 (P18, P25) : le « i » seul ; le choix de l'équipe (« pas une mesure ») y est en tête, la légende du
        // graphique dit « (estimation) » (garde V1)
        <p className="pf-note pf-traffic-tip">
          <InfoTip label="Comment ce temps est-il calculé ?" placement="top">
            <TipLines
              breaks
              lines={[
                ...(optimistic ? [optimistic] : []),
                stripDecisionCodes(cc.texts.choice),
                `${verdictText} ${cc.texts.label.charAt(0).toUpperCase()}${cc.texts.label.slice(1)} ; mesuré sur les ${cc.network}, pas sur les rues.`,
                ...(od ? [`Aller : ${periodLine(cc, 'out', start)}`, `Retour : ${periodLine(cc, 'ret', end)}`, OD_RULE_TEXT] : []),
              ]}
            />
          </InfoTip>
        </p>
      )}
      {/* Mode provenance : code lu dans les métadonnées publiées (ROAD01), millésime et fiche lus dans sources.json */}
      <CodeSourceNote code={cc.source_id} className="pf-prov" />
    </section>
  );
}

/**
 * Les deux sens d'un côté : le graphique (route vide en point vide, trafic moyen en point plein) et, hors de l'écran, la liste des sens
 * d'avant (mêmes phrases) pour les lecteurs d'écran ; ses lignes prennent le focus clavier (lot 4, D-051).
 */
function SideLegs({ cc, out, ret, title }: { cc: CarCongestionMeta; out: TrafficLeg; ret: TrafficLeg; title: string }) {
  const [active, setActive] = useState<string | null>(null);
  const focus = (label: string) => ({ tabIndex: 0, onFocus: () => setActive(label), onBlur: () => setActive(null) });
  return (
    <TrafficChart model={trafficChartModel(cc, out, ret)} title={title} active={active} onActive={setActive}>
      <ul className="pf-traffic-legs">
        <LegLine label="Aller" cc={cc} leg={out} {...focus('Aller')} />
        <LegLine label="Retour" cc={cc} leg={ret} {...focus('Retour')} />
      </ul>
    </TrafficChart>
  );
}

function LegLine({ label, cc, leg, ...rest }: { label: string; cc: CarCongestionMeta; leg: TrafficLeg; tabIndex?: number; onFocus?: () => void; onBlur?: () => void }) {
  const text = trafficLegText(cc, leg);
  return (
    <li {...rest}>
      {label} : {text ?? 'aucun trajet en voiture trouvé'}
    </li>
  );
}

/** Tranche d'un sens à cette heure (table OD : sans temps, l'indice seulement). */
function periodLine(cc: CarCongestionMeta, leg: 'out' | 'ret', clock: number): string {
  // durée nulle : on ne teste que la tranche autour de l'heure (le débordement dépend du temps de chaque commune)
  const probe = trafficLeg(cc, leg, clock, 0);
  if (probe.status === 'no_period' || !probe.period) return cc.texts.no_period;
  return `indice ${periodText(probe.period)}, si le trajet tient dans la tranche (sinon temps route vide)`;
}
