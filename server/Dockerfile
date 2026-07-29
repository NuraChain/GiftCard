# One image for the whole app: stage 1 builds the client, stage 2 runs the server
# (which has NO build step - Node >= 24 runs the TypeScript source) and serves the
# built client from CLIENT_DIR. One origin, one container.
FROM node:24-slim AS client
WORKDIR /build
COPY package*.json ./
COPY application/package.json application/
COPY server/package.json server/
RUN npm ci
COPY application ./application
RUN npm run build --workspace application

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
ENV CLIENT_DIR=./client
ENV SSR_ENTRY=./client-server/entry.server.js
# Stated explicitly rather than left to the default, because this path is what a deployment
# has to mount a volume at. An implicit path is how unsold codes end up in a container's
# writable layer and vanish on the next deploy.
ENV DATABASE_FILE=/app/data/nura.db
# Workspace install, root context: the lockfile lives at the repo root (a workspace
# member never has its own), so stage 2 installs exactly like stage 1 does - all
# manifests + the root lockfile, scoped to the server workspace, dev deps omitted.
COPY package*.json ./
COPY application/package.json application/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server
COPY server/src ./src
COPY --from=client /build/application/dist ./client
# The self-contained SSR bundle (vite build --ssr) - the kit renders 'server' pages with it.
COPY --from=client /build/application/dist-server ./client-server

# The database directory, owned by the unprivileged user the process runs as. Declaring the
# volume means `docker run` without `-v` still gets a real one rather than silently writing
# money into a layer that a redeploy discards.
RUN mkdir -p /app/data /app/logs && chown -R node:node /app/data /app/logs
VOLUME ["/app/data"]

# Nothing here needs root, and a payment server least of all.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s     CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/main.ts"]
