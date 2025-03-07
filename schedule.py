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
                                    "title": "Begin",
                                    "value": data["begin_datetime"].strftime("%H:%M"),
                                },
                                {
                                    "title": "Einde",
                                    "value": data["end_datetime"].strftime("%H:%M"),
                                },
                                {
                                    "title": "Locatie",
                                    "value": "Teams",
                                },
                            ],
                        },
                    ],
                    "actions": [
                        {
                            "type": "Action.OpenUrl",
                            "title": "Meeting-kanaal openen",
                            "url": data["channel_url"],
                        }
                    ],
                },
            }
        ],
    }
    response = requests.post(url, json=adaptive_card, headers={"Content-Type": "application/json"})
    if response.ok:
        print("Herinnering verzenden geslaagd.")
    else:
        print(f"""Herinnerung verzenden mislukt met HTTP-status-code {response.status_code}: '{response.text}'""")


WEBHOOK_URL = "https://prod-38.westeurope.logic.azure.com:443/workflows/WORKFLOW-ID/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=ACCESS-ID"

def main():
    appointment_data = {
        "begin_datetime": datetime.fromisoformat("2025-10-30T14:30:00"),
        "end_datetime": datetime.fromisoformat("2025-10-30T15:00:00"),
        "title": "Planvergadering",
        "message": "Onze aankomende meeting verschuift wegens feestdagen naar woensdag. Nieuwe afspraak:",
        "channel_url": "https://teams.microsoft.com/l/channel/...",
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
            dt_str.append(f"""{days} {"dag" if hours == 1 else "dagen"}""")
        hours, remainder = divmod(remainder, 60 * 60)
        if hours:
            dt_str.append(f"""{hours} {"uur" if hours == 1 else "uren"}""")
        mins, remainder = divmod(remainder, 60)
        if mins:
            dt_str.append(f"""{mins} {"minuut" if mins == 1 else "minuten"}""")
        print(f"""{", ".join(dt_str)} tot de afspraak""")
        if dt > reminder_dt[0]:
            time.sleep(5)
            continue

        send(WEBHOOK_URL, appointment_data)
        reminder_dt.pop(0)


if __name__ == "__main__":
    main()
