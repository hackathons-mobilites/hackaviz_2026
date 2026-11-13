import { selectedVehicle } from '../data/carCost';
import { stripDecisionCodes } from '../data/proof';
import type { Meta } from '../data/types';
import { useSkyStore } from '../store/useSkyStore';
import { InfoTip } from './InfoTip';

/**
 * Sélecteur « Véhicule » des modes voiture (D-029), sur la deuxième ligne de la cellule « Mode »
 * (même hauteur et mêmes classes que le réglage « Marche » des TC). Il ne change que le coût, les
 * péages et le carbone du panneau de preuve : ni le ciel ni les temps (les deux-roues ont le temps de
 * la voiture, décision de Nicolas du 03/11). Mémorisé dans le scénario et l'URL (`vh`).
 */
export function VehicleSelect({ meta, vehicle, note }: { meta: Meta; vehicle: string | null | undefined; note: string | null }) {
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const vs = meta.vehicles ?? [];
  const current = selectedVehicle(meta, vehicle);
  if (vs.length < 2 || !current) return null;
  const cars = vs.filter((v) => (v.family ?? 'car') === 'car');
  const twoWheelers = vs.filter((v) => v.family === 'two_wheeler');
  return (
    <span className="bar-line2 walk-setting vehicle-setting">
      <label htmlFor="vehicle-select" className="walk-label">
        Véhicule
      </label>
      <select
        id="vehicle-select"
        className="select walk-select"
        value={current.id}
        onChange={(e) => void applyScenario({ vehicle: e.target.value === vs[0]!.id ? null : e.target.value })}
      >
        <optgroup label="Voiture">
          {cars.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </optgroup>
        {twoWheelers.length > 0 && (
          <optgroup label="Deux-roues (même temps que la voiture)">
            {twoWheelers.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <InfoTip label="Que change « Véhicule » ?" placement="top" className="walk-tip">
        Le véhicule ne change que le coût (énergie et péages) et le carbone du trajet, affichés dans le panneau d'un astre. Le ciel et les
        temps restent ceux de la voiture.{note ? ` Temps : ${stripDecisionCodes(note)}.` : ''}
        {meta.car_costs?.two_wheelers?.electric ? ` ${stripDecisionCodes(meta.car_costs.two_wheelers.electric)}` : ''}
      </InfoTip>
    </span>
  );
}
