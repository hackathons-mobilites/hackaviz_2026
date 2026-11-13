import { useProvenanceStore } from '../../store/provenanceStore';
import { useState } from 'react';
import {
  detailText,
  familyRows,
  LIMITS,
  maskedPhrase,
  projectsPhrase,
  recruitLineText,
  recruitView,
  regionText,
  scopeCells,
  scopeText,
  seasonalText,
  starLimit,
  trendText,
  trendTipLines,
  type BmoBassin,
  type BmoFile,
} from '../../data/bmo';
import { recruitChartRows } from '../../data/recruitChart';
import type { Pole } from '../../data/types';
import { useSkyStore } from '../../store/useSkyStore';
import { BmoMethodNote } from '../provenance/BmoMethodNote';
import { BassinSourceNote, CodeSourceNote } from '../provenance/ProofNotes';
import { InfoTip } from '../InfoTip';
import { TipLines } from '../proof/TipLines';
import './recruit.css';
import { RecruitChart } from '../proof/RecruitChart';
import { useBmo, type BmoState } from './useBmo';

/**
 * Bloc « Projets de recrutement du bassin » du panneau de preuve (D-035, V0) : l'enquête BMO 2026 de France Travail
 * (EMP03), par bassin d'emploi (GEO04) et par famille de métiers. C'est une TENDANCE : des intentions de recrutement
 * déclarées par les employeurs, ni des offres publiées ni des embauches, jamais les postes salariés des astres recensés par l'INSEE.
 *
 * - 44 astres (défaut après la bascule) : un astre porte `bassin.code` ; les 20 arrondissements de Paris partagent un
 *   seul bassin et le bloc le dit.
 * - astre sans bassin : « non disponible pour cet astre », aucune valeur.
 * - jeu de démonstration : aucun bloc (aucune donnée BMO fictive).
 * - cases « * » de France Travail : « non diffusé par France Travail (vraisemblablement moins de 5 projets) », une
 *   DÉDUCTION de l'équipe (le sens n'est pas défini par la source), non comptées, « au moins n » ; aucune case publiée :
 *   « non diffusé », jamais 0. L'intérim : la source ne le dit pas, l'équipe n'a pas la réponse (« Champ et limites »).
 * La source (EMP03, GEO04 : jeu, millésime, code, lien vers la fiche) ET la méthode n'apparaissent que mode sources
 * actif (D-033).
 */
export function ProofRecruit({ pole, keepOut = false }: { pole: Pole; keepOut?: boolean }) {
  const dataset = useSkyStore((s) => s.dataset);
  const [family, setFamily] = useState<string | null>(null);
  const demo = !dataset || dataset.origin === 'demo';
  const bmo = useBmo(!demo && !!pole.bassin);
  if (demo) return null;
  return <RecruitBlock pole={pole} poles={dataset.poles} bmo={bmo} family={family} onFamily={setFamily} keepOut={keepOut} />;
}

/**
 * Ligne du bloc qui ne se replie jamais (lot 3, D-050 ; `keep-visible.json`), sous le titre du pli « Emplois et recrutement »,
 * pli fermé. Audit d'affichage du 10/11 (demande de Nicolas : l'information seulement) : UNE ligne chiffrée, lue dans les
 * données (`recruitLineText` : total, « dont au moins … jugés difficiles » ; « ni des offres publiées, ni des embauches » au « i » depuis le 11/11) ; le reste
 * (bassin, intentions de fin d'année, tendance, saisonniers, découpage du bassin) est dans son « i », mots inchangés. Le bloc
 * du pli ne répète ni la ligne ni la tendance (`keepOut`).
 */
export function RecruitKeep({ pole }: { pole: Pole }) {
  const dataset = useSkyStore((s) => s.dataset);
  const demo = !dataset || dataset.origin === 'demo';
  const bmo = useBmo(!demo && !!pole.bassin);
  if (demo || !dataset || bmo.status !== 'ready') return null;
  const view = recruitView(bmo.file, pole, dataset.poles);
  if (view.status !== 'ok') return null;
  return <RecruitKeepLineLive file={bmo.file} bassin={view.bassin} astres={view.astres} />;
}

/** La ligne selon le mode sources (audit d'affichage du 11/11, P36 : la réserve est écrite en clair en mode sources, sinon au « i ») */
function RecruitKeepLineLive(props: { file: BmoFile; bassin: BmoBassin; astres: number }) {
  const sourcesOn = useProvenanceStore((s) => s.on);
  return <RecruitKeepLine {...props} sourcesOn={sourcesOn} />;
}

/** La ligne et son « i », pure (testée sur les données publiées). */
export function RecruitKeepLine({ file, bassin, astres, sourcesOn = false }: { file: BmoFile; bassin: BmoBassin; astres: number; sourcesOn?: boolean }) {
  const cells = scopeCells(bassin, null);
  if (!cells) return null;
  return (
    <p className="pf-keep-line">
      {recruitLineText(file.year, cells, sourcesOn)}{' '}
      <InfoTip label="En savoir plus sur les projets de recrutement du bassin" placement="top">
        <TipLines lines={[`Bassin d'emploi ${bassin.name}.`, ...trendTipLines(file.year, !sourcesOn), seasonalText(cells), scopeText(astres)]} />
      </InfoTip>
    </p>
  );
}

/** Le bloc selon l'état du chargement (rendu pur : testé sur les données publiées). */
export function RecruitBlock({
  pole,
  poles,
  bmo,
  family,
  onFamily,
  keepOut = false,
}: {
  pole: Pole;
  poles: readonly Pole[];
  bmo: BmoState;
  family: string | null;
  onFamily: (code: string | null) => void;
  /** Lot 3 : les phrases « à garder visible » sont écrites par `RecruitKeep`, hors du pli ; le bloc ne les répète pas */
  keepOut?: boolean;
}) {
  return (
    <section className="pf-section pf-recruit" aria-labelledby="pf-recruit-title">
      <h3 className="pf-label" id="pf-recruit-title">
        Projets de recrutement du bassin
      </h3>
      {!pole.bassin ? (
        <p className="pf-dim">Non disponible pour cet astre : les projets de recrutement sont publiés par bassin d'emploi, pas par astre.</p>
      ) : bmo.status === 'loading' ? (
        <p className="pf-dim" role="status">
          Chargement des projets de recrutement.
        </p>
      ) : bmo.status === 'unavailable' ? (
        <p className="pf-dim">Non disponible : les projets de recrutement n'ont pas pu être chargés.</p>
      ) : (
        <Content pole={pole} poles={poles} file={bmo.file} family={family} onFamily={onFamily} keepOut={keepOut} />
      )}
    </section>
  );
}

function Content({
  pole,
  poles,
  file,
  family,
  onFamily,
  keepOut,
}: {
  pole: Pole;
  poles: readonly Pole[];
  file: BmoFile;
  family: string | null;
  onFamily: (code: string | null) => void;
  keepOut: boolean;
}) {
  const sourcesOn = useProvenanceStore((s) => s.on);
  const [active, setActive] = useState<string | null>(null);
  const view = recruitView(file, pole, poles);
  if (view.status !== 'ok') {
    return <p className="pf-dim">Non disponible pour ce bassin d'emploi.</p>;
  }
  const { bassin, astres } = view;
  const cells = scopeCells(bassin, family);
  const label = family ? file.families.find((f) => f.code === family)?.label : null;
  const chart = recruitChartRows(familyRows(file, bassin), family);
  const masked = maskedPhrase(cells?.met, file.masked);
  return (
    <>
      <p className="pf-recruit-bassin">
        Bassin d'emploi {bassin.name}
        {sourcesOn ? ' (France Travail)' : ''}{' '}
        <InfoTip label="Qu'est-ce que le bassin d'emploi ?" placement="top">
          {scopeText(astres)}
        </InfoTip>
      </p>
      <label className="pf-recruit-filter">
        <span className="pf-dim">Famille de métiers</span>
        <select value={family ?? ''} onChange={(e) => onFamily(e.target.value || null)}>
          <option value="">Toutes les familles</option>
          {file.families.map((f) => (
            <option key={f.code} value={f.code}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <span className="pf-stat">{projectsPhrase(cells?.met)}</span>
      <span className="pf-caption">
        projets de recrutement déclarés pour {file.year}
        {label ? ` : ${label}` : ''}
        {masked && (
          <>
            {' '}
            <InfoTip label="Pourquoi « au moins » ?" placement="top">
              <TipLines lines={[`${masked}.`, 'Non comptées : le chiffre est un minimum.', file.masked.note]} />
            </InfoTip>
          </>
        )}
      </span>
      {cells && (!keepOut || family) && <p className="pf-recruit-detail pf-dim">{detailText(cells)}</p>}
      {!keepOut && <p className="pf-note pf-recruit-trend">{trendText(file.year)}</p>}
      <RecruitChart rows={chart} title="Projets de recrutement déclarés par famille de métiers, de la plus nombreuse à la moins nombreuse" bassin={bassin.name} year={file.year} active={active} onActive={setActive}>
        <ul className="pf-recruit-list" aria-label="Projets de recrutement par famille de métiers">
          {chart.map((r) => (
            <li key={r.code} className={family === r.code ? 'is-selected' : undefined} tabIndex={0} onFocus={() => setActive(r.code)} onBlur={() => setActive(null)}>
              <span className="pf-recruit-name">{r.label}</span>
              <span className="pf-recruit-value">{r.phrase}</span>
            </li>
          ))}
        </ul>
      </RecruitChart>
      <CodeSourceNote code="EMP03" className="pf-prov" />
      <BassinSourceNote poles={[pole]} className="pf-prov" />
      <BmoMethodNote masked={file.masked} className="pf-prov" />
      <details className="pf-fold pf-recruit-limits">
        <summary>Champ et limites</summary>
        <ul>
          {LIMITS.slice(0, 2).map((t) => (
            <li key={t}>{t}</li>
          ))}
          <li>{starLimit(file.masked)}</li>
          {LIMITS.slice(2).map((t) => (
            <li key={t}>{t}</li>
          ))}
          <li>{regionText(file)}</li>
        </ul>
      </details>
    </>
  );
}
