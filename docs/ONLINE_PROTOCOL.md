# 双人联机协议草案 v1

日期：2026-10-19。状态：设计契约，尚无联网接口实现。与 [联网设计](ONLINE_DESIGN.md) 配套。

## 1. 公共约定

- HTTP 使用 JSON；生产 HTTPS／WSS，同源网页优先。WebSocket 使用标准 JSON 消息，不依赖 Socket.IO 协议，便于浏览器和微信 `SocketTask` 共用。
- 协议版本 `protocolVersion=1`；现有引擎 `rulesVersion=3`；题库版本独立为 `contentVersion`。
- 日期时间用服务器毫秒时间戳。客户端不据本机时钟决定动作是否合法。
- ID、payload 和消息长度均在边界校验，未知动作默认拒绝。账户、座位与房间权限来自服务端会话，忽略前端自称的角色。

## 2. HTTPS 接口草案

| 方法与路径 | 用途 | 身份／约束 |
| --- | --- | --- |
| `POST /api/auth/dev` | 本地开发测试身份 | 仅明确启用的非生产环境 |
| `POST /api/auth/wechat/code` | 原生微信 code 换业务会话 | 服务端预设客户端类型 → AppID 配置 |
| `GET /api/auth/wechat/h5/start` | 开始具备权限的 H5 微信授权 | 一次性 state，受限回跳 |
| `GET /api/auth/wechat/h5/callback` | 校验回调并建立会话 | 与原生 code 接口独立 |
| `POST /api/auth/logout` | 撤销当前业务会话 | 同时撤销实时连接 |
| `GET /api/me` | 读取业务资料 | 不返回 OpenID／session_key |
| `PATCH /api/me/profile` | 更新昵称与内部头像资源 ID | 只能修改当前账户 |
| `POST /api/me/avatar-upload` | 获取受控头像上传授权 | 所有权、大小、类型、用途限制 |
| `POST /api/rooms` | 创建双人房间 | 已登录，限流 |
| `POST /api/rooms/join-requests` | 申请加入邀请房间 | 不可枚举房间，限流，校验邀请码期限 |
| `POST /api/rooms/:id/join-requests/:requestId/accept` | 房主接受第二位 | 原子占座，满员不能覆盖 |
| `POST /api/rooms/:id/join-requests/:requestId/reject` | 拒绝申请 | 仅房主，未开局 |
| `GET /api/rooms/:id/snapshot` | 最新房间与棋局快照 | 仅两个已确认成员 |
| `POST /api/realtime-tickets` | 换取一次性 WebSocket 认证票据 | 业务会话有效，票据 30 秒过期 |
| `POST /api/rooms/:id/commands` | HTTP 兜底提交命令 | 与 WebSocket 共用相同事务服务 |

浏览器 Cookie 认证的写接口还需 CSRF 防护和严格 Origin 检查。接口版本、错误与上传校验的实现细节在 M1／M2 完成时用 API 契约文件固化。

## 3. 连接与快照

连接建立后 5 秒内发送 `AUTH {ticket}`；服务端验证一次性票据后返回 `AUTHENTICATED`。未认证连接不能订阅房间。之后发送 `SUBSCRIBE {roomId,lastRevision}`，服务器校验成员身份后返回最新快照；可以附带有限的缺失事件用于状态提示，不强制重播历史动画。

客户端与服务端定时交换心跳。鉴权失败、会话撤销、协议不兼容或同账号新连接接管时发送明确原因并关闭连接，不能无限自动重试无效凭据。

快照示例（资料均为示意，不对应真实账户）：

```json
{
  "protocolVersion": 1,
  "type": "ROOM_SNAPSHOT",
  "roomId": "room_example",
  "revision": 12,
  "serverTime": 1792342800000,
  "roomStatus": "playing",
  "matchId": "match_example",
  "rulesVersion": 3,
  "contentVersion": "long-distance-v1",
  "selfSeat": 0,
  "members": [
    {"seat": 0, "userId": "u_a", "nickname": "小粉", "avatarAssetId": "a_1", "avatarVersion": 1, "online": true},
    {"seat": 1, "userId": "u_b", "nickname": "小蓝", "avatarAssetId": "a_2", "avatarVersion": 1, "online": true}
  ],
  "engineState": {
    "version": 3,
    "players": [{"name": "小粉", "progress": 0}, {"name": "小蓝", "progress": 0}],
    "current": 0,
    "phase": "await_roll",
    "pendingCard": null,
    "firstWinner": null,
    "finaleChoice": null,
    "lastRoll": null,
    "turnNumber": 1,
    "chainDepth": 0
  },
  "presentation": null
}
```

`engineState` 必须通过现有 `engine.validateState()`，资料由 members 单独提供。头像访问链接由受控资源解析返回，不把微信会话字段塞进 members。

## 4. 命令格式与权限

```json
{
  "protocolVersion": 1,
  "type": "COMMAND",
  "roomId": "room_example",
  "matchId": "match_example",
  "actionId": "客户端为这次操作生成且重试保持不变的 UUID",
  "expectedRevision": 12,
  "command": {"type": "ROLL_REQUEST"}
}
```

| 命令 | 参数 | 服务器转换与权限 |
| --- | --- | --- |
| `SET_READY` | `ready` | 等候室成员，双方准备才开局 |
| `ROLL_REQUEST` | 无骰点 | 当前方且 await_roll；服务端生成 die → `ROLL` |
| `COMPLETE_TASK` | 无 | 当前方普通题卡 → `RESOLVE_CARD` |
| `SKIP_TASK` | 无 | 当前方当前任务／奖惩 → `RESOLVE_CARD {skipped:true}` |
| `SWAP_TASK` | 无 cardId | 当前方普通题卡；服务端选同类型题 → `SWAP_CARD` |
| `CHOOSE_EFFECT` | `optionId` | 当前方奖惩卡 → `RESOLVE_CARD {optionId}` |
| `CHOOSE_FINALE` | `optionId` | 获胜方且尚未选择 → 现有 `CHOOSE_FINALE` |
| `REQUEST_REMATCH` | 无 | 成员发起新局提议，不立刻清空棋局 |
| `ACCEPT_REMATCH` | `proposalId` | 另一位确认后新建 matchId |
| `RESUME_MATCH` | 无 | 暂停对局的成员确认恢复，双方确认后开放操作 |

最终约定第一版保存选项 ID。若后续增加两端共享自由文字，须另行设计双方确认、内容处理、读取范围和删除机制，不顺便上传现有 localStorage 约定文字。

所有命令在服务端事务中执行；等候室的 matchId 可为空，已开局的玩法命令必须匹配当前 matchId。幂等查找在 revision 检查之前，合法重试返回原接受结果，不产生第二次随机数或第二条状态变化。

## 5. 权威结果与动画

```json
{
  "protocolVersion": 1,
  "type": "COMMAND_ACCEPTED",
  "roomId": "room_example",
  "matchId": "match_example",
  "actionId": "与命令相同的 UUID",
  "previousRevision": 12,
  "revision": 13,
  "actorSeat": 0,
  "events": [
    {"type": "roll", "player": 0, "die": 2},
    {"type": "launch", "player": 0, "die": 2, "square": 1},
    {"type": "move", "player": 0, "source": "launch", "from": 0, "to": 1, "route": [1], "fromProgress": 0, "toProgress": 1, "steps": [1], "distance": 1},
    {"type": "card", "player": 0, "square": 1, "tileType": "truth", "cardId": 1}
  ],
  "engineState": {
    "version": 3,
    "players": [{"name": "小粉", "progress": 1}, {"name": "小蓝", "progress": 0}],
    "current": 0,
    "phase": "await_card",
    "pendingCard": {"square": 1, "type": "truth", "cardId": 1},
    "firstWinner": null,
    "finaleChoice": null,
    "lastRoll": 2,
    "turnNumber": 1,
    "chainDepth": 0
  },
  "presentation": {
    "id": "presentation_example",
    "notBefore": 1792342802500
  }
}
```

此例对应当前方尚未起飞、掷出 2 后进入第 1 格，不按两格前进。双方收到同一接受结果；客户端只播放尚未播放的 revision。任务界面等本机对应动画播放完后展示，后续操作还须通过服务器的 presentationUntil 校验。

`PRESENCE_CHANGED` 是瞬时在线状态提示，不推进棋局 revision；重连时以快照为准。房间生命周期、准备、暂停、资料变更等持久状态也必须有序更新 revision。头像版本变化不修改棋子进度。

## 6. 错误与恢复

| 错误码 | 客户端行为 |
| --- | --- |
| `UNAUTHENTICATED`／`SESSION_EXPIRED` | 重新登录，不回退为测试身份 |
| `NOT_A_MEMBER`／`ROOM_FULL` | 返回房间入口，保留明确提示 |
| `NOT_YOUR_TURN`／`INVALID_PHASE` | 刷新状态，不本地修改进度 |
| `STALE_REVISION` | 拉取快照；除同 actionId 的幂等查询外不自动重发旧动作 |
| `MATCH_REPLACED` | 丢弃旧局动画和输入，加载新 matchId |
| `PRESENTATION_IN_PROGRESS` | 保持等待，服务器返回可重试时间 |
| `ROOM_PAUSED`／`PARTNER_OFFLINE` | 展示重连／恢复界面 |
| `INVITE_EXPIRED` | 请房主更新邀请，不泄露其他房间资料 |
| `RATE_LIMITED` | 按服务端等待时间退避 |
| `UNSUPPORTED_VERSION` | 提示更新，不继续解读未知事件 |

HTTP 与 WebSocket 返回相同错误码及 requestId，不返回密钥、数据库堆栈或其他房间资料。

## 7. 关键验收用例

1. 两个独立账户加入，第三人被拒；同账号不能占两座。
2. 同一 actionId 重试 3 次仍只出现一个骰点／一次位移。
3. 两个不同 actionId 同时提交相同 expectedRevision，仅一个合法接受。
4. 非当前玩家伪造 player／die／state，服务器拒绝或忽略伪造字段，不改变棋局。
5. 在数据库提交后、广播前模拟中断；重连能拿到已提交结果。
6. 奖惩位移和新题卡在两端一致；越终点回弹一致。
7. 客户端重复、乱序、缺失事件时不重复播放／结算，缺口恢复到最新快照。
8. 再来一局后旧 matchId 命令失效；断线回来不重放已经接受的掷骰。
9. 头像拒绝授权、链接失效时棋子仍可显示和移动，且不泄露微信身份字段。
10. 服务重启后棋局、当前任务和幂等结果仍可恢复。
