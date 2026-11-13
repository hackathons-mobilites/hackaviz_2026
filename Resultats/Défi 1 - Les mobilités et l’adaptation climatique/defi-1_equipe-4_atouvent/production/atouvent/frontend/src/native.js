// Application Android (Capacitor) : comportements propres au téléphone.
import { Capacitor } from '@capacitor/core'

export async function setupNative(navigate) {
  if (!Capacitor.isNativePlatform()) return
  const { App } = await import('@capacitor/app')
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && window.location.pathname !== '/') navigate(-1)
    else App.exitApp()
  })
  try {
    const { Geolocation } = await import('@capacitor/geolocation')
    const perm = await Geolocation.checkPermissions()
    if (perm.location !== 'granted') await Geolocation.requestPermissions()
  } catch { /* refus : l'application reste utilisable avec une adresse saisie */ }
}
