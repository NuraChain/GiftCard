# The edge: build the client, then serve it from nginx along with the TLS termination and
# the proxy to the API. See deploy/nginx.conf for what that configuration actually does.
FROM node:24-slim AS build
WORKDIR /build
COPY package*.json ./
COPY application/package.json application/
COPY server/package.json server/
RUN npm ci
# The application imports the server's contract directly - one declaration, both sides - so
# the server source is part of the client build's input even though none of it ships.
COPY server ./server
COPY application ./application
RUN npm run build --workspace application

FROM nginx:1.27-alpine
COPY --from=build /build/application/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
