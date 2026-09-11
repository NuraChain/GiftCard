#!/bin/bash
#
# Installs the API as a systemd unit and starts it.
#
# WHAT THIS PROCESS IS. It serves JSON under /api and nothing else. nginx serves the built
# client out of application/dist and proxies /api through to the port below - so this unit
# failing takes the shop's checkout down, and nginx failing takes the pages down. They are
# separate problems with separate logs.
#
# There is no build step for the server: Node 24 runs the TypeScript source directly. The
# CLIENT still has one, and the check below says so rather than letting nginx serve a 404.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$ROOT/server"

# shellcheck source=./service.env
. "$(dirname "$0")/service.env"

# Node runs the TypeScript source directly - there is nothing built to point at.
SERVICE_ENTRY="$SERVER_DIR/src/main.ts"

SERVICE_DIR="${SERVICE_DIR:-/etc/systemd/system}"
SERVICE_FILE="$SERVICE_DIR/${SERVICE_NAME}.service"

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

if [ -z "$NODE_BIN" ]; then
  echo "error: node binary not found (set NODE_BIN to override)" >&2
  exit 1
fi

# Running .ts without a build needs Node 24. On 22 the service starts, fails with
# "Unknown file extension .ts", and systemd restarts it forever - so it is caught here
# instead, where the message can say what is actually wrong.
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "error: node $("$NODE_BIN" -v) is too old - this runs TypeScript directly and needs >= 24" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "error: writing the unit file needs root - re-run with sudo" >&2
  exit 1
fi

# The client is served by nginx, not by this process. A missing build is not fatal to the
# API, so this warns rather than exits - the checkout would work and every page would 404.
if [ ! -f "$ROOT/application/dist/index.html" ]; then
  echo "warning: application/dist/index.html is missing - run 'npm run build' so nginx has pages to serve" >&2
fi

# Every value in .env has a working default, so the API boots without one. What it will NOT
# have is a changed console key, and the shipped one is published in .env.example.
if [ ! -f "$SERVER_DIR/.env" ]; then
  echo "warning: server/.env is missing - the API will boot on defaults (port 4201)" >&2
  echo "         copy server/.env.example if you need to change the port, the proxy hop" >&2
  echo "         count, or where the database file lives" >&2
fi
echo "> Reminder: sign in at /admin and change the console key before this is reachable." >&2

# systemd does not create log directories, and pino-roll writes into this one.
mkdir -p "$SERVER_DIR/logs"

echo "> Installing systemd service (${SERVICE_FILE})..."
echo "> Repository: $ROOT"
echo "> Server:     $SERVER_DIR"
echo "> Node:       $NODE_BIN ($("$NODE_BIN" -v))"
echo "> Entry:      $SERVICE_ENTRY"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=$SERVICE_DESCRIPTION
After=network.target

[Service]
Type=simple

Restart=always
RestartSec=5

Environment=NODE_ENV=production

# The server directory is the working directory because main.ts loads .env from it, and
# because DATABASE_FILE and the log path are both relative to it.
WorkingDirectory=$SERVER_DIR

# Absolute path: the service no longer depends on the shell's current directory.
ExecStart=$NODE_BIN $SERVICE_ENTRY

StandardOutput=append:$SERVER_DIR/logs/service_output.log
StandardError=append:$SERVER_DIR/logs/service_error.log

LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "> Service installed successfully."
echo "> Unit: $SERVICE_FILE"

# If the service already exists, restart it immediately.
if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "> Restarting $SERVICE_NAME..."
  systemctl restart "$SERVICE_NAME"
else
  echo "> Starting $SERVICE_NAME..."
  systemctl start "$SERVICE_NAME"
fi

echo
systemctl status "$SERVICE_NAME" --no-pager
