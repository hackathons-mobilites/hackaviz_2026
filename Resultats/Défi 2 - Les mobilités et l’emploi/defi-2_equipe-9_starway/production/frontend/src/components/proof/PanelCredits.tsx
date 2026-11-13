import { OSM_CREDIT } from '../../data/attribution';
import { OSM_CODE, creditLine, creditNames, panelCreditCodes, type PanelCreditInput } from '../../data/panelCredits';
import { useSkyStore } from '../../store/useSkyStore';
import { usePublicOffersStore } from './publicOffersStore';
import { useTolls } from './useTolls';

/**
 * Pied du panneau de preuve : une seule ligne de crédits, écrite en mode sources seulement depuis le 11/11 (D-064, demande de
 * Nicolas : plus de ligne « Données : ... » au pied du panneau hors mode sources) : les producteurs des blocs du panneau pour ce
 * scénario, lus par les fonctions de provenance du mode sources. Hors mode sources, D-060 (accord de l'organisateur du hackathon
 * du 09/11/2026 : le producteur est crédité dans la dataviz) est tenue par la bande toujours visible sous le ciel (`SkyCredit`,
 * `scenarioCreditCodes`), qui cite aussi les producteurs du scénario et du panneau ouvert.
 */
export function PanelCredits(props: Omit<PanelCreditInput, 'ds' | 'tolls' | 'publicOffers'>) {
  const ds = useSkyStore((s) => s.dataset);
  const offers = usePublicOffersStore((s) => s.shown);
  const car = props.mode === 'car' || props.mode === 'car_traffic';
  const tolls = useTolls(car && !!props.access?.car_trip?.toll);
  if (!ds) return null;
  // Démonstration : aucun producteur réel, la mention OpenStreetMap reste (comme avant)
  if (ds.origin !== 'real') return <p className="pf-credits">Crédit : {OSM_CREDIT}.</p>;
  const { codes, tolls: tollNames } = panelCreditCodes({ ...props, ds, tolls, publicOffers: offers });
  // OpenStreetMap toujours crédité (ODbL, liste « à garder visible »), comme l'ancienne ligne du pied
  if (!codes.includes(OSM_CODE)) codes.push(OSM_CODE);
  const line = creditLine(creditNames(codes, ds.sources, tollNames));
  return line ? <p className="pf-credits">{line}.</p> : null;
}
