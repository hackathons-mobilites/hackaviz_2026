// Vue d'ensemble : comptes (total, profils de déplacement, nouveaux, actifs), rôles, signalements des dernières 24 h.
import { useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import { useI18n } from '../../../i18n/index.jsx'

export default function Overview() {
  const { t, err } = useI18n()
  const [s, setS] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api.admin.stats().then(setS).catch((x) => setError(err(x.code))) }, [err])

  if (error) return <p className="field__error" role="alert">{error}</p>
  if (!s) return <p className="loading" role="status">{t('app.loading')}</p>
  const tiles = [
    [t('admin.k_users'), s.users], [t('admin.k_profile'), s.with_profile], [t('admin.k_new'), s.new_7d],
    [t('admin.k_active'), s.active_30d], [t('admin.k_reports'), s.reports_24h],
  ]
  return (
    <section className="card" aria-labelledby="overview-title">
      <h2 id="overview-title">{t('admin.overview')}</h2>
      <dl className="admin-kpis">
        {tiles.map(([label, n]) => (
          <div key={label} className="admin-kpi"><dt>{label}</dt><dd>{n}</dd></div>
        ))}
      </dl>
      <ul className="tags" aria-label={t('admin.roles')}>
        {Object.entries(s.roles).map(([role, n]) => <li key={role} className="badge badge--info">{t(`admin.role_${role}`)} · {n}</li>)}
      </ul>
    </section>
  )
}
