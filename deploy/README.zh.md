# Kibborg CLI 服务器运维

[English](README.md) | 中文

这里放的是 `kibborg serve` 长期运行的现成材料：systemd unit、环境文件、healthcheck 和 Compose。它们都依赖同一条安全约定 —— **loopback 之外必须有 token**，没有 token 时 launcher 会拒绝启动（exit 2）。

| 文件 | 作用 |
|---|---|
| `kibborg.service` | systemd unit：以独立用户运行服务器，带 hardening 和正确的 `SIGTERM` |
| `kibborg.env.example` | `/etc/kibborg/serve.env` 模板：token、地址、端口、provider 密钥 |
| `healthcheck.sh` | 检查 `/healthz`，并确认 `/api` 在无 token 时返回 `401`/`403` |
| `Dockerfile` | 服务器模式镜像，含 `EXPOSE 7317` 与 `HEALTHCHECK` |
| `docker-compose.yml` | 带 `$DSH_HOME` 卷、仅 loopback 发布端口、30 秒 grace 期的服务 |

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

## 检查与停止

```bash
Kibborg_CLI/deploy/healthcheck.sh http://127.0.0.1:7317
sudo systemctl stop kibborg      # SIGTERM: маршруты, даунлинки и HTTP-сервер закрываются до выхода
```

healthcheck 返回 `0` 的条件是：`/healthz` 返回 `{"ok":true…}`，并且 `/api` 在无 token 时返回 `401` 或 `403`：前者证明进程在监听，后者证明防护在位。其他退出码都表示服务器已损坏或处于开放状态。

## Token

token 是把 API 与任何够到端口的人隔开的唯一屏障：`trustedHosts` 只防 DNS-rebinding，不防陌生客户端。生成与传递：

```bash
openssl rand -hex 32                        # значение для serve.env
kibborg attach http://127.0.0.1:7317 --token <тот же токен>
```

请把端口发布保持在 loopback，并有意地对外暴露 —— 通过 SSH 隧道或带 TLS 的反向代理。launcher 读取环境变量 `KIBBORG_SERVER_TOKEN`；它不会出现在 `--dump-config` 与 `doctor` 的输出里。
