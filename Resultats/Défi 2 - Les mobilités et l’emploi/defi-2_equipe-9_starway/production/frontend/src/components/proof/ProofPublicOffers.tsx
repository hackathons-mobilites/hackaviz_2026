import { useState } from 'react';
import {
  asOfText,
  astreOffers,
  employerOf,
  frDate,
  LIMITS,
  offersPhrase,
  offerUrl,
  recentOffers,
  regionText,
  scopeText,
  type PublicOffersFile,
  type PublicOffersList,
} from '../../data/publicOffers';
import { formatInt } from '../../data/format';
import type { Commune, Pole } from '../../data/types';
import { useProvenanceStore } from '../../store/provenanceStore';
import { useSkyStore } from '../../store/useSkyStore';
import { InfoTip } from '../InfoTip';
import { CodeSourceNote } from '../provenance/ProofNotes';
import { SourceTip } from './SourceTip';
import { TipLines } from './TipLines';
import './publicOffers.css';
import { usePublicOffersStore } from './publicOffersStore';
import { usePublicOffers, usePublicOffersList, type PublicOffersState } from './usePublicOffers';

/** Nombre d'offres listées dans le pli (les plus récemment publiées d'abord) */
const LIST_LIMIT = 10;

/**
 * Bloc « Offres diffusées sur Choisir le service public » du panneau de preuve (D-036, V0), SÉPARÉ de tout le reste :
 * la DGAFP publie les offres des trois versants de la fonction publique (EMP04).
 *
 * - une case « Service public », décochée par défaut : les offres diffusées ne se mêlent jamais aux postes salariés
 *   recensés par l'INSEE (Flores), ne sont jamais comptées dedans et ne changent ni le ciel ni les verdicts ;
 * - « offres diffusées au 11/10/2026 » : la date est celle du fichier ; une date de publication ne prouve pas que le
 *   poste est encore à pourvoir, jamais écrit « postes ouverts » ;
 * - rattachement par la commune seulement (code postal vérifié) : une offre connue seulement au département reste à
 *   part, sans répartition ;
 * - jeu de démonstration : aucun bloc (aucune offre fictive).
 * La source (EMP04 : jeu, millésime, code, lien vers la fiche) et la méthode n'apparaissent que mode sources actif (D-033).
 */
export function ProofPublicOffers({ pole }: { pole: Pole }) {
  const dataset = useSkyStore((s) => s.dataset);
  const shown = usePublicOffersStore((s) => s.shown);
  const setShown = usePublicOffersStore((s) => s.setShown);
  const demo = !dataset || dataset.origin === 'demo';
  const offers = usePublicOffers(!demo);
  if (demo) return null;
  return <PublicOffersBlock pole={pole} communes={dataset.communes} state={offers} shown={shown} onShown={setShown} />;
}

/**
 * « i » du bloc des offres, au bout de son titre (audit d'affichage du 11/11, P34) : « comptées à part des postes salariés (INSEE) », la
 * date de diffusion et les versants, mots inchangés ; en clair en mode sources (SourceTip). La case « Service public » la cite
 * (`aria-describedby`). Case cochée (offres listées, à côté d'une valeur), la réserve est écrite sous la case (garde V11).
 */
export function OffersScopeTip({ file }: { file: PublicOffersFile }) {
  return (
    <SourceTip label="En savoir plus sur les offres du service public" block>
      <span className="pf-tip-line" id="pf-offers-hint">
        {OFFERS_KEEP_TEXT}{' '}
      </span>
      <span className="pf-tip-line">{offersHintText(file)}</span>
    </SourceTip>
  );
}

const OFFERS_KEEP_TEXT = 'Offres du service public : comptées à part des postes salariés (INSEE).';

/** « Offres diffusées au 11/10/2026 : fonction publique d'État, territoriale et hospitalière. » (date lue dans le fichier) */
function offersHintText(file: PublicOffersFile): string {
  return `Offres diffusées ${asOfText(file)} : fonction publique d'État, territoriale et hospitalière.`;
}

/** Le bloc selon l'état du chargement (rendu pur : testé sur les données publiées). */
export function PublicOffersBlock({
  pole,
  communes,
  state,
  shown,
  onShown,
}: {
  pole: Pole;
  communes: readonly Pick<Commune, 'insee' | 'name'>[];
  state: PublicOffersState;
  shown: boolean;
  onShown: (shown: boolean) => void;
}) {
  return (
    <section className="pf-section pf-offers" aria-labelledby="pf-offers-title">
      <div className="pf-label-row">
        <h3 className="pf-label" id="pf-offers-title">
          Offres diffusées sur Choisir le service public
        </h3>
        {state.status === 'ready' && <OffersScopeTip file={state.file} />}
      </div>
      {state.status === 'loading' ? (
        <p className="pf-dim" role="status">
          Chargement des offres diffusées.
        </p>
      ) : state.status === 'unavailable' ? (
        <p className="pf-dim">Non disponible : les offres diffusées n'ont pas pu être chargées.</p>
      ) : (
        <Content pole={pole} communes={communes} file={state.file} shown={shown} onShown={onShown} />
      )}
    </section>
  );
}

function Content({
  pole,
  communes,
  file,
  shown,
  onShown,
}: {
  pole: Pole;
  communes: readonly Pick<Commune, 'insee' | 'name'>[];
  file: PublicOffersFile;
  shown: boolean;
  onShown: (shown: boolean) => void;
}) {
  return (
    <>
      <label className="pf-offers-toggle">
        <input type="checkbox" checked={shown} onChange={(e) => onShown(e.target.checked)} aria-describedby="pf-offers-hint" />
        <span>Service public</span>
      </label>
      {shown && <p className="pf-note pf-offers-apart">Comptées à part des postes salariés (INSEE).</p>}
      {shown && <Shown pole={pole} communes={communes} file={file} />}
    </>
  );
}

function Shown({ pole, communes, file }: { pole: Pole; communes: readonly Pick<Commune, 'insee' | 'name'>[]; file: PublicOffersFile }) {
  const a = astreOffers(file, pole);
  return (
    <>
      <span className="pf-stat">{a.n > 0 ? offersPhrase(a.n, file) : `Aucune offre diffusée ${asOfText(file)}`}</span>
      <span className="pf-caption">
        {a.n > 0 ? 'sur Choisir le service public, dans les communes de cet astre' : 'rattachée à une commune de cet astre'}{' '}
        <InfoTip label="Que dit ce chiffre des offres ?" placement="top">
          <TipLines lines={['Une date de publication ne prouve pas que le poste est encore à pourvoir.', "Ce chiffre n'est pas compté dans les postes salariés de l'astre recensés par l'INSEE."]} />
        </InfoTip>
      </span>
      {a.n > 0 && (
        <ul className="pf-offers-versants" aria-label="Offres diffusées par versant de la fonction publique">
          {a.versants.map((v) => (
            <li key={v.code}>
              <span className="pf-offers-name">{v.label}</span>
              <span className="pf-offers-value">{formatInt(v.n)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="pf-note pf-offers-note">{regionText(file)}</p>
      {a.n > 0 && <OffersFold pole={pole} communes={communes} file={file} />}
      <details className="pf-fold pf-offers-limits">
        <summary>Champ et limites</summary>
        <ul>
          <li>{scopeText(a)}</li>
          {LIMITS.map((t) => (
            <li key={t}>{t}</li>
          ))}
          <li>{file.metadata_gap.note}</li>
          {file.counts.file_rows_without_publication_dates > 0 && (
            <li>
              {formatInt(file.counts.file_rows_without_publication_dates)} lignes du fichier n'ont aucune date de publication : on ne sait pas si elles
              sont en ligne, elles ne sont pas comptées.
            </li>
          )}
        </ul>
      </details>
      <CodeSourceNote code="EMP04" className="pf-prov" />
      <MethodNote file={file} />
    </>
  );
}

/** Méthode du chiffre, en plus de la source : seulement quand le mode sources est actif (D-033). */
function MethodNote({ file }: { file: Pick<PublicOffersFile, 'method'> }) {
  const on = useProvenanceStore((s) => s.on);
  return <MethodLine on={on} file={file} />;
}

/** La ligne de méthode, pure (testée sans le store : le rendu serveur lit l'état initial). */
export function MethodLine({ on, file }: { on: boolean; file: Pick<PublicOffersFile, 'method'> }) {
  if (!on) return null;
  return <p className="prov-note pf-prov">Méthode : {file.method}</p>;
}

/** Pli « Voir les offres » : la liste est chargée à l'ouverture seulement. */
function OffersFold({ pole, communes, file }: { pole: Pole; communes: readonly Pick<Commune, 'insee' | 'name'>[]; file: PublicOffersFile }) {
  const [open, setOpen] = useState(false);
  const list = usePublicOffersList(file, open);
  return (
    <details className="pf-fold pf-offers-list" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Offres les plus récentes</summary>
      {list.status === 'loading' ? (
        <p className="pf-dim" role="status">
          Chargement de la liste.
        </p>
      ) : list.status === 'unavailable' ? (
        <p className="pf-dim">Non disponible : la liste des offres n'a pas pu être chargée.</p>
      ) : (
        <OffersList pole={pole} communes={communes} list={list.list} />
      )}
    </details>
  );
}

/** Les offres (intitulé, versant, employeur, commune, dates de publication, lien officiel) : aucun autre champ. */
export function OffersList({ pole, communes, list }: { pole: Pole; communes: readonly Pick<Commune, 'insee' | 'name'>[]; list: PublicOffersList }) {
  const { offers, total } = recentOffers(list, pole, LIST_LIMIT);
  const names = new Map(communes.map((c) => [c.insee, c.name]));
  return (
    <>
      <ul className="pf-offers-items">
        {offers.map((o) => (
          <li key={o.r}>
            <a href={offerUrl(list, o.r)} target="_blank" rel="noopener noreferrer">
              {o.t}
            </a>
            <span className="pf-dim">
              {[employerOf(list, o), names.get(o.insee), `publication du ${frDate(o.d)} ${o.f ? `au ${frDate(o.f)}` : 'sans date de fin'}`].filter(Boolean).join(', ')}
            </span>
          </li>
        ))}
      </ul>
      {total > offers.length && (
        <p className="pf-dim">
          Les {formatInt(offers.length)} plus récentes sur {formatInt(total)}. Les liens mènent à Choisir le service public : une offre arrivée à échéance peut y être dépubliée.
        </p>
      )}
    </>
  );
}
