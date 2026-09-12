# Одноразовый контейнер с серверным режимом Kibborg CLI.
#
# Сборка из корня монорепо:
#   docker build -f Kibborg_CLI/deploy/Dockerfile -t kibborg-server .
#
# Запуск (токен обязателен, потому что контейнер публикует порт наружу):
#   docker run --rm -p 127.0.0.1:7317:7317 \
#     -e KIBBORG_SERVER_TOKEN="$(openssl rand -hex 32)" \
#     -e DEEPSEEK_API_KEY \
#     -v kibborg-home:/var/lib/kibborg/.dsh \
#     kibborg-server
#
# Подключение с машины-клиента:
#   kibborg attach http://127.0.0.1:7317 --token <тот же токен>

FROM node:24-slim AS build

RUN corepack enable
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY Kibborg_CLI/package.json Kibborg_CLI/
COPY packages ./packages
COPY vendor ./vendor
COPY tsconfig*.json ./
COPY Kibborg_CLI ./Kibborg_CLI

RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm --dir Kibborg_CLI run build

FROM node:24-slim

# git нужен для `--worktree` и для ветки в статус-строке, curl — для healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash kibborg
WORKDIR /src
COPY --from=build /src /src
COPY Kibborg_CLI/deploy/healthcheck.sh /usr/local/bin/kibborg-healthcheck
RUN chmod +x /usr/local/bin/kibborg-healthcheck && chown -R kibborg:kibborg /src

USER kibborg
ENV DSH_HOME=/var/lib/kibborg/.dsh
ENV KIBBORG_SERVE_HOST=0.0.0.0
ENV KIBBORG_SERVE_PORT=7317
# The API listens on every interface inside the container; the published port is
# what decides reachability, and the token is required either way.
EXPOSE 7317

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/usr/local/bin/kibborg-healthcheck", "http://127.0.0.1:7317"]

ENTRYPOINT ["node", "/src/Kibborg_CLI/apps/cli/lib/bin.js"]
CMD ["serve", "--host", "0.0.0.0", "--port", "7317"]
