# GitHub Pages 展示交付 · 2026-10-20

## 地址与范围

展示首页：`https://snowpr1nt.github.io/love-flight-chess/doubao/`

联机游戏：该目录下 `play.html`；同屏试玩：`local.html`。

用户确认使用 GitHub 免费地址，路径带 `doubao`。没有绑定、注册或声称拥有 `doubao.com` 等独立域名。页面中 DOUBAO 为本次展示版本名称，不代表任何第三方官方出品。

展示首页沿用奶油波点、粉蓝、紫色边线、原创像素猫与草莓，包含游戏实景、三步玩法、双人联机与同屏入口、页面链接复制。游戏和邀请链接保留在 Pages 路径下，不以跳转原站作为实现。

## 托管与身份

GitHub Pages 提供前端静态文件。原 Cloudflare Workers / D1 联机服务继续负责身份、房间、权威结算和持久化；浏览器地址栏不包含 `chatgpt.site`，网络请求仍可查到后端地址。

后端仅额外允许 `https://snowpr1nt.github.io` 来源，校验 OPTIONS 请求方法和请求头，不开放通配 CORS、不携带跨站 Cookie。Pages 使用 Bearer 体验凭证；凭证只存在该浏览器的本地存储和发给服务端的 Authorization 头，不出现在邀请链接、日志、源码或房间快照中。清除浏览器站点数据会丢失体验身份。原站继续使用 HttpOnly Cookie，同源接口不返回其 Cookie 凭证。

GitHub Pages 同一用户的项目共享 Origin，因此不要在同一 `snowpr1nt.github.io` 下托管不可信脚本；当前游戏和展示页不加载第三方脚本。凭证有效期 7 天，房间过期策略与 V5 一致；微信登录尚未接入。

## 构建与发布

```sh
node scripts/build-pages.mjs
node --test tests/engine.test.cjs tests/online.test.mjs
```

构建仅从固定源码与公开素材生成 `pages-dist/`，不把后端、数据库、本地运行数据或 Git 元信息发布到 Pages。`pages-dist/` 被 Git 忽略；GitHub Actions 在 Node 24 中重新构建并测试，上传目录后使用官方 Pages action 发布。仓库 Pages 的发布来源设为 GitHub Actions。后续 main 提交自动发布，Git 继续记录源码和修改说明。

构建文件 `js/pages-config.js` 只含公开 API 地址，不含任何密钥。

## 本次验证

- 28 项规则与联机测试通过，其中新增跨域双人完整回合、预检白名单、跨站 Cookie 隔离及异常 Bearer 拒绝测试。
- 独立子 Agent 只读复核通过，核对身份、CORS、相对邀请链接、构建产物及发布流程。
- 本地浏览器检查 1440px、390px、320px，展示图全部加载、无横向溢出，同屏试玩显示 44 格；未捕获脚本异常。
- 线上发布和双端真实体验结果以交付消息与 GitHub Actions 记录为准。
