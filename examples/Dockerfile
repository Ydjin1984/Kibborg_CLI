# Одноразовый контейнер с Kibborg CLI.
#
# Образ НЕ содержит ключей: провайдерский ключ передаётся в рантайме
# (`-e DEEPSEEK_API_KEY=...`), а домашний каталог harness подключается томом,
# потому что профиль, сессии и настройки живут в `$DSH_HOME`.
#
# Сборка из корня монорепо:
#   docker build -f Kibborg_CLI/examples/Dockerfile -t kibborg .
#
# Запуск:
#   docker run --rm \
#     -e DEEPSEEK_API_KEY \
#     -v "$HOME/.dsh:/home/kibborg/.dsh" \
#     -v "$PWD:/work" -w /work \
#     kibborg -p "Опиши структуру этого репозитория" --output-format json

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

# git нужен для `--worktree` и для ветки в статус-строке.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash kibborg
WORKDIR /src
COPY --from=build /src /src
RUN chown -R kibborg:kibborg /src

USER kibborg
ENV DSH_HOME=/home/kibborg/.dsh
WORKDIR /work

# Точка входа — собранный бинарник; аргументы передаются как есть.
ENTRYPOINT ["node", "/src/Kibborg_CLI/apps/cli/lib/bin.js"]
CMD ["doctor"]
