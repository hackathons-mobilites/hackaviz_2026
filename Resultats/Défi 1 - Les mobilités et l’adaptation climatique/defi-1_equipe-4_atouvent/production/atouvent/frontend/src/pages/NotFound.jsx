import { Link } from 'react-router-dom'
import PageHead from '../components/PageHead.jsx'
import { useI18n } from '../i18n/index.jsx'

export default function NotFound() {
  const { t } = useI18n()
  return (
    <>
      <PageHead title={t('notfound.title')} />
      <main id="contenu" className="app-main">
        <Link className="btn btn--primary btn--block" to="/">{t('notfound.home')}</Link>
      </main>
    </>
  )
}
