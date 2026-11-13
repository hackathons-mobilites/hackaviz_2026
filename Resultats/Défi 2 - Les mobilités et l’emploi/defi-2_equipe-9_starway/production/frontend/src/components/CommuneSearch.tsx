import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { buildIndex, searchCommunes } from '../data/search';
import type { Commune } from '../data/types';
import { COMBO_IDLE, comboPick, comboReducer, typedCharacter } from './communeSearchState';
import './communeSearch.css';

interface Props {
  communes: readonly Commune[];
  value: Commune | null;
  onSelect: (c: Commune) => void;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
  /** Communes proposées quand le champ est vide (ex. communes calculées), en tête de liste */
  featured?: readonly Commune[];
  featuredLabel?: string;
}

const HELP = "Tapez le nom d'une commune";

function StarIcon() {
  return (
    <svg className="combo-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Commune de départ. Choisie : un bouton lisible (libellé, nom, « Changer »), jamais un faux texte dans un champ.
 * Au clic ou à la frappe : champ vide en combobox accessible (motif ARIA 1.2 : flèches, Entrée, Échap), tolérant aux accents et tirets.
 * Échap ou clic ailleurs : retour à la commune précédente, sans changement.
 */
export function CommuneSearch({ communes, value, onSelect, label, placeholder, autoFocus, onCancel, featured, featuredLabel }: Props) {
  const id = useId();
  const index = useMemo(() => buildIndex(communes), [communes]);
  const [state, dispatch] = useReducer(comboReducer, COMBO_IDLE);
  const { editing, query, open } = state;
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** Le focus revient au bouton après un choix ou Échap, jamais après un clic ailleurs */
  const refocus = useRef(false);

  // Commune changée d'ailleurs (visite, découverte, lien) : une recherche en cours n'a plus d'objet
  const [seenInsee, setSeenInsee] = useState(value?.insee);
  if (seenInsee !== value?.insee) {
    setSeenInsee(value?.insee);
    dispatch({ type: 'close' });
  }

  const searching = !value || editing;
  const searched = useMemo(() => searchCommunes(index, query), [index, query]);
  // Suggestions seulement tant qu'aucune commune n'est choisie : ensuite, la liste s'ouvre à la première lettre
  const showFeatured = !query.trim() && !value && !!featured?.length;
  const results = showFeatured ? featured : searched;
  const listVisible = open && results.length > 0;
  const activeIndex = listVisible && state.active >= 0 && state.active < results.length ? state.active : -1;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const listId = `${id}-list`;
  const noResult = open && !!query.trim() && results.length === 0;

  useLayoutEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }, [editing]);

  useLayoutEffect(() => {
    if (searching || !refocus.current) return;
    refocus.current = false;
    // Le focus a pu partir ailleurs le temps que la commune se charge : on ne le reprend pas
    const current = document.activeElement;
    if (!current || current === document.body) buttonRef.current?.focus();
  }, [searching]);

  useEffect(() => {
    if (activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
    // optionId ne dépend que de `id`, stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const choose = (c: Commune) => {
    refocus.current = true;
    dispatch({ type: 'close' });
    onSelect(c);
  };

  if (!searching) {
    return (
      <div className="commune-search">
        <div className="combo">
          <button
            ref={buttonRef}
            type="button"
            className="commune-pick"
            onClick={() => dispatch({ type: 'start', text: '' })}
            onKeyDown={(e) => {
              const typed = typedCharacter(e.key, e.ctrlKey || e.metaKey || e.altKey);
              if (typed === null) return;
              e.preventDefault();
              e.stopPropagation();
              dispatch({ type: 'start', text: typed });
            }}
          >
            <StarIcon />
            <span className="commune-pick-text">
              <span className="commune-label">{label}</span>
              <span className="commune-pick-name">
                <span className="commune-pick-city" title={value.name}>{value.name}</span>
                <span className="commune-pick-dep">&nbsp;({value.dep})</span>
              </span>
            </span>
            <span className="commune-pick-action">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20l1-5L16 4l4 4L9 19l-5 1z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
              <span className="commune-pick-word">Changer</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  const canFeature = !value && !!featured?.length;
  const firstUse = !value && !autoFocus;

  return (
    <div className="commune-search">
      <div className={`combo${firstUse ? ' is-first-use' : ''}`}>
        <StarIcon />
        <label htmlFor={`${id}-input`} className="commune-label commune-label-over">
          {label}
        </label>
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={listVisible}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          spellCheck={false}
          value={query}
          placeholder={editing ? HELP : (placeholder ?? HELP)}
          className="commune-input"
          onChange={(e) => dispatch({ type: 'input', text: e.target.value })}
          onFocus={() => {
            if (query.trim() || canFeature) dispatch({ type: 'open' });
          }}
          onClick={() => {
            // Champ déjà focalisé, liste refermée par Échap : le clic la rouvre
            if (!open && (query.trim() || canFeature)) dispatch({ type: 'open' });
          }}
          onBlur={() => {
            // Changement de fenêtre : la recherche attend le retour. Un clic dans la liste ne fait pas perdre le focus.
            if (document.hasFocus()) dispatch({ type: 'close' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              dispatch({ type: 'arrow', delta: e.key === 'ArrowDown' ? 1 : -1, count: results.length });
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const c = comboPick(state, results);
              if (c) choose(c);
            } else if (e.key === 'Escape') {
              // Rien à annuler : Échap garde son sens plus haut (tiroir de la barre)
              if (!open && !query && !editing && !onCancel) return;
              e.preventDefault();
              e.stopPropagation();
              refocus.current = editing;
              dispatch({ type: 'close' });
              onCancel?.();
            }
          }}
        />
      </div>
      {/* Toujours présente : `aria-controls` vise un élément qui existe, fermé ou ouvert */}
      <ul
        id={listId}
        role="listbox"
        className="combo-list"
        hidden={!listVisible}
        aria-label={showFeatured ? (featuredLabel ?? 'Communes') : 'Communes'}
        onMouseDown={(e) => e.preventDefault()}
      >
        {showFeatured && featuredLabel && (
          <li role="presentation" className="combo-section">
            {featuredLabel}
          </li>
        )}
        {listVisible &&
          results.map((c, i) => (
            <li
              key={c.insee}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className={i === activeIndex ? 'is-active' : ''}
              onClick={() => choose(c)}
              onMouseMove={() => dispatch({ type: 'hover', index: i })}
            >
              <span>{c.name}</span>
              <small>{c.dep}</small>
            </li>
          ))}
      </ul>
      <p className={noResult ? 'combo-empty' : 'sr-only'} role="status">
        {noResult ? "Aucune commune d'Île-de-France ne correspond." : ''}
      </p>
    </div>
  );
}
