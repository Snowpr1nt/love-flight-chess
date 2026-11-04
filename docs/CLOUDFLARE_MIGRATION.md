# 独立联机后端开通与迁移

这是恢复异地联机的后续操作单。代码和模板已准备好，尚未创建 Cloudflare 账号、数据库或线上 Worker；当前 Pages 仍使用原后端。无需把密码、API Token 发到聊天或提交到仓库。

## 1. 开通账号

1. 打开 [Cloudflare 注册页](https://dash.cloudflare.com/sign-up)，用自己的邮箱注册并完成邮箱验证。
2. 打开控制台的 Workers / Workers & Pages 区域，按提示启用 Workers，设置自己的 `workers.dev` 子域名。
3. 可先选择控制台提供的 Free 方案进行演示，具体额度和可用性以控制台及 [Workers 官方说明](https://developers.cloudflare.com/workers/get-started/guide/) 为准。这个方案不需要购买独立域名。

完成这一步后告知开发者“账号已开通”，由账号本人在浏览器完成后续 OAuth 登录。不要发送账号密码或 Token。

## 2. 准备源码与登录（开发者操作）

本地项目需要 Node.js 24 与 pnpm，进入源码根目录：

```powershell
pnpm install --frozen-lockfile
node scripts/prepare-game.mjs
pnpm exec wrangler login
```

最后一条会打开浏览器，登录自己的 Cloudflare 账号并授权 Wrangler。只在自己的设备与官方页面操作。数据库和应用要创建在同一个账号下。

## 3. 创建 D1 数据库

```powershell
pnpm exec wrangler d1 create love-flight-chess
```

把返回的 `database_id` 填入 `cloudflare/wrangler.jsonc` 中的 `REPLACE_WITH_YOUR_D1_DATABASE_ID`，保留 binding 名称 `DB`。数据库 UUID 是配置标识，不是登录密钥；不要把 OAuth 凭据写入配置。

应用已有五张表和唯一索引，使用迁移命令建表：

```powershell
pnpm exec wrangler d1 migrations apply DB --remote --config cloudflare/wrangler.jsonc
```

确认目标是刚创建的 `love-flight-chess`。不要对旧数据库重复直接执行初始 CREATE 脚本，迁移工具会记录已应用的 SQL。

## 4. 部署独立 Worker

```powershell
node scripts/prepare-game.mjs
pnpm exec wrangler deploy --config cloudflare/wrangler.jsonc
```

记录成功输出的实际 HTTPS 地址，例如：

```text
https://love-flight-api.<你设置的子域名>.workers.dev
```

以上为格式示例，不能直接作为可用网址。入口是 `cloudflare/worker.mjs`，使用原有权威规则、D1 状态和幂等回执，不依赖原 Sites、Next 或 Vinext 运行时。

用实际地址打开 `/api/flight/health`，应获得包含 `ok: true` 的 JSON。注意：health 只说明入口和 DB 绑定可用，不代表表已建好，下一步还必须实际建房验收。

## 5. 切换 GitHub Pages

打开仓库 **Settings → Secrets and variables → Actions → Variables → New repository variable**：

- Name：`LOVE_FLIGHT_API_BASE`
- Value：`https://实际Worker地址/api/flight`

这是公开 API 地址，不能填写 API Token。使用 HTTPS，末尾必须是 `/api/flight`，不要添加账号密码、查询参数或 fragment。

然后进入 **Actions → Publish doubao delivery page → Run workflow**，选择 `main` 并运行。构建会同时更新 `js/pages-config.js` 和页面 CSP 的 `connect-src`，无需改游戏交付网址。

发布成功后打开：`https://snowpr1nt.github.io/love-flight-chess/doubao/play.html`。

本地构建调试也支持同一变量：

```powershell
$env:LOVE_FLIGHT_API_BASE = 'https://实际Worker地址/api/flight'
node scripts/build-pages.mjs
```

## 6. 迁移验收

1. 两台真实设备分别建立昵称头像身份，创建、邀请、审核、双方准备。
2. 检查允许的 Pages 来源预检成功，非授权来源仍被拒绝。
3. 检查双方实际骰点、位置和任务一致，等待方不能代操作。
4. 同一 actionId 重试只结算一次，刷新和断线后不丢失新棋局。
5. 确认 API 返回 JSON，浏览器不再收到 403 HTML 或 CORS 错误。在玩家实际使用的网络上验收。

新域名与新 D1 默认是新的体验身份和房间。旧域名凭证不会发送到新域名，旧棋局也不会自动迁移；请重新填写昵称并创建房间。若需迁移历史数据，必须获得原数据库管理权限并完整迁移 guests、rooms、commands 等数据，不能只拷贝 rooms 表。

如果迁移后有问题，先确认 D1 迁移已执行、配置绑定名为 DB、仓库变量填写正确且重新运行了 Pages 发布，再查看自己的 Cloudflare Worker 日志。不要以删除浏览器数据作为第一步，以免丢失可恢复的体验身份。

## 官方参考

- [Workers 部署入门](https://developers.cloudflare.com/workers/get-started/guide/)
- [D1 入门](https://developers.cloudflare.com/d1/get-started/)
- [D1 Wrangler 命令](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)
