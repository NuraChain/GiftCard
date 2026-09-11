#!/bin/bash

set -euo pipefail

# shellcheck source=./service.env
. "$(dirname "$0")/service.env"

systemctl stop "$SERVICE_NAME"
