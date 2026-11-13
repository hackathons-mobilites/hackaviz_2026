// Session utilisateur : profil et préférences synchronisés avec le serveur.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, NATIVE, TOKEN_KEY } from '../api/client.js'
import { clearTrip } from '../features/trip/tripStore.js'
import { storage } from '../utils/storage.js'

// Données de la session gardées sur l'appareil : effacées à la déconnexion
const SESSION_KEY = 'atv.session'
// Ancien stockage du jeton dans le navigateur (avant le cookie HttpOnly) : effacé au premier lancement
if (!NATIVE) storage.remove(TOKEN_KEY)
const hasSession = () => Boolean(storage.get(SESSION_KEY) || (NATIVE && storage.get(TOKEN_KEY)))

function forgetDevice() {
  storage.remove(TOKEN_KEY)
  storage.remove(SESSION_KEY)
  storage.remove('atv.user')
  clearTrip().catch(() => {})
  // Réponses API mises en cache par le service worker (contiennent des positions GPS)
  if ('caches' in window) caches.delete('api').catch(() => {})
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(!hasSession())

  // Au démarrage : relit le compte si un jeton existe (hors ligne, on garde la copie locale)
  useEffect(() => {
    if (!hasSession()) return
    api.me.get()
      .then((u) => { setUser(u); storage.setJSON('atv.user', u) })
      .catch((e) => {
        if (e.status === 401) forgetDevice()
        else setUser(storage.getJSON('atv.user', null))
      })
      .finally(() => setReady(true))
  }, [])

  const open = useCallback(({ token, user: u }) => {
    if (NATIVE && token) storage.set(TOKEN_KEY, token)
    storage.set(SESSION_KEY, '1')
    storage.setJSON('atv.user', u)
    setUser(u)
    return u
  }, [])

  const value = useMemo(() => ({
    user, ready,
    login: async (body) => open(await api.auth.login(body)),
    // Inscription : pas de session tant que l'adresse e-mail n'est pas confirmée (renvoie { verify, email })
    register: async (body) => {
      const r = await api.auth.register(body)
      return r.verify ? r : open(r)
    },
    verifyEmail: async (token) => open(await api.auth.verify(token)),
    resetPassword: async (token, password) => open(await api.auth.reset(token, password)),
    // Les autres appareils sont déconnectés ; celui-ci reçoit un nouveau jeton
    changePassword: async (body) => open(await api.me.password(body)),
    update: async (body) => {
      const u = await api.me.update(body)
      storage.setJSON('atv.user', u)
      setUser(u)
      return u
    },
    // Destinations enregistrées
    addPlace: async (body) => { const u = await api.me.addPlace(body); storage.setJSON('atv.user', u); setUser(u); return u },
    removePlace: async (id) => { const u = await api.me.removePlace(id); storage.setJSON('atv.user', u); setUser(u); return u },
    // Le serveur efface le cookie de session ; l'appareil oublie le compte et le trajet enregistré
    logout: async () => {
      await api.auth.logout().catch(() => {})
      forgetDevice()
      setUser(null)
    },
  }), [user, ready, open])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

export const isAdmin = (user) => user?.role === 'admin' || user?.role === 'superadmin'

// Écran d'arrivée après inscription, selon la réponse sur le handicap
export function firstScreenPath(user) {
  return user?.first_screen === 'trajet_accessible' ? '/itineraires?sans-marche=1' : '/'
}
