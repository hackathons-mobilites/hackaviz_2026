// Prétraitement de la ligne de commande : parseArgs de Node refuse « --option -123 » (valeur prise pour une option).

/** Options dont la valeur peut être négative. */
const NEGATIVE_VALUE_OPTIONS = ['--av-offset-ms'];

/** Réécrit « --av-offset-ms -10071 » en « --av-offset-ms=-10071 ». */
export function joinNegativeValues(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (NEGATIVE_VALUE_OPTIONS.includes(argv[i]) && next !== undefined && /^-\d/.test(next)) {
      out.push(`${argv[i]}=${next}`);
      i++;
    } else {
      out.push(argv[i]);
    }
  }
  return out;
}
