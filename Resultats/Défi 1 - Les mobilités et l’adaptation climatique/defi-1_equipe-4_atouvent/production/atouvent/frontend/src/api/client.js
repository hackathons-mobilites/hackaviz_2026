// Client HTTP de l'API AtouVent : session, erreurs et appels regroupés par domaine.
import { storage } from '../utils/storage.js'

// Web : même origine (/api/v1). Application Android : adresse complète du serveur (VITE_API_URL, voir .env.android)
const BASE = import.meta.env.VITE_API_URL || '/api/v1'
export const API_BASE = BASE
export const TOKEN_KEY = 'atv.token'  // application Android seulement
export const NATIVE = Boolean(globalThis.Capacitor?.isNativePlatform?.())

export class ApiError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code // code court renvoyé par l'API, traduit par l'application (err.*)
  }
}

async function request(path, { method = 'GET', body, query } = {}) {
  const url = new URL(BASE + path, window.location.origin)
  Object.entries(query || {}).forEach(([k, v]) => v != null && url.searchParams.set(k, v))
  const headers = { Accept: 'application/json', 'X-Requested-With': 'AtouVent' }
  if (NATIVE) {
    headers['X-AtouVent-Client'] = 'native'
    const token = storage.get(TOKEN_KEY)
    if (token) headers.Authorization = `Bearer ${token}`
  }
  if (body) headers['Content-Type'] = 'application/json'

  let res
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'network')
  }
  // Une page web à la place de l'API (domaine parqué, mauvaise adresse) : traité comme un serveur injoignable
  if (res.ok && res.status !== 204 && !(res.headers.get('content-type') || '').includes('json')) throw new ApiError(0, 'network')
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // Erreur de validation (liste de champs) : message générique « vérifiez les informations »
    const detail = typeof data?.detail === 'string' ? data.detail : res.status === 422 ? 'validation' : 'error'
    throw new ApiError(res.status, detail)
  }
  return data
}

export const api = {
  auth: {
    register: (body) => request('/auth/register', { method: 'POST', body }),
    login: (body) => request('/auth/login', { method: 'POST', body }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    forgot: (email) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
    reset: (token, password) => request('/auth/reset-password', { method: 'POST', body: { token, password } }),
    verify: (token) => request('/auth/verify-email', { method: 'POST', body: { token } }),
    resendVerification: (email) => request('/auth/resend-verification', { method: 'POST', body: { email } }),
  },
  me: {
    get: () => request('/me'),
    update: (body) => request('/me/preferences', { method: 'PUT', body }),
    export: () => request('/me/export'),
    remove: () => request('/me', { method: 'DELETE' }),
    password: (body) => request('/me/password', { method: 'POST', body }),
    addPlace: (body) => request('/me/places', { method: 'POST', body }),
    removePlace: (id) => request(`/me/places/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  weather: (lat, lon, at) => request('/weather', { query: { lat, lon, at } }),  // at : départ d'un trajet à venir
  velibNear: (lat, lon, radius = 500, limit = 4) => request('/velib/near', { query: { lat, lon, radius_m: radius, limit } }),
  stopsNear: (lat, lon) => request('/stops/near', { query: { lat, lon } }),
  places: (group, lat, lon) => request('/places/near', { query: { group, lat, lon } }),
  rivers: () => request('/rivers'),
  coolNear: (lat, lon) => request('/cool/near', { query: { lat, lon } }),
  seine: () => request('/seine'),
  flood: () => request('/flood'),
  traffic: () => request('/traffic'),
  velibSummary: () => request('/velib/summary'),
  // Prochains passages d'une gare (zone de correspondance IDFM)
  departures: (zdc) => request(`/departures/${encodeURIComponent(`STIF:StopArea:SP:${zdc}:`)}`),
  geoSearch: (q) => request('/geo/search', { query: { q } }),
  trips: {
    plan: (body) => request('/trips/plan', { method: 'POST', body }),
    bundle: (trip) => request('/trips/bundle', { method: 'POST', body: { trip } }),
    live: (trip, nextLeg = 0) => request('/trips/live', { method: 'POST', body: { trip, next_leg: nextLeg } }),
  },
  reports: {
    near: (lat, lon) => request('/reports/near', { query: { lat, lon } }),
    add: (body) => request('/reports', { method: 'POST', body }),
    vote: (id, still) => request(`/reports/${encodeURIComponent(id)}/vote`, { method: 'POST', body: { still } }),
  },
  elevators: {
    summary: () => request('/elevators/summary'),
  },
  collectStatus: () => request('/collect/status'),
  admin: {
    stats: () => request('/admin/stats'),
    analysis: () => request('/admin/analysis'),
    insight: (topic) => request(`/admin/insights/${topic}`),
    dataHealth: () => request('/admin/data-health'),
    collect: () => request('/admin/collect'),
    users: (q, skip = 0) => request('/admin/users', { query: { q, skip, limit: 50 } }),
    setRole: (id, role) => request(`/admin/users/${encodeURIComponent(id)}/role`, { method: 'PUT', body: { role } }),
    remove: (id) => request(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    log: () => request('/admin/log'),
    gtfsRefresh: () => request('/admin/gtfs-refresh', { method: 'POST' }),
  },
}
