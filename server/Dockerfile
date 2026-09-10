# The API. It serves JSON and nothing else - the built client is nginx's job now
# (deploy/nginx.conf and application/Dockerfile), which is why there is no client build stage
# here any more and no CLIENT_DIR to point at one.
#
# There is no build step at all: Node >= 24 runs the TypeScript source directly.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production

# Stated explicitly rather than left to the default, because this path is what a deployment
# has to mount a volume at. An implicit path is how unsold codes end up in a container's
# writable layer and vanish on the next deploy.
ENV DATABASE_FILE=/app/data/guardian-service.db

# One nginx in front. The per-IP throttles and the console's sign-in lockout are only as good
# as this number - see server/src/platform/throttle.ts.
ENV TRUST_PROXY_HOPS=1

# nginx terminates TLS, so this process always sees plain http and cannot infer that the
# browser is on https. The Secure flag on the session cookie is therefore stated, not sensed.
ENV COOKIE_SECURE=true

# Workspace install, root context: the lockfile lives at the repo root (a workspace member
# never has its own), so all manifests plus the root lockfile are copied, scoped to the
# server workspace, dev dependencies omitted.
COPY package*.json ./
COPY application/package.json application/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server
COPY server/src ./src

# The database directory, owned by the unprivileged user the process runs as. Declaring the
# volume means `docker run` without `-v` still gets a real one rather than silently writing
# money into a layer that a redeploy discards.
RUN mkdir -p /app/data /app/logs && chown -R node:node /app/data /app/logs
VOLUME ["/app/data"]

# Nothing here needs root, and a payment server least of all.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/main.ts"]
