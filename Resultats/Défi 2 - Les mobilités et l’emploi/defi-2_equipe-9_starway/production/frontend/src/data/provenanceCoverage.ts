/**
 * Registre de couverture de la provenance (D-033) : pour chaque composant qui montre un chiffre, les codes
 * de source du manifeste (`sources.json`) que sa ligne de provenance doit afficher quand le mode est
 * activé (bouton de la barre du haut ou `?src=1`), ou son exemption écrite avec la raison.
 * `provenanceCoverage.test.ts` ÉCHOUE si un composant de preuve n'y est ni inscrit ni exempté, si un
 * composant inscrit n'utilise aucune note de provenance, si un code n'est pas dans sources.json, ou si un
 * composant écrit un code de source en dur.
 *
 * AJOUTER UN BLOC CHIFFRÉ (nouveau `components/proof/Proof*.tsx`, ou tout fichier sous `components/subscriptions`,
 * `needs`, `recruit`, `vehicles`) :
 *  1. poser UNE ligne JSX de `components/provenance/ProofNotes.tsx` sous le chiffre, avec la classe `pf-prov`
 *     (`<CodeSourceNote code="ENV01" />`, `<RecordsSourceNote nodes={[...]} />` pour les données qui portent
 *     leurs `source_id`, ou une nouvelle fonction pure dans `data/provenance.ts` + son test) ;
 *  2. ne jamais écrire de nom de jeu, de millésime, de lien ni de code dans le texte : tout vient de sources.json ;
 *  3. inscrire le composant ci-dessous (`kind: 'notes'`) avec les codes cités ; si la source du bloc est déjà
 *     citée par son parent, `kind: 'covered'` ; sinon `kind: 'exempt'` avec une raison (et une date si elle est
 *     temporaire).
 * La note ne s'affiche que mode actif et n'occupe aucune place quand il est coupé (aucun saut de mise en page).
 */

/** `notes` : le composant pose lui-même la note ; `covered` : la note de `coveredBy` couvre ce bloc ; `exempt` : raison écrite. */
export type CoverageKind = 'notes' | 'covered' | 'exempt';

export interface CoverageEntry {
  /** Chemin depuis `src/components/` */
  file: string;
  kind: CoverageKind;
  /** Codes du manifeste que la ligne doit pouvoir citer : tous doivent être dans `public/data/sources.json` */
  codes: readonly string[];
  /** Codes cités seulement quand le pipeline les publie (absents de sources.json aujourd'hui : rien n'est affiché d'ici là) */
  whenPublished?: readonly string[];
  /** `covered` : fichier du registre (kind `notes`) dont la ligne couvre ce bloc */
  coveredBy?: string;
  /** `exempt` : pourquoi ce composant n'a pas de ligne de provenance (datée si temporaire) */
  reason?: string;
}

const SKY_CODES = ['EMP01', 'TRA01', 'CYC01', 'GEO04'] as const;
const SUBSCRIPTION_CODES = ['SUB01', 'SUB02', 'SUB03', 'SUB04', 'SUB05', 'COST01', 'COST02'] as const;

export const PROVENANCE_COVERAGE: readonly CoverageEntry[] = [
  // ---- panneau de preuve
  { file: 'ProofPanel.tsx', kind: 'notes', codes: ['TRA01', 'TRA01B', 'TRA01C', 'CYC01', 'GEO02', 'EMP01', 'GEO04'] },
  { file: 'proof/ProofJobs.tsx', kind: 'notes', codes: ['EMP01', 'EMP02'] },
  // projets de recrutement BMO par bassin d'emploi (D-035) : jeu et millésime lus dans sources.json (EMP03), bassin (GEO04)
  { file: 'recruit/ProofRecruit.tsx', kind: 'notes', codes: ['EMP03', 'GEO04'] },
  // Forfait Navigo Mois (COST01) retiré du panneau (audit d'affichage du 10/11, faux depuis D-032) : seuls les tickets restent
  // D-066 : bloc « Trajet » (tuiles Coût et Carbone, autres trajets) à la place de ProofCost, ProofCarbon et ProofAlternatives
  { file: 'proof/TripBlock.tsx', kind: 'notes', codes: ['TRA01', 'CYC01', 'COST02', 'ENV01'] },
  // Tuiles hors TC : vélo (texte de subscriptions.json, aucun chiffre), voiture (mêmes faits que le pli, dont la note cite les sources)
  { file: 'proof/ModeTripBlock.tsx', kind: 'covered', coveredBy: 'proof/ProofCarCost.tsx', codes: ['COST08', 'VEH01', 'COST06', 'COST07', 'ENV02', 'CYC01', 'TOLL01', 'TOLL02', 'TOLL03', 'TOLL04', 'TOLL05'] },
  { file: 'proof/ProofTraffic.tsx', kind: 'notes', codes: ['ROAD01'] },
  { file: 'proof/ProofTransports.tsx', kind: 'notes', codes: ['TRA01', 'CYC01', 'TRA03', 'TRA04', 'QS01'] },
  { file: 'proof/ProofOffpeak.tsx', kind: 'notes', codes: ['TRA01', 'CYC01'] },
  { file: 'proof/ProofNeeds.tsx', kind: 'notes', codes: ['TRA01', 'TRA03', 'TRA04'] },
  {
    file: 'needs/NeedsMarks.tsx',
    kind: 'exempt',
    codes: [],
    reason:
      "Calque décoratif (losanges au bord des astres, aria-hidden) : aucun chiffre ni donnée affichés. Ce que déclarent les sources (GTFS IDFM, référentiel des lignes, accessibilité en gare) est cité par la légende et par le panneau de preuve (ProofNeeds.tsx), avec leurs dates.",
  },
  // offres diffusées sur Choisir le service public (D-036) : jeu et millésime lus dans sources.json (EMP04), méthode lue dans service_public.json
  { file: 'proof/ProofPublicOffers.tsx', kind: 'notes', codes: ['EMP04'] },
  { file: 'proof/ProofModes.tsx', kind: 'notes', codes: ['TRA01', 'CYC01', 'COST02', 'ENV01'] },
  // codes lus dans meta.transfer_check.sources (TRA01, TRA02B depuis le 10/11) : data/transferCheck.ts, transferSourceCodes
  { file: 'proof/ProofTransferCheck.tsx', kind: 'notes', codes: ['TRA01', 'TRA02B'] },
  { file: 'proof/ProofTimes.tsx', kind: 'covered', coveredBy: 'ProofPanel.tsx', codes: ['TRA01', 'CYC01'] },
  { file: 'proof/ProofOd.tsx', kind: 'covered', coveredBy: 'ProofPanel.tsx', codes: ['TRA01', 'TRA01B', 'TRA01C', 'CYC01', 'EMP01'] },
  { file: 'proof/ProofBadgeLine.tsx', kind: 'covered', coveredBy: 'ProofPanel.tsx', codes: ['TRA01', 'CYC01'] },
  {
    file: 'proof/ProofCarCost.tsx',
    kind: 'notes',
    // lues dans meta.vehicles (consommation COST08 ou VEH01, prix COST06 ou COST07, carbone ENV02), dans tolls.json
    // (TOLL01 à TOLL05) et dans le réseau routier du mode (CYC01) : data/provenanceCarCost.ts
    codes: ['COST08', 'VEH01', 'COST06', 'COST07', 'ENV02', 'CYC01', 'TOLL01', 'TOLL02', 'TOLL03', 'TOLL04', 'TOLL05'],
  },
  // ---- abonnements (D-032)
  { file: 'subscriptions/ProofSubscriptions.tsx', kind: 'notes', codes: SUBSCRIPTION_CODES },
  { file: 'subscriptions/SubscriptionsDialog.tsx', kind: 'notes', codes: SUBSCRIPTION_CODES },
  {
    file: 'subscriptions/SubscriptionsButton.tsx',
    kind: 'exempt',
    codes: [],
    reason: "Bouton qui ouvre « Mes abonnements » : aucun chiffre ni donnée affichés (les prix sont dans le dialogue et le panneau de preuve).",
  },
  // ---- ciel, listes, carte, halo
  { file: 'SkyCredit.tsx', kind: 'notes', codes: SKY_CODES },
  { file: 'SkyList.tsx', kind: 'notes', codes: SKY_CODES },
  { file: 'Insights.tsx', kind: 'notes', codes: SKY_CODES },
  { file: 'ContrastOfTheDay.tsx', kind: 'notes', codes: SKY_CODES },
  { file: 'MirrorMap.tsx', kind: 'notes', codes: ['GEO01', 'TRA01', 'EMP01', 'CYC01'] },
  { file: 'HaloPanel.tsx', kind: 'notes', codes: ['GEN04', 'GEN01', 'SOC01'] },
  { file: 'CounterBlock.tsx', kind: 'covered', coveredBy: 'SkyCredit.tsx', codes: ['EMP01', 'TRA01', 'CYC01'] },
  { file: 'JobsCounter.tsx', kind: 'covered', coveredBy: 'SkyCredit.tsx', codes: ['EMP01'] },
  { file: 'Legend.tsx', kind: 'covered', coveredBy: 'SkyCredit.tsx', codes: ['EMP01', 'TRA01', 'CYC01'] },
  { file: 'SizeKey.tsx', kind: 'covered', coveredBy: 'SkyCredit.tsx', codes: ['EMP01'] },
  { file: 'SkySummary.tsx', kind: 'covered', coveredBy: 'SkyCredit.tsx', codes: ['EMP01', 'TRA01', 'CYC01'] },
  { file: 'IncomeRanks.tsx', kind: 'covered', coveredBy: 'HaloPanel.tsx', codes: ['SOC01'] },
  { file: 'HaloAstrolabe.tsx', kind: 'covered', coveredBy: 'HaloPanel.tsx', codes: ['GEN04', 'GEN01', 'SOC01'] },
  { file: 'HaloDotPlot.tsx', kind: 'covered', coveredBy: 'HaloPanel.tsx', codes: ['GEN04', 'GEN01', 'SOC01'] },
  // ---- repères de territoire (D-048) : jeu, millésime et méthode lus dans sources.json et territoire.json ; descriptifs, jamais sur un astre
  // onglet « Chômage » (taux de l'Insee SOC02, composition communale des zones d'emploi GEO05) et temps de travail (enquête Emploi EMP05)
  { file: 'territoire/UnemploymentTab.tsx', kind: 'notes', codes: ['SOC02', 'GEO05'] },
  { file: 'territoire/WorkTime.tsx', kind: 'notes', codes: ['EMP05'] },
  { file: 'territoire/Polarity.tsx', kind: 'notes', codes: ['GEO06'] },
];
