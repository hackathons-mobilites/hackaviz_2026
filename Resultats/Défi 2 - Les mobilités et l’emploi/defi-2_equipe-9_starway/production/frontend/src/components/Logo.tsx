import { assetUrls } from '../theme/assets';

/**
 * Logo final vectoriel (public/assets/img/starway-logo.svg) ; en petit sur mobile, symbole seul.
 * `mono` (barre du haut de l'explorateur, L-13) : version monochrome blanc lunaire, pour qu'aucun
 * cyan (« accessible ») ni or (« gain démontré ») n'apparaisse hors des données ; le logo couleur
 * reste sur l'écran titre et la slide. Le nom accessible est porté par l'attribut alt.
 */
export function Logo({ small = false, mono = false }: { small?: boolean; mono?: boolean }) {
  return (
    <span className={small ? 'logo-wrap logo-wrap-small' : 'logo-wrap'}>
      <img className="logo-full" src={mono ? assetUrls.logoMonoSvg : assetUrls.logoSvg} alt="STARWAY" />
      {small && (
        <img className="logo-symbol" src={mono ? assetUrls.symbolMonoSvg : assetUrls.symbolSvg} alt="" aria-hidden="true" />
      )}
    </span>
  );
}
