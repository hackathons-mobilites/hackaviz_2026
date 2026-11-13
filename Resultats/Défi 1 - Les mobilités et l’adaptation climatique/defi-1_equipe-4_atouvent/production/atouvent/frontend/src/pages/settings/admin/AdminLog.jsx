// Journal des actions d'administration (super admin) : qui a changé quel rôle ou supprimé quel compte, et quand.
import { useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import DataTable from '../../../components/data/DataTable.jsx'
import { useI18n } from '../../../i18n/index.jsx'

export default function AdminLog() {
  const { t, date, time } = useI18n()
  const [rows, setRows] = useState(null)
  useEffect(() => { api.admin.log().then((r) => setRows(r.map((e, i) => ({ id: i, ...e })))).catch(() => setRows([])) }, [])
  const columns = [
    { key: 'at', label: t('admin.l_when'), row: true, format: (v) => `${date(v)} ${time(v)}` },
    { key: 'by', label: t('admin.l_by') },
    { key: 'action', label: t('admin.l_action'), format: (v, r) => `${t(`admin.action_${v}`)}${r.detail ? ` (${r.detail})` : ''}` },
    { key: 'target', label: t('admin.l_target') },
  ]
  return (
    <section className="card" aria-labelledby="log-title">
      <h2 id="log-title">{t('admin.log')}</h2>
      {rows === null ? <p className="loading" role="status">{t('app.loading')}</p>
        : <DataTable caption={t('admin.log')} columns={columns} rows={rows} empty={t('admin.log_empty')} />}
    </section>
  )
}
