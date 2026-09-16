"""SMTP delivery for the research digest."""

# TODO: not yet verified against a real inbox — SMTP_HOST/PORT/USER/PASSWORD
# aren't in agent/.env yet. Run `python -m agent --topic ai-engineering`
# (Task 6 Step 5 in docs/superpowers/plans/2026-08-12-research-agent.md)
# once they are, and check hypnosisflow@gmail.com for the digest.

from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage

from agent.config import Settings


def send(subject: str, body: str, settings: Settings) -> None:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.delivery.from_
    message["To"] = settings.delivery.to
    message.set_content(body)

    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ["SMTP_USER"]
    password = os.environ["SMTP_PASSWORD"]

    with smtplib.SMTP(host, port) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.send_message(message)
