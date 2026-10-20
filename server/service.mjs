import { engine, board } from './rules.mjs';

const DAY = 86400000;
const COOKIE = 'lf_demo_player';
const clone = (value) => structuredClone(value);
export class GameError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (condition, code, message, status = 400) => {
  if (!condition) throw new GameError(code, message, status);
};
const randomId = () => crypto.randomUUID();
function randomInt(max) {
  const values = new Uint32Array(1);
  const ceiling = 4294967296 - 4294967296 % max;
  do { crypto.getRandomValues(values); } while (values[0] >= ceiling);
  return values[0] % max;
}
async function hash(value) {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function profile(input) {
  const name = typeof input.nickname === 'string' ? input.nickname.trim() : '';
  fail(name.length > 0 && [...name].length <= 12, 'INVALID_PROFILE', '昵称请填写 1–12 个字。');
  const avatar = input.avatar || 'cat-pink';
  fail(typeof avatar === 'string' && (/^cat-(pink|blue|mint|lilac)$/.test(avatar) ||
    /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(avatar) && avatar.length <= 24000),
    'INVALID_AVATAR', '请选择预设头像，或使用压缩后的图片。');
  return { nickname: name, avatar };
}

// All SQL is parameterized. D1 batch is an atomic, sequential transaction.
export class D1Store {
  constructor(db) { this.db = db; }
  async guest(tokenHash) { return this.db.prepare('SELECT * FROM flight_guests WHERE token_hash = ?').bind(tokenHash).first(); }
  async saveGuest(guest) {
    await this.db.prepare('INSERT INTO flight_guests (id,token_hash,profile,expires_at) VALUES (?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET profile=excluded.profile,expires_at=excluded.expires_at')
      .bind(guest.id,guest.token_hash,guest.profile,guest.expires_at).run();
  }
  async rate(key, limit, now) {
    const bucket = Math.floor(now / 60000);
    const row = await this.db.prepare('INSERT INTO flight_limits (id,bucket,hits) VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET bucket=excluded.bucket,hits=CASE WHEN flight_limits.bucket=excluded.bucket THEN flight_limits.hits+1 ELSE 1 END RETURNING hits')
      .bind(key,bucket).first();
    fail(row.hits <= limit,'RATE_LIMITED','操作有些频繁，请稍后再试。',429);
  }
  async room(id, byCode = false) {
    const row = await this.db.prepare(byCode ? 'SELECT * FROM flight_rooms WHERE code=?' : 'SELECT * FROM flight_rooms WHERE id=?').bind(id).first();
    return row ? { ...JSON.parse(row.document), revision:row.revision, expiresAt:row.expires_at } : null;
  }
  async insert(room) {
    await this.db.prepare('INSERT INTO flight_rooms (id,code,revision,document,expires_at) VALUES (?,?,?,?,?)')
      .bind(room.id,room.code,room.revision,JSON.stringify(room),room.expiresAt).run();
  }
  async receipt(roomId,playerId,actionId) {
    const row=await this.db.prepare('SELECT fingerprint,result FROM flight_commands WHERE room_id=? AND player_id=? AND action_id=?').bind(roomId,playerId,actionId).first();
    return row ? {fingerprint:row.fingerprint,result:JSON.parse(row.result)} : null;
  }
  async commit(before,next,receipt) {
    const update=this.db.prepare('UPDATE flight_rooms SET revision=?,document=?,expires_at=? WHERE id=? AND revision=? AND NOT EXISTS (SELECT 1 FROM flight_commands WHERE room_id=? AND player_id=? AND action_id=?) RETURNING id')
      .bind(next.revision,JSON.stringify(next),next.expiresAt,before.id,before.revision,before.id,receipt.playerId,receipt.actionId);
    const insert=this.db.prepare('INSERT OR IGNORE INTO flight_commands (room_id,player_id,action_id,fingerprint,result,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM flight_rooms WHERE id=? AND revision=? AND json_extract(document,\'$.lastActionId\')=? AND json_extract(document,\'$.lastActorId\')=?)')
      .bind(before.id,receipt.playerId,receipt.actionId,receipt.fingerprint,JSON.stringify(receipt.result),next.expiresAt,before.id,next.revision,receipt.actionId,receipt.playerId);
    const results=await this.db.batch([update,insert]);
    return results[0].results.length === 1;
  }
  async touch(roomId,playerId,now) {
    await this.db.prepare('INSERT INTO flight_presence (room_id,player_id,last_seen) VALUES (?,?,?) ON CONFLICT(room_id,player_id) DO UPDATE SET last_seen=excluded.last_seen').bind(roomId,playerId,now).run();
  }
  async presence(roomId) { return (await this.db.prepare('SELECT player_id,last_seen FROM flight_presence WHERE room_id=?').bind(roomId).all()).results; }
}

export class FlightService {
  constructor(store, {now=()=>Date.now(),rng=randomInt}={}) { this.store=store; this.now=now; this.rng=rng; }
  async getGuest(request) {
    const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
    if(!token || !/^[a-f0-9-]{72}$/.test(token)) return null;
    const guest=await this.store.guest(await hash(token));
    return guest && guest.expires_at > this.now() ? {...guest,...JSON.parse(guest.profile)} : null;
  }
  async requireGuest(request) {
    const guest=await this.getGuest(request);
    fail(guest,'SESSION_EXPIRED','请先填写昵称和头像，建立体验身份。',401);
    return guest;
  }
  async enter(request,input) {
    const ip=request.headers.get('cf-connecting-ip')||'local';
    await this.store.rate('enter:'+await hash(ip),20,this.now());
    const data=profile(input);
    let guest=await this.getGuest(request);
    let token=null;
    if(!guest) { token=randomId()+randomId();guest={id:randomId(),token_hash:await hash(token)}; }
    const row={id:guest.id,token_hash:guest.token_hash,profile:JSON.stringify(data),expires_at:this.now()+7*DAY};
    await this.store.saveGuest(row);
    const secure=new URL(request.url).protocol==='https:' ? '; Secure' : '';
    return {data:{player:{id:guest.id,...data},mode:'demo'},cookie:token ? `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}` : null};
  }
  async requireRoom(id) {
    fail(typeof id==='string' && /^[a-f0-9-]{36}$/.test(id),'INVALID_ROOM','房间链接不正确。');
    const room=await this.store.room(id);
    fail(room && room.expiresAt>this.now(),'ROOM_EXPIRED','房间不存在或已过期，请重新创建。',404);
    return room;
  }
  async snapshot(room,guest) {
    const seat=room.members.findIndex(m=>m.id===guest.id);
    if(seat<0) {
      fail(room.pending.some(m=>m.id===guest.id),'NOT_A_MEMBER','你不在这个房间，或房间已满。',403);
      return {id:room.id,code:room.code,revision:room.revision,status:'pending',selfSeat:-1,hostName:room.members[0].nickname,members:[],pending:[],state:null,events:[],serverTime:this.now(),expiresAt:room.expiresAt};
    }
    const presence=await this.store.presence(room.id);
    return {id:room.id,code:room.code,revision:room.revision,status:room.status,selfSeat:seat,
      members:room.members.map(m=>({...m,online:presence.some(p=>p.player_id===m.id && this.now()-p.last_seen<45000)})),
      pending:seat===0 && room.status==='waiting' ? room.pending : [],state:room.state,matchId:room.matchId,
      events:room.events,logs:room.logs,ready:room.ready,rematch:room.rematch,notBefore:room.notBefore,
      rulesVersion:engine.VERSION,protocolVersion:1,serverTime:this.now(),expiresAt:room.expiresAt};
  }
  async create(guest) {
    await this.store.rate('create:'+guest.id,8,this.now());
    const count=await this.store.db.prepare('SELECT COUNT(*) AS n FROM flight_rooms WHERE expires_at>? AND json_extract(document,\'$.members[0].id\')=?').bind(this.now(),guest.id).first();
    fail(count.n<8,'TOO_MANY_ROOMS','最多保留 8 个未过期房间，请稍后再创建。',429);
    for(let attempt=0;attempt<6;attempt++) {
      const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const code=Array.from({length:6},()=>alphabet[this.rng(alphabet.length)]).join('');
      if(await this.store.room(code,true)) continue;
      const room={id:randomId(),code,revision:1,status:'waiting',members:[{id:guest.id,nickname:guest.nickname,avatar:guest.avatar}],pending:[],ready:[],rematch:[],state:null,matchId:null,notBefore:0,events:[],logs:['房间已建立，邀请另一位机长一起登机。'],expiresAt:this.now()+1800000};
      try {await this.store.insert(room);} catch(error) {if(/unique/i.test(String(error)))continue;throw error;}
      await this.store.touch(room.id,guest.id,this.now());
      return {room:await this.snapshot(room,guest)};
    }
    throw new GameError('BUSY','房间创建繁忙，请重试。',503);
  }
  async join(guest,input) {
    await this.store.rate('join:'+guest.id,20,this.now());
    const code=typeof input.code==='string'? input.code.trim().toUpperCase():'';
    fail(/^[A-HJ-NP-Z2-9]{6}$/.test(code),'INVALID_INVITE','请输入 6 位房间邀请码。');
    let room=await this.store.room(code,true);
    fail(room && room.expiresAt>this.now(),'INVITE_EXPIRED','邀请码不存在或房间已过期。',404);
    if(room.members.some(m=>m.id===guest.id)||room.pending.some(m=>m.id===guest.id)) {
      await this.store.touch(room.id,guest.id,this.now());
      return {room:await this.snapshot(room,guest)};
    }
    fail(room.status==='waiting' && room.members.length<2,'ROOM_FULL','这个房间已经满员或已开始，请让对方发来新邀请。',409);
    fail(room.pending.length<3,'ROOM_BUSY','房主正在处理加入申请，请稍后再试。',409);
    const result=await this.mutate(guest,room,{type:'JOIN',actionId:input.actionId,expectedRevision:room.revision});
    await this.store.touch(room.id,guest.id,this.now());
    return result;
  }
  async read(guest,id,heartbeat,after) {
    const room=await this.requireRoom(id);
    fail(room.members.some(m=>m.id===guest.id)||room.pending.some(m=>m.id===guest.id),'NOT_A_MEMBER','你已离开此房间，或加入申请未被接受。',403);
    if(heartbeat) await this.store.touch(id,guest.id,this.now());
    const snapshot=await this.snapshot(room,guest);
    if(room.revision===after && snapshot.selfSeat>=0) return {unchanged:true,revision:room.revision,online:snapshot.members.map(member=>member.online),serverTime:this.now()};
    return {room:snapshot};
  }
  async command(guest,id,input) {
    fail(input.type!=='JOIN','FORBIDDEN','加入房间请使用邀请码入口。',403);
    await this.store.rate('command:'+guest.id,120,this.now());
    return this.mutate(guest,await this.requireRoom(id),input);
  }
  async mutate(guest,room,input) {
    fail(typeof input.actionId==='string' && /^[a-f0-9-]{36}$/.test(input.actionId),'INVALID_ACTION','请求标识不正确。');
    const type=input.type;
    const fingerprint=JSON.stringify({type,matchId:input.matchId||null,optionId:input.optionId??null,targetId:input.targetId??null});
    const previous=await this.store.receipt(room.id,guest.id,input.actionId);
    if(previous) {
      fail(previous.fingerprint===fingerprint,'ACTION_ID_REUSED','同一操作标识不能用于不同操作。',409);
      return {room:await this.snapshot(room,guest),ack:previous.result,replayed:true};
    }
    fail(input.expectedRevision===room.revision,'STALE_REVISION','棋局刚刚有变化，已为你同步，请重新操作。',409);
    const seat=room.members.findIndex(m=>m.id===guest.id);
    const next=clone(room);
    let events=[];
    if(type==='JOIN') {
      fail(seat===-1 && room.status==='waiting' && room.members.length<2,'ROOM_FULL','房间已满。',409);
      fail(!room.pending.some(member=>member.id===guest.id),'ALREADY_REQUESTED','加入申请已发送，请等待房主确认。',409);
      fail(room.pending.length<3,'ROOM_BUSY','房主正在处理加入申请，请稍后重试。',409);
      next.pending.push({id:guest.id,nickname:guest.nickname,avatar:guest.avatar});
    } else {
      fail(seat>=0,'NOT_A_MEMBER','只有房间成员可以操作。',403);
      if(type==='ACCEPT_JOIN'||type==='REJECT_JOIN') {
        fail(seat===0 && room.status==='waiting' && room.members.length===1,'FORBIDDEN','当前不能处理加入申请。',403);
        const member=room.pending.find(m=>m.id===input.targetId);
        fail(member,'INVALID_ACTION','该加入申请已经失效。',409);
        next.pending=next.pending.filter(m=>m.id!==input.targetId);
        if(type==='ACCEPT_JOIN') {next.members.push(member);next.pending=[];next.logs.unshift(`${member.nickname} 已登机，两个人都准备好就可以出发。`);}
      } else if(type==='READY') {
        fail(room.status==='waiting' && room.members.length===2,'INVALID_PHASE','等待另一位机长加入后再准备。',409);
        if(!next.ready.includes(guest.id))next.ready.push(guest.id);
        if(next.ready.length===2) {
          next.state=engine.createGame(next.members.map(m=>m.nickname),this.rng(2));
          next.matchId=randomId();next.status='playing';next.expiresAt=this.now()+DAY;
          next.logs.unshift('双方已准备，随机先手已确定。一起从共同起点出发！');
          events=[{type:'game_started',player:next.state.current}];
        }
      } else if(type==='REMATCH') {
        fail(room.state?.phase==='finished','INVALID_PHASE','本局结束后才能再来一局。',409);
        fail(input.matchId===room.matchId,'MATCH_REPLACED','已经开启新一局，请同步后再操作。',409);
        if(!next.rematch.includes(guest.id))next.rematch.push(guest.id);
        if(next.rematch.length===2) {
          next.matchId=randomId();next.state=engine.createGame(next.members.map(m=>m.nickname),this.rng(2));
          next.status='playing';next.rematch=[];next.events=[];next.logs=['新的心动航线已开启，双方再次从共同起点出发。'];
          events=[{type:'game_started',player:next.state.current}];
        }
      } else {
        fail(room.state,'INVALID_PHASE','请先等待双方准备完成。',409);
        fail(input.matchId===room.matchId,'MATCH_REPLACED','已进入新一局，请同步后再操作。',409);
        fail(seat===room.state.current,'NOT_YOUR_TURN','现在轮到对方操作。',403);
        fail(this.now()>=room.notBefore,'PRESENTATION_IN_PROGRESS','请等骰子和棋子停稳再操作。',409);
        const presence=await this.store.presence(room.id);
        fail(room.members.every(m=>presence.some(p=>p.player_id===m.id && this.now()-p.last_seen<45000)), 'PARTNER_OFFLINE','对方暂时离线，请等重新连接后继续。',409);
        let action;
        if(type==='ROLL_REQUEST')action={type:'ROLL',die:this.rng(6)+1};
        else if(type==='COMPLETE_TASK') {
          fail(['truth','dare'].includes(room.state.pendingCard?.type),'INVALID_PHASE','请先完成当前奖惩选择。',409);
          action={type:'RESOLVE_CARD'};
        } else if(type==='SKIP_TASK')action={type:'RESOLVE_CARD',skipped:true};
        else if(type==='CHOOSE_EFFECT') {
          fail(['reward','penalty'].includes(room.state.pendingCard?.type),'INVALID_PHASE','当前不是奖惩选择。',409);
          action={type:'RESOLVE_CARD',optionId:input.optionId};
        } else if(type==='SWAP_TASK') {
          const pool=board.tiles.filter(t=>t.type===room.state.pendingCard?.type && t.promptId && t.promptId!==room.state.pendingCard?.cardId);
          fail(pool.length,'INVALID_PHASE','当前没有可换的题目。',409);
          action={type:'SWAP_CARD',cardId:pool[this.rng(pool.length)].promptId};
        } else if(type==='CHOOSE_FINALE')action={type:'CHOOSE_FINALE',optionId:input.optionId};
        else throw new GameError('INVALID_ACTION','不支持的操作。');
        let result;
        try {result=engine.reduce(room.state,action);} catch {throw new GameError('INVALID_PHASE','当前状态不允许此操作，请同步棋局后重试。',409);}
        next.state=result.state;events=result.events;
        if(next.state.phase==='finished')next.status='finished';
        if(type==='COMPLETE_TASK'||type==='SKIP_TASK')next.logs.unshift(`${guest.nickname} ${type==='SKIP_TASK'?'经双方同意跳过了':'完成了'}这一站互动。`);
        for(const event of events) {
          if(event.type==='roll')next.logs.unshift(`${guest.nickname} 掷出了 ${event.die} 点。`);
          if(event.type==='move')next.logs.unshift(`${guest.nickname} ${event.source==='penalty'?'回退':'前进'}至${event.toProgress===45?'爱心终点':`第 ${event.toProgress} 格`}。`);
          if(event.type==='first_winner')next.logs.unshift(`${guest.nickname} 精准抵达，解锁最终约定！`);
          if(event.type==='finale_chosen')next.logs.unshift(`终点奖励：${board.finaleOptions.find(x=>x.id===event.optionId)?.title||'心动约定'}。`);
        }
      }
    }
    next.revision=room.revision+1;next.logs=next.logs.slice(0,12);next.lastActionId=input.actionId;next.lastActorId=guest.id;
    const duration=(events.some(e=>e.type==='roll')?1900:0)+events.filter(e=>e.type==='move').reduce((n,e)=>n+e.route.length*300+300,0)+(events.some(e=>e.type==='first_winner')?800:0);
    next.notBefore=this.now()+duration;
    const ack={actionId:input.actionId,type,revision:next.revision,previousRevision:room.revision,matchId:next.matchId,events,createdAt:this.now(),notBefore:next.notBefore};
    next.events.push(ack);next.events=next.events.slice(-32);
    const accepted=await this.store.commit(room,next,{playerId:guest.id,actionId:input.actionId,fingerprint,result:ack});
    if(!accepted) {
      const fresh=await this.requireRoom(room.id);
      const receipt=await this.store.receipt(room.id,guest.id,input.actionId);
      if(receipt) {
        fail(receipt.fingerprint===fingerprint,'ACTION_ID_REUSED','操作标识已被使用。',409);
        return {room:await this.snapshot(fresh,guest),ack:receipt.result,replayed:true};
      }
      throw new GameError('STALE_REVISION','对方刚刚完成操作，请同步后重试。',409);
    }
    return {room:await this.snapshot(next,guest),ack};
  }
}

async function readBody(request) {
  fail(request.headers.get('content-type')?.includes('application/json'),'INVALID_CONTENT_TYPE','请使用 JSON 请求。',415);
  const reader=request.body?.getReader();let size=0;const parts=[];
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32000){await reader.cancel();throw new GameError('BODY_TOO_LARGE','提交内容过大。',413);}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  try {const body=JSON.parse(new TextDecoder().decode(bytes));fail(body && typeof body==='object'&&!Array.isArray(body),'INVALID_BODY','请求格式错误。');return body;}catch(e){if(e instanceof GameError)throw e;throw new GameError('INVALID_JSON','请求内容不是有效 JSON。');}
}
export async function handleFlight(request,db,options) {
  const headers={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'};
  const respond=(data,status=200)=>Response.json(data,{status,headers});
  try {
    fail(db,'SERVICE_UNAVAILABLE','联机服务正在准备，请稍后重试。',503);
    const url=new URL(request.url);const path=url.pathname.replace(/^\/api\/flight/,'');
    if(request.method==='GET'&&path==='/health')return respond({ok:true,protocolVersion:1,mode:'demo',transport:'https-poll',rulesVersion:engine.VERSION});
    const service=new FlightService(new D1Store(db),options);
    if(request.method==='POST') {
      fail(request.headers.get('origin')===url.origin && request.headers.get('x-love-flight')==='1','BAD_ORIGIN','请从当前游戏页面发起操作。',403);
      const input=await readBody(request);
      if(path==='/visitor') {
        const result=await service.enter(request,input);if(result.cookie)headers['set-cookie']=result.cookie;return respond(result.data);
      }
      const guest=await service.requireGuest(request);
      if(path==='/rooms')return respond(await service.create(guest));
      if(path==='/rooms/join')return respond(await service.join(guest,input));
      const match=/^\/rooms\/([a-f0-9-]{36})\/commands$/.exec(path);
      if(match)return respond(await service.command(guest,match[1],input));
    } else if(request.method==='GET') {
      const guest=await service.requireGuest(request);
      if(path==='/visitor')return respond({player:{id:guest.id,nickname:guest.nickname,avatar:guest.avatar},mode:'demo'});
      const match=/^\/rooms\/([a-f0-9-]{36})$/.exec(path);
      if(match)return respond(await service.read(guest,match[1],url.searchParams.get('heartbeat')==='1',Number(url.searchParams.get('after'))));
    }
    return respond({error:{code:'NOT_FOUND',message:'接口不存在。'}},404);
  } catch(error) {
    if(error instanceof GameError)return respond({error:{code:error.code,message:error.message}},error.status);
    console.error('flight request failed',error instanceof Error?error.name:'unknown');
    return respond({error:{code:'SERVICE_ERROR',message:'服务暂时不可用，请稍后重试。'}},503);
  }
}
