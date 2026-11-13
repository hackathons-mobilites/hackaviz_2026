// État de chaque collecte de données sur 7 jours : à jour, en retard ou en échec (toujours écrit, jamais la couleur seule), dernier relevé réussi, taux de réussite et dernière erreur.
import { useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import Icon from '../../../components/Icon.jsx'
import DataTable from '../../../components/data/DataTable.jsx'
import { useI18n } from '../../../i18n/index.jsx'

const STATE_ICON = { ok: 'check', late: 'clock', failing: 'alert' }

export default function CollectStatus() {
  const { t, time, date } = useI18n()
  const [rows, setRows] = useState(null)
  useEffect(() => {
    api.admin.collect().then((r) => setRows(Object.entries(r).map(([source, s]) => ({ id: source, source, ...s })))).catch(() => setRows([]))
  }, [])
  const when = (v) => (v ? `${date(v)} ${time(v)}` : '—')
  const columns = [
    { key: 'source', label: t('admin.c_source'), row: true, format: (v) => t(`admin.src_${v}`) },
    { key: 'state', label: t('admin.c_state'), format: (v) => (
      <span className={`admin-state admin-state--${v}`}><Icon name={STATE_ICON[v]} size={16} /> {t(`admin.state_${v}`)}</span>) },
    { key: 'last_ok', label: t('admin.c_last_ok'), format: when },
    { key: 'success_rate', label: t('admin.c_rate'), num: true, format: (v, r) => `${v} % (${r.ok}/${r.runs})` },
    { key: 'last_error', label: t('admin.c_error'), format: (v, r) => (v ? (
      <span className="admin-error">
        {r.recovered && <strong>{t('admin.recovered')} · </strong>}
        {when(r.last_error_at)} · <code>{String(v).slice(0, 80)}</code>
      </span>) : t('admin.no_error')) },
  ]
  return (
    <section className="card" aria-labelledby="collect-title">
      <h2 id="collect-title">{t('admin.collect')}</h2>
      <p className="card__meta">{t('admin.collect_sub')}</p>
      {rows === null ? <p className="loading" role="status">{t('app.loading')}</p>
        : <DataTable caption={t('admin.collect')} columns={columns} rows={rows} empty={t('admin.no_error')} />}
    </section>
  )
}
