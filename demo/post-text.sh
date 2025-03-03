#!/bin/bash

source .env
curl  -d "@$1" \
  --header "Content-Type: application/json" \
  --request POST \
  "${WEBHOOK_URL}"