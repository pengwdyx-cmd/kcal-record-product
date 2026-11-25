# 部署前检查清单（卡路里记录 Web · 2026-11-25）

> 状态：**仅整理，未执行部署**。本文档基于当前代码实测数据整理，供部署时逐项核对。
> 项目根：`06_Project_Portfolio/project_calorie_web_V0.3_20261123_170123/projects/`

## 一、技术事实（已核实）

### 1. 框架版本
| 项 | 版本 |
|---|---|
| Next.js | **16.1.1**（App Router，webpack 构建，非 Turbopack） |
| React / React DOM | 19.2.3 |
| TypeScript | ^5 |
| Node 要求 | **>= 20.9.0**（next 16.1.1 engines 官方约束） |
| 包管理器 | **pnpm >= 9.0.0**（preinstall 有 `only-allow pnpm` 强制） |

### 2. build / start 命令（package.json scripts 实际指向 bash 脚本）
```
pnpm build  →  scripts/build.sh：
  1) 安装依赖（prepare-node-modules.sh）
  2) pnpm next build --webpack          ← 必须带 --webpack（项目有 webpack 配置）
  3) pnpm tsup src/server.ts ...        ← 打包出自定义服务器 dist/server.js

pnpm start  →  scripts/start.sh：
  PORT=${DEPLOY_RUN_PORT:-5000} node dist/server.js
```
`src/server.ts` 行为（部署关键）：
- `dev = process.env.COZE_PROJECT_ENV !== 'PROD'` → **不设 COZE_PROJECT_ENV=PROD 会以 dev 模式跑**，假死风险重现。
- `server.listen(port)` 未绑定 host → 默认监听所有网卡（0.0.0.0），公网可达，无需改代码。
- 端口读 `PORT` 环境变量（默认 5000），不写死。

### 3. 工作流 1 请求最长耗时
| 场景 | 实测/设定 |
|---|---|
| 真实餐图实测 | **75–90s**（干煸鱿鱼.jpg 实测 86s） |
| 服务端上游超时上限 | 上传 60s + 流式工作流 **180s** = 理论最长 **240s** |
| **平台/网关超时要求** | **≥ 240s，建议配 300s**（Nginx `proxy_read_timeout 300s`；Serverless 默认 10–60s 会截断，不可用） |

### 4. 环境变量（配在平台/服务器，不进代码仓库）
| 变量 | 必需性 | 说明 |
|---|---|---|
| `COZE_API_TOKEN` | 必需 | 只在 workflow1/workflow2 两个 route.ts 服务端读取 |
| `COZE_WORKFLOW1_ID` | 必需 | 工作流 1（图片识别） |
| `COZE_WORKFLOW2_ID` | 必需 | 工作流 2（热量计算） |
| `COZE_APP_ID` | 必需 | 应用 ID |
| `COZE_PROJECT_ENV` | **部署必需** | 设 `PROD`，否则自定义 server 走 dev 模式 |
| `PORT` | 平台注入 | 监听端口（默认 5000） |
| `DEPLOY_RUN_PORT` | 可选 | start.sh 的端口来源，优先于默认 5000 |

禁止任何 `NEXT_PUBLIC_*` 前缀的密钥变量。已核验：客户端产物、SSR HTML、日志文件均无密钥泄露。

### 5. 本地文件日志依赖（有，需要注意）
三个文件都由 `appendFileSync` 写到 `process.cwd()`（项目根，**启动时的工作目录**）：
- `workflow1-debug.log` / `workflow1-runs.jsonl` / `workflow2-runs.jsonl`
- 单实例云服务器：没问题，只需保证工作目录可写。
- Serverless / 只读文件系统 / 多实例：日志会丢失或分散；隐藏页 `/devtools/coze-runs` 读不到记录；**业务主流程不受影响**（写日志已 try/catch）。
- 建议：磁盘空间有限时定期清理；或后续改集中日志（本次不改代码）。

### 6. /devtools/coze-runs 临时关闭方式
该页含 debug_url（7 天有效，可看工作流节点输入输出，含用户餐食图），公网必须关闭或加鉴权：
- **方案 A（推荐，零代码改动）**：Nginx 加一条规则直接封路径：
  ```nginx
  location ^~ /devtools/ { return 404; }
  ```
  随时可注释回来，改完 `nginx -s reload`。
- **方案 B（重新构建生效）**：把 `src/app/devtools` 文件夹改名（如 `_devtools_disabled`，`_` 开头是 Next 私有目录不生成路由），再 `pnpm build`。
- 现状：页面已有 robots.txt disallow，但这只是搜索引擎礼貌，不挡人。

## 二、部署到普通 Node.js 云服务器的配置清单

### 服务器基础
1. 系统：Linux（Ubuntu 22.04+ 推荐）
2. **Node.js ≥ 20.9**（建议 20 LTS 或 22），**pnpm ≥ 9**（`npm i -g pnpm@9`）
3. 进程守护：pm2 或 systemd（示例：`pm2 start "node dist/server.js" --name calorie-web`，注入环境变量）
4. 建议加 2G swap（build 阶段内存峰值较高）

### 构建（二选一）
- 服务器上构建：上传源码（不含 node_modules）→ `pnpm install` → `pnpm build`
- **本地构建后上传**（内存小的服务器推荐）：本机 `pnpm build` → rsync 上传 `.next/`、`dist/`、`public/`、`node_modules/`、`package.json` 等

### 启动
```
COZE_PROJECT_ENV=PROD PORT=5000 node dist/server.js
```

### 反向代理（Nginx，必须）
```nginx
server {
  listen 80;
  server_name 你的域名或IP;
  location ^~ /devtools/ { return 404; }      # 临时关闭调试页
  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_read_timeout 300s;                  # 关键：工作流1最长240s
    proxy_send_timeout 300s;
    client_max_body_size 10m;                 # 图片 dataURL，留余量
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```
- HTTPS：certbot / Let's Encrypt（涉及用户上传照片，建议上）
- 安全组：只开放 80/443，**不要暴露 5000 端口**
- 国内服务器绑域名需 ICP 备案

### 公开前必须处理的安全项
| 项 | 风险 | 处理 |
|---|---|---|
| `/devtools/coze-runs` | 泄露 debug_url 与用户餐食节点数据 | Nginx 封路径（见上）或改鉴权 |
| 无限流 | 任何人调用即消耗你的 Coze 积分（每次识别约 75–90s，成本高） | 加简单限流/访问口令/验证码 |
| 密钥 | 泄露即积分被盗刷 | 只放服务端环境变量；已核验当前产物干净 |

### 数据一致性预期（当前无数据库/用户ID，属已知取舍）
- 统计页历史存各用户浏览器 localStorage：体验与本地一致，但**不跨设备、不跨浏览器**。
- 确认页载荷存 sessionStorage：公网 HTTPS 下行为不变。

## 三、推荐服务器规格（不过度配置）

本机生产模式实测：启动 CPU 1.8s、常驻内存 **~107MB**（对比 dev 假死期 875MB）。

| 项 | 推荐 | 说明 |
|---|---|---|
| CPU | **2 核** | 1 核也能跑，但 build 阶段和并发请求会吃紧 |
| 内存 | **2G + 2G swap** | 常驻 ~110MB 绰绰有余；内存主要耗在服务器上执行 build（若本地构建则 1G 也可） |
| 磁盘 | 40–50G SSD | 系统 + 依赖 + 日志足够；无数据库 |
| 带宽 | 3–5Mbps 固定 或 按流量 | 页面小、图片在客户端压缩后上传（~190KB/张），并发低时 3M 够用 |
| 数据库 | **不需要** | 当前无 DB；package.json 里的 pg/drizzle/supabase 是预装未用 |

**结论：2核2G 轻量云服务器（腾讯云/阿里云轻量应用服务器档即可），不要上 4核8G。**

## 四、部署平台对比（2026-11-25 调研，按「能否稳定支持 240s 请求」筛选）

> 本项目工作流 1 是一次最长 240s、期间几乎不向客户端发字节的 POST 请求，平台代理超时是第一筛选标准。数据来源：各平台官方文档（调研当日核对）。

### ✅ 通过筛选（超时可达 240s 以上）

| 平台 | 请求超时上限 | 本项目适配性备注 |
|---|---|---|
| **自管 VPS**（腾讯云/阿里云轻量 + Nginx） | 无平台限制；Nginx 自配 `proxy_read_timeout 300s` | **首选**。本清单第二节即此方案；本地文件日志正常写入；国内访问快；需自己管备案/HTTPS/安全 |
| **Render**（Web Service） | HTTP 响应最长 **100 分钟**（官方对比文档） | 免费档 15 分钟无流量休眠→冷启动几十秒，用户首次请求体验差；付费档常驻。文件日志可写（持久容器）。国内直连速度一般 |
| **Zeabur**（容器托管） | 无文档化的请求超时限制（容器常驻进程） | 华人团队、部署简单，国内访问友好；文件日志可写；小项目费用高于 Render 免费档 |
| **Google Cloud Run** | 默认 300s，可配置到 **3600s**（`--timeout`） | 需容器化部署 + 改一行配置即可；国内访问差（无中国区），慎选 |
| **Vercel**（Fluid compute） | Hobby 默认/最大 **300s**；Pro 可到 800s | 超时刚好过线（240s<300s 默认值，无需配置）。⚠️ 但两个硬伤：①函数文件系统只读 → 本地日志/jsonl 全部失效，`/devtools/coze-runs` 无记录；②国内访问默认域名不稳定。不推荐本项目 |
| **阿里云函数计算 FC** | 函数最长 **86400s**（24h） | 超时充足；但 Serverless：文件日志丢失/多实例分散、冷启动；对 Next.js 自定义 server 改造大。不推荐 |

### ⚠️ 勉强过线（余量太小，不建议）

| 平台 | 限制 | 风险 |
|---|---|---|
| Railway | 无数据传输 **300s** 断开；请求总时长上限 **900s**（官方文档+官方论坛确认不可调） | 工作流 1 等待期 240s 已贴近 300s 无数据上限——若 Coze 侧偶发卡顿即被掐断。除非把响应改为流式推心跳，否则不要用 |

### ❌ 被筛掉（超时无法支持 240s）

| 平台 | 请求超时 | 说明 |
|---|---|---|
| Netlify | 同步函数最长 **60s**（同步不可配置） | 远低于 240s |
| Fly.io | 代理 **60s** 无字节即断开（普通套餐不可配） | 本项目请求期间不回字节，必断 |
| Heroku | 首字节 **30s**（H12 错误，路由器层面固定） | 远低于 240s |
| AWS Lambda + API Gateway | 集成超时 **29s**（API Gateway 硬限制） | 远低于 240s |
| Cloudflare Workers/Pages | 墙钟时长无硬限制 | 超时本身可行，但：CPU 计费模型（免费 10ms/付费 30s）、Next.js 需 OpenNext 适配、**文件系统只读（日志/jsonl 全失效）**，对本项目属于「超时可行但整体不适配」 |

### 结论
1. **首选：2核2G 国内轻量云服务器自管（本清单第二节方案）**——唯一同时满足「超时充足 + 日志正常写 + 国内访问快」的方案。
2. 备选（不想管服务器运维时）：**Render 付费档** 或 **Zeabur**，两者都是常驻容器、无超时风险、文件日志可写；代价是国内访问速度/合规与备案问题。
3. Serverless 系（Vercel/Netlify/FC/Cloudflare）对本项目当前形态都不合适：要么超时不够，要么文件日志失效。

## 五、逐项核对清单（部署当天用）

- [ ] Node >= 20.9、pnpm >= 9
- [ ] 环境变量 5 项齐全（4 个 COZE + COZE_PROJECT_ENV=PROD）
- [ ] `pnpm build` 成功、`node dist/server.js` 启动且 `COZE_PROJECT_ENV=PROD`
- [ ] Nginx：proxy_read_timeout 300s、client_max_body_size 10m、封 /devtools/
- [ ] 真实跑一遍 上传→识别→确认→计算→结果
- [ ] `curl -I https://域名/devtools/coze-runs` 返回 404
- [ ] 检查服务器上 jsonl/debug.log 正常写入（工作目录可写）
- [ ] 限流/口令已配
- [ ] HTTPS 生效、安全组只开 80/443


