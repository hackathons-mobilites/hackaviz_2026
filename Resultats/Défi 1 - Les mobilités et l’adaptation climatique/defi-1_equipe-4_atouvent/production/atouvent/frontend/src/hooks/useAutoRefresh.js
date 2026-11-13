// Mise à jour automatique sans recharger la page : relance `load` toutes les `ms` millisecondes, seulement quand l'écran est visible et qu'il y a du réseau, et tout de suite au retour sur l'onglet ou du réseau.
import { useEffect, useRef } from 'react'

export function useAutoRefresh(load, ms, deps = []) {
  const fn = useRef(load)
  fn.current = load
  useEffect(() => {
    let last = Date.now()
    const run = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      last = Date.now()
      fn.current()
    }
    const id = setInterval(run, ms)
    // Retour sur l'application après un moment : on rafraîchit sans attendre le prochain tour
    const wake = () => { if (Date.now() - last > ms / 2) run() }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', run)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', run)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps])
}
