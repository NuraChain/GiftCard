#!/bin/bash

set -euo pipefail

# shellcheck source=./service.env
. "$(dirname "$0")/service.env"

systemctl restart "$SERVICE_NAME"
