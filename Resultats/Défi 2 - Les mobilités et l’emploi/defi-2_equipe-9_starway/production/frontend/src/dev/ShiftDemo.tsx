/**
 * Démonstration isolée D-019 (développement seulement, page `dev-shift.html`, absente du build) :
 * ShiftPicker + calcul par pôle. Le jeu vient de `public/data/od/` s'il est publié, sinon de fichiers
 * choisis sur le disque (`data/interim/od_export_partial/index.json` et un `o/{insee}.bin`) : rien
 * n'est copié dans `public/`. Aucune valeur n'est inventée : tout est lu dans ces fichiers.
 */
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/jost/wght.css';
import '../styles.css';
import { ShiftPicker } from '../components/ShiftPicker';
import { formatInt, formatPercent } from '../data/format';
import { computeOd } from '../data/od/compute';
import { fetchOdIndex } from '../data/od/loader';
import { shiftBounds, type Shift } from '../data/od/shift';
import { decodeSwodBytes, type SwodFile } from '../data/od/swod';
import { odScenarioStatusText, odTextContext, odVerdict, odWalkLimitNote, selfJobsText } from '../data/od/texts';
import type { OdIndex } from '../data/od/types';
import type { ModeId } from '../data/types';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'erreur inconnue');

export function ShiftDemo() {
  const [index, setIndex] = useState<OdIndex | null>(null);
  const [file, setFile] = useState<SwodFile | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [shift, setShift] = useState<Shift | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [mode, setMode] = useState<ModeId>('transit');

  useEffect(() => {
    fetchOdIndex().then((i) => i && setIndex(i), (e: unknown) => setError(errText(e)));
  }, []);

  const bounds = useMemo(() => (index ? shiftBounds(index) : null), [index]);
  // Horaire de départ de la démo : premier début et dernière fin proposés (bornes du jeu, aucun choix inventé)
  const value = useMemo(() => shift ?? (bounds ? { start: bounds.startMin, end: bounds.endMax } : null), [shift, bounds]);
  const b = budget ?? index?.max_trip_min ?? null;

  const result = useMemo(
    () => (index && origin && value && b != null ? computeOd(index, file, { origin, start: value.start, end: value.end, budget: b, mode }) : null),
    [index, file, origin, value, b, mode],
  );

  const pickIndex = async (f: File | undefined) => {
    if (!f) return;
    try {
      setIndex(JSON.parse(await f.text()) as OdIndex);
      setShift(null);
    } catch (e) {
      setError(errText(e));
    }
  };
  const pickBin = async (f: File | undefined) => {
    if (!f) return;
    try {
      const decoded = await decodeSwodBytes(await f.arrayBuffer());
      setFile(decoded);
      setOrigin(index?.communes[decoded.origin] ?? null);
    } catch (e) {
      setError(errText(e));
    }
  };

  const ctx = index && result ? odTextContext(index, result.timeDependent) : null;

  return (
    <main style={{ padding: 24, maxWidth: 820, display: 'grid', gap: 16 }}>
      <h1 style={{ fontSize: 22 }}>D-019 : horaires de poste libres (démonstration de développement)</h1>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <label>
          od/index.json <input type="file" accept=".json" onChange={(e) => void pickIndex(e.target.files?.[0])} />
        </label>
        <label>
          o/&#123;insee&#125;.bin <input type="file" accept=".bin" disabled={!index} onChange={(e) => void pickBin(e.target.files?.[0])} />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {index && bounds && value && (
        <>
          <p style={{ color: 'var(--text-dim)' }}>
            {index.decision} ; {index.complete ? 'export complet' : 'export partiel'} ; jeu {index.dataset_id}
          </p>
          <ShiftPicker bounds={bounds} value={value} onChange={(s) => setShift(s)} />
          <div style={{ display: 'flex', gap: 16 }}>
            <label>
              Temps par sens (min){' '}
              <input
                type="number"
                min={index.grid.step_min}
                max={index.max_trip_min}
                step={index.grid.step_min}
                value={b ?? ''}
                onChange={(e) => setBudget(Number(e.target.value))}
              />
            </label>
            <label>
              Mode{' '}
              <select value={mode} onChange={(e) => setMode(e.target.value as ModeId)}>
                {index.modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
                <option value="bike_transit">bike_transit (absent de D-019)</option>
              </select>
            </label>
          </div>
        </>
      )}
      {result && ctx && index && (
        <section aria-live="polite">
          <h2 style={{ fontSize: 18 }}>
            Origine {origin} : {odScenarioStatusText(result.status) ?? 'calculé'}
          </h2>
          {result.totals && (
            <p>
              {formatInt(result.totals.reachedInPoles)} postes atteints aller et retour dans les pôles sur {formatInt(result.totals.polesJobs)} ;{' '}
              {formatInt(result.totals.reachedAll)} dans toute l’Île-de-France ; {selfJobsText(result.totals.selfJobs)}.
            </p>
          )}
          {odWalkLimitNote(index, result.timeDependent) && <p style={{ color: 'var(--text-dim)' }}>{odWalkLimitNote(index, result.timeDependent)}</p>}
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Pôle</th>
                <th align="right">Atteints</th>
                <th align="right">Part</th>
                <th align="right">Non calculés</th>
                <th align="right">Votre commune</th>
              </tr>
            </thead>
            <tbody>
              {result.poles.map((p) => (
                <tr key={p.id}>
                  <td>
                    <details>
                      <summary>{p.id}</summary>
                      <ul>
                        {p.communes.map((d) => {
                          const v = odVerdict(d, b!, ctx);
                          return (
                            <li key={d.insee}>
                              {d.insee} ({formatInt(d.jobs)} postes) : {v.title}. {v.detail}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  </td>
                  <td align="right">{formatInt(p.reached)}</td>
                  <td align="right">{p.share != null ? formatPercent(p.share * 100) : 'sans postes'}</td>
                  <td align="right">{formatInt(p.unknown)}</td>
                  <td align="right">{p.self ? formatInt(p.self) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShiftDemo />
  </StrictMode>,
);
