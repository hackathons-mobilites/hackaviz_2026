"""E-mails : version texte et version HTML avec le logo intégré et le lien en bouton."""
from app.services import mailer


def test_message_has_text_html_and_inline_logo():
    body = mailer.text("fr", "reset_body", link="https://atouvent.com/mot-de-passe/nouveau#abc", minutes=30)
    msg = mailer.build_message("a@exemple.fr", "Sujet", body, "fr")
    text = msg.get_body(("plain",)).get_content()
    html = msg.get_body(("html",)).get_content()
    assert "https://atouvent.com/mot-de-passe/nouveau#abc" in text
    assert 'href="https://atouvent.com/mot-de-passe/nouveau#abc"' in html and "Choisir mon mot de passe" in html
    logo = next(p for p in msg.walk() if p.get_content_type() == "image/png")
    assert f"cid:{logo['Content-ID'][1:-1]}" in html
