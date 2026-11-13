import { METHODS } from '../../data/provenance';
import { POLARITY_TAG, POLARITY_TIP, communeTerritoire, polarityLine } from '../../data/territoire';
import { InfoTip } from '../InfoTip';
import { PolaritySourceNote } from '../provenance/ProofNotes';
import './territoire.css';
import { useTerritoire } from './useTerritoire';

/**
 * Polarité SDRIF-E (D-048, T4), lue dans territoire.json (jamais écrite dans le code) : un fait sur une commune, en texte perle, sans nouveau
 * symbole, jamais dans le ciel, jamais de niveau 1 ou 2 (la source ne les définit pas). Une commune sans polarité n'affiche RIEN (ni ligne,
 * ni bulle, ni « aucune »). La bulle « i » dit ce que la source dit et ce qu'elle ne dit pas : ce n'est pas un classement d'accessibilité.
 */

/** Sous le nom de la commune de « Derrière notre étoile » : « Polarité du SDRIF-E : Argenteuil » ; en diptyque, une ligne par côté qui en a une. */
export function PolarityUnderName({ sides }: { sides: readonly { insee: string; name: string; tag?: 'A' | 'B' }[] }) {
  const state = useTerritoire();
  if (state.status !== 'ready') return null;
  const lines = sides
    .map((s) => ({ ...s, text: polarityLine(communeTerritoire(state.file, s.insee)?.polarity) }))
    .filter((s): s is typeof s & { text: string } => s.text !== null);
  if (lines.length === 0) return null;
  return (
    <div className="terr-polarity-block">
      {lines.map((s) => (
        <p key={s.insee} className="terr-polarity">
          <span className="terr-polarity-text">{s.tag ? `${s.tag} · ${s.name} : ${s.text}` : s.text}</span>
          <InfoTip label="Ce qu'est une polarité du SDRIF-E" placement="bottom">
            {POLARITY_TIP}
          </InfoTip>
        </p>
      ))}
      <PolaritySourceNote file={state.file} method={METHODS.polarity} className="terr-prov" />
    </div>
  );
}

/**
 * Pli « Communes du pôle » : l'étiquette « polarité SDRIF-E » nomme les communes de la liste qui en ont une (texte perle, aucun symbole).
 * Les triangles aller et retour du lot 4 restent à leur place. Aucune commune concernée : rien n'est rendu.
 */
export function CommunePolarityTags({ communes }: { communes: readonly { insee: string; name: string }[] }) {
  const state = useTerritoire();
  if (state.status !== 'ready') return null;
  const tagged = communes
    .map((c) => ({ ...c, polarity: communeTerritoire(state.file, c.insee)?.polarity ?? null }))
    .filter((c): c is typeof c & { polarity: string } => c.polarity !== null);
  if (tagged.length === 0) return null;
  return (
    <div className="terr-polarity-tags">
      <p className="terr-polarity">
        <span>Communes avec une {POLARITY_TAG}</span>
        <InfoTip label="Ce qu'est une polarité du SDRIF-E" placement="top">
          {POLARITY_TIP}
        </InfoTip>
      </p>
      <ul className="terr-polarity-list">
        {tagged.map((c) => (
          <li key={c.insee}>
            <span className="terr-polarity-text">{c.name}</span> · {polarityLine(c.polarity)}
          </li>
        ))}
      </ul>
      <PolaritySourceNote file={state.file} method={METHODS.polarity} className="terr-prov" />
    </div>
  );
}
