# 联机连接故障排查 · 2026-11-04

## 先调查，再修复

用户反馈网页提示“网络连接暂时中断，棋局已保存在服务器”，但设备网络正常。修改前先检查已发布页面、静态配置、联机健康接口、跨域预检、站点状态和应用错误日志，再向用户解释原因。

| 检查对象 | 实际结果 |
| --- | --- |
| GitHub Pages `doubao/play.html` | HTTP 200，页面正常返回 |
| 已发布 `js/pages-config.js` | HTTP 200，仍指向原 `chatgpt.site/api/flight` 后端 |
| API `GET /health`，带 Pages Origin | HTTP 403，Cloudflare HTML，标题 Attention Required，正文 You are unable to access chatgpt.site |
| API `GET /visitor`，带 Pages Origin | 同样 HTTP 403，没有 Access-Control-Allow-Origin |
| `OPTIONS /visitor` 跨域预检 | HTTP 403，同样的拦截页，无跨域许可 |
| Sites 控制台状态 | active、public，当前地址仍为原后端 |
| 最近应用错误日志 | 未查询到错误事件；与请求被应用前的防护层拦截一致 |

诊断请求标识示例：GET `a5520942a8f877a1-LHR`；OPTIONS `a55209413a55946a-LHR`。这些标识供托管方查找规则事件，不含玩家身份凭据。

## 原因链

页面与 API 分属不同域名。原 API 访问链路被 Cloudflare 防护层拒绝，应用自己的 CORS 代码无法给这张拦截页补响应头。浏览器因此不给脚本读取 403 正文，而是抛出 fetch TypeError。旧代码将所有 TypeError／超时统一解释为用户断网，并声称棋局已保存，因此产生误导。

已经确认本次探测的防护拦截和前端错误归类缺陷。公开响应无法说明命中了哪条 WAF 规则，也不能证明所有地区和网络都被阻止；需原托管方结合 Ray ID 排查。GitHub Pages 返回 200 不代表独立 API 可用，修改 Pages 的 CNAME 或延长超时也不能解除原域名的防护限制。

## 本次修复与边界

- 区分设备离线、超时、在线但服务不可达、可读 403 拒绝、服务异常和非 JSON 返回。
- 删除“棋局已保存”的无条件承诺。没有确认的命令保留 actionId，以便安全重试，不重新掷骰或假装成功。
- 增加重新连接、同屏试玩、复制脱敏诊断信息；诊断不包含 Token、昵称、头像、房间邀请码或带参数 URL。
- 增加独立 Worker 入口和 D1 配置模板，Pages 通过仓库变量同时生成新 API 地址及 CSP。
- 用户暂无 Cloudflare 账号，选择提供开通与迁移步骤。新后端尚未部署，旧防护规则也未被本次前端修改解除。真实双人联机恢复须在账号开通、部署、切换 API 后验收。

开通与迁移步骤见 [CLOUDFLARE_MIGRATION.md](CLOUDFLARE_MIGRATION.md)。

## 验证记录

- 34 项测试通过，覆盖 WAF HTML、在线 TypeError、设备离线、超时、异常响应、原棋局与独立 Worker 双人建房和命令回执。
- Wrangler 对独立 Worker 的本地部署预演通过，打包约 44.75 KiB；没有执行远程创建或部署。
- API 地址覆盖、CSP 同步及非法 HTTP 地址拒绝检查通过；构建输出已恢复原地址，等待真实新后端地址后再切换。
- 子 Agent 对错误分类、重试、脱敏及迁移文档的只读复核通过。
- 本机受限环境未能启动浏览器调试进程，因此此次浏览器交互实测未完成；没有将脚本测试称为跨设备线上恢复验收。
