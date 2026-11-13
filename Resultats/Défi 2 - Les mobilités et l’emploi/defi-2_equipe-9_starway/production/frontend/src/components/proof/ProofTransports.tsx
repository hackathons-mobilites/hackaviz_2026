import { useRef } from 'react';
import {
  distanceText,
  hasLineFacts,
  itineraryDeltaText,
  legMinutes,
  legTitle,
  lineComfortFacts,
  lineFactsShort,
  lineStopFacts,
  LINE_FACTS_LICENCE,
  type ItinTrip,
} from '../../data/itineraries';
import type { LineFactsMeta } from '../../data/types';
import { needsTripLabel, type NeedsLeg } from '../../data/needs';
import { tripBandModel } from '../../data/tripBand';
import { TripBand } from './TripBand';
import { useTourFold } from './useTourFold';
import { TravelSourceNote, TripFactsSourceNote } from '../provenance/ProofNotes';
import { LegNeeds, NeedsNotes, NeedsRecall, NeedsTripSummary } from './ProofNeeds';
import { InfoTip } from '../InfoTip';
import { SourceTip } from './SourceTip';
import { useSourcesOn } from './useSourcesOn';
import { TipLines } from './TipLines';
import './panneauLignes.css';

/**
 * Bloc « Transports utilisés (aller) » (maquette v1 de Sara, 04/11) : rendu SEULEMENT si l'itinéraire est
 * publié (`itineraryOf` non nul), jamais de valeur d'attente.
 * Visible : une ligne par ligne de TC empruntée (pastille, « RER A ») avec ce que disent les sources
 * (climatisation déclarée à IDFM, TRA03 ; ponctualité mensuelle SNCF Voyageurs, QS01, RER et Transilien,
 * avec le mois ; « pas de donnée ouverte » ailleurs). Retours KBS du 10/11 (règle d'affichage V5) : la ligne de valeur
 * est visible ; ses phrases complètes, les définitions et la mention ODbL sont dans un « i » au bout de la liste (mots
 * inchangés) ; jeu, millésime et code en mode sources. Replié (« Arrêts et horaires du trajet ») : chaque tronçon
 * (heures, arrêts, marche), sans la climatisation ni la ponctualité. Jamais « trajet accessible ».
 */
export function ProofTransports({
  trip,
  leg: side = 'out',
  note,
  example = false,
  stopNote,
  texts,
  needs = 'inline',
  repeatNotes = true,
  scale,
  bare = false,
}: {
  trip: ItinTrip;
  leg?: 'out' | 'ret';
  note?: string | null;
  /**
   * Audit d'affichage du 11/11 (T1, V3) : vue commune par commune, l'itinéraire n'est qu'un exemple ; le mot reste dans le titre (« Transports
   * utilisés (aller, exemple de trajet) »), la note d'exemple, la phrase de l'arrêt et l'écart de durée vont dans le « i » du titre.
   */
  example?: boolean;
  /**
   * Phrase de l'arrêt d'affichage de l'astre : `itineraryStopNote` pour l'aller (itinéraire jusqu'à l'arrêt), `itineraryReturnStopNote`
   * pour le retour (itinéraire depuis l'arrêt). Le bloc l'écrit telle quelle, sous son sens ; absente, rien.
   */
  stopNote?: string | null;
  texts?: LineFactsMeta['texts'];
  /**
   * « Ce qu'il me faut sur mon trajet » : `inline` (défaut) = dans le bloc, comme avant ; `external` = dans son propre pli du panneau
   * (lot 3, D-050), le bloc ne garde que le trajet.
   */
  needs?: 'inline' | 'external';
  /** Lot 3 : `false` au retour quand l'aller est affiché, pour ne pas répéter le crédit des données (lot 6 : « calculé avec r5py » est dans « Méthode et sources ») */
  repeatNotes?: boolean;
  /** Lot 4 : échelle commune de l'aller et du retour (minutes, `tripBandScale`) ; donnée, le trajet est dessiné en bande à l'échelle du temps ; absente, la liste d'avant */
  scale?: number;
  /**
   * Bloc « Trajet » (D-066) : le titre, la bascule Aller / Retour et le « i » de l'exemple sont ceux du bloc ; ce composant ne rend que
   * la bande, les lignes et « Arrêts et horaires du trajet » du sens choisi (classe `pf-transports` gardée : visite, test de fumée, Aide).
   */
  bare?: boolean;
}) {
  const showShared = side === 'out' || repeatNotes;
  const legs = trip.legs ?? [];
  const rides = legs.filter((l) => l.m !== 'walk');
  const delta = itineraryDeltaText(trip);
  const titleId = `pf-transports-title-${side}`;
  const facts = hasLineFacts(legs);
  const needsInline = needs === 'inline';
  const sectionRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDetailsElement>(null);
  // Lot 5 : la visite (étape qui commente la climatisation et la ponctualité) ouvre « Détail du trajet » puis le referme
  useTourFold(sectionRef, detailRef);
  const model = scale != null ? tripBandModel(trip) : null;
  const tipLines2 = [note, stopNote, delta].filter((t): t is string => !!t);
  const band = model != null;
  // Retours KBS du 10/11 : phrases complètes de chaque ligne, définitions et mention ODbL, mots inchangés, dans un seul « i ».
  // Une ligne par phrase, séparées par un saut de ligne (rendu comme une espace) : lecteur d'écran et inventaire lisent des phrases distinctes.
  const tipLines = [
    ...rides.flatMap((leg) => {
      const all = lineComfortFacts(leg, texts);
      return all.length ? [legTitle(leg), ...all] : [];
    }),
    ...(facts && texts ? [texts.air_conditioning.definition, texts.punctuality.definition] : []),
    ...(facts && showShared ? [texts?.licence ?? LINE_FACTS_LICENCE] : []),
  ];
  const sourcesOn = useSourcesOn();
  const lastWithFacts = rides.reduce((last, leg, i) => (lineFactsShort(leg, texts) ? i : last), -1);
  const linesTip =
    facts && tipLines.length > 0 ? (
      <InfoTip label="Climatisation et ponctualité : d'où viennent ces valeurs ?" placement="top">
        {tipLines.map((t, i) => (
          <span key={i} className="pf-tip-line">
            {t}
            {i < tipLines.length - 1 ? '\n' : ''}
          </span>
        ))}
      </InfoTip>
    ) : null;
  const linesList = (
    <ul className={`pf-lines${band ? ' pf-lines-band' : ''}`}>
      {rides.map((leg, i) => {
        // T4 : le mois de la ponctualité est dans le « i » des lignes ; écrit ici en mode sources
        const short = lineFactsShort(leg, texts, sourcesOn);
        return (
          <li key={i}>
            <span className="pf-trip-head">
              {leg.color && /^[0-9a-f]{6}$/i.test(leg.color) && <span className="pf-trip-swatch" style={{ background: `#${leg.color}` }} aria-hidden="true" />}
              <strong>{legTitle(leg)}</strong>
              {/* Avec la bande du trajet, les heures sont dans la bande : lues par les lecteurs d'écran seulement */}
              <span className="pf-trip-time">
                {leg.dep} → {leg.arr} · {legMinutes(leg.min)}&nbsp;min
              </span>
            </span>
            {short && (
              <span className="pf-lines-facts">
                {short}
                {i === lastWithFacts && linesTip && <> {linesTip}</>}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
  return (
    <section ref={sectionRef} className={`pf-section pf-transports${bare ? ' is-bare' : ''}`} aria-labelledby={bare ? undefined : titleId} aria-label={bare ? `Lignes et arrêts, ${side === 'out' ? 'aller' : 'retour'}` : undefined}>
      {!bare && (
      <div className="pf-label-row">
        <h3 className="pf-label" id={titleId}>
          Transports utilisés ({side === 'out' ? 'aller' : 'retour'}{example ? ', exemple de trajet' : ''}) · {trip.dep} → {trip.arr}
        </h3>
        {/* T2, T5, A3 : d'où part et où arrive l'exemple, mots inchangés, dans cet ordre ; en clair en mode sources */}
        {tipLines2.length > 0 && (
          <SourceTip label="D'où part et où arrive cet exemple ?" block>
            <TipLines lines={tipLines2} />
          </SourceTip>
        )}
      </div>
      )}
      {needsInline && side === 'out' && <NeedsRecall />}
      {band && model ? (
        <>
          <TripBand trip={trip} scale={scale!} side={side} texts={texts} />
          {rides.length === 0 && <p className="pf-lines-none">À pied, sans transport en commun.</p>}
          {/* Retours KBS du 10/11 : la ligne de valeur de chaque ligne (climatisation, ponctualité) est visible sous la bande */}
          {rides.length > 0 && linesList}
        </>
      ) : rides.length === 0 ? (
        <p className="pf-lines-none">À pied, sans transport en commun.</p>
      ) : (
        linesList
      )}
      {/* Mode provenance : jeu, millésime et fiche de la climatisation (TRA03) et de la ponctualité (QS01) lues ci-dessus */}
      <TripFactsSourceNote className="pf-prov" trip={trip} />
      {needsInline && <NeedsTripSummary trip={trip} label={needsTripLabel(side)} />}
      {/* Audit d'affichage du 10/11 : Nicolas ne trouvait pas le détail ; le pli dit ce qu'il contient et se voit comme un bouton */}
      <details ref={detailRef} className="pf-fold pf-trip-fold">
        <summary>Arrêts et horaires du trajet</summary>
        <ol className="pf-trip">
          {legs.map((leg, i) => {
            const walk = leg.m === 'walk';
            const dist = distanceText(leg.dist_m);
            const all = lineStopFacts(leg, texts);
            const where = !walk && (leg.from || leg.to) ? `${leg.from ?? '?'} → ${leg.to ?? '?'}` : null;
            return (
              <li key={i} className={walk ? 'is-walk' : ''}>
                <span className="pf-trip-head">
                  {!walk && leg.color && /^[0-9a-f]{6}$/i.test(leg.color) && (
                    <span className="pf-trip-swatch" style={{ background: `#${leg.color}` }} aria-hidden="true" />
                  )}
                  <strong>{legTitle(leg)}</strong>
                  <span className="pf-trip-time">
                    {leg.dep} → {leg.arr} · {legMinutes(leg.min)}&nbsp;min{walk && dist ? ` · ${dist}` : ''}
                  </span>
                </span>
                {where && <span className="pf-trip-where">{where}</span>}
                {all.length > 0 && (
                  <ul className="pf-trip-facts">
                    {all.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
                <LegNeeds leg={leg as NeedsLeg} />
              </li>
            );
          })}
        </ol>
        {needsInline && <NeedsNotes legs={legs as NeedsLeg[]} />}
      </details>
      {/* Retours KBS du 10/11 : définitions et mention ODbL des faits de ligne dans le « i » de la liste ; les producteurs restent
          crédités en bas du ciel, dans « Sources et limites » et, en mode sources, au pied du panneau (D-064) */}
      <TravelSourceNote className="pf-prov" mode="transit" origins={[]} lead="Itinéraire" />
    </section>
  );
}
