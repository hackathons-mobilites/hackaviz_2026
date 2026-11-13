import { useId, useState } from 'react';
import type { CarLegFacts } from '../../data/carCost';
import { euro, euroRange } from '../../data/carCostChart';
import { carBreakdown } from '../../data/costBreakdown';
import { formatInt } from '../../data/format';
import { tollCredits } from '../../data/tolls';
import { BIKE_CARBON, BIKE_TRANSIT_DETAIL, BIKE_TRANSIT_TC, bikeCarbonTile, type Tile } from '../../data/tripTiles';
import { InfoTip } from '../InfoTip';
import { TipLines } from './TipLines';
import type { AccessFile, Meta, TollsFile } from '../../data/types';
import type { Scenario } from '../../state/scenario';
import { useSubscriptionsFile } from '../subscriptions/useSubscriptionsFile';
import { carScenarioFacts } from './carScenario';
import { CostDonut } from './CostDonut';
import { TripTiles, type TileSlot } from './TripTiles';
import { useTolls } from './useTolls';
import './alternatives/alternatives.css';
import './tripTiles.css';

/**
 * Bloc « Trajet » hors transports en commun (D-066) : la même place et les mêmes tuiles que le bloc des transports en commun, avec
 * ce que les données donnent. Pas de tuile Durée : la seule durée publiée est celle du verdict, déjà en tête de fiche.
 * - vélo : Coût (texte publié de `subscriptions.json`) et Carbone « Pas d'émission à l'usage », sans chiffre (aucune source retenue) ;
 * - vélo + TC : la partie vélo comme le vélo, la partie en transports en commun « Non calculé » (pas d'itinéraire vélo + TC publié) ;
 * - voiture : Coût et Carbone du sens choisi (bascule Aller / Retour), le péage et le crédit de son tarif côte à côte (D-060).
 */
export function ModeTripBlock(props: { mode: string; meta: Meta; access: AccessFile | null | undefined; poleIndex: number; polesCount: number; scenario: Scenario }) {
  const isCar = props.mode === 'car' || props.mode === 'car_traffic';
  if (isCar) return <CarTripBlock {...props} />;
  if (props.mode === 'bike' || props.mode === 'bike_transit') return <BikeTripBlock transit={props.mode === 'bike_transit'} bikeKmh={props.meta.speeds?.bike_kmh ?? null} />;
  return null;
}

function Shell({ titleId, children, info }: { titleId: string; children: React.ReactNode; info?: { label: string; lines: readonly string[] } }) {
  return (
    <section className="pf-section pf-trip-block" aria-labelledby={titleId}>
      <div className="pf-label-row">
        <h3 className="pf-label" id={titleId}>
          Trajet
        </h3>
        {info && (
          <InfoTip label={info.label} placement="top">
            <TipLines lines={info.lines} />
          </InfoTip>
        )}
      </div>
      {children}
    </section>
  );
}

function BikeTripBlock({ transit, bikeKmh }: { transit: boolean; bikeKmh: number | null }) {
  const titleId = useId();
  const file = useSubscriptionsFile();
  if (!file) return null;
  const parking = [file.bike.parking.text, `${file.bike.parking.scope.charAt(0).toUpperCase()}${file.bike.parking.scope.slice(1)}.`];
  // « Vélo personnel : aucun titre de transport. » : la valeur après les deux-points, le reste est le libellé de la tuile
  const bikeCostText = file.bike.personal.text.split(' : ').slice(1).join(' : ').replace(/\.$/, '') || file.bike.personal.text;
  const bikeCost: Tile = { value: cap(bikeCostText), sub: transit ? 'partie à vélo' : null, tip: transit ? parking : [] };
  // Vélo + TC : la vitesse de meta.speeds n'est pas dite pour ce mode, aucun sous-libellé de vitesse (arbitrage du 11/11)
  const bikeCarbon: Tile = transit ? { ...BIKE_CARBON, sub: 'partie à vélo' } : bikeCarbonTile(bikeKmh);
  const tiles: TileSlot[] = transit
    ? [
        { label: 'Coût', tile: bikeCost, className: 'pf-cost', tipLabel: 'Et pour garer le vélo en gare ?' },
        { label: 'Coût', tile: BIKE_TRANSIT_TC, tipLabel: 'Pourquoi non calculé ?' },
        { label: 'Carbone', tile: bikeCarbon, className: 'pf-carbon', tipLabel: "Pourquoi pas d'émission à l'usage ?" },
        { label: 'Carbone', tile: BIKE_TRANSIT_TC, tipLabel: 'Pourquoi non calculé ?' },
      ]
    : [
        { label: 'Coût', tile: bikeCost, className: 'pf-cost' },
        { label: 'Carbone', tile: bikeCarbon, className: 'pf-carbon', tipLabel: "Pourquoi pas d'émission à l'usage ?" },
      ];
  return (
    // 13/11 (demande de Nicolas) : en vélo + TC, dire au titre du bloc qu'il n'y a pas de détail ligne par ligne
    <Shell titleId={titleId} info={transit ? { label: 'Pourquoi pas de détail du trajet ?', lines: BIKE_TRANSIT_DETAIL } : undefined}>
      <p className="pf-trip-rt">Aller et retour</p>
      <TripTiles label="Coût et carbone, aller et retour" tiles={tiles} keyOf={(t, i) => `${t.label}-${i}`} />
    </Shell>
  );
}

function CarTripBlock({ meta, access, poleIndex, polesCount, scenario }: { meta: Meta; access: AccessFile | null | undefined; poleIndex: number; polesCount: number; scenario: Scenario }) {
  const titleId = useId();
  const tj = useTolls(!!access?.car_trip?.toll);
  const [dir, setDir] = useState<'out' | 'ret'>('out');
  const cf = carScenarioFacts({ meta, access, poleIndex, polesCount, scenario, tolls: tj });
  if (!cf?.facts || cf.forbidden) return null;
  const f = dir === 'out' ? cf.facts.out : cf.facts.ret;
  if (f.distM == null) return null;
  const breakdown = carBreakdown(f, cf.v.energy);
  const rt = cf.facts.totalMin != null && cf.facts.totalMax != null ? `Aller et retour : ${euroRange(cf.facts.totalMin, cf.facts.totalMax)}${cf.facts.co2 != null ? ` · environ ${formatInt(cf.facts.co2)}\u00a0g CO2e (estimation, énergie seule)` : ''}` : null;
  return (
    <Shell titleId={titleId}>
      <div className="alt-dir" role="group" aria-label="Sens du trajet">
        {(['out', 'ret'] as const).map((d) => (
          <button key={d} type="button" className="alt-dir-btn" aria-pressed={dir === d} onClick={() => setDir(d)}>
            {d === 'out' ? 'Aller' : 'Retour'}
          </button>
        ))}
      </div>
      {rt && <p className="pf-trip-rt">{rt}</p>}
      <TripTiles
        label={`Voiture, ${dir === 'out' ? 'aller' : 'retour'} : coût et carbone`}
        tiles={[
          {
            label: 'Coût',
            tile: carCostTile(f, tj),
            className: 'pf-carcost-leg',
            tipLabel: 'Quelles dépenses pour ce trajet ?',
            extra: breakdown ? <CostDonut breakdown={breakdown} title={`Dépenses du trajet en voiture, ${dir === 'out' ? 'aller' : 'retour'}, en pourcentage du coût`} /> : undefined,
          },
          {
            label: 'Carbone',
            tile: f.co2 != null ? { value: `${formatInt(f.co2)}\u00a0g CO2e`, sub: 'estimation, énergie seule', tip: [] } : { value: 'Non calculé', sub: null, tip: [] },
          },
        ]}
      />
    </Shell>
  );
}

/** Coût d'un sens en voiture : énergie + péage ; le montant du péage et le crédit de son tarif sont écrits dessous, côte à côte (D-060). */
function carCostTile(f: CarLegFacts, tj: TollsFile | null): Tile {
  const toll = f.toll;
  if (f.totalMin != null && f.totalMax != null) {
    if (!toll || toll.status === 'sans_peage' || !tj) return { value: euroRange(f.totalMin, f.totalMax), sub: 'énergie, aucun péage', tip: [] };
    const credits = tollCredits(tj, toll.items);
    return { value: euroRange(f.totalMin, f.totalMax), sub: `dont péage ${euroRange(toll.min!, toll.max!)}${credits.length ? ` (${credits.join(', ')})` : ''}`, tip: [] };
  }
  return { value: f.energy != null ? euro(f.energy) : 'Inconnu', sub: f.energy != null ? 'énergie seule, péage non chiffré' : null, tip: [] };
}

function cap(s: string): string {
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}
