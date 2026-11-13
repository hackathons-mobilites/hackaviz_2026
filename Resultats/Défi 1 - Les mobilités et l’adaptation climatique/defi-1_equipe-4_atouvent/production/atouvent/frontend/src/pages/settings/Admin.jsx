// Administration (admins et super admin).
import PageHead from '../../components/PageHead.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useI18n } from '../../i18n/index.jsx'
import AdminLog from './admin/AdminLog.jsx'
import CollectStatus from './admin/CollectStatus.jsx'
import GtfsRefresh from './admin/GtfsRefresh.jsx'
import Overview from './admin/Overview.jsx'
import Users from './admin/Users.jsx'

export default function Admin() {
  const { t } = useI18n()
  const { user } = useAuth()
  const superadmin = user.role === 'superadmin'
  return (
    <>
      <PageHead title={t('admin.title')} />
      <main id="contenu" className="app-main app-main--wide admin">
        <p className="card__meta">{t(superadmin ? 'admin.intro_super' : 'admin.intro')}</p>
        <Overview />
        <CollectStatus />
        {superadmin && <GtfsRefresh />}
        {superadmin && <Users />}
        {superadmin && <AdminLog />}
      </main>
    </>
  )
}
