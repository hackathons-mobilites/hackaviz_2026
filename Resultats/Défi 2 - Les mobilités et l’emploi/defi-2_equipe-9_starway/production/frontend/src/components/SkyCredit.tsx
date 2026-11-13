import { useLayoutEffect, useMemo, useRef } from 'react';
import { OSM_COPYRIGHT_URL, OSM_CREDIT, OSM_CREDIT_SHORT } from '../data/attribution';
import { codesOfParts, creditNames, OSM_CODE, scenarioCreditCodes } from '../data/panelCredits';
import { skyProvenance } from '../data/provenance';
import { useReservedRect } from '../store/overlayRects';
import { useProvenanceStore } from '../store/provenanceStore';
import { useSkyStore } from '../store/useSkyStore';
import { useFeaturesStore } from './featuresStore';
import { ProvenanceParts } from './provenance/ProvenanceNote';
import { useIsPhone } from './useBottomSheet';
import './skyCredit.css';

/**
 * Bande de provenance du ciel (motion-spec, « Bande de provenance du ciel ») : une seule pour tout le
 * ciel (et le diptyque), jamais une ligne par astre. Toujours : les producteurs (du ciel, du scénario et du panneau ouvert :
 * c'est ici que D-060 est tenue hors mode sources, la ligne du pied du panneau n'étant écrite qu'en mode sources) et « © les contributeurs
 * d'OpenStreetMap » (ODbL, les temps de trajet en sont tirés) ; « Sources & limites » est dans la barre du
 * haut seulement (un seul accès, retour du testeur KBS du 10/11). Mode provenance actif : au-dessus,
 * la source des postes (aire des astres) et des temps de trajet (états), lue dans sources.json,
 * poles.json et meta.json. Zone réservée `provenance` : la ligne de provenance garde sa place, invisible,
 * quand le mode est coupé, pour que le changement de réglage ne déplace aucun nom de pôle.
 */
export function SkyCredit() {
  const ref = useRef<HTMLDivElement>(null);
  const dataset = useSkyStore((s) => s.dataset);
  const mode = useSkyStore((s) => s.scenario.mode);
  const vehicle = useSkyStore((s) => s.scenario.vehicle);
  const panelOpen = useSkyStore((s) => !!s.scenario.pole);
  const hasOrigin = useSkyStore((s) => !!s.scenario.origin);
  const on = useProvenanceStore((s) => s.on);
  const mapPhase = useFeaturesStore((s) => s.mapPhase);
  const demo = dataset?.origin === 'demo';
  const parts = useMemo(() => (dataset ? skyProvenance(dataset, mode) : []), [dataset, mode]);
  // Producteurs en clair, toujours visibles (D-060) : postes (INSEE), bassins d'emploi (France Travail), horaires ; et, depuis que la
  // ligne du pied du panneau n'est écrite qu'en mode sources (11/11), ceux du scénario et du panneau ouvert (DiRIF, EDF, Service
  // Public... : `scenarioCreditCodes`). OpenStreetMap garde son lien ODbL juste après
  const producers = useMemo(
    () =>
      dataset && !demo
        ? creditNames(
            [...codesOfParts(parts), ...scenarioCreditCodes(dataset, { mode, vehicle, panelOpen, hasOrigin })].filter((c) => c !== OSM_CODE),
            dataset.sources,
          )
        : [],
    [dataset, demo, parts, mode, vehicle, panelOpen, hasOrigin],
  );
  const phone = useIsPhone();
  useReservedRect('provenance', ref, true);
  // Hauteur de la bande publiée en variable CSS : au téléphone, la légende se pose juste au-dessus
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--sky-credit-h', `${el.offsetHeight}px`);
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--sky-credit-h');
    };
  }, []);
  return (
    <div ref={ref} className="sky-credit" data-map-phase={mapPhase}>
      {parts.length > 0 && (
        // Coupé : `visibility: hidden` (ni lu ni focalisable), la place reste réservée
        <p id="prov-sky" className={`sky-credit-line sky-prov ${on ? 'is-on' : ''}`} aria-hidden={!on}>
          <ProvenanceParts parts={parts} compact={phone} />
        </p>
      )}
      <p className="sky-credit-line">
        {demo ? (
          'Données fictives de démonstration'
        ) : (
          <>
            {/* 12/11 (retour de Flo, validé par Nicolas) : les producteurs ne s'écrivent que si « Afficher la provenance » est actif ; le crédit OpenStreetMap (ODbL) reste toujours */}
            {on && producers.length > 0 && `Données : ${producers.join(', ')}, `}
            <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer" aria-label={`${OSM_CREDIT} (nouvel onglet)`}>
              {on ? OSM_CREDIT : OSM_CREDIT_SHORT}
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
                <path d="M4 2h6v6M10 2 3 9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </a>
          </>
        )}
        {/* « Sources & limites » n'est plus répété ici (retour du testeur KBS, 10/11) : un seul accès, le lien de la barre du
            haut, rangé dans le menu à trois traits au téléphone */}
      </p>
    </div>
  );
}
