import { useState } from 'react';
import { modeChartModel } from '../../data/modeChart';
import { minutesText, splitAnchorNote, type ModeComparison } from '../../data/modesCompare';
import type { ModeId } from '../../data/types';
import { InfoTip } from '../InfoTip';
import { ModesSourceNote } from '../provenance/ProofNotes';
import { ModeChart } from './ModeChart';
import { useSourcesOn } from './useSourcesOn';
import './carCost.css';
import './panneauLignes.css';

/**
 * « Comparer les modes » (retour de Cyril et Sara du 03/11, V0) : un tableau, une ligne par mode publié
 * pour la commune, avec l'aller, le retour, le verdict au temps choisi et le coût ou le carbone
 * seulement là où ils sont calculables depuis les données publiées (« non publié » sinon, jamais une valeur inventée). Tableau natif
 * (`caption`, `th scope`) : lisible au clavier et au lecteur d'écran ; le bouton de chaque ligne
 * affiche le ciel de ce mode. Replié par défaut pour garder le volet court (maquette v1 de Sara).
 * Audit d'affichage du 10/11 (demande de Nicolas, lot 4) : sous le tableau, au plus une phrase (en commune par commune, vers quel arrêt
 * vont les durées) ; la méthode (durées, coût TC, coût voiture, carbone, « non publié ») est dans le « i » « Ce que compte ce tableau ».
 * Les modes non calculés pour la commune sont nommés dans le pli ouvert seulement : pli fermé, ils ne disent rien du chiffre lu.
 */
export function ProofModes({
  data,
  budget,
  onShow,
  vehicleNote,
  anchorNote,
  inFold = false,
}: {
  data: ModeComparison;
  budget: number;
  onShow: (mode: ModeId) => void;
  /** Ce qui n'est pas compté dans le coût voiture (meta.car_costs.not_included), si publié */
  vehicleNote?: string | null;
  /**
   * Commune par commune (table OD) : phrase qui dit que les durées vont à l'arrêt d'ancrage du pôle ; le
   * verdict (celui du ciel est celui de la table OD) n'est alors pas affiché.
   */
  anchorNote?: string | null;
  /** Lot 3 (D-050) : le pli « Comparer les moyens de transport » du panneau porte déjà le repli ; le bloc n'a plus le sien */
  inFold?: boolean;
}) {
  const [active, setActive] = useState<ModeId | null>(null);
  const sourcesOn = useSourcesOn();
  if (data.rows.length === 0) return null;
  const verdicts = !anchorNote;
  const anchor = anchorNote ? splitAnchorNote(anchorNote) : null;
  const chart = modeChartModel(data.rows);
  const tip = (
    <InfoTip label="Ce que compte ce tableau" placement="top" className="pf-modes-tip">
      {/* Audit d'affichage du 11/11 (M7) : vers quel arrêt vont les durées, en tête du « i » ; écrit sous le tableau en mode sources */}
      {anchor && !sourcesOn && <span className="pf-tip-row">{anchor.lead} </span>}
      <span className="pf-tip-row">{anchor?.tail ?? 'Mêmes durées que le ciel de chaque mode (aller pour arriver avant le début du poste, retour après la fin).'}</span>{' '}
      <span className="pf-tip-row">Coût des transports en commun : prix au ticket de l’itinéraire détaillé, plein tarif, sans forfait.</span>{' '}
      <span className="pf-tip-row">
        Coût voiture : énergie seule des voitures, péages non comptés (le détail est dans « Coût et carbone »), quand les distances sont publiées
        {vehicleNote ? ` (non compté : ${vehicleNote})` : ''}.
      </span>{' '}
      <span className="pf-tip-row">
        Carbone : transports en commun d’après les facteurs IDFM ; voiture estimé comme dans « Coût et carbone » (distance routière x facteur ADEME du véhicule, énergie seule,
        une personne seule dans le véhicule).
      </span>{' '}
      <span className="pf-tip-row">« Non publié » : aucune valeur dans les données, rien n’est estimé.</span>
    </InfoTip>
  );
  const title = (
    <h3 className={`pf-label ${inFold ? 'pf-modes-title' : 'pf-inline'}`} id="pf-modes-title">
      Comparer les modes
    </h3>
  );
  const content = (
    <>
      <ModeChart model={chart} title="Temps de trajet par moyen de transport, du plus court au plus long (aller + retour)" active={active} onActive={setActive} verdicts={verdicts} />
      <div className="pf-modes-scroll">
          <table className="pf-modes-table">
            <caption className="sr-only">Temps de trajet vers ce pôle selon le mode{verdicts ? `, en ${budget} min ou moins par sens` : ''}</caption>
            <thead>
              <tr>
                <th scope="col">Mode</th>
                <th scope="col">Aller</th>
                <th scope="col">Retour</th>
                {verdicts && <th scope="col">En {budget}&nbsp;min ou moins</th>}
                <th scope="col">Coût aller et retour</th>
                <th scope="col">Carbone aller et retour</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const unknown = r.verdict === 'unknown';
                return (
                  <tr
                    key={r.mode}
                    className={r.current ? 'is-current' : ''}
                    aria-current={r.current ? 'true' : undefined}
                    onMouseEnter={() => setActive(r.mode)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(r.mode)}
                    onBlur={() => setActive(null)}
                  >
                    <th scope="row">
                      {r.label}
                      {r.current ? (
                        <span className="pf-modes-cur"> (ciel affiché)</span>
                      ) : (
                        <>
                          {' '}
                          <button type="button" className="link-btn pf-modes-show" onClick={() => onShow(r.mode)} aria-label={`Afficher le ciel en ${r.label}`}>
                            afficher
                          </button>
                        </>
                      )}
                    </th>
                    <td>{unknown ? 'non calculé' : minutesText(r.out)}</td>
                    <td>{unknown ? 'non calculé' : minutesText(r.ret)}</td>
                    {verdicts && <td className={`pf-modes-v is-${r.verdict}`}>{r.verdictText}</td>}
                    <td className={r.cost ? '' : 'pf-modes-na'}>{r.cost ?? 'non publié'}</td>
                    <td className={r.carbon ? '' : 'pf-modes-na'}>{r.carbon ?? 'non publié'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.notComputed.length > 0 && <p className="pf-src">Non calculés pour cette commune : {data.notComputed.join(', ')}.</p>}
        <p className="pf-src pf-modes-read">
          {anchor && sourcesOn ? `${anchor.lead} ` : null}
          {tip}
        </p>
        {/* Mode provenance : durées, prix au ticket, carbone et coût voiture réellement lus dans le tableau */}
        <ModesSourceNote className="pf-prov" rows={data.rows} />
    </>
  );
  return (
    // Audit d'affichage du 11/11 (M1) : dans le pli « Comparer les moyens », le titre interne redisait celui du pli
    <section className="pf-section pf-modes" {...(inFold ? { 'aria-label': 'Comparer les moyens' } : { 'aria-labelledby': 'pf-modes-title' })}>
      {inFold ? (
        content
      ) : (
        <details className="pf-fold">
          <summary>{title}</summary>
          {content}
        </details>
      )}
    </section>
  );
}
