// Navigation principale : 4 entrées, toujours au même endroit
import { NavLink } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { NAV } from '../routes.jsx'
import Icon from './Icon.jsx'

export default function BottomNav() {
  const { t } = useI18n()
  return (
    <nav className="bottom-nav" aria-label={t('nav.main')}>
      <ul>
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.to === '/'}>
              <Icon name={item.icon} size={24} />
              <span>{t(item.label)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
