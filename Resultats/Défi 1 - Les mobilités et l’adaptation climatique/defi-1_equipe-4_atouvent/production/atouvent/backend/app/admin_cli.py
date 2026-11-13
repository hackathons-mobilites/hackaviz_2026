"""Commandes d'administration.
python -m app.admin_cli create-superadmin prenom.nom@exemple.fr"""
from __future__ import annotations

import secrets
import sys
from datetime import datetime, timezone

from .core import security as sec
from .core.config import check_secrets
from .core.db import get_db, init_db
from .services import mailer


def create_superadmin(db, email: str, send_email: bool = True, hours: int = 48) -> str:
    email = email.strip().lower()
    user = db.users.find_one({"email": email})
    if user:
        db.users.update_one({"_id": user["_id"]}, {"$set": {"role": "superadmin"}})
    else:
        # Mot de passe aléatoire jamais communiqué : le super admin choisit le sien via le lien
        db.users.insert_one({"email": email, "password": sec.hash_password(secrets.token_urlsafe(32)), "language": "fr",
                             "created_at": datetime.now(timezone.utc), "alerts": [], "offline": True,
                             "role": "superadmin", "token_version": 0})
    user = db.users.find_one({"email": email})
    link = mailer.reset_link(sec.make_reset_token(user, minutes=hours * 60))
    body = mailer.text("fr", "invite_body", email=email, link=link, hours=hours)
    if send_email and mailer.send(email, mailer.text("fr", "invite_subject"), body):
        return f"Super admin {email} prêt. Lien envoyé par e-mail (valable {hours} h)."
    return f"Super admin {email} prêt. E-mail non envoyé : lien à transmettre (valable {hours} h) :\n{link}"


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] != "create-superadmin":
        print(__doc__)
        return 1
    check_secrets()
    hours = int(argv[argv.index("--hours") + 1]) if "--hours" in argv else 48
    db = get_db()
    init_db(db)
    print(create_superadmin(db, argv[1], send_email="--no-email" not in argv, hours=hours))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
