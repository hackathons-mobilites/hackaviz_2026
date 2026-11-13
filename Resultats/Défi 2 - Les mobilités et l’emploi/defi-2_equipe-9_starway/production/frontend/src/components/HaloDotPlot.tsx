import { useEffect, useState, type CSSProperties } from 'react';
import { formatPercent } from '../data/format';
import type { DotRow } from '../data/halo';
import { dotPlot } from '../theme/tokens';

/**
 * Modes domicile-travail par sexe en « constellation en lignes » (L-09, motion-spec « Halo v2 ») :
 * une ligne par mode, axe 0-100 % en filet, femmes = point plein, hommes = anneau, même blanc lunaire
 * (la forme distingue, la couleur n'est pas genrée). Marge d'erreur à 95 % en segment doux derrière
 * chaque point ; estimation imprécise en pointillé à 50 %. Les points glissent de 0 à leur valeur
 * (600 ms outQuart, décalage 60 ms) ; mouvement réduit : en place d'emblée.
 * `rowsB` : comparaison A/B, deux constellations empilées sur le même axe.
 */
export function HaloDotPlot({
  rows,
  title,
  reduced,
}: {
  rows: DotRow[];
  /** Nom accessible (« Modes domicile-travail par sexe, A : Montreuil ») */
  title: string;
  reduced: boolean;
}) {
  const [placed, setPlaced] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const id = window.requestAnimationFrame(() => setPlaced(true));
    return () => window.cancelAnimationFrame(id);
  }, [reduced]);
  const on = placed || reduced;

  const W = 300;
  const labelW = 112;
  const x0 = labelW + 6;
  const x1 = W - 10;
  const rowH = 26;
  const H = rows.length * rowH + 22;
  const X = (v: number) => x0 + (Math.max(0, Math.min(100, v)) / 100) * (x1 - x0);

  return (
    <svg className={`halo-dots ${reduced ? 'is-reduced' : ''}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={title}>
      {rows.map((r, i) => {
        const y = i * rowH + rowH / 2;
        const dot = (v: number | null, m: number | null, imprecise: boolean, kind: 'f' | 'h', k: number) => {
          if (v == null) return null;
          const style = {
            transform: `translateX(${on ? X(v) - x0 : 0}px)`,
            transitionDelay: `${(i * 2 + k) * dotPlot.stagger}ms`,
          } as CSSProperties;
          return (
            <g className={`dot-mover ${imprecise ? 'is-imprecise' : ''}`} style={style}>
              {m != null && !imprecise && (
                <line x1={x0 + (X(Math.max(0, v - m)) - X(v))} x2={x0 + (X(Math.min(100, v + m)) - X(v))} y1={y} y2={y} className="dot-margin" />
              )}
              <circle cx={x0} cy={y} r={4.5} className={kind === 'f' ? 'dot-f' : 'dot-h'} />
            </g>
          );
        };
        return (
          <g key={r.mode}>
            <text x={labelW} y={y + 4} textAnchor="end" className="dot-label">
              {r.label}
            </text>
            <line x1={x0} x2={x1} y1={y} y2={y} className="dot-axis" />
            {dot(r.f, r.fMargin, r.fImprecise, 'f', 0)}
            {dot(r.h, r.hMargin, r.hImprecise, 'h', 1)}
          </g>
        );
      })}
      {[0, 50, 100].map((v) => (
        <text key={v} x={X(v)} y={H - 4} textAnchor={v === 0 ? 'start' : v === 100 ? 'end' : 'middle'} className="dot-scale">
          {formatPercent(v)}
        </text>
      ))}
    </svg>
  );
}

/** Légende de forme de la constellation : point plein = femmes, anneau = hommes (marges et pointillé : au « i » posé à côté). */
export function DotPlotKey() {
  return (
    <p className="dot-key" aria-hidden="true">
      <svg viewBox="0 0 12 12" width="12" height="12">
        <circle cx="6" cy="6" r="4.5" className="dot-f" />
      </svg>
      Femmes
      <svg viewBox="0 0 12 12" width="12" height="12">
        <circle cx="6" cy="6" r="4.5" className="dot-h" />
      </svg>
      Hommes
      {/* « segment : marge d'erreur à 95 % ; pointillé : estimation imprécise » : rangé dans le « i » « Comment lire ce graphique » (demande de Nicolas du 10/11), mots inchangés */}
    </p>
  );
}
