from dotenv import dotenv_values
import os
from utils.mailing.pymail import Credentials, MailClient
from fastapi import HTTPException


env_file_path = os.path.dirname(os.path.abspath(os.path.dirname(__file__)))
env_config = dotenv_values(".env")
credentials = Credentials(
        env_config.get("MAILING_ACCOUNT_EMAIL"),
        env_config.get("MAILING_ACCOUNT_PASSWORD"),
        )
config = {
        "smtp": {
                "server": env_config.get("MAILING_SMTP_SERVER"),
                "port": env_config.get("MAILING_SMTP_PORT"),
                "timeout": int(float(str(env_config.get("MAILING_SMTP_TIMEOUT"))))
            }
        }


class MyMailClient:
    def __init__(self) -> None:
        self.m = MailClient(
            credentials,
            config,
            silent=True,
            initialize_imap=False
            )

    def reinit(self):
        self.m = MailClient(
            credentials,
            config,
            silent=True,
            initialize_imap=False
            )

mail_is_not_started = False
try:
    m = MyMailClient()
except Exception as e:
    print(env_config.get("MAILING_ACCOUNT_PASSWORD"))
    if not env_config.get("MAILING_ACCOUNT_PASSWORD"):
        raise
    mail_is_not_started = True
    print(e)

async def send_mail(subject:str, to:str, content:str, content_type:str="html"):
    if mail_is_not_started:
        raise HTTPException(500, "Mail service is not working")
    try:
        msg = m.m._setup_message(
            to=to,
            subject=subject,
            content=content,
            content_type=content_type
            )
        m.m._send_mail(msg)
    except Exception as e:
        m.reinit()
        m.m._send_mail(msg)
    # TODO add logging of sent mails and exception handling

