import { Component, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react';
import {
  BUNDLE_RELOAD_LABEL,
  BUNDLE_UPDATED_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE,
  isBundleStale,
  stateFromError,
  subscribeBundleStale,
  type BoundaryState,
} from '../state/bundleUpdate';

/**
 * Écran de repli : le message et un BOUTON. Pas de rechargement automatique (il pourrait boucler si le
 * fichier manque vraiment) : la personne décide.
 */
export function UpdateNotice({ stale }: { stale: boolean }) {
  return (
    <main className="fatal update-notice" role="alert">
      <h1>{stale ? BUNDLE_UPDATED_MESSAGE : UNEXPECTED_ERROR_MESSAGE}</h1>
      <p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()} autoFocus>
          {BUNDLE_RELOAD_LABEL}
        </button>
      </p>
    </main>
  );
}

type State = BoundaryState;

class Boundary extends Component<{ children: ReactNode; stale: boolean }, State> {
  state: State = { failed: false, stale: false };

  static getDerivedStateFromError(error: unknown): State {
    return stateFromError(error);
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Erreur interceptée par la limite d’erreur', error, info.componentStack);
  }

  render() {
    // `stale` (props) : un import en échec hors du rendu (ciel, affiche) a marqué le site comme changé
    if (this.state.failed || this.props.stale) return <UpdateNotice stale={this.state.stale || this.props.stale} />;
    return this.props.children;
  }
}

/**
 * Limite d'erreur autour de toute l'application. Sans elle, un `import()` en échec (Comparer, carte, liste
 * du ciel : fichier à nom haché remplacé par une mise en ligne) démonte React et laisse une page blanche.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const stale = useSyncExternalStore(subscribeBundleStale, isBundleStale, () => false);
  return <Boundary stale={stale}>{children}</Boundary>;
}
