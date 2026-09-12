# Эксплуатация сервера Kibborg CLI

English | [中文](README.zh.md)

Здесь лежат заготовки для постоянного запуска `kibborg serve`: unit systemd, файл окружения, healthcheck и Compose. Все они опираются на один контракт безопасности — **токен обязателен вне loopback**, без него launcher отказывается стартовать (exit 2).

| Файл | Что делает |
|---|---|
| `kibborg.service` | unit systemd: запускает сервер от отдельного пользователя, с hardening и корректным `SIGTERM` |
| `kibborg.env.example` | шаблон `/etc/kibborg/serve.env`: токен, адрес, порт, ключ провайдера |
| `healthcheck.sh` | проверяет `/healthz` и то, что `/api` без токена отвечает `401`/`403` |
| `Dockerfile` | образ серверного режима с `EXPOSE 7317` и `HEALTHCHECK` |
| `docker-compose.yml` | сервис с томом `$DSH_HOME`, публикацией порта только на loopback и grace-периодом 30 с |

## systemd

```bash
sudo useradd --create-home --shell /bin/bash kibborg
sudo mkdir -p /etc/kibborg /var/lib/kibborg
sudo cp Kibborg_CLI/deploy/kibborg.env.example /etc/kibborg/serve.env
sudo chown kibborg:kibborg /etc/kibborg/serve.env && sudo chmod 600 /etc/kibborg/serve.env
sudo cp Kibborg_CLI/deploy/kibborg.service /etc/systemd/system/kibborg.service
sudo systemctl daemon-reload && sudo systemctl enable --now kibborg
systemctl status kibborg
```

## Проверка и остановка

```bash
Kibborg_CLI/deploy/healthcheck.sh http://127.0.0.1:7317
sudo systemctl stop kibborg      # SIGTERM: маршруты, даунлинки и HTTP-сервер закрываются до выхода
```

Healthcheck отвечает `0`, когда `/healthz` вернул `{"ok":true…}` и при этом `/api` без токена ответил `401` или `403`: первое подтверждает, что процесс слушает, второе — что фенс на месте. Любой другой код выхода означает, что сервер сломан или открыт.

## Токен

Токен — единственное, что отделяет API от любого, кто дотянулся до порта: `trustedHosts` защищает только от DNS-rebinding, а не от чужого клиента. Генерация и передача:

```bash
openssl rand -hex 32                        # значение для serve.env
kibborg attach http://127.0.0.1:7317 --token <тот же токен>
```

Держите публикацию порта на loopback и выставляйте наружу осознанно — через SSH-туннель или обратный прокси с TLS. Переменная `KIBBORG_SERVER_TOKEN` читается launcher'ом; в `--dump-config` и `doctor` она не печатается.
