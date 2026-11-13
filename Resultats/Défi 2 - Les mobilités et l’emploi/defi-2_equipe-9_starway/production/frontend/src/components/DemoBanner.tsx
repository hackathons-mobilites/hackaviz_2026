import { demoUsesRealPoles } from '../data/originSummary';
import { useSkyStore } from '../store/useSkyStore';

/** Bandeau OBLIGATOIRE dès qu'un chiffre fictif est affiché. */
export function DemoBanner() {
  const reason = useSkyStore((s) => (s.dataset?.origin === 'demo' ? s.dataset.demoReason : 'missing_access'));
  // D-016 : la démo (dev) charge les vrais pôles quand ils existent ; seules les durées sont alors fictives.
  const realPoles = useSkyStore((s) => (s.dataset ? demoUsesRealPoles(s.dataset.poles) : false));
  return (
    <div className="demo-banner" role="status">
      <strong>DONNÉES FICTIVES - démonstration</strong>
      <span>
        {reason === 'missing_access' || realPoles
          ? 'Durées de trajet tirées au hasard : elles ne décrivent pas la réalité. Pôles et postes salariés (INSEE) réels.'
          : 'Postes et durées de trajet tirés au hasard : ils ne décrivent pas la réalité.'}
        {reason === 'missing_meta' && ' Les données du pipeline ne sont pas encore publiées.'}
        {reason === 'query' && ' Mode ?demo=1.'}
      </span>
    </div>
  );
}
