# 恋爱飞行计划 · 双人联机体验

异地情侣真心话大冒险飞行棋。两个人使用各自的手机或电脑，加入同一个房间，轮流掷骰、完成互动。保留共同起点、44 格手绘像素回旋棋盘、18 道真心话、18 道大冒险、奖惩连锁和中央爱心终点。

## 体验

演示站：https://love-flight-duo-demo.sunnylyric36.chatgpt.site

1. 两个人分别打开网址，填写昵称，选择像素猫头像或上传自己的头像。
2. 一人创建房间，复制邀请链接或六位房间码发给另一人。
3. 另一人申请加入；房主确认后，两人都点击准备，系统随机决定先手。
4. 当前玩家掷骰并确认任务；另一方可以同步看到棋子、骰子和任务，等待自己的回合。
5. 刷新页面或短暂断网后，可回到当前房间。请使用原浏览器，保留站点 Cookie。

这是昵称头像体验身份，**尚未接入真实微信登录**。没有上传互动答案、录音或聊天功能。音效默认关闭，可在游戏设置开启。自定义文本的最终约定仅留在各自设备；最终奖励选项在房间内同步。

## 已实现的联机能力

- 服务端决定骰点、回合、奖惩位移和胜利结果，另一方无法代替当前玩家操作。
- 房主审核加入申请；固定两个席位；未获准的人无法读取棋局和头像。
- 数据库保存棋局，命令具备版本校验、幂等回执和并发保护。
- 约 1.1 秒间隔的 HTTPS 同步，双方分别播放骰子和逐格移动动画。网络延迟会影响看到更新的时间，不保证动画逐帧同步。
- 断线后暂停操作，双方重连后恢复。等待房间 30 分钟过期，开局后的房间 24 小时过期；过期后不可继续访问。过期数据尚未配置定时清理。
- 头像显示在双方状态栏及棋子上；上传图片先在设备上裁剪压缩，不接收任意外部图片地址。

## 本地运行

需要 Node.js 24 和 pnpm 11。无依赖的本地联机预览：

```sh
node scripts/dev-flight.mjs
```

打开 `http://127.0.0.1:8787/`，用两个不同浏览器或独立浏览器会话测试。该预览使用 Node 内置 SQLite，数据库位于被 Git 忽略的 `.sites-runtime/`。同一浏览器中的普通标签页共享一个玩家身份。

完整框架构建：

```sh
pnpm install --frozen-lockfile
pnpm build
```

生产运行使用 Vinext / Cloudflare Workers 和 D1。Sites 构建与发布使用插件提供的构建、源码同步、打包和版本发布流程；`.openai/hosting.json` 保存站点身份，`drizzle/` 保存建表迁移。不将部署凭据写入源码。

离线同屏版仍可双击根目录 `index.html` 使用；它与联机房间互不读写进度。

## 玩法

双方从同一起点出发。未起飞时掷出 2／4／6 进入第 1 格，奇数换人；掷 6 不补掷。起飞后按点数逐格前进。奖励格先选择再前进 2 格，惩罚格先选择再回退 2 格，落地继续触发任务。36 个互动任务支持双方同意后换题或跳过。从第 44 格再走一步进入中央爱心，超出则回弹，精准抵达才获胜。双方确认后可以再开一局。

## 源码入口

| 文件 | 用途 |
| --- | --- |
| `js/engine.js`、`js/board-data.js` | 客户端与服务端共用的棋局规则 |
| `js/ui.js`、`css/redesign.css` | 回旋棋盘、动画、任务和本地模式 |
| `js/online.js`、`css/online.css` | 房间大厅、头像、同步及断线恢复 |
| `server/service.mjs` | 权威结算、成员权限、回执及 D1 持久化 |
| `app/api/flight/[...path]/route.ts` | 生产 API 入口 |
| `db/schema.ts`、`drizzle/` | 数据表及迁移 |
| `scripts/prepare-game.mjs` | 生成网页静态资源及服务端规则模块 |
| `tests/engine.test.cjs`、`tests/online.test.mjs` | 规则与联机验收测试 |

运行测试：

```sh
node scripts/prepare-game.mjs
node --test tests/engine.test.cjs tests/online.test.mjs
```

## 记录与后续

[修改记录](CHANGELOG.md) · [本次交付说明](docs/ONLINE_DELIVERY.md) · [原联机与微信设计](docs/ONLINE_DESIGN.md) · [协议草案](docs/ONLINE_PROTOCOL.md) · [素材来源](assets/SOURCES.md)

当前演示使用 D1 和 HTTPS 同步，替代原设计草案的 PostgreSQL / WebSocket 部署方案。后续可以沿用命令协议接入 WebSocket、真实微信授权和小程序前端；本版本不包含这些未实施能力。

预览：[大厅](previews/online-lobby.png) · [联机棋盘](previews/online-desktop.png) · [手机](previews/online-mobile.png)。源码与历史记录：[GitHub](https://github.com/Snowpr1nt/love-flight-chess)。
