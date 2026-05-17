# 1Panel / Docker Compose 部署指南

本指南介绍如何在 VPS 上通过 Docker Compose 部署 Afilmory。默认配置会随项目启动独立的 PostgreSQL 和 Redis 容器，并把数据保存在 Docker volumes 中，适合 1Panel 服务器直接部署。

## 前提条件

- VPS 已安装 Docker 和 Docker Compose（1Panel 通常会自动安装）
- 已配置好反向代理域名（可选，但生产环境推荐）

## 部署步骤

### 1. 拉取项目代码

```bash
git clone https://github.com/uovme/afilmorys.git
cd afilmorys
```

### 2. 配置环境变量

```bash
cp .env.docker.example .env.docker
nano .env.docker
```

至少修改以下值：

```env
POSTGRES_PASSWORD=这里填数据库密码
DATABASE_URL=postgresql://afilmory:这里填数据库密码@db:5432/afilmory
CONFIG_ENCRYPTION_KEY=这里填 openssl rand -hex 32 生成的密钥
BETTER_AUTH_SECRET=这里填另一个 openssl rand -hex 32 生成的密钥
```

可选：如果只允许指定邮箱登录，配置：

```env
AUTH_ALLOWED_EMAILS=owner@example.com,admin@example.com
```

留空或注释 `AUTH_ALLOWED_EMAILS` 表示允许所有注册用户登录。

### 3. 构建并启动

```bash
docker compose --env-file .env.docker up -d --build
```

首次构建可能需要 5-10 分钟，取决于 VPS 性能。

### 4. 验证部署

```bash
docker ps | grep afilmory
docker logs -f afilmory_core
```

正常日志包含：

```text
[entrypoint] Waiting for database to be ready...
[entrypoint] Database is ready!
[entrypoint] Running database migrations...
[entrypoint] Starting application...
Hono HTTP application started on http://0.0.0.0:1841.
```

### 5. 配置反向代理

在 1Panel 中为 Afilmory 站点设置反向代理：

1. 进入 **网站**，创建或编辑站点。
2. 设置反向代理目标：`http://127.0.0.1:1841`。
3. 配置 SSL 证书以启用 HTTPS。

## 数据持久化

默认 compose 会创建两个 volumes：

- `afilmorys_pgdata`：PostgreSQL 数据
- `afilmorys_redisdata`：Redis 数据

更新代码或重建镜像不会删除这些 volumes。不要使用 `docker compose down -v`，除非你明确要清空数据库。

## 常用管理命令

```bash
# 查看日志
docker logs -f afilmory_core

# 重启服务
docker compose restart core

# 停止服务（保留数据库 volume）
docker compose down

# 更新部署
git pull
docker compose --env-file .env.docker up -d --build

# 重置超级管理员密码
docker exec afilmory_core node ./dist/main.js reset-superadmin-password
```

## 常见问题

### Core 容器不断重启

```bash
docker logs afilmory_core
```

| 日志关键词 | 原因 | 解决方案 |
|-----------|------|---------|
| `DATABASE_URL is required` | 环境变量缺失 | 检查 `.env.docker` 文件是否存在且配置正确 |
| `password authentication failed` | 数据库密码不一致 | 确认 `POSTGRES_PASSWORD` 与 `DATABASE_URL` 中的密码一致；已有 volume 初始化后再改密码不会自动修改数据库用户密码 |
| `Database not ready` | PostgreSQL 启动失败或网络异常 | 查看 `docker logs afilmory_db` |
| `ECONNREFUSED` (Redis) | Redis 不可达 | 查看 `docker logs afilmory_redis` |

### 无法访问网页

1. 检查容器是否正常运行：`docker ps | grep afilmory`。
2. 测试端口是否监听：`curl http://127.0.0.1:1841/`。
3. 如使用反向代理，检查目标地址是否为 `http://127.0.0.1:1841`。

### 修改端口

默认宿主机端口为 `1841`。如需修改，编辑 `.env.docker`：

```env
APP_PORT=9090
PORT=1841
```

然后重启：

```bash
docker compose --env-file .env.docker up -d
```

修改后，1Panel 反向代理目标也要同步改为 `http://127.0.0.1:9090`。
