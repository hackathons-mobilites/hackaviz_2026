// Accès sûr à localStorage (peut être bloqué en navigation privée)
export const storage = {
  get(key) {
    try { return localStorage.getItem(key) } catch { return null }
  },
  set(key, value) {
    try { localStorage.setItem(key, value) } catch { /* stockage indisponible */ }
  },
  remove(key) {
    try { localStorage.removeItem(key) } catch { /* stockage indisponible */ }
  },
  getJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
  },
  setJSON(key, value) {
    this.set(key, JSON.stringify(value))
  },
}
