// Chargement de MapLibre (une seule fois, à la demande) avec son fichier de calcul en arrière-plan (worker).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

let loading
export function loadMaplibre() {
  loading ??= import('maplibre-gl').then((mod) => {
    const maplibregl = mod.default ?? mod  // module ESM sans export par défaut
    maplibregl.setWorkerUrl(new URL(workerUrl, window.location.href).href)
    return maplibregl
  })
  return loading
}
