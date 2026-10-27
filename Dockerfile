# The shop in one image: the API, serving the built client at `/`.
#
#   docker build -t ashbringer .
#   docker run -d --name ashbringer --restart unless-stopped \
#       -p 127.0.0.1:4600:4600 \
#       -v "$(pwd)/.env:/app/.env:ro" \
#       --add-host=host.docker.internal:host-gateway \
#       ashbringer
#
# THE CONFIGURATION IS THE .env AT THE REPOSITORY ROOT (copy .env.example), MOUNTED at /app/.env:
# the server finds it there exactly as it does outside Docker (server/src/config.ts). Mounted,
# not copied in - it carries the database password, and an image is not a place for that.
#   - The image's own HOST, PORT and NODE_ENV win over the file's, so the 127.0.0.1 the file
#     says for a bare-metal install does not lock the container out of its own published port.
#     For the same reason, do NOT pass the file with `--env-file`: that sets HOST=127.0.0.1 over
#     the image's 0.0.0.0, and nothing outside the container can reach it.
#   - The server runs as `node` (uid 1000) and must be able to read the file: chmod 644, or
#     chown 1000. An unreadable file stops the boot with the reason, rather than being skipped.
#   - DATABASE_URL at 127.0.0.1 is the container itself. A database on the same machine is
#     host.docker.internal (what the --add-host line above provides), and PostgreSQL must
#     listen on, and allow, the Docker bridge address.
#   - `-e NAME=value` still works for any one setting, and wins over the file.
#
# PUBLISH ON 127.0.0.1 and put nginx in front, as without Docker - see the note on `listen`
# in server/src/main.ts. Running with nothing in front (or testing over plain http) means
# TRUST_PROXY_HOPS=0 and COOKIE_SECURE=false in the file.
#
# THE DATABASE IS THE BUSINESS. PostgreSQL holds the unsold codes and the gateway credentials,
# outside the image: a container rebuilt or replaced loses nothing but its own logs.
#
# Every COPY names its paths rather than copying the checkout, so a local node_modules (built
# for another OS), server/logs and .env never end up in an image.

FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY application/package.json application/
COPY server/package.json server/
RUN npm ci

# The client imports the server's contract, so both sources are needed to build it.
COPY server/tsconfig.json server/
COPY server/src server/src
COPY application/index.html application/tsconfig.json application/vite.config.ts application/
COPY application/public application/public
COPY application/src application/src
RUN npm run build


FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4600

# Only the server's runtime dependencies. The server has no build step: Node runs its
# TypeScript as it is.
COPY package.json package-lock.json ./
COPY application/package.json application/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server && npm cache clean --force

COPY server/src server/src
COPY --from=build /app/application/dist application/dist

RUN mkdir -p server/logs && chown -R node:node server/logs
USER node

WORKDIR /app/server
EXPOSE 4600

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "src/main.ts"]
