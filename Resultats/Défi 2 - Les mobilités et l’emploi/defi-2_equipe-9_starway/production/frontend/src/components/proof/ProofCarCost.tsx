import type { CarLegFacts, CarTripFacts } from '../../data/carCost';
import { carScenarioFacts } from './carScenario';
import { formatInt, nbsp } from '../../data/format';
import { dayDate } from '../../data/provenance';
import { carCostProvenance } from '../../data/provenanceCarCost';
import { passageLabel, passageWindow, tollCredits, tollLeg, type TollLeg } from '../../data/tolls';
import type { AccessFile, Meta, SourceEntry, TollsFile, VehicleMeta } from '../../data/types';
import { formatHhmm } from '../../state/url';
import type { Scenario } from '../../state/scenario';
import { InfoTip } from '../InfoTip';
import { ProvenanceNote } from '../provenance/ProvenanceNote';
import { carCostChartModel, carCostReading, euroRange } from '../../data/carCostChart';
import { usePalette } from '../../store/colorVisionStore';
import { carCostChart, triChart as T } from '../../theme/tokens';
import { ChartReadingTip } from '../ChartReadingTip';
import { TriMark } from './TriMark';
import { TripTiles } from './TripTiles';
import { useProvenanceStore } from '../../store/provenanceStore';
import './carCost.css';
import { useTolls } from './useTolls';

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const price = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 4 });

const euro = (x: number) => nbsp(eur.format(x));
const range = (a: number, b: number) => (a === b ? euro(a) : `de ${euro(a)} à ${euro(b)}`);
const clock = (m: number) => {
  const d = ((m % 1440) + 1440) % 1440;
  const t = formatHhmm(d);
  return `${Number(t.slice(0, 2))}h${t.slice(2)}`;
};

/** Portée du coût voiture : un trajet vers le point d'arrivée du pôle (K18) */
const CAR_COST_SCOPE = "Vers le point d'arrivée du pôle, pas commune par commune.";

/**
 * Coût et carbone d'un trajet motorisé (D-029), modes `car` et `car_traffic`, vers le point du pôle,
 * pour le véhicule choisi dans la barre (« Véhicule », URL `vh`) : énergie, péages traversés (tarif
 * de la classe du véhicule à l'heure de passage, tolls.json), total, carbone, aller puis retour ; ce qui est compté ou non est
 * dans le « i » « Ce qui est compté ». Rien n'est affiché sans les distances routières corrigées (`car_trip`).
 * Jamais sur le ciel.
 */
export function ProofCarCost(props: CarCostProps) {
  const tj = useTolls(!!props.access?.car_trip?.toll);
  const sourcesOn = useProvenanceStore((s) => s.on);
  return <CarCostView {...props} tolls={tj} sourcesOn={sourcesOn} />;
}

interface CarCostProps {
  meta: Meta;
  access: AccessFile | null | undefined;
  poleIndex: number;
  /** Nombre d'astres affichés : garde de longueur des séries par position (arbitrage du 05/11) */
  polesCount: number;
  scenario: Scenario;
  /** sources.json : sert à la provenance (affichée seulement quand le mode sources est actif) */
  sources?: readonly SourceEntry[];
  /** Mode sources (D-033) : `false` retire les sources internes aux lignes Énergie et Carbone (défaut : tout écrire, pour les tests du rendu) */
  sourcesOn?: boolean;
}

/** Rendu du bloc (sans chargement) : `tolls` = tolls.json, null tant qu'il n'est pas chargé. */
export function CarCostView({ meta, access, poleIndex, polesCount, scenario, sources = [], tolls: tj, sourcesOn = true }: CarCostProps & { tolls: TollsFile | null }) {
  const cf = carScenarioFacts({ meta, access, poleIndex, polesCount, scenario, tolls: tj });
  if (!cf) return null;
  const { costs, v, trip, start, end, durations, facts, forbidden } = cf;
  const twoWheeler = v.family === 'two_wheeler';
  // Audit d'affichage du 10/11 (demande de Nicolas, lot 4) : ce qui est compté ou non, le périmètre du carbone, l'énergie, le facteur, la
  // distance R5 et la classe de péage sont de la méthode : dans le « i », mots inchangés ; les sources, en mode sources seulement
  const counted = (
    <InfoTip label="Ce qui est compté" placement="top">
      {/* Audit d'affichage du 11/11 (K18) : la portée du coût en tête du « i » ; écrite sous le total en mode sources */}
      {trip && !sourcesOn && (
        <>
          <span className="pf-tip-row">{CAR_COST_SCOPE}</span>{' '}
        </>
      )}
      <span className="pf-tip-row">Non compté : {costs.not_included.join(', ')}.</span>{' '}
      {costs.carbon ? (
        <>
          <span className="pf-tip-row">
            Carbone : {costs.carbon.occupancy} ; {costs.carbon.perimeter}
          </span>{' '}
        </>
      ) : null}
      <span className="pf-tip-row">
        Énergie : {num.format(v.consumption_per_100km)} {v.unit}/100 km{sourcesOn ? ` (${v.consumption_source.text})` : ''} x {price.format(v.price_eur_per_unit)} €/{v.unit}
        {sourcesOn ? ` (${v.price_source.text}${v.price_source.read_at ? `, relevé du ${v.price_source.read_at.slice(0, 10).split('-').reverse().join('/')}` : ''})` : ''}.
      </span>{' '}
      {v.co2_source && (
        <>
          <span className="pf-tip-row">
            Carbone : {String(v.co2_kg_per_unit).replace('.', ',')} kg CO2e/{v.unit}
            {sourcesOn ? ` (ADEME, Base Carbone ${v.co2_source.version}, élément ${v.co2_source.element_id} « ${v.co2_source.name} », combustion et amont)` : ', combustion et amont'}.{' '}
            {sourcesOn ? costs.carbon?.tc_comparison : costs.carbon?.tc_comparison?.replace(/\s*\(ENV\d{2}\)/, '')}
          </span>{' '}
        </>
      )}
      {trip && facts && (
        <span className="pf-tip-row">
          Distance routière R5. Péages : classe {v.toll_class} ({tj?.classes[String(v.toll_class)] ?? ''}), tarifs du {dayDate(meta.service_date)}
          {tj ? ` ; ${tj.rule.price}` : ''}.
        </span>
      )}
    </InfoTip>
  );
  return (
    <section className="pf-section pf-carcost" aria-labelledby="pf-carcost-title">
      <div className="pf-label-row">
        <h3 className="pf-label" id="pf-carcost-title">
          Coût et carbone : {v.label.toLowerCase()}
        </h3>
        {facts && !forbidden ? counted : null}
      </div>
      {!facts ? (
        <p>Coût du trajet : pas encore publié (distances routières en cours de recalcul). {counted}</p>
      ) : forbidden ? (
        <p>
          Ce chemin passe par le Duplex A86, interdit aux deux-roues : aucun coût n'est calculé pour ce véhicule (le temps et le chemin sont ceux de la
          voiture). {counted}
        </p>
      ) : (
        <>
          {/* D-066 (demande de Nicolas du 11/11) : le total et le carbone aller et retour en grand, puis une barre par sens (énergie,
              péage), le montant et le crédit de chaque péage écrits à côté (D-060, D-064) ; les phrases d'avant restent pour les
              lecteurs d'écran (liste hors écran) */}
          <TripTiles
            label="Voiture, aller et retour"
            tiles={[
              {
                label: 'Aller et retour',
                className: 'pf-carcost-total',
                tile:
                  facts.totalMin != null
                    ? { value: euroRange(facts.totalMin, facts.totalMax!), sub: 'énergie et péages', tip: [] }
                    : { value: 'Total inconnu', sub: facts.energy != null ? `péage non chiffré, dont énergie ${euro(facts.energy)}` : 'péage non chiffré', tip: [] },
              },
              {
                label: 'Carbone aller et retour',
                className: 'pf-carcost-carbon',
                tile: facts.co2 != null ? { value: `${formatInt(facts.co2)}\u00a0g CO2e`, sub: 'estimation, énergie seule', tip: [] } : { value: 'Non calculé', sub: null, tip: [] },
              },
            ]}
          />
          <CarCostChart facts={facts} total={facts.totalMin != null ? range(facts.totalMin, facts.totalMax!) : null} />
          <TollLines f={[facts.out, facts.ret]} tj={tj} windows={[passageWindow('out', start!, durations.out), passageWindow('ret', end!, durations.ret)]} />
          <ul className="pf-carcost-legs sr-only">
            <LegLine label="Aller" leg="out" f={facts.out} tj={tj} clockAt={start!} />
            <LegLine label="Retour" leg="ret" f={facts.ret} tj={tj} clockAt={end!} />
          </ul>
          {trip && sourcesOn && <p className="pf-note">{CAR_COST_SCOPE}</p>}
          <BadgeNote f={[facts.out, facts.ret]} tj={tj} v={v} windows={[passageWindow('out', start!, durations.out), passageWindow('ret', end!, durations.ret)]} trip={trip!} i={poleIndex} />
          <Notices f={[facts.out, facts.ret]} tj={tj} />
        </>
      )}
      {twoWheeler && v.time?.text && <p className="pf-note">{v.time.text}</p>}
      <ProvenanceNote parts={carCostProvenance(sources, { vehicle: v, tolls: tj, withTrip: !!trip && !!facts, mode: scenario.mode, meta })} />
    </section>
  );
}

function tollText(t: TollLeg, tj: TollsFile): string {
  if (t.status === 'sans_peage') return 'aucun péage';
  if (t.min == null) {
    const where = (t.points ?? []).map((p) => tj.points[p]?.label).filter(Boolean);
    return `péage inconnu${where.length ? ` (${[...new Set(where)].join(', ')})` : ''} : ${tj.status_texts[t.status] ?? t.status}`;
  }
  const names = t.items.map((x) => passageLabel(tj, x.e, x.s)).join(' ; ');
  return `péage ${range(t.min, t.max!)} (${[names, ...tollCredits(tj, t.items)].join(' ; ')})`;
}

function LegLine({ label, leg, f, tj, clockAt }: { label: string; leg: 'out' | 'ret'; f: CarLegFacts; tj: TollsFile | null; clockAt: number }) {
  if (f.distM == null) return <li>{label} : aucun trajet en voiture trouvé.</li>;
  const win = passageWindow(leg, clockAt, f.minutes);
  return (
    <li>
      {label} ({num.format(f.distM / 1000)} km) : énergie {f.energy != null ? euro(f.energy) : 'inconnue'} ;{' '}
      {f.toll && tj ? tollText(f.toll, tj) : 'péages en cours de chargement'}
      {f.toll?.status === 'fourchette' && win ? ` : l'heure de passage n'est connue qu'entre ${clock(win[0])} et ${clock(win[1])}` : ''}
      {f.totalMin != null && f.toll?.status !== 'sans_peage' ? <> ; total {range(f.totalMin, f.totalMax!)}</> : null}
      {f.co2 != null ? <> ; {formatInt(f.co2)}&nbsp;g CO2e</> : null}.
    </li>
  );
}

/** Duplex A86 : tarif avec badge de télépéage, relevé à part (chantier abonnements), jamais dans le total. */
function BadgeNote({ f, tj, v, windows, trip, i }: { f: CarLegFacts[]; tj: TollsFile | null; v: VehicleMeta; windows: ([number, number] | null)[]; trip: NonNullable<AccessFile['car_trip']>; i: number }) {
  if (!tj || !trip.toll) return null;
  const parts: string[] = [];
  (['out', 'ret'] as const).forEach((leg, k) => {
    const items = f[k]?.toll?.items ?? [];
    const w = windows[k];
    if (!w || !items.some((x) => tj.points[x.e]?.system === 'DUPLEX_A86')) return;
    const b = tollLeg(tj, trip.toll![leg][i], v.toll_class, w[0], w[1], 'telepeage');
    if (b.min != null) parts.push(`${leg === 'out' ? 'aller' : 'retour'} ${range(b.min, b.max!)}`);
  });
  if (!parts.length) return null;
  const duplex = tj.points.findIndex((p) => p.system === 'DUPLEX_A86');
  return <p className="pf-src">Péage du Duplex A86 avec un badge de télépéage ({tollCredits(tj, [{ e: duplex, s: duplex }]).join(', ')}) : {parts.join(', ')}. Non utilisé dans le total.</p>;
}

/** Avis attachés aux points traversés (A14 : gratuité annoncée, non appliquée). */
function Notices({ f, tj }: { f: CarLegFacts[]; tj: TollsFile | null }) {
  if (!tj) return null;
  const ids = new Set<number>();
  for (const x of f) for (const it of x.toll?.items ?? []) [it.e, it.s].forEach((p) => ids.add(p));
  const notes = [...new Set([...ids].map((p) => tj.points[p]?.notice).filter((n): n is string => !!n))];
  return (
    <>
      {notes.map((n) => (
        <p key={n} className="pf-note">
          {n}
        </p>
      ))}
    </>
  );
}

/**
 * Lignes visibles des péages (D-060, D-064) : le montant de chaque péage et le crédit de son tarif, côte à côte ; « Aucun péage, aller et
 * retour. » quand aucun sens n'en traverse. La fenêtre de passage d'une fourchette est écrite à la suite.
 */
function TollLines({ f, tj, windows }: { f: CarLegFacts[]; tj: TollsFile | null; windows: ([number, number] | null)[] }) {
  if (!tj) return <p className="pf-carcost-tolls">Péages en cours de chargement.</p>;
  const legs = (['out', 'ret'] as const).map((leg, k) => ({ leg, toll: f[k]?.toll ?? null, win: windows[k] ?? null }));
  if (legs.every((l) => l.toll?.status === 'sans_peage')) return <p className="pf-carcost-tolls">Aucun péage, aller et retour.</p>;
  return (
    <ul className="pf-carcost-tolls">
      {legs.map(({ leg, toll, win }) =>
        toll ? (
          <li key={leg}>
            {leg === 'out' ? 'Aller' : 'Retour'} : {tollText(toll, tj)}
            {toll.status === 'fourchette' && win ? ` : l'heure de passage n'est connue qu'entre ${clock(win[0])} et ${clock(win[1])}` : ''}.
          </li>
        ) : null,
      )}
    </ul>
  );
}

/**
 * Graphique du coût de la voiture (D-066, grammaire D-051) : une barre par sens, triangle vers la droite pour l'aller, vers la gauche
 * pour le retour, longueur = euros sur une échelle commune partant de 0 ; énergie en plein, péage hachuré à la suite, fourchette en
 * pointillé ; le montant au bout. Perle (donnée neutre) : ni cyan (accessible) ni or (gain). Décoratif (`aria-hidden`) : la liste des
 * sens, hors écran, est lue par les lecteurs d'écran. Aucune animation.
 */
function CarCostChart({ facts, total }: { facts: CarTripFacts; total: string | null }) {
  const stroke = usePalette().color.neutral;
  const model = carCostChartModel(facts);
  if (!model) return null;
  const { rowPx, labelPx, valuePx, barPx } = carCostChart;
  const plotL = labelPx;
  const plotR = T.width - valuePx;
  const w = (eur: number) => (model.axisMax > 0 ? ((plotR - plotL) * eur) / model.axisMax : 0);
  const H = model.rows.length * rowPx + 4;
  const hatch = 'pf-carcost-hatch';
  return (
    <figure className="pf-cc pf-carcost-chart">
      <figcaption className="pf-cc-title chart-read-row">
        <span>Coût de chaque sens</span>
        <ChartReadingTip chart="coût de la voiture, aller et retour" reading={carCostReading(model, { total, co2: facts.co2 })} placement="top" />
      </figcaption>
      <p className="pf-cc-key">
        <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true" focusable="false">
          <rect x="0.5" y="0.5" width="13" height="9" fill={stroke} />
        </svg>{' '}
        énergie,{' '}
        <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true" focusable="false">
          <defs>
            <pattern id={`${hatch}-key`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke={stroke} strokeWidth="1.5" />
            </pattern>
          </defs>
          <rect x="0.5" y="0.5" width="13" height="9" fill={`url(#${hatch}-key)`} stroke={stroke} strokeWidth="1" />
        </svg>{' '}
        péage, en euros.
      </p>
      <div className="pf-cc-plot">
        <svg viewBox={`0 0 ${T.width} ${H}`} width="100%" aria-hidden="true" focusable="false" className="pf-cc-svg">
          <defs>
            <pattern id={hatch} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke={stroke} strokeWidth="1.5" />
            </pattern>
          </defs>
          {model.rows.map((r, i) => {
            const cy = i * rowPx + rowPx / 2 + 2;
            const e = w(r.energy);
            const tMin = r.tollMin != null ? w(r.tollMin) : 0;
            const tMax = r.tollMax != null ? w(r.tollMax) : 0;
            return (
              <g key={r.dir}>
                <TriMark dir={r.dir} x={8} y={cy} filled stroke={stroke} />
                <text x={20} y={cy} dominantBaseline="central" className="pf-cc-name" fill="currentColor">
                  {r.label}
                </text>
                <rect x={plotL} y={cy - barPx / 2} width={Math.max(e, 1)} height={barPx} fill={stroke} />
                {tMin > 0 && <rect x={plotL + e} y={cy - barPx / 2} width={tMin} height={barPx} fill={`url(#${hatch})`} stroke={stroke} strokeWidth="1" />}
                {tMax > tMin && (
                  <rect x={plotL + e + tMin} y={cy - barPx / 2} width={tMax - tMin} height={barPx} fill="none" stroke={stroke} strokeWidth="1" strokeDasharray={T.dash} />
                )}
                <text x={plotL + e + Math.max(tMin, tMax) + 6} y={cy} dominantBaseline="central" className="pf-cc-min" fill="currentColor">
                  {r.text}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
