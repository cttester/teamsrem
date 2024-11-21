#!/usr/bin/env python3

import time
import requests
from datetime import datetime, timedelta


def send(url: str, data: dict):
    adaptive_card = {
        "type": "Message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "version": "1.5",
                    "type": "AdaptiveCard",
                    "body": [
                        {
                            "type": "TextBlock",
                            "size": "large",
                            "weight": "bold",
                            "text": data["title"],
                            "style": "heading",
                            "wrap": True,
                        },
                        {"type": "TextBlock", "text": data["message"], "wrap": True},
                        {
                            "type": "FactSet",
                            "facts": [
                                {
                                    "title": "Datum",
                                    "value": data["begin_datetime"].strftime("%d.%m.%Y"),
                                },
                                {
                                    "title": "Beginn",
                                    "value": data["begin_datetime"].strftime("%H:%M"),
                                },
                                {
                                    "title": "Ende",
                                    "value": data["end_datetime"].strftime("%H:%M"),
                                },
                                {
                                    "title": "Ort",
                                    "value": "Teams",
                                },
                            ],
                        },
                    ],
                    "actions": [
                        {
                            "type": "Action.OpenUrl",
                            "title": "Meeting-Kanal öffnen",
                            "url": data["channel_url"],
                        }
                    ],
                },
            }
        ],
    }
    response = requests.post(url, json=adaptive_card, headers={"Content-Type": "application/json"})
    if response.ok:
        print("Erinnerung erfolgreich gesendet.")
    else:
        print(f"""Senden der Erinnerung fehlgeschlagen mit dem HTTP-Status-Code {response.status_code}: '{response.text}'""")


WEBHOOK_URL = "https://prod-38.westeurope.logic.azure.com:443/workflows/3a07d82974844022b0f22f2852df2229/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=mo8GgPYb-4MSX1IquVZlFZOs-AhyWQGhN0WxquqM-eI"

def main():
    appointment_data = {
        "begin_datetime": datetime.fromisoformat("2024-10-30T14:30:00"),
        "end_datetime": datetime.fromisoformat("2024-10-30T15:00:00"),
        "title": "Ressortmeeting",
        "message": "Unser kommendes Meeting wird wegen des Feiertags auf Mittwoch vorgezogen. Neuer Termin:",
        "channel_url": "https://teams.microsoft.com/l/channel/19%3A792962d748e64fc5b2da1edb61cbdc55%40thread.tacv2/General?groupId=98281a40-c89f-416d-b8f1-47ed5354401d&tenantId=30b24132-0c65-4261-ac6f-79103eb03e71",
    }

    reminder_dt = sorted([
        timedelta(seconds=30),
        timedelta(minutes=10),
        timedelta(hours=1),
        timedelta(days=1),
    ], reverse=True)

    while reminder_dt:
        dt = appointment_data["begin_datetime"] - datetime.now()
        days, remainder = divmod(dt.seconds, 60 * 60 * 24)
        dt_str = []
        if days:
            dt_str.append(f"""{days} {"Tag" if hours == 1 else "Tage"}""")
        hours, remainder = divmod(remainder, 60 * 60)
        if hours:
            dt_str.append(f"""{hours} {"Stunde" if hours == 1 else "Stunden"}""")
        mins, remainder = divmod(remainder, 60)
        if mins:
            dt_str.append(f"""{mins} {"Minute" if mins == 1 else "Minuten"}""")
        print(f"""{", ".join(dt_str)} bis zum Termin""")
        if dt > reminder_dt[0]:
            time.sleep(5)
            continue

        send(WEBHOOK_URL, appointment_data)
        reminder_dt.pop(0)


if __name__ == "__main__":
    main()
