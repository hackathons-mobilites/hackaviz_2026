import { priceText, type SubscriptionsFile, type TransitOption, type VelibOffer } from '../../data/subscriptions';
import { InfoTip } from '../InfoTip';
import { RecordsSourceNote } from '../provenance/ProofNotes';
import './subscriptions.css';

/**
 * Partie « Mes abonnements » du dialogue « Mes réglages » (V0, D-032 proposée) : boutons radio natifs, accessibles au
 * clavier. Tout texte et tout prix vient de `subscriptions.json`. Les choix sont un brouillon : rien ne change avant
 * « Enregistrer », et le réglage ne change que le coût affiché. Le fichier garde son nom : le registre de la provenance et
 * la traçabilité (`provenanceCoverage.ts`, `traceability.py`) le citent.
 */
export function SubscriptionsChoices({
  file,
  transit,
  velib,
  onTransit,
  onVelib,
}: Readonly<{ file: SubscriptionsFile; transit: string | null; velib: string | null; onTransit: (id: string | null) => void; onVelib: (id: string | null) => void }>) {
  const opts = file.transit.options;
  const groups: { title: string; items: TransitOption[] }[] = [
    { title: 'Pour tous', items: opts.filter((o) => o.kind === 'pass' && o.audience === 'all') },
    { title: 'Sous conditions', items: opts.filter((o) => o.kind === 'pass' && o.audience !== 'all') },
    { title: "Titre d'une journée", items: opts.filter((o) => o.kind === 'day') },
  ];
  const offers = file.velib.offers;
  const noneVelib = offers.find((o) => o.kind === 'ride');
  // Audit d'affichage du 10/11 : la date des prix et les forfaits deux zones non proposés, dans le « i » des transports en commun
  const zones = file.transit.not_proposed.find((n) => n.id === 'navigo_zones') ?? null;

  return (
    <>
      <p>Dites-nous ce que vous avez déjà : le coût affiché dans le panneau d'un pôle en tient compte. Le ciel ne change pas. Réglage gardé sur cet appareil.</p>

      <fieldset className="subs-group">
        <legend>
          Transports en commun{' '}
          <InfoTip label="Prix et titres proposés" placement="bottom">
            {file.price_validity && <span className="pf-tip-line">Prix : {file.price_validity}.</span>}
            {zones && <span className="pf-tip-line">{zones.label} : non proposés, voir « Titres non proposés, et pourquoi ».</span>}
          </InfoTip>
        </legend>
        <Radio name="subs-transit" checked={transit === null} onChange={() => onTransit(null)} label="Aucun abonnement" detail="tickets à l'unité, plein tarif" />
        {groups.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.title} className="subs-sub">
                <p className="subs-subtitle">{g.title}</p>
                {g.items.map((o) => (
                  <Radio
                    key={o.id}
                    name="subs-transit"
                    checked={transit === o.id}
                    onChange={() => onTransit(o.id)}
                    label={o.label ?? o.id}
                    detail={[o.price.text ?? priceText(o.price), o.conditions].filter(Boolean).join(' · ')}
                  />
                ))}
              </div>
            ),
        )}
      </fieldset>

      <fieldset className="subs-group">
        <legend>Vélib'</legend>
        {noneVelib && (
          <Radio
            name="subs-velib"
            checked={velib === null || velib === noneVelib.id}
            onChange={() => onVelib(null)}
            label="Aucun abonnement"
            detail={noneVelib.price.text ?? priceText(noneVelib.price)}
          />
        )}
        {offers
          .filter((o) => o.kind !== 'ride')
          .map((o: VelibOffer) => (
            <Radio
              key={o.id}
              name="subs-velib"
              checked={velib === o.id}
              onChange={() => onVelib(o.id)}
              label={o.label ?? o.id}
              detail={[o.price.text ?? priceText(o.price), o.price.variants?.length ? `tarifs réduits : ${o.price.variants.map((v) => `${v.label} ${priceText({ eur: v.eur, per: o.price.per })}`).join(', ')}` : null].filter(Boolean).join(' · ')}
            />
          ))}
      </fieldset>

      <section className="subs-info" aria-label="Vélo personnel et voiture">
        <p>{file.bike.personal.text}</p>
        <p>{file.bike.parking.text}</p>
        <p className="subs-small">{file.car.reason}</p>
      </section>

      <section className="subs-info" aria-label="Prise en charge par l'employeur">
        <p>{file.employer.text}</p>
        <p className="subs-small">{file.texts.never_divided}</p>
      </section>

      <details className="subs-details">
        <summary>Titres non proposés, et pourquoi</summary>
        <ul>
          {file.transit.not_proposed.map((n) => (
            <li key={n.id}>
              <strong>{n.label}</strong> : {n.reason}
            </li>
          ))}
        </ul>
      </details>

      <RecordsSourceNote className="pf-prov" nodes={[opts, offers, file.transit.not_proposed, file.employer]} />
    </>
  );
}

function Radio({ name, checked, onChange, label, detail }: Readonly<{ name: string; checked: boolean; onChange: () => void; label: string; detail?: string | null }>) {
  return (
    <label className={`subs-radio ${checked ? 'is-checked' : ''}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>
        <span className="subs-radio-label">{label}</span>
        {detail && <span className="subs-radio-detail">{detail}</span>}
      </span>
    </label>
  );
}
