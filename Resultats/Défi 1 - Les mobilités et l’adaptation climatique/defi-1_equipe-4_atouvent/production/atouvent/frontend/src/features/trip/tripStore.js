// Trajet en cours enregistré sur le téléphone (IndexedDB) : il survit à la perte du réseau et à la fermeture de l'application.
import { openDB } from 'idb'

const DB = 'atouvent'
const STORE = 'trajets'
const CURRENT = 'en-cours'

const db = () => openDB(DB, 1, { upgrade: (d) => d.createObjectStore(STORE) })

export async function saveTrip(bundle) {
  const record = { ...bundle, saved_at: new Date().toISOString(), delayMs: 0, announced: [] }
  await (await db()).put(STORE, record, CURRENT)
  return record
}

export async function loadTrip() {
  try {
    return (await (await db()).get(STORE, CURRENT)) || null
  } catch {
    return null
  }
}

// Mise à jour partielle (retard mesuré, annonces déjà faites)
export async function patchTrip(patch) {
  const d = await db()
  const cur = await d.get(STORE, CURRENT)
  if (cur) await d.put(STORE, { ...cur, ...patch }, CURRENT)
}

export async function clearTrip() {
  await (await db()).delete(STORE, CURRENT)
}
