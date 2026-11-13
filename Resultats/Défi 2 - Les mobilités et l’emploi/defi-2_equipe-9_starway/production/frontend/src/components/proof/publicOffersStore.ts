import { create } from 'zustand';

interface PublicOffersState {
  /** Case « Service public » cochée : les offres diffusées s'affichent, à part */
  shown: boolean;
  setShown: (shown: boolean) => void;
}

/**
 * Case « Service public » du panneau de preuve (D-036), hors du store du ciel comme le son et le daltonisme : ce n'est
 * pas un scénario (ni dans l'URL écrite, ni dans la visite, ni dans les liens copiés). Elle ne change aucune donnée,
 * aucun état d'astre, aucune position ni taille, aucun verdict : elle montre ou cache un bloc séparé. Décochée par
 * défaut, pour que les offres diffusées ne se confondent jamais avec les postes salariés recensés par l'INSEE ; le choix vaut
 * pour la session (rien n'est mémorisé).
 */
export const usePublicOffersStore = create<PublicOffersState>()((set) => ({
  shown: false,
  setShown: (shown) => set({ shown }),
}));
