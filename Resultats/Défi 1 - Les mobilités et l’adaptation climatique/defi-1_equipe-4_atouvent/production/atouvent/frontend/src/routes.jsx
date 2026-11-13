// Table des routes de l'application (une route = un écran de la maquette)
import { lazy } from 'react'
import Layout from './components/Layout.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import DataLayout from './pages/data/DataLayout.jsx'

// Chargement à la demande : l'écran d'accueil s'ouvre plus vite
const Language = lazy(() => import('./pages/Language.jsx'))
const Login = lazy(() => import('./pages/auth/Login.jsx'))
const Register = lazy(() => import('./pages/auth/Register.jsx'))
const RegisterProfile = lazy(() => import('./pages/auth/RegisterProfile.jsx'))
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword.jsx'))
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword.jsx'))
const VerifyEmail = lazy(() => import('./pages/auth/VerifyEmail.jsx'))
const ConfirmEmail = lazy(() => import('./pages/auth/ConfirmEmail.jsx'))
const Around = lazy(() => import('./pages/Around.jsx'))
const Itineraries = lazy(() => import('./pages/trip/Itineraries.jsx'))
const Trip = lazy(() => import('./pages/trip/Trip.jsx'))
const Accessibility = lazy(() => import('./pages/settings/Accessibility.jsx'))
const Alerts = lazy(() => import('./pages/settings/Alerts.jsx'))
const Account = lazy(() => import('./pages/settings/Account.jsx'))
const Admin = lazy(() => import('./pages/settings/Admin.jsx'))
const Analysis = lazy(() => import('./pages/data/Analysis.jsx'))
const Supervision = lazy(() => import('./pages/data/Supervision.jsx'))
const Forecast = lazy(() => import('./pages/data/Forecast.jsx'))
const NotFound = lazy(() => import('./pages/NotFound.jsx'))

// Entrées de la navigation basse
export const NAV = [
  { to: '/', label: 'nav.around', icon: 'around' },
  { to: '/trajet', label: 'nav.trip', icon: 'trip' },
  { to: '/compte', label: 'nav.account', icon: 'account' },
  { to: '/accessibilite', label: 'nav.a11y', icon: 'a11y' },
]

export const routes = [
  { path: '/bienvenue', element: <Language /> },                 // 00 Langue (première ouverture)
  {
    // Écrans décideurs : grand écran, sans navigation mobile
    element: <DataLayout />,
    children: [
      { path: '/donnees', element: <Analysis /> },                // 09 Analyse décideurs
      { path: '/donnees/supervision', element: <Supervision /> }, // 10 Supervision temps réel
      { path: '/donnees/prevision', element: <Forecast /> },      // 11 Prévision et risques
    ],
  },
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Around /> },                         // 03 Autour de moi
      { path: '/connexion', element: <Login /> },                 // 01 Connexion
      { path: '/inscription', element: <Register /> },            // 02 Créer un compte
      { path: '/inscription/profil', element: <RegisterProfile /> }, // 02b Profil de déplacement
      { path: '/inscription/confirmation', element: <VerifyEmail /> }, // e-mail de confirmation envoyé
      { path: '/confirmer-email', element: <ConfirmEmail /> },     // lien de confirmation reçu par e-mail
      { path: '/mot-de-passe-oublie', element: <ForgotPassword /> },
      { path: '/mot-de-passe/nouveau', element: <ResetPassword /> }, // lien reçu par e-mail
      { path: '/itineraires', element: <Itineraries /> },         // 04 Itinéraires
      { path: '/trajet', element: <Trip /> },                     // 05 / 05b Suivi (en ligne et hors ligne)
      { path: '/accessibilite', element: <Accessibility /> },     // 06 Accessibilité
      { path: '/alertes', element: <Alerts /> },                  // 07 Alertes
      { path: '/compte', element: <RequireAuth><Account /></RequireAuth> }, // 08 Compte et données
      { path: '/admin', element: <RequireAuth admin><Admin /></RequireAuth> }, // admins et super admin
      { path: '*', element: <NotFound /> },
    ],
  },
]
