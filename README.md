<img width="522" height="143" alt="image" src="https://github.com/user-attachments/assets/75aa483f-541c-4739-b6a2-81daa30b8d89" />

# kiro-rs

**该项目基于 [hank9999/kiro.rs](https://github.com/hank9999/kiro.rs) 进行的二次开发**

`kiro-rs` 是一个用 Rust 编写的 Anthropic Messages API 兼容代理。它把
`/v1/messages`、`/v1/models`、`/v1/messages/count_tokens` 等 Anthropic 风格请求转换为 Kiro / Amazon Q 后端请求，并提供一个可选的 Web Admin 面板来管理凭据、客户端 Key、用量、代理池、请求日志和在线更新。

项目当前的核心目标是：让 Claude Code、Anthropic SDK 或其它兼容 Anthropic API 的客户端，通过统一的本地 / 自托管服务访问 Kiro 账号能力，同时在服务端集中处理多凭据、token 刷新、故障转移、用量统计和可观测性。

## 🔎 快速引导

- [声明](#notice)
- [二改说明](#fork-notes)
- [功能](#features)
- [快速开始](#quick-start)
- [调用 API](#api-usage)
- [API 路由](#api-routes)
- [配置](#configuration)
- [凭据](#credentials)
- [模型](#models)
- [Thinking、工具与 WebSearch](#thinking-tools-websearch)
- [图片处理](#images)
- [用量、缓存与日志](#usage-cache-logs)
- [Admin UI](#admin-ui)
- [代理和 Region](#proxy-region)
- [负载均衡与故障转移](#load-balancing-failover)
- [在线更新和发布](#updates-release)
- [开发](#development)
- [目录结构](#project-structure)
- [License](#license)
- [社区支持](#community)
- [致谢](#acknowledgements)

<a id="notice"></a>
## 📚 声明

本项目仅供研究和自用。使用本项目产生的任何后果由使用者自行承担。本项目与 AWS、Kiro、Amazon Q、Anthropic、Claude 等官方实体无关，不代表任何官方立场。

<a id="fork-notes"></a>
## 🧩 二改说明

相较于长秋佬的 kiro-rs-admin 三开，本仓库主要更新内容如下：

- 同步 [ZyphrZero/kiro.rs](https://github.com/ZyphrZero/kiro.rs) 二开上游 `0.6.9` 系列源码，并继续保留 Admin 管理能力。
- 支持企业 SSO / Microsoft Entra ID / Azure AD 的全流程登录。服务无需部署在本机，也可以直接在网页获取第二段 IdP 登录链接；机器无法监听回调端口时，可手动粘贴 Kiro 中间链接生成第二段登录链接。
- 支持更多 JSON 凭据导入格式，已兼容 Kiro Account Manager `1.1.2` / `1.8.3`、Kiro-Go、CLiProxyAPIPlus 等导出格式；导入时会自动归一化 `external_idp` 字段、从 JWT 补全邮箱 / scopes / issuer / token endpoint 等信息。
- 批量导入与 Account Manager 导入入口合并，支持导入时统一配置代理和 RPM；导出支持 Account Manager 嵌套格式与通用 JSON 格式。
- 优化限流时的账号选择。普通 429 默认先在同一凭据上切换 `q` / `runtime` 独立限流端点，仍失败再自动切换凭据，避免账号池充足时仍对同一账号连续重试；同时合并 [GreyGunG/Kiro-RS-Tool](https://github.com/GreyGunG/Kiro-RS-Tool) 的策略设计，可在网页选择 `failover` / `turbo` / `fast` / `balanced` / `steady` / `polite` / `custom` 等 429 重试策略。
- 支持动态模型兼容。原始 rs 主要面向 Claude 系列模型，现在会从 Kiro 拉取账号可用模型列表，并对 `auto`、DeepSeek、MiniMax、GLM、Qwen 等 Kiro 原生模型族做透传兼容，后续同族新模型通常不需要改代码。
- 增强代理设置。全局和单个凭据都可以配置多个代理，提供粘性会话 / 轮询 / 最小负载三种代理负载策略；代理失效时支持自动切换、自动停用和直连兜底。
- 优化并发与故障转移。普通 429 会利用 `q` / `runtime` 两套独立限流桶提高吞吐；凭据级风控冷却状态会在管理页展示。
- 新增凭据测试响应功能，默认用 `claude-sonnet-4-6` 发送 `hello`，也可以先拉取模型列表后按模型单选或多选批量测试，并展示可读的响应片段和耗时。
- 凭据管理页增加隐私模式，默认隐藏邮箱完整信息。
- 加强 Claude Code 工具调用兼容：内置工具做双向字段映射，流式工具参数完整后再输出，减少 `Invalid tool parameters` 和半截 JSON 导致的中断；同时过滤 Kiro 工具 XML 泄漏，并合并官方 thinking 参数与 thinking block 转换。

<a id="features"></a>
## ✨ 功能

- **Anthropic Messages API 兼容**：`/v1/messages`、`/v1/models`、`/v1/messages/count_tokens`。
- **Claude Code 兼容端点**：`/cc/v1/messages`、`/cc/v1/messages/count_tokens`。
- 流式和非流式响应：支持 Anthropic SSE 事件格式。
- **多凭据管理**：OAuth、Builder ID、Social、Enterprise / IdC、企业 SSO（Microsoft Entra ID / Azure AD）、Kiro API Key。
- 自动 token 刷新：支持刷新后回写 `credentials.json`。
- **多凭据调度**：`priority` 固定优先级、`balanced` 均衡分配、`least_conn` 最少在途负载。
- **故障转移**：凭据失败、额度用尽、普通 429 端点 / 凭据切换、账号级 429 风控冷却、token 失效强制刷新。
- **profileArn 策略**：流式端点按账号类型注入真实 ARN 或 Builder ID 占位 ARN；用量类 / 头部类调用跳过占位 ARN。
- **端点抽象**：按凭据选择 `ide` 或 `cli` endpoint，并在普通 429 时利用 `q` / `runtime` 独立限流桶回退。
- **工具调用**：支持 `tool_use` / `tool_result` 配对、工具名缩短与反向映射、Claude Code 内置工具到 Kiro 内置工具的字段映射、流式工具参数累积。
- **Thinking / Reasoning 兼容**：支持 `thinking.type=enabled` / `adaptive`、Claude Code 默认 thinking 请求、Kiro 原生 `reasoningContentEvent` 到 Anthropic thinking / signature / redacted thinking 事件的转换。
- **WebSearch**：支持纯 `web_search` 请求和混合工具场景下的本地 agentic web_search loop。
- **图像处理**：入站图片按环境变量自动缩放 / 重编码，降低 AWS Q 单字段大小限制导致的 400 风险。
- **Prompt cache 计量**：模拟 Anthropic cache_control 的 `cache_creation` / `cache_read` token 统计。
- **用量统计**：按客户端 Key、模型、凭据、日期聚合 input/output/cache token 和 credits。
- **请求链路追踪**：SQLite `traces.db`，记录成功 / 失败请求、尝试链路和错误类型。
- 客户端 Key 分发：Admin 面板生成 `csk_*` Key，支持独立启停和统计。
- **Admin UI**：概览、凭据管理、客户端 Key、分组、请求日志等视图，支持隐私模式、批量导入 / 导出、响应测试、模型拉取、运行时策略配置。
- 代理能力：全局代理、凭据级代理、代理池、健康检查、自动停用、直连兜底、粘性会话 / 轮询 / 最小负载分配。
- **在线更新**：从 GitHub Release / Docker Hub 拉取新版本，支持镜像定时自动更新与手动回退。
- **多平台发布**：GitHub Release 构建 Windows、Linux、macOS 和 Docker Hub 多架构镜像。

<a id="quick-start"></a>
## 🚀 快速开始

本项目从源码构建。前端 Admin UI 会通过 `rust-embed` 嵌入到最终二进制，因此需先构建前端再编译后端。

### 1. 安装 Node.js（已安装可跳过）

```bash
# 下载并安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# 代替重启 shell
\. "$HOME/.nvm/nvm.sh"
# 下载并安装 Node.js
nvm install 24
# 验证 Node.js 版本
node -v # 应输出 "v24.17.0"
```

### 2. 安装 Rust（已安装可跳过）

```bash
# 安装 rustup（会自动安装 Rust）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

按提示输入 `1` 回车，使用默认安装。安装完成后重新加载环境变量（或重开终端）：

```bash
source "$HOME/.cargo/env"
```

### 3. 安装 Bun（已安装可跳过）

```bash
# 使用官方脚本安装 Bun
curl -fsSL https://bun.sh/install | bash

# 重新加载环境变量
source /root/.bashrc
```

### 4. 克隆并构建

```bash
git clone https://github.com/liuran001/kiro.rs-admin
cd kiro.rs-admin/admin-ui
bun install
bun run build
cd ..
cargo build --release
```

### 5. 配置并运行

复制示例配置为 `config.json`，按需修改后运行：

```bash
cp config.example.json config.json
./target/release/kiro-rs
```

首次启动会在工作目录自动生成 `credentials.json`。指定配置文件路径：

```bash
./target/release/kiro-rs --config /path/to/config.json --credentials /path/to/credentials.json
```

访问：

- API: `http://<host>:8990/v1/messages`
- Admin UI: `http://<host>:8990/admin`

测试：

```bash
cargo test
```

<a id="api-usage"></a>
## 调用 API

`/v1` 路由支持 `x-api-key` 和 `Authorization: Bearer` 两种鉴权方式。Key 可以是主 `apiKey`，也可以是 Admin 面板生成的 `csk_*` 客户端 Key。

```bash
curl http://127.0.0.1:8990/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-kiro-rs-..." \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "stream": true,
    "messages": [
      { "role": "user", "content": "Hello" }
    ]
  }'
```

Claude Code 兼容端点：

```bash
curl http://127.0.0.1:8990/cc/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-kiro-rs-..." \
  -d '{
    "model": "claude-sonnet-4-8",
    "max_tokens": 1024,
    "stream": true,
    "messages": [
      { "role": "user", "content": "Hello from Claude Code style endpoint" }
    ]
  }'
```

列出模型：

```bash
curl http://127.0.0.1:8990/v1/models \
  -H "Authorization: Bearer sk-kiro-rs-..."
```

估算 token：

```bash
curl http://127.0.0.1:8990/v1/messages/count_tokens \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-kiro-rs-..." \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "messages": [
      { "role": "user", "content": "Count this." }
    ]
  }'
```

<a id="api-routes"></a>
## API 路由

### Anthropic 兼容

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/v1/models` | 返回本服务声明支持的兼容模型列表 |
| `POST` | `/v1/messages` | Anthropic Messages API 兼容入口 |
| `POST` | `/v1/messages/count_tokens` | Anthropic count_tokens 兼容入口 |
| `POST` | `/cc/v1/messages` | Claude Code 兼容入口，流式事件顺序针对 Claude Code 调整 |
| `POST` | `/cc/v1/messages/count_tokens` | Claude Code 兼容 count_tokens |

### OpenAI 兼容

在 Anthropic 管线之上提供的 OpenAI 兼容层，方便接入 Codex 及通用 OpenAI SDK 客户端。鉴权与 `/v1/messages` 一致（`Authorization: Bearer <客户端 Key>` 或 `x-api-key`）。

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/v1/chat/completions` | Chat Completions（文本 / 工具调用 / 流式 / WebSearch，供通用 OpenAI SDK 客户端） |
| `POST` | `/v1/responses` | Responses API（Codex 接入的唯一端点；流式 SSE、工具调用、WebSearch、`previous_response_id` 多轮） |
| `GET` | `/v1/responses/{id}` | 获取已存储的 response（`store!=false` 时可用） |
| `DELETE` | `/v1/responses/{id}` | 删除已存储的 response |

接入 Codex：在 `~/.codex/config.toml` 配一个自定义 provider，`base_url` 指向 `http://<host>:<port>/v1`、`wire_api = "responses"`、`env_key` 填客户端 Key 对应的环境变量。Codex 会向 `base_url` + `/responses` 发起请求。请求里的 `gpt-*` / `o1` / `o3` / `codex` 等模型名会统一映射到默认兼容模型（`claude-sonnet-4.5`），也可直接填 Claude 模型名透传。带 `{"type":"web_search"}` 工具时，服务端内部执行联网搜索并把结果喂回模型合成答案（不向客户端下发原始搜索块）。

### Admin

启用 `adminApiKey` 后会挂载：

| 路径 | 说明 |
|---|---|
| `/admin` | 嵌入式 Web 管理界面 |
| `/api/admin/credentials` | 凭据列表、新增、编辑、删除 |
| `/api/admin/credentials/{id}/balance` | 查询单个凭据订阅 / 用量 |
| `/api/admin/credentials/{id}/models` | 查询该凭据上游实际可用模型 |
| `/api/admin/client-keys` | 客户端 Key 管理 |
| `/api/admin/stats/*` | 用量统计 |
| `/api/admin/traces` | 请求链路追踪查询 |
| `/api/admin/proxy-pool` | 代理池 |
| `/api/admin/config/*` | 运行时配置 |
| `/api/admin/auth/*` | Social / IdC 登录流程 |
| `/api/admin/system/update/*` | 在线更新、回退、版本检查 |

Admin API 鉴权同样支持：

- `x-api-key: <adminApiKey>`
- `Authorization: Bearer <adminApiKey>`

<a id="configuration"></a>
## ⚙️ 配置

默认配置文件名是 `config.json`。首次启动如果文件不存在，会自动生成最小配置。

### 最小配置

```json
{
  "host": "0.0.0.0",
  "port": 8990,
  "apiKey": "sk-kiro-rs-change-me",
  "adminApiKey": "sk-admin-change-me",
  "region": "us-east-1",
  "tlsBackend": "rustls",
  "defaultEndpoint": "ide"
}
```

### 常用字段

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `host` | `127.0.0.1` | 监听地址。自动生成配置时为 `0.0.0.0` |
| `port` | `8080` | 监听端口。自动生成配置时为 `8990` |
| `apiKey` | 无 | 主 API Key，调用 `/v1` 和 `/cc/v1` 必填 |
| `adminApiKey` | 无 | 设置后启用 `/admin` 和 `/api/admin` |
| `region` | `us-east-1` | 全局默认 Region |
| `authRegion` | 无 | token 刷新用 Region，未配置时回退 `region` |
| `apiRegion` | 无 | Kiro API 请求用 Region，未配置时回退 `region` |
| `defaultEndpoint` | `ide` | 凭据未指定 endpoint 时使用的端点 |
| `tlsBackend` | `rustls` | `rustls` 或 `native-tls` |
| `proxyUrl` | 无 | 全局代理，支持 `http://`、`https://`、`socks5://` |
| `proxyUsername` / `proxyPassword` | 无 | 全局代理认证 |
| `loadBalancingMode` | `priority` | `priority`、`balanced` 或 `least_conn` |
| `proxyBalancingMode` | `sticky` | 多代理候选选择策略：`sticky`、`round_robin` 或 `least_load` |
| `accountThrottleFailover` | `true` | 账号级 429 suspicious activity 时是否冷却并切换凭据 |
| `accountThrottleCooldownSecs` | `1800` | 账号级风控冷却秒数 |
| `retryMode` | `failover` | 普通 429 重试策略：`failover`、`turbo`、`fast`、`balanced`、`steady`、`polite` 或 `custom` |
| `retryPolicy` | 无 | `retryMode=custom` 时使用的普通 429 自定义策略 |
| `toolCompatibilityMode` | `claude-code` | `claude-code` 启用内置工具双向映射；`raw` 保留旧的 schema 透传行为 |
| `extractThinking` | `true` | 非流式响应是否把旧 `<thinking>` 文本提取成 thinking block |
| `traceEnabled` | `true` | 是否写入 `traces.db` |
| `traceRetentionDays` | `7` | trace 保留天数 |
| `usageLogRetentionDays` | `31` | `usage_log.*.jsonl` 保留天数 |
| `countTokensApiUrl` | 无 | 外部 count_tokens API 地址 |
| `countTokensApiKey` | 无 | 外部 count_tokens API Key |
| `countTokensAuthType` | `x-api-key` | `x-api-key` 或 `bearer` |
| `githubToken` | 无 | 在线更新访问 GitHub API 时使用，降低 rate limit 风险 |
| `updateAutoApply` | `false` | 是否每天自动检查并应用新版本 |
| `updateAutoApplyTime` | `03:00` | 自动更新时间，本地时区 `HH:MM` |

<a id="credentials"></a>
## 🔐 凭据

默认凭据文件名是 `credentials.json`。推荐通过 Admin UI 添加、登录和重登凭据；直接编辑文件时建议使用数组格式。

```json
[
  {
    "id": 1,
    "refreshToken": "xxx",
    "expiresAt": "2026-12-31T00:00:00Z",
    "authMethod": "idc",
    "provider": "BuilderId",
    "clientId": "xxx",
    "clientSecret": "xxx",
    "priority": 0
  }
]
```

### 支持的凭据类型

#### Builder ID / IdC

```json
{
  "refreshToken": "xxx",
  "expiresAt": "2026-12-31T00:00:00Z",
  "authMethod": "idc",
  "provider": "BuilderId",
  "clientId": "xxx",
  "clientSecret": "xxx"
}
```

#### Enterprise IAM Identity Center

```json
{
  "refreshToken": "xxx",
  "expiresAt": "2026-12-31T00:00:00Z",
  "authMethod": "idc",
  "provider": "Enterprise",
  "startUrl": "https://example.awsapps.com/start",
  "region": "us-east-1",
  "clientId": "xxx",
  "clientSecret": "xxx"
}
```

Enterprise / IdC 账号在流式调用前会按需调用 `ListAvailableProfiles` 解析真实 `profileArn`，成功后写回凭据。纯 Builder ID/free 账号没有 Enterprise profile 时，会回退到官方 IDE 使用的 Builder ID 占位 ARN，以避免流式端点缺少 `profileArn` 返回 400。

#### Social 登录

```json
{
  "refreshToken": "xxx",
  "expiresAt": "2026-12-31T00:00:00Z",
  "authMethod": "social",
  "provider": "Github"
}
```

`provider` 可为 `Github` 或 `Google`。Social 登录会使用固定 Social profile ARN。

#### 企业 SSO（Microsoft 365 / Entra ID / Azure AD）

```json
{
  "refreshToken": "xxx",
  "accessToken": "xxx",
  "expiresAt": "2026-12-31T00:00:00Z",
  "authMethod": "external_idp",
  "provider": "AzureAD",
  "clientId": "11111111-2222-3333-4444-555555555555",
  "tokenEndpoint": "https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token",
  "issuerUrl": "https://login.microsoftonline.com/<tenant>/v2.0",
  "scopes": "openid profile offline_access <resource-scope>"
}
```

适用于 Microsoft 365 / Entra ID / Azure AD 企业租户账号（既不是 AWS Builder ID 也不是 IAM Identity Center）。Token 刷新走 IdP 的 OAuth2 `refresh_token` grant（公共客户端，表单编码，无 `clientSecret`）：`clientId` 与 `tokenEndpoint` 必填，`scopes` 需含 `offline_access` 才能拿到 refresh token。数据面与 Profile 请求会自动携带 `TokenType: EXTERNAL_IDP` 头，真实 `profileArn` 由 `ListAvailableProfiles` 懒解析回填。

Admin UI 支持完整网页登录流程：先打开 Kiro portal，收到企业 SSO 中间链接后生成第二段 IdP 授权链接，并在页面显式展示链接和复制按钮，方便复制到其它浏览器 / 机器完成登录。若服务所在机器无法监听或访问 IdP 回调端口，也可以手动粘贴中间链接，让服务只负责生成第二段登录链接。

`authMethod` 除 `external_idp` 外也接受 `azuread` / `azure` / `entra` / `microsoft` / `m365` 等别名（统一归一化）；未写 `authMethod` 但带 `tokenEndpoint` 时会自动判定为 `external_idp`。出于防 SSRF / refresh token 外泄考虑，`tokenEndpoint`（及 `issuerUrl`）必须为 `https` 且 host 命中允许列表（`*.microsoftonline.com` / `.us` / `.cn`），否则拒绝导入。

导入时如果缺少 `scopes` / `issuerUrl` / `tokenEndpoint`，会优先从 `accessToken` 的 JWT claims、旧 KAM `userId`、issuer URL 等位置推导；`scopes` 中的 `codewhisperer:*` 会自动补成 `api://<clientId>/codewhisperer:*` 并保留 `offline_access`。

> 企业 SSO 逻辑参考 [Kiro-Go](https://github.com/ngh1105/Kiro-Go) / [Quorinex/Kiro-Go#131](https://github.com/Quorinex/Kiro-Go/pull/131)，并合并了 [doitcan-oiu/kiro.rs-admin](https://github.com/doitcan-oiu/kiro.rs-admin) 对无 `clientSecret` 企业 SSO JSON 的处理思路。

#### Kiro API Key

```json
{
  "kiroApiKey": "ksk_xxx",
  "authMethod": "api_key",
  "endpoint": "cli"
}
```

也可以通过环境变量临时注入最高优先级 API Key 凭据：

```bash
KIRO_API_KEY=ksk_xxx ./kiro-rs
```

### 凭据字段

| 字段 | 说明 |
|---|---|
| `id` | 凭据 ID，Admin 管理时自动分配 |
| `refreshToken` / `accessToken` | OAuth token |
| `expiresAt` | RFC3339 过期时间 |
| `authMethod` | `idc`、`social`、`external_idp`、`api_key`。旧值 `builder-id`、`iam` 会规范化为 `idc`；`azuread` / `entra` 等别名归一化为 `external_idp` |
| `provider` | `BuilderId`、`Enterprise`、`Github`、`Google`、`IAM_SSO`、`AzureAD` 等 |
| `clientId` / `clientSecret` | IdC 刷新 token 所需 OIDC client；`external_idp` 仅需 `clientId`（公共客户端，无 `clientSecret`） |
| `startUrl` | Enterprise IAM Identity Center Start URL |
| `tokenEndpoint` / `issuerUrl` / `scopes` | 企业 SSO（Entra ID / Azure AD）专用：IdP 刷新端点 / OIDC issuer（备注）/ 已授权 scope（需含 `offline_access`） |
| `profileArn` | 真实 profile ARN 或已知固定 ARN；通常由程序维护 |
| `priority` | 数字越小优先级越高 |
| `region` | 凭据级 Region，兼容旧配置 |
| `authRegion` | 凭据级 token 刷新 Region |
| `apiRegion` | 凭据级 API 请求 Region |
| `machineId` | 凭据级 machine id，未填时自动派生 |
| `email` / `subscriptionTitle` | Admin 查询后回填的展示信息 |
| `proxyUrl` | 凭据级代理；可用逗号、空白或换行配置多个候选；填 `direct` 表示绕过全局代理 |
| `proxyUsername` / `proxyPassword` | 凭据级代理认证 |
| `rpmLimit` | 凭据级每分钟请求限制，`0` 表示不限制；批量导入时可统一覆盖 |
| `disabled` | 是否禁用 |
| `kiroApiKey` | `ksk_*` Kiro API Key |
| `endpoint` | `ide` 或 `cli`，未填使用 `config.defaultEndpoint` |

### 导入 / 导出格式

Admin UI 的批量导入和 Account Manager 导入已经合并为同一个入口，支持粘贴或上传以下格式：

- Kiro Account Manager `1.1.2` 旧格式和 `1.8.3` 新格式。
- Kiro-Go / CLiProxyAPIPlus 等扁平 JSON 格式，包括 `access_token`、`refresh_token`、`auth_method`、`profile_arn`、`token_endpoint` 等 snake_case 字段。
- 本项目原生 `credentials.json` 数组格式，兼容 camelCase / snake_case 混用字段。

导入时可统一覆盖代理和 `rpmLimit`，也会自动从 JWT 的 `preferred_username` / `email` / `upn` 补全邮箱。导出支持 Account Manager 嵌套格式和通用 JSON 格式，便于在其它工具之间迁移。

<a id="models"></a>
## 模型

`GET /v1/models` 返回本服务声明的兼容模型 ID。真实可用性仍取决于上游账号订阅；Admin 的“凭据模型”会实时调用 Kiro `ListAvailableModels` 查询该凭据实际可用模型列表，响应测试也可以直接使用这份列表。

当前声明列表包含常见 Claude 别名和 Kiro 原生模型：

- `auto`
- `claude-sonnet-5` / `claude-sonnet-5-thinking`
- `claude-opus-4.8`、`claude-opus-4.7`、`claude-opus-4.6`、`claude-opus-4.5`
- `claude-sonnet-4.6`、`claude-sonnet-4.5`、`claude-sonnet-4`
- `claude-haiku-4.5`
- 兼容旧 Anthropic 风格别名：`claude-fable-5`、`claude-opus-4-8`、`claude-sonnet-4-8`、`claude-opus-4-5-20251101`、`claude-sonnet-4-5-20250929`、`claude-haiku-4-5-20251001` 及对应 `-thinking`
- `deepseek-3.2`
- `minimax-m2.5` / `minimax-m2.1`
- `glm-5`
- `qwen3-coder-next`

模型映射策略：

| 请求模型 | 上游模型 |
|---|---|
| `auto` | `auto` |
| `deepseek-*` | 原样透传 |
| `minimax-*` | 原样透传 |
| `glm-*` | 原样透传 |
| `qwen*` | 原样透传 |
| `claude-<family>-<major>-<minor>` | 自动归一化为 `claude-<family>-<major>.<minor>` |
| `fable`（任意） | `claude-fable-5` |
| `sonnet` + `5`（`sonnet-5` / `sonnet5` / `sonnet.5`） | `claude-sonnet-5` |
| `sonnet` + `4-8` / `4.8` | `claude-sonnet-4.8` |
| `sonnet` + `4-6` / `4.6` | `claude-sonnet-4.6` |
| `sonnet` + `4-5` / `4.5` | `claude-sonnet-4.5` |
| `opus` + `4-8` / `4.8` | `claude-opus-4.8` |
| `opus` + `4-7` / `4.7` | `claude-opus-4.7` |
| `opus` + `4-6` / `4.6` | `claude-opus-4.6` |
| `opus` + `4-5` / `4.5` | `claude-opus-4.5` |
| 任意 `haiku` | `claude-haiku-4.5` |

未命中显式规则的模型会去掉 `-thinking` 后缀后透传给上游，避免 Kiro 新模型发布后必须立即改代码；是否真正可用由 Kiro 返回结果决定。

上下文窗口估算：

- `auto`、`claude-sonnet-4.6+`、`claude-sonnet-5`、`claude-opus-4.6+`、`claude-fable-5`：`1_000_000`
- `deepseek-*`：`164_000`
- `minimax-*`：`196_000`
- `qwen*`：`256_000`
- 其它 Claude / 未知模型：默认按 `200_000` 估算

<a id="thinking-tools-websearch"></a>
## Thinking、工具与 WebSearch

### Thinking

客户端可以显式发送 Anthropic `thinking` 字段，也可以直接使用带 `-thinking` 后缀的模型名。Claude Code 当前也可能在普通模型名下默认发送 `thinking.type=enabled`；服务端会按请求体实际 thinking 配置处理，不依赖模型名是否带后缀。

普通 thinking：

```json
{
  "model": "claude-sonnet-4-8-thinking",
  "max_tokens": 4096,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 20000
  },
  "messages": [
    { "role": "user", "content": "推理一下这个问题" }
  ]
}
```

`budget_tokens` 会限制在 `24576` 以内。

模型名带 `-thinking` 后缀时会自动覆写 thinking 配置：

- Opus 4.6：`thinking.type=adaptive`，并默认设置 `output_config.effort=high`。
- 其它 thinking 模型：`thinking.type=enabled`，`budget_tokens=20000`。

Adaptive thinking：

```json
{
  "model": "claude-opus-4-6-thinking",
  "max_tokens": 4096,
  "thinking": {
    "type": "adaptive"
  },
  "output_config": {
    "effort": "high"
  },
  "messages": [
    { "role": "user", "content": "给出完整分析" }
  ]
}
```

`additionalModelRequestFields.output_config` 是 Kiro 上游的窄兼容字段。当前只会在已知可接受该字段的 Opus 4.6 adaptive thinking 路径上传递；Sonnet 4.5 / 4.8、Opus 4.6 非 adaptive thinking 等路径会跳过该字段，避免上游返回 `additionalModelRequestFields is not supported for this model`。`effort` 会先归一化大小写和空格；已知 4.5 / 4.6 系列不接受 `xhigh`，会降级为最接近的 `high`；Opus 4.7 / 4.8、Fable 5、Mythos 5 会保留 `xhigh`；其它未知模型的已知 effort 值也会保持原样，避免维护一张容易过期的模型白名单；未知 effort 值会回退到 `high`。

Kiro 上游可能返回原生 `reasoningContentEvent`。`kiro-rs` 会把它转换为 Anthropic 兼容内容：

- `text` → 流式 `thinking_delta`，非流式 `thinking` block。
- `signature` → 流式 `signature_delta`，非流式 `thinking.signature`。
- `redactedContent` → `redacted_thinking` block。
- 如果当前请求没有启用 thinking，明文 reasoning 会降级为普通 text；签名和 redacted 内容不会输出。

非流式响应优先使用原生 reasoning 事件；只有没有原生 reasoning 时，才回退到旧的 `<thinking>...</thinking>` 文本提取路径。

### Tool Use

服务端会把 Anthropic tools 转成 Kiro 工具定义，并处理以下兼容逻辑：

- 默认 `toolCompatibilityMode=claude-code`：把 Claude Code 内置工具双向映射为 Kiro 原生工具，覆盖 `Read` / `Write` / `Edit` / `Bash` / `Glob` / `Grep` / `LS` / `WebSearch` 等常见工具。
- 工具入参会做字段转换，例如 Claude Code 的 `file_path` / `content` 会转换为 Kiro 侧的 `path` / `text`，响应返回客户端前再映射回 Anthropic / Claude Code 期望的形态。
- 流式响应里的 `tool_use.input` 会先累积，只有 JSON 完整、字段转换完成后才输出给客户端，避免半截参数触发 `Invalid tool parameters` 或提前执行。
- 会过滤 Kiro 工具 XML 泄漏和不完整的工具片段，减少模型把内部 `<invoke>` / 工具 schema 直接吐给客户端的情况。
- 长工具名会被缩短，并在响应流中恢复原始名称。
- 孤立的 `tool_use` / `tool_result` 会被过滤或修复，避免上游因消息配对错误返回不可恢复错误。
- tool_result 中的图片会提升到 Kiro 顶层图片字段，并走同一套图片缩放逻辑。

如果需要排查上游原始行为，可以把 `toolCompatibilityMode` 设为 `raw`，此时会保留旧的 schema 透传方式。

### WebSearch

支持 Anthropic web_search tool：

```json
{
  "model": "claude-sonnet-4-8",
  "max_tokens": 2048,
  "stream": true,
  "tools": [
    {
      "type": "web_search_20250305",
      "name": "web_search",
      "max_uses": 5
    }
  ],
  "messages": [
    { "role": "user", "content": "搜索今天的相关信息" }
  ]
}
```

纯 web_search 请求会直接走上游 MCP 搜索接口。混合工具场景下，如果上游返回只包含 `web_search` 的工具调用，`kiro-rs` 会内部调用同一套 MCP 搜索接口，把结果作为 tool_result 喂回上游，直到上游停止搜索或达到轮数限制；其它工具调用会原样返回给客户端。

<a id="images"></a>
## 图片处理

入站图片会在本地 CPU 上按需压缩，默认策略：

- 长边上限：`1568px`
- base64 字段大小上限：`400000`
- JPEG 质量：`85`
- PNG / JPEG / WebP 大图会重编码为 JPEG
- GIF 保留原格式，避免破坏动画
- 解码失败时保留原图并记录 warning，不会让整个请求失败

环境变量：

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `KIRO_RS_IMAGE_RESIZE` | `1` | `0`、`false`、`no`、`off` 可关闭 |
| `KIRO_RS_IMAGE_MAX_LONG_SIDE` | `1568` | 长边像素上限 |
| `KIRO_RS_IMAGE_MAX_BYTES` | `400000` | base64 字段大小阈值 |
| `KIRO_RS_IMAGE_JPEG_QUALITY` | `85` | JPEG 输出质量 |

<a id="usage-cache-logs"></a>
## 用量、缓存与日志

运行数据默认落在 `credentials.json` 所在目录。

```text
data/
├── config.json
├── credentials.json
├── client_api_keys.json
├── kiro_stats.json
├── kiro_balance_cache.json
├── proxy_pool.json
├── cache_metering.json
├── traces.db
└── usage_log.YYYY-MM-DD.jsonl
```

说明：

- `client_api_keys.json`：Admin 生成的 `csk_*` 客户端 Key，明文存储，用于鉴权。
- `kiro_stats.json`：凭据成功 / 失败 / 额度 / 冷却等统计。
- `kiro_balance_cache.json`：凭据订阅、额度、邮箱等缓存。
- `proxy_pool.json`：代理池与健康状态。
- `cache_metering.json`：prompt cache 计量缓存，定期落盘。
- `traces.db`：SQLite 请求链路追踪数据库，WAL 模式。
- `usage_log.*.jsonl`：按日滚动请求用量日志。

`CacheMeter` 会基于 `cache_control` 和会话信息模拟 Anthropic prompt cache 口径，输出互斥的：

- `input_tokens`
- `cache_creation_input_tokens`
- `cache_read_input_tokens`
- `output_tokens`

<a id="admin-ui"></a>
## 🖥️ Admin UI

启用 `adminApiKey` 后访问 `/admin`。当前页面：

- 概览：整体请求量、token、模型分布、凭据贡献。
- 凭据管理：添加、SSO 登录、重登、删除、禁用、优先级、余额、模型列表、超额开关、代理绑定、响应测试、隐私模式。
- 客户端 Key：创建、编辑、禁用、删除、重置统计。
- 分组：管理凭据分组，并按组隔离调度。
- 请求日志：查询 `traces.db`，查看失败原因、状态码、凭据尝试链路、端点切换和 token 用量。

Admin 还提供：

- Social、IdC / Enterprise、企业 SSO / external_idp 登录流程。
- 批量导入 / 导出，兼容 Account Manager、Kiro-Go、CLiProxyAPIPlus 等 JSON 格式。
- 全局代理设置、凭据级代理、代理池健康检查、自动停用和批量分配。
- 凭据负载均衡、代理负载均衡、普通 429 重试策略、账号级风控故障转移配置。
- trace / usage log 保留策略。
- 在线更新、自动更新和回退。

<a id="proxy-region"></a>
## 代理和 Region

### Region 优先级

Token 刷新：

```text
credential.authRegion -> credential.region -> config.authRegion -> config.region
```

API 请求：

```text
credential.apiRegion -> config.apiRegion -> config.region
```

部分 REST / 管理类上游接口只在 `us-east-1` 和 `eu-central-1` 提供服务，代码会按账号区域选择候选端点并在必要时回退。

### 代理优先级

```text
credential.proxyUrl -> config.proxyUrl -> direct
```

凭据级 `proxyUrl` 填 `direct` 表示即使配置了全局代理也直连。

全局代理和凭据级代理都可以配置多个候选，使用逗号、空白或换行分隔即可。代理池支持单个 / 批量添加、测活、自动停用和删除；请求时如果当前代理失败，会按候选顺序切换，候选里包含 `direct` 时可自动直连兜底。

`proxyBalancingMode` 支持：

- `sticky`：粘性会话。某个凭据通过某个代理请求成功后，后续优先复用该代理，直到该代理失败或被停用。
- `round_robin`：轮询。按进程内游标在可用代理之间分配。
- `least_load`：最小负载。优先选择当前 in-flight 最少的代理。

支持：

- `http://host:port`
- `https://host:port`
- `socks5://host:port`

如果 `rustls` 环境下代理或证书行为异常，可以在 `config.json` 中切到：

```json
{
  "tlsBackend": "native-tls"
}
```

<a id="load-balancing-failover"></a>
## 负载均衡与故障转移

`loadBalancingMode` 支持：

- `priority`：优先使用 priority 数字最小的可用凭据。
- `balanced`：在可用凭据之间均衡分配。
- `least_conn`：优先使用当前 in-flight 最少的可用凭据，适合高并发账号池。

普通 429 与账号级风控 429 是两套策略：

- 普通 429 默认使用 `retryMode=failover`：先用同一凭据切换 `q` / `runtime` 独立限流端点，备用端点仍失败时再切换其它凭据；不对该凭据施加跨请求冷却，适合多账号池保持吞吐。
- `turbo` / `fast` / `balanced` / `steady` / `polite` 来自 Kiro-RS-Tool 的策略设计，分别对应从激进到保守的普通 429 冷却、重试次数、退避和是否尊重 `Retry-After`。
- `custom` 可手动设置普通 429 冷却、每凭据重试次数、退避范围、是否换凭据和是否尊重 `Retry-After`。
- 账号级 429 风控指上游返回 suspicious activity 一类错误；开启 `accountThrottleFailover` 后会把当前凭据临时冷却并切换账号，冷却状态会在 Admin 凭据管理页展示。

故障处理：

- 单凭据连续 API 失败会增加失败计数，达到阈值后跳过。
- 402 / quota exhausted 会禁用该凭据并切换。
- 401 / 403 中识别到 bearer token 失效时，会对该凭据强制刷新一次 token 后重试。
- 普通 429 可按策略切换端点、切换凭据、短冷却或尊重 `Retry-After`。
- 429 + suspicious activity 可触发账号级冷却并切换凭据。
- 400 客户端请求错误不会切换凭据。
- 网关超时和部分不可恢复错误会快速失败，避免一次请求内无限放大重试。

<a id="updates-release"></a>
## 在线更新和发布

发布 tag `vX.Y.Z` 会触发 Release workflow：

- 校验 `Cargo.toml` 版本和 tag 一致。
- 构建 Admin UI。
- 构建多平台二进制。
- 构建并推送 Docker Hub 多架构镜像。
- 创建 GitHub Release。

Docker 镜像：

- `zyphrzero/kiro-rs:<version>`
- `zyphrzero/kiro-rs:latest`
- `zyphrzero/kiro-rs:beta`（master beta 构建）

容器内在线更新会下载对应平台二进制并替换当前可执行文件；替换后进程退出，由 Docker `restart: unless-stopped` 拉起新进程。回退依赖本地 `<exe>.backup`。

<a id="development"></a>
## 开发

常用命令：

```bash
# 后端测试
cargo test

# 前端构建
cd admin-ui && bun run build

# 后端 release 构建
cargo build --release

# 开启 debug 日志
RUST_LOG=debug ./target/release/kiro-rs
```

发布前建议：

```bash
cargo test
cd admin-ui && bun run build
git diff --check
```

<a id="project-structure"></a>
## 目录结构

```text
.
├── src/
│   ├── anthropic/      # Anthropic API 兼容层
│   ├── kiro/           # Kiro / Amazon Q 上游、token、endpoint、event-stream
│   ├── admin/          # Admin API、用量、trace、代理池、在线更新
│   ├── admin_ui/       # 嵌入式 Admin UI 静态资源路由
│   ├── model/          # CLI 参数和 config.json 模型
│   ├── common/         # 通用鉴权工具
│   ├── image_resize.rs # 图片缩放与 token 估算
│   ├── token.rs        # count_tokens 估算和远程 count_tokens 调用
│   └── main.rs         # 入口
├── admin-ui/           # React Admin UI
├── .github/workflows/  # build、docker、release workflows
├── docker-compose.yml
├── Cargo.toml
└── CHANGELOG.md
```

<a id="license"></a>
## License

见 [LICENSE](LICENSE)。

<a id="community"></a>
## 💬 社区支持

欢迎到 [linux.do](https://linux.do/) 交流、分享和反馈。

<a id="acknowledgements"></a>
## 🙏 致谢

本项目的实现离不开社区项目和反馈的帮助：

- [hank9999/kiro.rs](https://github.com/hank9999/kiro.rs)：原始 Rust 版 Kiro / Amazon Q 到 Anthropic Messages API 兼容代理基础。
- [ZyphrZero/kiro.rs](https://github.com/ZyphrZero/kiro.rs)：本仓库同步的二开上游，提供 `0.6.9` 系列核心源码、Kiro 协议适配和 Claude Code 兼容基础。
- [doitcan-oiu/kiro.rs-admin](https://github.com/doitcan-oiu/kiro.rs-admin)：参考并合并企业 SSO 无 `clientSecret` JSON 导入、`runtime` / `q` 双端点提高并发等改动思路。
- [GreyGunG/Kiro-RS-Tool](https://github.com/GreyGunG/Kiro-RS-Tool)：参考并合并 Claude Code 工具调用双向映射、流式半截 JSON 保护、Kiro 工具 XML 泄漏过滤、CCH / cache 计量修正、thinking 转换和可选 429 重试策略。
- [ngh1105/Kiro-Go](https://github.com/ngh1105/Kiro-Go)：参考 Kiro-Go 的登录、企业 SSO、模型兼容和多格式凭据导入思路。
- [Quorinex/Kiro-Go#131](https://github.com/Quorinex/Kiro-Go/pull/131)：参考 Azure AD / external_idp 凭据字段和刷新流程。
- [Kiro-account-manager](https://github.com/chaogei/Kiro-account-manager)：兼容其 `1.1.2` / `1.8.3` 账号导入导出格式，并支持 Account Manager 风格导出。
- CLiProxyAPIPlus / CLIProxyAPI 生态：兼容其扁平 JSON 凭据导出格式，包括 snake_case 字段、缺邮箱凭据、JWT scopes 推导等场景。
- [kiro2api](https://github.com/caidaoli/kiro2api)：API 兼容、路由和代理网关设计参考。
- [proxycast](https://github.com/aiclientproxy/proxycast)：代理池、管理面板和多账号代理调度设计参考。

感谢所有 issue、PR、测试和部署反馈的贡献者。
