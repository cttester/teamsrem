#!/bin/bash

JSON="{
  \"type\": \"Message\",
  \"attachments\": [
    {
      \"contentType\": \"application/vnd.microsoft.card.adaptive\",
      \"content\": {
        \"$schema\": \"http://adaptivecards.io/schemas/adaptive-card.json\",
        \"version\": \"1.5\",
        \"type\": \"AdaptiveCard\",
        \"body\": [
          {
            \"type\": \"TextBlock\",
            \"size\": \"large\",
            \"weight\": \"bold\",
            \"text\": \"resops-Meeting\",
            \"style\": \"heading\",
            \"wrap\": true
          },
          {
            \"type\": \"TextBlock\",
            \"text\": \"Das nächste resops-Meeting wird wegen des Feiertags auf Mittwoch vorgezogen. Neuer Termin:\",
            \"wrap\": true
          },
          {
            \"type\": \"FactSet\",
            \"facts\": [
              {
                \"title\": \"Datum\",
                \"value\": \"30.10.2024\"
              },
              {
                \"title\": \"Uhrzeit\",
                \"value\": \"15:30\"
              },
              {
                \"title\": \"Ort\",
                \"value\": \"Teams\"
              }
            ]
          }
        ],
        \"actions\": [
          {
            \"type\": \"Action.OpenUrl\",
            \"title\": \"Meeting-Kanal öffnen\",
            \"url\": \"https://teams.microsoft.com/l/channel/19%3A792962d748e64fc5b2da1edb61cbdc55%40thread.tacv2/General?groupId=98281a40-c89f-416d-b8f1-47ed5354401d&tenantId=30b24132-0c65-4261-ac6f-79103eb03e71\"
          }
        ]
      }
    }
  ]
}"

echo "${JSON}"

# WEBHOOK_URL="https://prod-138.westeurope.logic.azure.com:443/workflows/3d35e252f7ba402d80b196108ad2ba66/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=SvTYN0J9QVvwJvkOog4IiM0AehofieGS7Dblk4NESSI"
WEBHOOK_URL="https://prod-38.westeurope.logic.azure.com:443/workflows/3a07d82974844022b0f22f2852df2229/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=mo8GgPYb-4MSX1IquVZlFZOs-AhyWQGhN0WxquqM-eI"

curl \
  --header "Content-Type: application/json" \
  --request POST \
  --data "${JSON}" \
  "${WEBHOOK_URL}"

