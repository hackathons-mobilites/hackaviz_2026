import type { ReactNode } from 'react';
import type { ItinTrip } from '../../data/itineraries';
import { coverLine, optionPriceLine, passLine } from '../../data/costLines';
import { SourceTip } from '../proof/SourceTip';
import { TipLines } from '../proof/TipLines';
import { InfoTip } from '../InfoTip';
import { RecordsSourceNote } from '../provenance/ProofNotes';
import {
  coveringOptions,
  formatEur,
  legCostText,
  priceText,
  transitRoundTrip,
  velibRides,
  velibRoundTrip,
  type RideCost,
  type SubscriptionsFile,
  type VelibOffer,
} from '../../data/subscriptions';
import { useSubscriptionsStore } from './subscriptionsStore';
import { usePersonalSettingsAllowed, useEffectiveSubscriptions } from './useEffectiveSubscriptions';
import { useSubscriptionsFile } from './useSubscriptionsFile';
import { useTransitChoice } from './useTransitChoice';
import './subscriptions.css';

/**
 * Coût selon les abonnements (D-032), dans le pli « Coût et carbone » du panneau de preuve. Audit d'affichage du 10/11 (demande
 * de Nicolas) : une ligne de coût selon le cas, l'information seulement ; la règle (prix jamais divisé), la prise en charge par
 * l'employeur et les raisons sont dans un « i ». Tout texte et tout prix vient de `subscriptions.json`.
 * - `ProofTransitPass` : abonnement TC choisi (ce qui reste à payer en plus, hors coût de l'abonnement) ;
 * - `ProofTransitCover` : aucun abonnement choisi, les abonnements qui couvriraient l'aller et le retour ;
 * - `ProofSubscriptions` : Vélib', vélo personnel, vélo + TC.
 */

/** Bouton qui ouvre « Mes réglages » à la partie des abonnements ; absent pendant la visite (réglages personnels coupés). */
function SettingsButton({ children }: { children: ReactNode }) {
  const personal = usePersonalSettingsAllowed();
  const openDialog = useSubscriptionsStore((s) => s.openDialog);
  if (!personal) return null;
  return (
    <button type="button" className="link-btn subs-settings-btn" aria-haspopup="dialog" onClick={(e) => openDialog(e.currentTarget, 'subs')}>
      {children}
    </button>
  );
}

/** « i » de « hors coût de l'abonnement » : la règle du prix jamais divisé et la prise en charge par l'employeur (textes publiés). */
function NotDividedTip({ file, employerNote = null, employer = true }: { file: SubscriptionsFile; employerNote?: string | null; employer?: boolean }) {
  return (
    <InfoTip label="Pourquoi hors coût de l'abonnement ?" placement="top">
      <span className="pf-tip-line">{file.texts.never_divided}</span>
      {employer && (
        <span className="pf-tip-line">
          {employerNote ? `${employerNote.charAt(0).toUpperCase()}${employerNote.slice(1)}. ` : ''}
          {file.employer.text}
        </span>
      )}
    </InfoTip>
  );
}

/** Abonnement TC choisi : une ligne. Navigo Jour (titre d'un jour) : le détail par sens et le total, comme avant. */
export function ProofTransitPass({ outTrip, retTrip, maxTripMin }: Readonly<{ outTrip: ItinTrip | null; retTrip: ItinTrip | null; maxTripMin: number | null | undefined }>) {
  const { file, option } = useTransitChoice();
  if (!file || !option) return null;
  const extra = file.transit.extra_titles;
  const rt = transitRoundTrip(outTrip, retTrip, option, extra, file.transit.unpriced_agencies ?? {});
  const ticketed = [rt.out, rt.ret].some((l) => l.status === 'tickets' || l.status === 'extra');
  const notes = <RecordsSourceNote className="pf-prov" nodes={[option, ticketed ? extra : null, option.employer ? file.employer : null]} />;
  if (option.kind === 'day') {
    const lines = [legCostText(rt.out, extra, 'out'), legCostText(rt.ret, extra, 'ret')].filter((t): t is string => !!t);
    return (
      <section className="pf-section pf-subs" aria-label="Coût avec votre titre">
        <p className="pf-cost-line">
          Avec votre {option.label} ({option.price.text ?? priceText(option.price)}) : <SettingsButton>Modifier</SettingsButton>
        </p>
        <ul className="subs-list">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {rt.total_eur !== null && (
          <p>
            <strong>{`Aller et retour avec un ${option.label} : ${formatEur(rt.total_eur)}.`}</strong>
          </p>
        )}
        {notes}
      </section>
    );
  }
  const line = passLine(option, rt, extra, maxTripMin);
  return (
    <section className="pf-section pf-subs" aria-label="Coût avec votre abonnement">
      <p className="pf-cost-line">
        {line.lead}
        {line.tail ? (
          <>
            {line.tail} <NotDividedTip file={file} employer={!!option.employer} employerNote={option.employer_note ?? null} />
          </>
        ) : null}
        . <SettingsButton>Modifier</SettingsButton>
      </p>
      {notes}
    </section>
  );
}

/** Aucun abonnement TC choisi : les abonnements tout public qui couvriraient l'aller ET le retour, leur prix dans le « i ». */
export function ProofTransitCover({ outTrip, retTrip }: Readonly<{ outTrip: ItinTrip | null; retTrip: ItinTrip | null }>) {
  const { file, unknownId } = useTransitChoice();
  // Un seul sens : le coût dit déjà pourquoi il n'est pas calculé, les titres qui couvriraient l'aller-retour ne sont pas recherchés
  if (!file || ((!outTrip || !retTrip) && !unknownId)) return null;
  const cover = outTrip && retTrip ? coveringOptions(file, outTrip, retTrip) : [];
  const line = coverLine(cover);
  return (
    <section className="pf-section pf-subs" aria-label="Avec un abonnement">
      {unknownId && <p className="pf-note">Votre abonnement enregistré n'est plus dans la liste publiée : coût affiché hors abonnement.</p>}
      {!outTrip || !retTrip ? null : line ? (
        <p className="pf-cost-line">
          {line.lead}
          {line.tail}{' '}
          <InfoTip label="Prix de ces titres" placement="top">
            {cover.map((o) => (
              <span key={o.id} className="pf-tip-line">
                {optionPriceLine(o)}
              </span>
            ))}
            <span className="pf-tip-line">{file.texts.never_divided}</span>
            <span className="pf-tip-line">{file.employer.text}</span>
          </InfoTip>
          . <SettingsButton>Mes réglages</SettingsButton>
        </p>
      ) : (
        <p className="pf-cost-line">
          Aucun titre tout public relevé ne couvre ce trajet sans supplément. <SettingsButton>Mes réglages</SettingsButton>
        </p>
      )}
      <RecordsSourceNote className="pf-prov" nodes={[cover, file.employer]} />
    </section>
  );
}

/** Vélib', vélo personnel, vélo + TC (D-027, D-032). */
export function ProofSubscriptions({
  mode,
  insee,
  poleIndex,
  polesCount,
}: Readonly<{
  mode: string;
  insee: string | null;
  poleIndex: number;
  /** Nombre d'astres affichés : garde de longueur des séries Vélib' par position (arbitrage du 05/11) */
  polesCount: number;
}>) {
  const file = useSubscriptionsFile();
  const { velib: velibId } = useEffectiveSubscriptions();
  if (!file || !insee) return null;
  const offer = velibId ? file.velib.offers.find((o) => o.id === velibId) ?? null : null;

  let body: ReactNode = null;
  if (mode === 'velib') body = <VelibPart file={file} offer={offer} insee={insee} poleIndex={poleIndex} polesCount={polesCount} />;
  else if (mode === 'bike') body = <p className="pf-cost-line">{file.bike.personal.text}</p>;
  else if (mode === 'bike_transit')
    body = (
      // Audit d'affichage du 11/11 (K12) : l'offre de stationnement en gare (condition d'une offre, pas une valeur du trajet) et sa portée
      // vont au « i » de la valeur, mots inchangés ; en clair en mode sources
      <p className="pf-cost-line">
        {file.bike.personal.text}{' '}
        <SourceTip label="Et pour garer le vélo en gare ?" block>
          <TipLines lines={[file.bike.parking.text, `${file.bike.parking.scope.charAt(0).toUpperCase()}${file.bike.parking.scope.slice(1)}.`]} />
        </SourceTip>
      </p>
    );
  if (!body) return null;
  return (
    <section className="pf-section pf-subs" aria-label="Coût selon vos abonnements">
      {body}
    </section>
  );
}

function rideText(c: RideCost): string {
  if (c.status === 'included') return 'incluse';
  if (c.status === 'paid' && c.eur !== null) return formatEur(c.eur);
  return 'non calculée';
}

function VelibPart({
  file,
  offer,
  insee,
  poleIndex,
  polesCount,
}: Readonly<{ file: SubscriptionsFile; offer: VelibOffer | null; insee: string; poleIndex: number; polesCount: number }>) {
  const rides = velibRides(file, insee, poleIndex, polesCount);
  if (!rides || (rides.out === null && rides.ret === null)) return null;
  const none = file.velib.offers.find((o) => o.kind === 'ride') ?? null;
  const shown = offer ?? none;
  if (!shown) return null;
  const rt = velibRoundTrip(rides.out, rides.ret, shown);
  const others = file.velib.offers.filter((o) => o.id !== shown.id && o.kind === 'subscription');
  const dur = [rides.out !== null ? `aller ${rides.out} min` : null, rides.ret !== null ? `retour ${rides.ret} min` : null].filter(Boolean).join(', ');
  // La raison d'une course non calculée (souvent la même à l'aller et au retour) est dite une fois, dans le « i »
  const reasons = [...new Set([rt.out.reason, rt.ret.reason].filter((r): r is string => !!r))];
  return (
    <>
      <p className="pf-cost-line">Partie à vélo (calculée) : {dur}.</p>
      <p className="pf-cost-line">
        {offer ? `Avec votre ${offer.label} (${offer.price.text ?? priceText(offer.price)})` : <strong>Hors abonnement ({shown.label})</strong>} : course aller {rideText(rt.out)}, course
        retour {rideText(rt.ret)}
        {rt.total_eur !== null ? `, soit ${formatEur(rt.total_eur)} l'aller-retour${shown.kind === 'day' ? ' (prix du pass compris)' : ''}` : ''}{' '}
        <InfoTip label="Comment ce coût est-il calculé ?" placement="top">
          {reasons.map((r) => (
            <span key={r} className="pf-tip-line">
              {`${r.charAt(0).toUpperCase()}${r.slice(1)}.`}
            </span>
          ))}
          <span className="pf-tip-line">{file.texts.velib_ride}</span>
          <span className="pf-tip-line">{file.texts.never_divided}</span>
        </InfoTip>
        . <SettingsButton>Modifier</SettingsButton>
      </p>
      <ul className="subs-list">
        {others.map((o) => {
          const x = velibRoundTrip(rides.out, rides.ret, o);
          return (
            <li key={o.id}>
              {o.label} ({priceText(o.price)}) : courses {x.total_eur !== null ? (x.total_eur === 0 ? 'incluses' : `${formatEur(x.total_eur)} l'aller-retour en plus`) : 'non calculées'}
            </li>
          );
        })}
      </ul>
      <RecordsSourceNote className="pf-prov" nodes={[shown, others]} />
    </>
  );
}
