"""Envoi d'e-mails par SMTP (confirmation de l'adresse, réinitialisation du mot de passe, invitation super admin)."""
from __future__ import annotations

import html
import logging
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

from ..core.config import settings

log = logging.getLogger("atouvent.mail")
LOGO = Path(__file__).resolve().parents[1] / "assets" / "logo-mail.png"
BUTTON = {"password": {"fr": "Choisir mon mot de passe", "en": "Choose my password"},
          "verify": {"fr": "Confirmer mon adresse", "en": "Confirm my address"}}
FOOTER = {"fr": "AtouVent · se déplacer en Île-de-France malgré les aléas climatiques.\nMessage automatique, merci de ne pas y répondre.",
          "en": "AtouVent · getting around Île-de-France despite climate hazards.\nAutomatic message, please do not reply."}

# Textes par langue (le français sert de repli)
TEXTS = {
    "fr": {
        "reset_subject": "AtouVent · Réinitialiser votre mot de passe",
        "reset_body": "Bonjour,\n\nPour choisir un nouveau mot de passe AtouVent, ouvrez ce lien (valable {minutes} minutes) :\n{link}\n\n"
                      "Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.\n\nL'équipe AtouVent",
        "verify_subject": "AtouVent · Confirmez votre adresse e-mail",
        "verify_body": "Bonjour,\n\nPour activer votre compte AtouVent, confirmez votre adresse e-mail en ouvrant ce lien (valable {hours} heures) :\n{link}\n\n"
                       "Si vous n'avez pas créé de compte, ignorez ce message : aucun compte ne sera activé.\n\nL'équipe AtouVent",
        "invite_subject": "AtouVent · Votre compte administrateur",
        "invite_body": "Bonjour,\n\nUn compte super administrateur AtouVent a été créé pour {email}.\n"
                       "Choisissez votre mot de passe en ouvrant ce lien (valable {hours} heures) :\n{link}\n\nL'équipe AtouVent",
    },
    "en": {
        "reset_subject": "AtouVent · Reset your password",
        "reset_body": "Hello,\n\nTo choose a new AtouVent password, open this link (valid for {minutes} minutes):\n{link}\n\n"
                      "If you did not ask for this, ignore this message: your password is unchanged.\n\nThe AtouVent team",
        "verify_subject": "AtouVent · Confirm your e-mail address",
        "verify_body": "Hello,\n\nTo activate your AtouVent account, confirm your e-mail address by opening this link (valid for {hours} hours):\n{link}\n\n"
                       "If you did not create an account, ignore this message: no account will be activated.\n\nThe AtouVent team",
        "invite_subject": "AtouVent · Your administrator account",
        "invite_body": "Hello,\n\nA super administrator AtouVent account was created for {email}.\n"
                       "Choose your password by opening this link (valid for {hours} hours):\n{link}\n\nThe AtouVent team",
    },
}


def text(lang: str, key: str, **params) -> str:
    return (TEXTS.get(lang) or TEXTS["fr"])[key].format(**params)


def render_html(body: str, lang: str, logo_cid: str, button_kind: str = "password") -> str:
    """Version HTML : en-tête nuit avec le logo, paragraphes, le lien devient un bouton (tableaux et styles en ligne pour les lecteurs de messagerie)."""
    url = re.search(r"https?://\S+", body)
    paras = []
    for block in body.split("\n\n"):
        lines = [l for l in block.split("\n") if not (url and l.strip() == url.group(0))]
        if lines:
            paras.append("<br>".join(html.escape(l) for l in lines))
    button = ""
    labels = BUTTON.get(button_kind, BUTTON["password"])
    if url:
        u = html.escape(url.group(0), quote=True)
        button = (f'<tr><td style="padding:8px 32px 8px"><a href="{u}" style="display:inline-block;background:#1A5C96;color:#FFFFFF;'
                  f'font-weight:700;font-size:16px;text-decoration:none;padding:14px 24px;border-radius:10px">'
                  f'{html.escape(labels.get(lang, labels["fr"]))}</a></td></tr>'
                  f'<tr><td style="padding:4px 32px 16px;font-size:12px;color:#4A5A70;word-break:break-all">{u}</td></tr>')
    # Le bouton se place après le premier paragraphe (celui qui annonce le lien)
    first, rest = paras[:2], paras[2:]
    p = lambda t: f'<tr><td style="padding:8px 32px;font-size:16px;line-height:1.5;color:#0F1B2D">{t}</td></tr>'
    footer = "<br>".join(html.escape(l) for l in FOOTER.get(lang, FOOTER["fr"]).split("\n"))
    return f"""<!doctype html><html lang="{lang}"><body style="margin:0;background:#F2F4F7;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F4F7;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden">
<tr><td style="background:#0F1B2D;padding:22px 32px"><img src="cid:{logo_cid}" width="180" alt="AtouVent" style="display:block;border:0;width:180px;height:auto"></td></tr>
<tr><td style="height:6px;background:#F28B5B;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="height:16px"></td></tr>
{"".join(p(t) for t in first)}{button}{"".join(p(t) for t in rest)}
<tr><td style="padding:24px 32px;font-size:12px;line-height:1.5;color:#4A5A70;border-top:1px solid #DCE2EA">{footer}</td></tr>
</table></td></tr></table></body></html>"""


def build_message(to: str, subject: str, body: str, lang: str = "fr", button: str = "password") -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr(("AtouVent", settings.smtp_from))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=settings.smtp_from.split("@")[-1] or None)
    msg.set_content(body)
    cid = make_msgid(domain="atouvent")
    msg.add_alternative(render_html(body, lang, cid[1:-1], button), subtype="html")
    if LOGO.exists():
        msg.get_payload()[1].add_related(LOGO.read_bytes(), "image", "png", cid=cid, filename="atouvent.png")
    return msg


def send(to: str, subject: str, body: str, lang: str = "fr", button: str = "password") -> bool:
    """Envoie un e-mail (texte + HTML avec logo). Ne lève jamais d'exception : renvoie False en cas d'échec."""
    if not settings.smtp_host:
        log.warning("SMTP non configuré : e-mail non envoyé à %s (%s)\n%s", to, subject, body)
        return False
    msg = build_message(to, subject, body, lang, button)
    try:
        ctx = ssl.create_default_context()
        if settings.smtp_ssl:
            server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=ctx, timeout=20)
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20)
            server.starttls(context=ctx)
        with server:
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        return True
    except (smtplib.SMTPException, OSError) as exc:
        log.error("Échec d'envoi à %s : %s", to, exc)
        return False


def verify_link(token: str) -> str:
    return f"{settings.app_url}/confirmer-email#{token}"


def reset_link(token: str) -> str:
    return f"{settings.app_url}/mot-de-passe/nouveau#{token}"
