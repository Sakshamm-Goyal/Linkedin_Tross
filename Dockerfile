FROM node:22.16.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:22.16.0-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV LINKEDIN_PYTHON_BIN=/opt/curl-cffi/bin/python
WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl python3 python3-venv \
    && python3 -m venv /opt/curl-cffi \
    && /opt/curl-cffi/bin/pip install --no-cache-dir curl_cffi \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
RUN mkdir --parents /data && chown app:app /data
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app scripts/curl_cffi_fetch.py ./scripts/curl_cffi_fetch.py
COPY --from=build --chown=app:app /app/package.json ./package.json
USER app
EXPOSE 3000
CMD ["node", "dist/server.js"]
