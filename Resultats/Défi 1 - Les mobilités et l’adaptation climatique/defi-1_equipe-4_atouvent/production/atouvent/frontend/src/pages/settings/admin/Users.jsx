// Comptes et rôles (super admin) : recherche par adresse, rôle, profil de déplacement (oui ou non, jamais le détail : donnée de santé), création et dernière connexion, suppression avec confirmation.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import { useI18n } from '../../../i18n/index.jsx'

const ROLES = ['user', 'admin']

export default function Users() {
  const { t, err, date } = useI18n()
  const [q, setQ] = useState('')
  const [data, setData] = useState({ total: 0, items: [] })
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const load = useCallback((skip = 0) => {
    api.admin.users(q, skip)
      .then((r) => setData((d) => ({ total: r.total, items: skip ? [...d.items, ...r.items] : r.items })))
      .catch((x) => setError(err(x.code)))
  }, [q, err])

  useEffect(() => {
    const id = setTimeout(() => load(0), 300) // attend la fin de la frappe
    return () => clearTimeout(id)
  }, [load])

  const setRole = (u, role) => {
    if (!window.confirm(t('admin.role_confirm', { email: u.email, role: t(`admin.role_${role}`) }))) return
    api.admin.setRole(u.id, role)
      .then((nu) => { setData((d) => ({ ...d, items: d.items.map((x) => (x.id === nu.id ? nu : x)) })); setStatus(t('admin.role_done', { email: u.email })) })
      .catch((x) => setError(err(x.code)))
  }

  const remove = (u) => {
    if (!window.confirm(t('admin.delete_confirm', { email: u.email }))) return
    api.admin.remove(u.id)
      .then(() => { setData((d) => ({ total: d.total - 1, items: d.items.filter((x) => x.id !== u.id) })); setStatus(t('admin.deleted', { email: u.email })) })
      .catch((x) => setError(err(x.code)))
  }

  return (
    <section className="card" aria-labelledby="users-title">
      <h2 id="users-title">{t('admin.users')}</h2>
      {error && <p className="field__error" role="alert">{error}</p>}
      <div className="field">
        <label htmlFor="admin-q">{t('admin.search')}</label>
        <input id="admin-q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="card__meta" role="status">{status || t('admin.total', { n: data.total })}</p>
      <ul className="list">
        {data.items.map((u) => (
          <li key={u.id} className="list__item admin-user">
            <strong>{u.email}</strong>
            <span className="card__meta">
              {[u.created_at && t('admin.created', { date: date(u.created_at) }),
                t('admin.last_login', { date: u.last_login_at ? date(u.last_login_at) : t('admin.never') }),
                t(u.has_profile ? 'admin.has_profile' : 'admin.no_profile')].filter(Boolean).join(' · ')}
            </span>
            {u.role === 'superadmin' ? (
              <span className="badge badge--ok">{t('admin.role_superadmin')}</span>
            ) : (
              <div className="admin-user__actions">
                <select className="input" aria-label={t('admin.role', { email: u.email })} value={u.role}
                  onChange={(e) => setRole(u, e.target.value)}>
                  {ROLES.map((r) => <option key={r} value={r}>{t(`admin.role_${r}`)}</option>)}
                </select>
                <button type="button" className="btn btn--danger" onClick={() => remove(u)}>{t('admin.delete', { email: u.email })}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {data.items.length < data.total && (
        <button type="button" className="btn btn--ghost btn--block" onClick={() => load(data.items.length)}>{t('admin.more')}</button>
      )}
    </section>
  )
}
