import { Fragment } from 'react';
import { READING_TITLE, readingLabel, type ChartReading } from '../data/chartReading';
import { InfoTip } from './InfoTip';

/**
 * « Comment lire ce graphique » (demande de Nicolas du 10/11) : le bouton « i » (InfoTip, même style et même accessibilité que les
 * autres) posé à côté du titre d'un graphique. Il dit ce que représente chaque élément, puis un cas précis construit avec les valeurs
 * affichées (`data/chartReading.ts`, fonctions pures). Chaque phrase est sur sa ligne : le relevé des phrases du test de fumée lit le
 * contenu des bulles ligne par ligne.
 */
export function ChartReadingTip({
  reading,
  chart,
  placement = 'bottom',
  className = '',
}: {
  reading: ChartReading;
  /** Nom du graphique, ajouté au nom accessible du bouton (plusieurs graphiques par panneau) */
  chart: string;
  placement?: 'bottom' | 'top';
  className?: string;
}) {
  return (
    <InfoTip label={readingLabel(chart)} placement={placement} className={`chart-read ${className}`}>
      {/* Ce que mesure le graphique, en clair, avant la lecture du dessin (compteur : ce que sont les postes, 11/11) */}
      {reading.intro?.map((p) => (
        <Fragment key={p}>
          <span className="chart-read-line chart-read-intro">{p}</span>
          {'\n'}
        </Fragment>
      ))}
      <span className="chart-read-head">{READING_TITLE}</span>
      {'\n'}
      {reading.parts.map((p) => (
        <Fragment key={p}>
          <span className="chart-read-line">{p}</span>
          {'\n'}
        </Fragment>
      ))}
      {reading.example.length > 0 && (
        <>
          <span className="chart-read-head chart-read-case">Un cas précis</span>
          {'\n'}
          {reading.example.map((p, i) => (
            <Fragment key={`${i}-${p}`}>
              <span className="chart-read-line">{p}</span>
              {'\n'}
            </Fragment>
          ))}
        </>
      )}
    </InfoTip>
  );
}
