#!/bin/bash
#
# Removes the unit. It does NOT touch server/data - the database holds unsold codes, which
# are money, and the order ledger, which is the record of what was sold to whom.

set -euo pipefail

# shellcheck source=./service.env
. "$(dirname "$0")/service.env"

SERVICE_DIR="${SERVICE_DIR:-/etc/systemd/system}"
SERVICE_FILE="$SERVICE_DIR/${SERVICE_NAME}.service"

echo "> Removing service (${SERVICE_FILE})..."

systemctl stop "$SERVICE_NAME" || true
systemctl disable "$SERVICE_NAME" || true

rm -f "$SERVICE_FILE"

systemctl daemon-reload

echo "> Service removed. server/data and server/logs were left alone."
