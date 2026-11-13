import type { ReactNode } from 'react';
import type { Tile } from '../../data/tripTiles';
import { SourceTip } from './SourceTip';
import { TipLines } from './TipLines';
import { useSourcesOn } from './useSourcesOn';
import './tripTiles.css';

export interface TileSlot {
  /** « Durée », « Coût », « Carbone » */
  label: string;
  tile: Tile;
  /** Classe de la tuile (`pf-cost`, `pf-carbon` : repères du test de fumée et du contrôle d'affichage) */
  className?: string;
  /** Nom accessible du « i » de la tuile, en question */
  tipLabel?: string;
  /** Ligne de source sous la tuile (mode sources seulement : `CodeSourceNote` ne rend rien sinon) */
  note?: ReactNode;
  /** Contenu ajouté au « i » de la tuile, sous ses phrases (l'anneau des dépenses du coût, 12/11) */
  extra?: ReactNode;
}

/**
 * Tuiles du bloc « Trajet » (D-066) : le chiffre en grand, la garde courte dessous (« estimation », « au ticket »), le reste dans le
 * « i » (`SourceTip` : écrit en clair avec le mode sources, D-064). Une liste de définitions : un lecteur d'écran lit « Coût, 2,55 €,
 * au ticket ». Aucune couleur de donnée : ce ne sont pas des verdicts (cyan réservé à l'accessible, or au gain démontré).
 */
export function TripTiles({ tiles, label, keyOf }: { tiles: readonly TileSlot[]; label: string; keyOf?: (t: TileSlot, i: number) => string }) {
  // Mode sources : les phrases des « i » sont écrites en clair dans la tuile ; une tuile par ligne pour qu'elles restent lisibles
  const sourcesOn = useSourcesOn();
  return (
    <dl className={`pf-tiles${sourcesOn ? ' is-src' : ''}`} aria-label={label} data-count={tiles.length}>
      {tiles.map((t, i) => (
        <div key={keyOf ? keyOf(t, i) : `${t.label}-${i}`} className={`pf-tile${t.className ? ` ${t.className}` : ''}`}>
          <dt className="pf-tile-label">{t.label}</dt>
          <dd className="pf-tile-value">
            <span className={`pf-tile-figure${t.tile.value.length > 12 ? ' is-words' : ''}`}>{t.tile.value}</span>
            {/* Espace lue entre le chiffre et sa garde : « 2,55 € au ticket » pour un lecteur d'écran et le relevé des phrases */}
            {(t.tile.sub || t.tile.tip.length > 0 || t.extra) && ' '}
            {(t.tile.sub || t.tile.tip.length > 0 || t.extra) && (
              <span className="pf-tile-sub">
                {t.tile.sub}
                {(t.tile.tip.length > 0 || t.extra) && (
                  <>
                    {t.tile.sub ? ' ' : ''}
                    <SourceTip label={t.tipLabel ?? `${t.label} : d'où vient cette valeur ?`} block>
                      <TipLines lines={t.tile.tip} />
                      {t.extra}
                    </SourceTip>
                  </>
                )}
              </span>
            )}
            {t.note}
          </dd>
        </div>
      ))}
    </dl>
  );
}
