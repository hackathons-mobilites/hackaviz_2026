import { useProvenanceStore } from '../store/provenanceStore';
import { AnimatePresence, motion as m } from 'motion/react';
import { useEffect, useRef } from 'react';
import { buildHalo, commuteDotRows, haloPairs, HALO_DIMENSIONS, isContextHalo, pairSideText, sexShareLine, stripCensusParen, type HaloDimension, type HaloView } from '../data/halo';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useViewport } from '../hooks/useViewport';
import { sidePanelSide } from '../state/panes';
import { useColorVisionStore } from '../store/colorVisionStore';
import { useOverlayRects, useReservedRect } from '../store/overlayRects';
import { useCompareView, useSkyView } from '../store/selectors';
import { selectReducedMotion, useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import './features.css';
import { HaloAstrolabe, type AstrolabeRing } from './HaloAstrolabe';
import { InfoTip } from './InfoTip';
import { TipLines } from './proof/TipLines';
import { ChartReadingTip } from './ChartReadingTip';
import { dotPlotReading, ringReading } from '../data/chartReading';
import { IncomeRanks } from './IncomeRanks';
import { HaloSourceNote } from './provenance/ProofNotes';
import { UnemploymentTab } from './territoire/UnemploymentTab';
import { PolarityUnderName } from './territoire/Polarity';
import { DotPlotKey, HaloDotPlot } from './HaloDotPlot';
import { useBottomSheet, useIsPhone } from './useBottomSheet';
import { useOriginContext } from './useOriginContext';

/** Groupe de la légende sans la mention d'anneau (la constellation n'a plus d'anneaux) */
const groupName = (g: string) => g.replace(/ \((anneau intérieur|anneau extérieur)\)$/, '');

/** Anneau de l'astrolabe : segments du premier anneau, noms et valeurs autour (âges, taux de pauvreté). */
function astrolabeRing(h: HaloView, dim: HaloDimension): AstrolabeRing | null {
  const r = h.rings[0];
  if (!r || dim === 'commute') return null;
  const items = r.segments.map((seg, i) => {
    if (seg.dotted) return { name: '', value: '' };
    if (dim === 'income') return i === 0 ? { name: h.legend[0]?.label ?? '', value: h.legend[0]?.value ?? '' } : { name: '', value: '' };
    return { name: h.legend[i]?.label ?? '', value: h.legend[i]?.value ?? '' };
  });
  return { segments: r.segments, items };
}

/**
 * « Derrière notre étoile » (halo v2, D-025) : une dimension à la fois (trois onglets), dessinée en
 * astrolabe (âges, niveau de vie) ou en constellation en lignes (modes domicile-travail par sexe) ;
 * valeurs chiffrées dans « Valeurs détaillées », dénominateur et source. Le panneau se pose du côté
 * opposé à l'étoile-guide (il ne la cache jamais) ; dans le ciel, seule une orbite sans donnée reste.
 * Descriptif : aucun lien de cause avec l'accessibilité.
 */
export function HaloPanel() {
  const sourcesOn = useProvenanceStore((s) => s.on);
  const view = useSkyView();
  const contexts = useSkyStore((s) => s.contexts);
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const viewB = useCompareView();
  const tabsRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const dim = view?.scenario.halo ?? null;
  const origin = view?.origin ?? null;
  const open = !!dim && !!origin;
  const phone = useIsPhone();
  const originB = viewB?.origin ?? null;
  const ctxB = useOriginContext(open ? originB?.insee : null);
  const { sheetProps, handleProps } = useBottomSheet(open && phone, () => void applyScenario({ halo: null }));
  const poleOpen = useSkyStore((s) => !!s.scenario.pole);
  const reduced = useSkyStore(selectReducedMotion);
  const guide = useOverlayRects((s) => s.guide);
  const proofShown = useOverlayRects((s) => 'proof' in s.rects);
  const vw = useViewport().width;
  // Côté opposé à l'étoile-guide (L-02) ; à gauche si le panneau de preuve occupe la droite
  const side = phone ? 'left' : sidePanelSide(guide?.x ?? null, vw, poleOpen || proofShown);
  useReservedRect('halo', asideRef, open && !phone, side);
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // Tab boucle dans le halo, sauf si le panneau de preuve (prioritaire) est ouvert par-dessus
  const touring = useSkyStore((s) => s.tour.status !== 'idle');
  useFocusTrap(asideRef, open && !poleOpen && !touring);

  // Focus initial sur la croix ; à la fermeture, focus rendu à l'élément qui a ouvert le halo
  useEffect(() => {
    // Visite en cours : le halo suit la narration, le focus reste où il est (Tab atteint les commandes de la visite)
    if (!open || useSkyStore.getState().tour.status !== 'idle') return;
    opener.current = document.activeElement as HTMLElement | null;
    const id = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(id);
      const back = opener.current;
      if (back && document.contains(back)) back.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useSkyStore.getState().scenario.pole && !useSkyStore.getState().sourcesOpen) void applyScenario({ halo: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, applyScenario]);

  const select = (d: HaloDimension) => void applyScenario({ halo: d });
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const n = HALO_DIMENSIONS.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : -1;
    if (next < 0) return;
    e.preventDefault();
    select(HALO_DIMENSIONS[next]!.id);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  const ctx = origin ? contexts[origin.insee] : undefined;
  // Mode daltonien : arcs des modes étagés en luminance (seules les couleurs changent)
  const cv = useColorVisionStore((s) => s.on);
  const halo = isContextHalo(dim) ? buildHalo(ctx, dim, cv) : null;
  const isDemo = view?.dataset.origin === 'demo';
  // Diptyque : même onglet des deux côtés, « A : x · B : y » (aucune phrase comparative)
  const haloB = isContextHalo(dim) && originB && ctxB !== undefined ? buildHalo(ctxB, dim, cv) : null;
  const pairs = halo && haloB && ctx !== undefined ? haloPairs(halo, haloB) : null;
  // Le dénominateur reste toujours écrit (règle de vérité) ; le nom du recensement, en mode sources seulement (D-033)
  const denominatorText = (t: string) => (sourcesOn ? t : stripCensusParen(t));

  return (
    <AnimatePresence>
      {open && (halo || dim === 'unemployment') && (
        <m.aside
          key="halo"
          ref={asideRef}
          className={`halo-panel is-${side} ${phone ? 'is-sheet' : ''}`}
          role="dialog"
          aria-modal={!touring}
          aria-labelledby="halo-title"
          initial={{ x: side === 'right' ? 30 : -30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: side === 'right' ? 30 : -30, opacity: 0 }}
          transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
          {...sheetProps}
        >
          {phone && (
            <div className="sheet-handle" {...handleProps} aria-hidden="true">
              <span />
            </div>
          )}
          <header>
            <p className="eyebrow">Derrière notre étoile</p>
            <h2 id="halo-title">{originB ? `A · ${origin.name} et B · ${originB.name}` : origin.name}</h2>
            <button type="button" className="icon-btn" ref={closeRef} onClick={() => void applyScenario({ halo: null })} aria-label="Fermer le halo « Derrière notre étoile »">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          {/* Polarité SDRIF-E (D-048, T4) : sous le nom de la commune, seulement si la commune en a une ; jamais dans le ciel */}
          <PolarityUnderName sides={[{ insee: origin.insee, name: origin.name, ...(originB ? { tag: 'A' as const } : {}) }, ...(originB ? [{ insee: originB.insee, name: originB.name, tag: 'B' as const }] : [])]} />

          <div className="halo-tabs" role="tablist" aria-label="Dimension du halo" ref={tabsRef}>
            {HALO_DIMENSIONS.map((d, i) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                id={`halo-tab-${d.id}`}
                aria-selected={dim === d.id}
                aria-controls="halo-tabpanel"
                tabIndex={dim === d.id ? 0 : -1}
                className={dim === d.id ? 'is-on' : ''}
                onClick={() => select(d.id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {d.label}
              </button>
            ))}
          </div>

          <div id="halo-tabpanel" role="tabpanel" aria-labelledby={`halo-tab-${dim}`} className="halo-body">
            {dim === 'unemployment' ? (
              // Quatrième onglet (D-048, T3) : territoire.json, jamais context/{insee}.json ; la commune de DÉPART seulement
              <UnemploymentTab
                sides={[
                  { insee: origin.insee, name: origin.name, ...(originB ? { tag: 'A' as const } : {}) },
                  ...(originB ? [{ insee: originB.insee, name: originB.name, tag: 'B' as const }] : []),
                ]}
              />
            ) : !halo ? null : isDemo ? (
              <p className="halo-hidden">Profil non disponible avec les données de démonstration.</p>
            ) : ctx === undefined ? (
              <p className="halo-hidden">Chargement…</p>
            ) : halo.hidden ? (
              <>
                <p className="halo-hidden">{halo.hidden}</p>
                {halo.guard && <p className="halo-guard">{halo.guard}</p>}
              </>
            ) : (
              <>
                {/* Le dessin : astrolabe (âges, niveau de vie) ou constellation (modes par sexe) ; A/B à la même échelle */}
                {dim === 'commute' ? (
                  <div className="halo-visual">
                    {/* Légende des formes, puis « Comment lire ce graphique » (cas de la commune affichée, A et B en comparaison) */}
                    <div className="chart-read-row">
                      <DotPlotKey />
                      <ChartReadingTip
                        chart="modes domicile-travail par sexe"
                        reading={dotPlotReading({
                          sides: [
                            { name: origin.name, ...(originB ? { tag: 'A' as const } : {}), rows: commuteDotRows(ctx), denominator: halo.denominator ? denominatorText(halo.denominator) : null },
                            ...(originB && haloB && !haloB.hidden
                              ? [{ name: originB.name, tag: 'B' as const, rows: commuteDotRows(ctxB), denominator: haloB.denominator ? denominatorText(haloB.denominator) : null }]
                              : []),
                          ],
                          year: halo.year,
                        })}
                      />
                    </div>
                    {originB && <p className="halo-side">A · {origin.name}</p>}
                    <HaloDotPlot rows={commuteDotRows(ctx)} title={`Modes domicile-travail par sexe${originB ? `, A : ${origin.name}` : ''}`} reduced={reduced} />
                    {originB && haloB && !haloB.hidden && (
                      <>
                        <p className="halo-side">B · {originB.name}</p>
                        <HaloDotPlot rows={commuteDotRows(ctxB)} title={`Modes domicile-travail par sexe, B : ${originB.name}`} reduced={reduced} />
                      </>
                    )}
                  </div>
                ) : dim === 'income' ? (
                  // Niveau de vie : la commune parmi les communes d'Île-de-France (retour du 03/11), plus d'anneau
                  <IncomeRanks
                    denominator={halo.denominator ? denominatorText(halo.denominator) : null}
                    sides={[
                      { insee: origin.insee, name: origin.name, ...(originB ? { tag: 'A' as const } : {}) },
                      ...(originB ? [{ insee: originB.insee, name: originB.name, tag: 'B' as const }] : []),
                    ]}
                  />
                ) : (
                  (() => {
                    const ringA = astrolabeRing(halo, dim);
                    if (!ringA) return null;
                    const ringB = haloB && !haloB.hidden ? astrolabeRing(haloB, dim) : null;
                    const label = HALO_DIMENSIONS.find((d) => d.id === dim)?.label ?? '';
                    // « Comment lire ce graphique » de l'anneau : cas construit avec les arcs et les valeurs affichés (A et B en comparaison)
                    const tip = (
                      <div className="chart-read-row is-end">
                        <ChartReadingTip
                          chart={label.toLowerCase()}
                          reading={ringReading({
                            sides: [
                              { name: origin.name, ...(originB ? { tag: 'A' as const } : {}), ...ringA, denominator: halo.denominator ? denominatorText(halo.denominator) : null },
                              ...(originB && ringB && haloB ? [{ name: originB.name, tag: 'B' as const, ...ringB, denominator: haloB.denominator ? denominatorText(haloB.denominator) : null }] : []),
                            ],
                            year: halo.year,
                          })}
                        />
                      </div>
                    );
                    return originB ? (
                      <>
                      {tip}
                      <div className="halo-visual halo-ab">
                        <figure>
                          <figcaption>A · {origin.name}</figcaption>
                          <HaloAstrolabe ring={ringA} animKey={`A-${dim}-${cv}`} reduced={reduced} compact title={`${label}, A : ${origin.name}`} />
                        </figure>
                        <figure>
                          <figcaption>B · {originB.name}</figcaption>
                          {ringB ? (
                            <HaloAstrolabe ring={ringB} animKey={`B-${dim}-${cv}`} reduced={reduced} compact title={`${label}, B : ${originB.name}`} />
                          ) : (
                            <p className="halo-hidden">{haloB?.hidden ?? 'Chargement…'}</p>
                          )}
                        </figure>
                      </div>
                      </>
                    ) : (
                      <div className="halo-visual">
                        {tip}
                        <HaloAstrolabe ring={ringA} animKey={`${dim}-${cv}`} reduced={reduced} title={`${label}, ${origin.name}`} />
                      </div>
                    );
                  })()
                )}
                {halo.stat && dim !== 'income' && (
                  <div className={`halo-stat ${halo.stat.hidden ? 'is-hidden' : ''}`}>
                    <span className="halo-stat-value">{halo.stat.value}</span>
                    <span className="halo-stat-caption">{halo.stat.caption}</span>
                  </div>
                )}
                {dim === 'age' &&
                  (() => {
                    // Répartition par sexe : une phrase sous l'âge (onglet retiré, L-10)
                    const a = sexShareLine(ctx, sourcesOn);
                    const b = originB ? sexShareLine(ctxB, sourcesOn) : null;
                    if (!a && !b) return null;
                    return originB ? (
                      <p className="halo-sexline">
                        A : {a ?? 'non disponible'}
                        <br />B : {b ?? 'non disponible'}
                      </p>
                    ) : (
                      <p className="halo-sexline">{a}</p>
                    );
                  })()}
                {/* Mode daltonien, A/B compact (astrolabes sans noms) : valeurs ouvertes d'emblée (motion-spec, renfort 3) */}
                <details className="halo-details" open={cv && !!originB}>
                  <summary>Valeurs détaillées</summary>
                  <ul className={`halo-legend ${dim === 'commute' || dim === 'income' ? 'no-swatch' : ''}`}>
                    {/* Niveau de vie : la médiane (plus de chiffre isolé sous l'anneau) en tête de la liste */}
                    {dim === 'income' && halo.stat && (
                      <li>
                        <span className="halo-label">Niveau de vie médian</span>
                        <span className="halo-value mono">{halo.stat.value}</span>
                      </li>
                    )}
                    {halo.legend.map((l, i) => (
                      <li key={`${l.group ?? ''}-${l.label}-${i}`} className={l.imprecise ? 'is-imprecise' : ''}>
                        {l.group && (i === 0 || halo.legend[i - 1]?.group !== l.group) && <span className="halo-group">{groupName(l.group)}</span>}
                        {dim === 'age' && <span className="swatch" style={{ background: l.color }} aria-hidden="true" />}
                        <span className="halo-label">{l.label}</span>
                        <span className="halo-value mono">
                          {l.value}
                          {l.margin && !l.imprecise && <span className="halo-margin"> {l.margin}</span>}
                        </span>
                        {l.imprecise && (
                          <span className="halo-imprecise">
                            estimation imprécise{sourcesOn ? ' (recensement)' : ''}{l.margin ? `, ${l.margin}` : ''}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {pairs && (
                    <ul className="halo-pairs" aria-label="Valeurs des deux communes">
                      {pairs.map((p, i) => (
                        <li key={`${p.group ?? ''}-${p.label}-${i}`}>
                          <span className="halo-label">
                            {p.group ? `${groupName(p.group)} · ` : ''}
                            {p.label}
                          </span>
                          <span className="halo-value mono">
                            A : {pairSideText(p.a, p.aMargin, p.aImprecise)} · B : {pairSideText(p.b, p.bMargin, p.bImprecise)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
                {pairs && origin && originB ? (
                  // Diptyque : chaque commune a son propre dénominateur (effectifs différents)
                  <div className="halo-denominator">
                    <p>Dénominateurs :</p>
                    <ul>
                      <li>
                        A · {origin.name} : {halo.denominator ? denominatorText(halo.denominator) : 'non publié'}
                      </li>
                      <li>
                        B · {originB.name} : {haloB?.hidden ? haloB.hidden.replace(/\.$/, '').toLowerCase() : (haloB?.denominator ? denominatorText(haloB.denominator) : 'non publié')}
                      </li>
                    </ul>
                  </div>
                ) : (
                  // Règle d'affichage finale du 11/11 (D1) : sans mode sources, la phrase complète est dans le « i » « Portée de cette statistique »
                  sourcesOn && halo.denominator && <p className="halo-denominator">Dénominateur : {denominatorText(halo.denominator)}.</p>
                )}
                {/* H7 : la portée est au « i » du bas de l'onglet, comme pour les autres onglets ; en clair en mode sources et en comparaison */}
                {halo.guard && (sourcesOn || pairs) && <p className="halo-guard">{halo.guard}</p>}
                {halo.note && (
                  <details className="halo-method">
                    <summary>Méthode et marges</summary>
                    <p>{halo.note}</p>
                  </details>
                )}
              </>
            )}
            {halo && (sourcesOn ? (
              <p className="halo-source">
                {`Source : ${halo.source}${halo.year ? `, millésime ${halo.year}` : ''}.`}
                {!halo.guard && " Statistique descriptive, sans lien de cause établi avec l'accessibilité."}
              </p>
            ) : !pairs && !halo.hidden ? (
              // Règle d'affichage finale du 11/11 (D1) : une ligne courte, la base et le millésime (règle de vérité 5) ; au « i », mots inchangés,
              // la phrase « Dénominateur : … » complète (définitions, seuil de pauvreté) et la portée ; la source, en mode sources seulement (D-033)
              <p className="halo-source">
                {halo.base ?? (halo.year ? `Millésime ${halo.year}.` : '')}{' '}
                <InfoTip label="Portée de cette statistique" placement="top">
                  <TipLines
                    lines={[
                      ...(halo.denominator ? [`Dénominateur : ${denominatorText(halo.denominator)}.`] : []),
                      ...(halo.guard ? [halo.guard] : ["Statistique descriptive, sans lien de cause établi avec l'accessibilité."]),
                    ]}
                  />
                </InfoTip>
              </p>
            ) : (
              // Comparaison : les dénominateurs des deux communes sont écrits plus haut ; le millésime reste écrit, la portée au « i »
              (halo.year || !halo.guard) && (
                <p className="halo-source">
                  {halo.year ? `Millésime ${halo.year}.` : ''}
                  {!halo.guard && (
                    <>
                      {' '}
                      <InfoTip label="Portée de cette statistique" placement="top">
                        Statistique descriptive, sans lien de cause établi avec l'accessibilité.
                      </InfoTip>
                    </>
                  )}
                </p>
              )
            ))}
            {/* Mode provenance : code, millésime du bloc lu et lien vers la fiche de la source */}
            {isContextHalo(dim) && <HaloSourceNote ctx={ctx ?? ctxB} dim={dim} />}
          </div>
        </m.aside>
      )}
    </AnimatePresence>
  );
}

export default HaloPanel;
