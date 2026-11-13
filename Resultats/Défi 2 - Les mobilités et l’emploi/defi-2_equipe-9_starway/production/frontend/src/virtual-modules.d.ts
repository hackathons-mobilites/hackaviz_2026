/** Module virtuel écrit au build par vite.config.ts (`incomeDistribution`) */
declare module 'virtual:income-distribution' {
  const distribution: import('./data/incomeRank').IncomeDistribution;
  export default distribution;
}
