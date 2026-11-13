// 00 · Choix de la langue, proposé dès la première ouverture (en français et dans la langue du téléphone)
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BrandHead from '../components/BrandHead.jsx'
import Icon from '../components/Icon.jsx'
import { detectLanguage, LANGUAGES, translate, useI18n } from '../i18n/index.jsx'

export default function Language() {
  const { lang, setLang } = useI18n()
  const [choice, setChoice] = useState(lang)
  const navigate = useNavigate()
  const { state } = useLocation()
  const detected = detectLanguage()
  // Deuxième langue de l'accueil : celle du téléphone, sinon l'anglais
  const other = detected === 'fr' ? 'en' : detected
  const tr = (k, p) => translate(choice, k, p)

  const submit = (e) => {
    e.preventDefault()
    setLang(choice)
    navigate(state?.from || '/', { replace: true })
  }

  return (
    <div className="app app--plain">
      <BrandHead
        title={<>{translate('fr', 'lang.welcome')} · <span lang={other}>{translate(other, 'lang.welcome')}</span></>}
        subtitle={<>{translate('fr', 'lang.title')} · <span lang={other}>{translate(other, 'lang.title')}</span></>} />
      <main id="contenu" className="app-main lang-main" lang={choice}>
        <form onSubmit={submit} className="lang-form">
          <p className="info-chip" role="status">
            <Icon name="phone" size={20} />
            <span>{tr('lang.detected', { name: '' })}<strong lang={detected}>{LANGUAGES.find((l) => l.code === detected)?.name}</strong></span>
          </p>
          <fieldset>
            <legend className="sr-only">{tr('lang.title')}</legend>
            {LANGUAGES.map((l) => (
              <label key={l.code} className="choice lang-choice" lang={l.code}>
                <input type="radio" name="lang" value={l.code} checked={choice === l.code} onChange={() => setChoice(l.code)} />
                <span className="lang-choice__name">
                  <span>{l.name}</span>
                  {l.code !== choice && <small lang={choice}>{tr(`lang.name.${l.code}`)}</small>}
                </span>
                <span className="lang-choice__code" aria-hidden="true">{l.code.toUpperCase()}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className="btn btn--primary btn--block btn--lg lang-form__submit">{tr('lang.continue')}</button>
          <p className="footnote">{tr('lang.hint')}</p>
        </form>
      </main>
    </div>
  )
}
