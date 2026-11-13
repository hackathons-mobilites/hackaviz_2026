import { useId } from 'react';
import { NEEDS_EMPTY_HINT, needsRecallText } from '../../data/mySettings';
import {
  ASSISTANCE_LINKS,
  legNeedsFacts,
  NEED_GREYED,
  NEED_GREYED_TEXT,
  NEED_HINT,
  NEED_HINT_PLAIN,
  NEED_LABEL,
  NEED_ORDER,
  needsFixedText,
  needsNotes,
  NEEDS_ALWAYS_TEXT,
  NEEDS_TITLE,
  stripNeedsSourceCodes,
  tripHasStation,
  type NeedId,
  type NeedsLeg,
} from '../../data/needs';
import { astreMarkText, tripSummaryLines } from '../../data/needsSky';
import type { ItinTrip } from '../../data/itineraries';
import { useNeedsStore } from '../../store/needsStore';
import { NeedsSourceNote } from '../provenance/ProofNotes';
import { NeedsMethodNote } from '../provenance/NeedsMethodNote';
import { useSubscriptionsStore } from '../subscriptions/subscriptionsStore';
import { usePersonalSettingsAllowed } from '../subscriptions/useEffectiveSubscriptions';
import './needs.css';
import { useNeedsMeta, useNeedsReadCtx, useNeedsSelected } from './useNeedsMeta';

/**
 * Partie « Ce qu'il me faut sur mon trajet » du dialogue « Mes réglages » (version finale du 05/11/2026) : cinq cases à
 * cocher natives, accessibles au clavier, puis trois cases grisées « pas de donnée ouverte ». On ne classe pas les
 * personnes : chaque case lit une source ouverte. Les cases sont un brouillon : rien ne change avant « Enregistrer ». Le
 * réglage ne change ni les durées, ni les verdicts : il choisit ce que le panneau dit de chaque tronçon et si une marque
 * est posée sur le ciel. Le daltonisme n'en fait pas partie : c'est le bouton de la barre du haut.
 */
export function NeedsChoices({ value, onChange }: Readonly<{ value: readonly NeedId[]; onChange: (next: NeedId[]) => void }>) {
  const ctx = useNeedsReadCtx();
  const uid = useId();
  const hint = (id: NeedId) => (ctx.withSources === false ? NEED_HINT_PLAIN[id] : NEED_HINT[id]);
  const toggle = (id: NeedId) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset className="pf-needs">
      <legend className="pf-needs-legend">{NEEDS_TITLE}</legend>
      {NEED_ORDER.map((id) => (
        <label key={id} className="pf-needs-item" htmlFor={`${uid}-${id}`}>
          <input id={`${uid}-${id}`} type="checkbox" checked={value.includes(id)} onChange={() => toggle(id)} />
          <span>
            {/* Nom de la source : mode sources seulement (D-033) */}
            {NEED_LABEL[id]}{hint(id) && <span className="pf-needs-hint"> ({hint(id)})</span>}
          </span>
        </label>
      ))}
      {NEED_GREYED.map((g) => (
        <label key={g.id} className="pf-needs-item is-greyed" htmlFor={`${uid}-${g.id}`}>
          <input id={`${uid}-${g.id}`} type="checkbox" checked={false} disabled aria-describedby={`${uid}-${g.id}-why`} />
          <span>
            {g.label}{' '}
            <span className="pf-needs-hint" id={`${uid}-${g.id}-why`}>
              ({NEED_GREYED_TEXT})
            </span>
          </span>
        </label>
      ))}
      {/* Le nom des sources et la date de chaque relevé : mode sources seulement (D-033) */}
      <p className="pf-needs-fixed">{needsFixedText(ctx.withSources === false ? {} : ctx.dates)}</p>
      <p className="pf-needs-fixed">{NEEDS_ALWAYS_TEXT}</p>
      {ASSISTANCE_LINKS.length > 0 && (
        <p className="pf-needs-fixed">
          Assistance :{' '}
          {ASSISTANCE_LINKS.map((l, i) => (
            <span key={l.url}>
              {i > 0 ? ', ' : ''}
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label}
              </a>
            </span>
          ))}
        </p>
      )}
    </fieldset>
  );
}

/**
 * Rappel d'une ligne (panneau, légende) avec le lien qui ouvre « Mes réglages » : le réglage s'applique à tout le ciel, il
 * n'est plus dans le panneau d'un astre. Absent pendant la visite et l'enregistrement.
 * `emptyHint` (pli d'un astre, 11/11) : sans aucune case cochée, la ligne dit à quoi sert le pli (NEEDS_EMPTY_HINT), avec
 * « Mes réglages » en bouton qui ouvre le dialogue sur cette partie, au lieu de « aucun coché ».
 */
export function NeedsRecall({ label = 'Mes besoins', emptyHint = false }: Readonly<{ label?: string; emptyHint?: boolean }>) {
  const meta = useNeedsMeta();
  const count = useNeedsStore((s) => s.selected.length);
  const openDialog = useSubscriptionsStore((s) => s.openDialog);
  const allowed = usePersonalSettingsAllowed();
  if (!meta || !allowed) return null;
  if (emptyHint && count === 0) {
    return (
      <p className="pf-needs-recall pf-needs-empty">
        {NEEDS_EMPTY_HINT.before}
        <button type="button" className="link-btn" aria-haspopup="dialog" onClick={(e) => openDialog(e.currentTarget, 'needs')}>
          {NEEDS_EMPTY_HINT.link}
        </button>
        {NEEDS_EMPTY_HINT.after}
      </p>
    );
  }
  return (
    <p className="pf-needs-recall">
      {label} : {needsRecallText(count)}{' '}
      <button type="button" className="link-btn" aria-haspopup="dialog" onClick={(e) => openDialog(e.currentTarget, 'needs')}>
        Modifier
      </button>
    </p>
  );
}

/** Ce que déclare chaque source d'un tronçon (avec sa date), selon les cases cochées ; rien si aucune n'est cochée. */
export function LegNeeds({ leg }: { leg: NeedsLeg }) {
  const ctx = useNeedsReadCtx();
  const selected = useNeedsSelected();
  const facts = legNeedsFacts(leg, selected, ctx);
  if (facts.length === 0) return null;
  return (
    <ul className="pf-trip-facts pf-needs-facts">
      {facts.map((f) => (
        <li key={f}>{f}</li>
      ))}
    </ul>
  );
}

/** Une ligne par case cochée pour un sens du trajet (rempli, non rempli, non renseigné). */
export function NeedsTripSummary({ trip, label }: { trip: ItinTrip; label: string }) {
  const selected = useNeedsSelected();
  const lines = tripSummaryLines(trip.legs as NeedsLeg[] | undefined, selected);
  if (lines.length === 0) return null;
  return (
    <div className="pf-needs-summary">
      <p className="pf-needs-summary-title">{label}</p>
      <ul className="pf-trip-facts pf-needs-facts">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

/** La marque de l'astre sélectionné, en mots : aller ET retour, budget du scénario. */
export function NeedsAstreMark({ out, ret, budget }: { out: ItinTrip | null; ret: ItinTrip | null; budget: number }) {
  const selected = useNeedsSelected();
  const text = astreMarkText(out, ret, selected, budget);
  if (!text) return null;
  return <p className="pf-note pf-needs-verdict">{text}</p>;
}

/** Mises en garde de lecture du bloc et sources (la source ne s'affiche que si le mode provenance est actif). */
export function NeedsNotes({ legs }: { legs: readonly NeedsLeg[] | undefined }) {
  const selected = useNeedsSelected();
  const ctx = useNeedsReadCtx();
  const notes = needsNotes(selected, tripHasStation(legs)).map((n) => (ctx.withSources === false ? stripNeedsSourceCodes(n) : n));
  if (notes.length === 0) return null;
  return (
    <>
      {/* Toujours à côté de ce que disent les sources (D-034) : le texte a quitté le panneau avec les cases */}
      <p className="pf-src">{needsFixedText(ctx.withSources === false ? {} : ctx.dates)}</p>
      {notes.map((n) => (
        <p key={n} className="pf-src">
          {n}
        </p>
      ))}
      <NeedsSourceNote className="pf-prov" />
      <NeedsMethodNote className="pf-prov" />
    </>
  );
}
