# Kibborg CLI 运行示例

[English](README.md) | 中文

这里放的是非交互场景的现成模板：CI、cron 和一次性的 Docker 运行。三者都依赖同一个 headless 契约：

- `stdout` 只承载结果（`--output-format text|json|stream-json`），面向人的输出走 `stderr`；
- 退出码：`0` 成功，`1` 错误（包括 `--json-schema` 校验失败和 `--max-turns` 用尽），`2` 配置/环境/任务错误，`3` 需要用户决定（有提问但没有 `--question-answers`），`130` 中断。

| 文件 | 展示内容 |
|---|---|
| `github-actions.yml` | workflow 步骤：JSON 回答、schema 校验、结果发布 |
| `cron-kibborg.sh` | 夜间运行，带 `--max-turns` 和日志文件 |
| `Dockerfile` | 一次性容器，内含已构建的 CLI |

首次运行前请确认 profile 已构建、密钥可用：`kibborg doctor` 与 `kibborg auth`。
