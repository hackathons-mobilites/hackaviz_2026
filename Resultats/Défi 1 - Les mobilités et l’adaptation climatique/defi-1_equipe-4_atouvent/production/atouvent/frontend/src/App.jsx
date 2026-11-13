// Assemblage : fournisseurs de contexte + routeur
import { Suspense } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Splash from './components/Splash.jsx'
import { AnnouncerProvider } from './context/AnnouncerContext.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { PrefsProvider } from './context/PrefsContext.jsx'
import { I18nProvider, useI18n } from './i18n/index.jsx'
import { routes } from './routes.jsx'

const router = createBrowserRouter(routes)

// Chaque page commence en haut : nouvelle page, retour arrière et rechargement (sauf lien vers une section #…)
if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
let lastPath = router.state.location.pathname
router.subscribe(({ location }) => {
  if (location.pathname === lastPath) return
  lastPath = location.pathname
  if (location.hash) return
  window.scrollTo(0, 0)
  // Page chargée à la demande : on recommence une fois affichée
  requestAnimationFrame(() => window.scrollTo(0, 0))
})

function Fallback() {
  const { t } = useI18n()
  return <p className="loading" role="status" style={{ padding: 24 }}>{t('app.loading')}</p>
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <PrefsProvider>
          <AnnouncerProvider>
            {/* Logo animé à chaque ouverture de l'application */}
            <Splash />
            <Suspense fallback={<Fallback />}>
              <RouterProvider router={router} />
            </Suspense>
          </AnnouncerProvider>
        </PrefsProvider>
      </AuthProvider>
    </I18nProvider>
  )
}
