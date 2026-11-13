import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { NEEDS_MARK_HELP, NEEDS_TITLE, type NeedId } from '../../data/needs';
import { needsCountText, SETTINGS_HELP, SETTINGS_NOT_STORED, SETTINGS_SAVED, SETTINGS_TITLE, settingsSummary, subscriptionsText, transitLabelOf, velibLabelOf, SETTINGS_EMPTY } from '../../data/mySettings';
import type { SubscriptionsFile } from '../../data/subscriptions';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useNeedsStore } from '../../store/needsStore';
import { mySettings } from '../../theme/tokens';
import { NeedsChoices } from '../proof/ProofNeeds';
import { useNeedsMeta } from '../proof/useNeedsMeta';
import { SubscriptionsChoices } from '../subscriptions/SubscriptionsDialog';
import { useSubscriptionsStore, type SettingsSection } from '../subscriptions/subscriptionsStore';
import { usePersonalSettingsAllowed } from '../subscriptions/useEffectiveSubscriptions';
import { useSubscriptionsFile } from '../subscriptions/useSubscriptionsFile';
import './mySettings.css';

/**
 * « Mes réglages » : une seule entrée pour les deux réglages personnels (abonnements, besoins sur le trajet). L'entrée
 * est dans le tiroir de la barre de scénario, avec un résumé ; le lien de la barre du haut et les « Modifier » du panneau
 * ouvrent le même dialogue. Les choix y sont un brouillon : le ciel et les coûts ne changent qu'à « Enregistrer ».
 * Hors scénario : ni URL, ni lien copié, ni visite, ni `?record=1`.
 */

/** Entrée du tiroir de la barre de scénario : résumé d'une ligne et bouton qui ouvre le dialogue. */
export function MySettingsEntry() {
  const file = useSubscriptionsFile();
  const needsMeta = useNeedsMeta();
  const transit = useSubscriptionsStore((s) => s.transit);
  const velib = useSubscriptionsStore((s) => s.velib);
  const openDialog = useSubscriptionsStore((s) => s.openDialog);
  const needsCount = useNeedsStore((s) => s.selected.length);
  const allowed = usePersonalSettingsAllowed();
  if ((!file && !needsMeta) || !allowed) return null;
  const summary = settingsSummary({ transitLabel: transitLabelOf(file, transit), velibLabel: velibLabelOf(file, velib), needsCount: needsMeta ? needsCount : 0 });
  const verb = summary === SETTINGS_EMPTY ? 'Choisir' : 'Modifier';
  return (
    <div className="drawer-cell drawer-settings">
      <span className="field-label">{SETTINGS_TITLE}</span>
      <div className="drawer-settings-line">
        <span className="drawer-settings-summary">{summary}</span>
        <button type="button" className="btn drawer-settings-btn" aria-haspopup="dialog" aria-label={`${verb} mes réglages`} onClick={(e) => openDialog(e.currentTarget)}>
          {verb}
        </button>
      </div>
    </div>
  );
}

/** Dialogue et confirmation, montés une seule fois (App) ; le dialogue s'ouvre par `useSubscriptionsStore.openDialog`. */
export function MySettings() {
  const open = useSubscriptionsStore((s) => s.dialogOpen);
  const file = useSubscriptionsFile();
  const needsAvailable = !!useNeedsMeta();
  const allowed = usePersonalSettingsAllowed();
  const [saved, setSaved] = useState<{ text: string; at: number } | null>(null);

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(null), mySettings.savedMs);
    return () => window.clearTimeout(t);
  }, [saved]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      {open && allowed && (file || needsAvailable) && <DialogBody file={file} needsAvailable={needsAvailable} onSaved={(text) => setSaved({ text, at: Date.now() })} />}
      {/* Zone annoncée toujours montée : un lecteur d'écran n'annonce pas une zone qui apparaît avec son texte */}
      <div className="settings-toast" role="status">
        {saved?.text ?? ''}
      </div>
    </>,
    document.body,
  );
}

function DialogBody({ file, needsAvailable, onSaved }: Readonly<{ file: SubscriptionsFile | null; needsAvailable: boolean; onSaved: (text: string) => void }>) {
  const closeDialog = useSubscriptionsStore((s) => s.closeDialog);
  const saveSubscriptions = useSubscriptionsStore((s) => s.save);
  const saveNeeds = useNeedsStore((s) => s.save);
  const savedTransit = useSubscriptionsStore((s) => s.transit);
  const savedVelib = useSubscriptionsStore((s) => s.velib);
  const savedNeeds = useNeedsStore((s) => s.selected);
  const requested = useSubscriptionsStore((s) => s.dialogSection);

  // Brouillon : recopié à l'ouverture, jeté par Annuler, Échap ou la croix (le dialogue se démonte)
  const [transit, setTransit] = useState(savedTransit);
  const [velib, setVelib] = useState(savedVelib);
  const [needs, setNeeds] = useState<readonly NeedId[]>(savedNeeds);
  const sections: SettingsSection[] = [...(file ? (['subs'] as const) : []), ...(needsAvailable ? (['needs'] as const) : [])];
  const [section, setSection] = useState<SettingsSection>(sections.includes(requested) ? requested : sections[0]!);

  const ref = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const uid = useId();
  useFocusTrap(ref, true);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDialog();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [closeDialog]);

  const sameNeeds = needs.length === savedNeeds.length && needs.every((n) => savedNeeds.includes(n));
  const dirty = transit !== savedTransit || velib !== savedVelib || !sameNeeds;

  const save = () => {
    const subsKept = file ? saveSubscriptions({ transit, velib }) : true;
    const needsKept = needsAvailable ? saveNeeds(needs) : true;
    closeDialog();
    onSaved(subsKept && needsKept ? SETTINGS_SAVED : SETTINGS_NOT_STORED);
  };

  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const cur = sections.indexOf(section);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? sections.length - 1 : (cur + (e.key === 'ArrowRight' ? 1 : sections.length - 1)) % sections.length;
    setSection(sections[next]!);
    ref.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${uid}-tab-${sections[next]!}`)}`)?.focus();
  };

  const tabValue = (s: SettingsSection) => (s === 'subs' ? (subscriptionsText(transitLabelOf(file, transit), velibLabelOf(file, velib)) ?? 'Aucun abonnement') : (needsCountText(needs.length) ?? 'Aucun besoin'));
  const tabTitle = (s: SettingsSection) => (s === 'subs' ? 'Mes abonnements' : NEEDS_TITLE);

  return (
    <div className="drawer-backdrop subs-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !dirty && closeDialog()}>
      <div ref={ref} className="drawer subs-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="drawer-head">
          <h2 id={titleId}>{SETTINGS_TITLE}</h2>
          <button type="button" className="icon-btn" ref={sections.length > 1 ? undefined : firstRef} onClick={closeDialog} aria-label="Fermer sans enregistrer">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <p className="settings-help">{SETTINGS_HELP}</p>
        {sections.length > 1 && (
          <div className="settings-tabs" role="tablist" aria-label={SETTINGS_TITLE}>
            {sections.map((s) => (
              <button
                key={s}
                id={`${uid}-tab-${s}`}
                ref={s === section ? firstRef : undefined}
                type="button"
                role="tab"
                className="settings-tab"
                aria-selected={s === section}
                aria-controls={`${uid}-panel-${s}`}
                tabIndex={s === section ? 0 : -1}
                onClick={() => setSection(s)}
                onKeyDown={onTabKey}
              >
                <span className="settings-tab-title">{tabTitle(s)}</span>
                <span className="settings-tab-value">{tabValue(s)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="drawer-body subs-body settings-body">
          {file && (
            <div id={`${uid}-panel-subs`} role={sections.length > 1 ? 'tabpanel' : undefined} aria-labelledby={sections.length > 1 ? `${uid}-tab-subs` : undefined} hidden={section !== 'subs'}>
              <SubscriptionsChoices file={file} transit={transit} velib={velib} onTransit={setTransit} onVelib={setVelib} />
            </div>
          )}
          {needsAvailable && (
            <div id={`${uid}-panel-needs`} role={sections.length > 1 ? 'tabpanel' : undefined} aria-labelledby={sections.length > 1 ? `${uid}-tab-needs` : undefined} hidden={section !== 'needs'}>
              <p>{NEEDS_MARK_HELP}</p>
              <NeedsChoices value={needs} onChange={setNeeds} />
            </div>
          )}
        </div>
        <footer className="settings-actions">
          <button type="button" className="btn btn-primary" onClick={save}>
            Enregistrer
          </button>
          <button type="button" className="btn btn-secondary" onClick={closeDialog}>
            Annuler
          </button>
        </footer>
      </div>
    </div>
  );
}
