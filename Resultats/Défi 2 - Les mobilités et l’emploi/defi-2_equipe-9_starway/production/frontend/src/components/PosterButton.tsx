import { useEffect, useRef, useState } from 'react';
import { formatShift } from '../data/od/shift';
import { returnFocus } from '../hooks/focusReturn';
import { buildPosterText, posterFileName, posterPlainText } from '../poster/posterText';
import { engineFeatures } from '../sky/featureBridge';
import { useCompareView, useSkyView } from '../store/selectors';
import { selectShowsFakeData, useSkyStore } from '../store/useSkyStore';
import './features.css';
import { useFeaturesStore } from './featuresStore';

/**
 * « Exporter l'affiche » (critique v0.4 spec d) : PNG 1920×1080 (ou 3840×2160) du ciel courant,
 * scénario en clair, chiffres du ciel affiché, sources et URL. Désactivé si le ciel est neutre.
 */
export function PosterButton() {
  const view = useSkyView();
  const viewB = useCompareView();
  const fake = useSkyStore(selectShowsFakeData);
  const mapPhase = useFeaturesStore((s) => s.mapPhase);
  const showToast = useFeaturesStore((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const split = !!view?.scenario.compare;
  // Diptyque : les deux ciels doivent être calculés (sinon un demi-cadre vide passerait pour une donnée)
  const bReady = !split || (!!viewB?.origin && !viewB.neutral && viewB.totals.hasData && !viewB.accessMissing);
  // Table OD (D-019) : les deux ciels du diptyque doivent avoir la même base de calcul
  const sameBasis = !split || viewB?.basis === view?.basis;
  const disabled = !view?.origin || view.neutral || !view.totals.hasData || view.accessMissing || !bReady || !sameBasis;
  const reason = !view?.origin
    ? 'Choisissez une commune'
    : !sameBasis
      ? 'Les deux ciels ne sont pas calculés de la même façon'
    : split && !bReady
      ? 'Scénario non calculé pour la commune comparée'
      : 'Scénario non calculé';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      returnFocus(trigger.current, wrap.current);
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const text = () =>
    view?.origin
      ? buildPosterText({
          dataset: view.dataset,
          scenario: view.scenario,
          originName: view.origin.name,
          totals: view.totals,
          demo: fake,
          url: window.location.href,
          now: new Date(),
          ...(view.basis === 'od' && view.od ? { shiftLabel: formatShift({ start: view.od.scenario.start, end: view.od.scenario.end }) } : {}),
          ...(split && viewB?.origin
            ? { compare: { originName: viewB.origin.name, totals: viewB.totals } }
            : {}),
        })
      : null;

  const exportPng = async (hd: boolean) => {
    setOpen(false);
    const t = text();
    const engine = engineFeatures('A');
    if (!t || !view) return;
    if (!engine) {
      showToast('Affiche indisponible : le ciel WebGL n’a pas pu démarrer.');
      return;
    }
    setBusy(true);
    try {
      const snapshot = engine.snapshot(hd ? 4 : 2, 30);
      if (!snapshot) throw new Error('ciel vide');
      const snapB = split ? engineFeatures('B')?.snapshot(hd ? 4 : 2, 30) : null;
      if (split && (!snapB || !viewB?.origin)) throw new Error('ciel B vide');
      const { renderPoster } = await import('../poster/renderPoster');
      const canvas = await renderPoster(
        t,
        {
          snapshot,
          poles: view.dataset.poles,
          statuses: view.states.map((s) => s.status),
          neutral: view.neutral,
          originName: view.origin!.name,
          ...(snapB && viewB?.origin ? { compare: { snapshot: snapB, statuses: viewB.states.map((s) => s.status), originName: viewB.origin.name } } : {}),
        },
        hd ? 2 : 1,
      );
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('PNG');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = posterFileName(view.scenario, hd);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      showToast('Affiche enregistrée');
    } catch (e) {
      console.error(e);
      showToast('L’affiche n’a pas pu être générée.');
    } finally {
      setBusy(false);
    }
  };

  const copyText = async () => {
    setOpen(false);
    const t = text();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(posterPlainText(t));
      showToast('Texte de l’affiche copié');
    } catch {
      showToast('Copie impossible dans ce navigateur.');
    }
  };

  return (
    <div className="poster-menu" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="btn btn-ghost feature-btn view-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={busy ? 'Exporter l’affiche, en cours' : 'Exporter l’affiche'}
        disabled={disabled || busy || mapPhase !== 'sky'}
        data-tip={disabled ? `Exporter l’affiche : ${reason.toLowerCase()}` : 'Exporter l’affiche du scénario (PNG)'}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 15l3.2-3.6 2.3 2.4 2-2 2.5 3.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span className="view-label">{busy ? 'Affiche…' : 'Affiche'}</span>
      </button>
      {open && (
        <ul className="poster-list" role="menu">
          <li role="none">
            <button type="button" role="menuitem" onClick={() => void exportPng(false)}>
              Affiche PNG <span>1920 × 1080</span>
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={() => void exportPng(true)}>
              Haute définition <span>3840 × 2160</span>
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={() => void copyText()}>
              Copier le texte de l'affiche
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export default PosterButton;
