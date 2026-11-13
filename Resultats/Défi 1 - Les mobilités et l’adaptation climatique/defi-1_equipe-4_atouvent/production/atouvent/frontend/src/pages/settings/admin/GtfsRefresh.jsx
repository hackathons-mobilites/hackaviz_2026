// Mise à jour immédiate des horaires IDFM (super admin) : normalement faite chaque nuit par le collecteur.
import { useState } from 'react'
import { api } from '../../../api/client.js'
import Icon from '../../../components/Icon.jsx'
import { useI18n } from '../../../i18n/index.jsx'

export default function GtfsRefresh() {
  const { t, err } = useI18n()
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const run = () => {
    if (!window.confirm(t('admin.gtfs_confirm'))) return
    setBusy(true)
    setStatus(t('admin.gtfs_running'))
    api.admin.gtfsRefresh()
      .then((r) => setStatus(t(r?.refreshed ? 'admin.gtfs_updated' : 'admin.gtfs_current')))
      .catch((x) => setStatus(err(x.code)))
      .finally(() => setBusy(false))
  }
  return (
    <section className="card" aria-labelledby="gtfs-title">
      <h2 id="gtfs-title">{t('admin.gtfs')}</h2>
      <p className="card__meta">{t('admin.gtfs_sub')}</p>
      <button type="button" className="btn btn--outline" onClick={run} disabled={busy}><Icon name="clock" size={18} /> {t('admin.gtfs_btn')}</button>
      {status && <p className="card__meta" role="status">{status}</p>}
    </section>
  )
}
