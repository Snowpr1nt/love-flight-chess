import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalDatabase } from '../server/sqlite-local.mjs';
import { handleFlight, FlightService, D1Store } from '../server/service.mjs';
import { engine } from '../server/rules.mjs';

function context(filename=':memory:') {
  const db=openLocalDatabase(filename);let time=1792454400000,random=1;
  const options={now:()=>time,rng:max=>random%max};
  const ctx={db,options,advance(ms=10000){time+=ms;},random(value){random=value;},
    async api(path,body,cookie,headers={}) {
      const request=new Request('https://game.test/api/flight'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json','origin':'https://game.test','x-love-flight':'1'}),...(cookie?{cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
      const response=await handleFlight(request,db,options);return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],cors:response.headers.get('access-control-allow-origin')};
    },
    async guest(name){const result=await ctx.api('/visitor',{nickname:name,avatar:'cat-pink'});assert.equal(result.status,200);return {cookie:result.cookie,id:result.data.player.id};},
    async command(guest,room,type,extra={}) {return ctx.api('/rooms/'+room.id+'/commands',{type,expectedRevision:room.revision,matchId:room.matchId,actionId:crypto.randomUUID(),...extra},guest.cookie);},
  };return ctx;
}
async function pair(ctx) {
  const a=await ctx.guest('桃桃'),b=await ctx.guest('蓝蓝');
  const created=await ctx.api('/rooms',{},a.cookie);assert.equal(created.status,200);let room=created.data.room;
  const requested=await ctx.api('/rooms/join',{code:room.code,actionId:crypto.randomUUID()},b.cookie);assert.equal(requested.status,200);assert.equal(requested.data.room.status,'pending');
  room=(await ctx.api('/rooms/'+room.id+'?heartbeat=1',undefined,a.cookie)).data.room;
  room=(await ctx.command(a,room,'ACCEPT_JOIN',{targetId:b.id})).data.room;
  room=(await ctx.command(a,room,'READY')).data.room;
  const ready=await ctx.command(b,room,'READY');assert.equal(ready.status,200);room=ready.data.room;
  return {a,b,room,current:room.selfSeat===room.state.current?b:a};
}

test('two independent visitors join by invitation and both ready; no third seat or forged access',async()=>{
  const ctx=context();try {
    const {a,b,room}=await pair(ctx);assert.equal(room.members.length,2);assert.equal(room.state.version,3);
    const view=(await ctx.api('/rooms/'+room.id+'?heartbeat=1',undefined,a.cookie)).data.room;
    assert.deepEqual(view.state,room.state);assert.equal(view.selfSeat,0);assert.equal(room.selfSeat,1);
    const third=await ctx.guest('第三人');assert.equal((await ctx.api('/rooms/'+room.id,undefined,third.cookie)).status,403);
    assert.equal((await ctx.api('/rooms/join',{code:room.code,actionId:crypto.randomUUID()},third.cookie)).status,409);
    assert.equal((await ctx.command(room.state.current===0?b:a,room,'ROLL_REQUEST')).status,403);
    const unchanged=await ctx.api('/rooms/'+room.id+'?after='+room.revision,undefined,a.cookie);assert.equal(unchanged.data.unchanged,true);assert.equal('room' in unchanged.data,false);
  } finally {ctx.db.close();}
});

test('server generates dice, locks presentation, persists idempotent results and rejects changed action reuse',async()=>{
  const ctx=context();try {
    const {a,b,room}=await pair(ctx);const current=room.state.current===0?a:b;
    const actionId=crypto.randomUUID();const input={type:'ROLL_REQUEST',expectedRevision:room.revision,matchId:room.matchId,actionId,die:6,state:{current:0}};
    const first=await ctx.api('/rooms/'+room.id+'/commands',input,current.cookie);assert.equal(first.status,200);assert.equal(first.data.room.state.lastRoll,2);assert.equal(first.data.room.state.players[room.state.current].progress,1);
    const again=await ctx.api('/rooms/'+room.id+'/commands',input,current.cookie);assert.equal(again.status,200);assert.equal(again.data.replayed,true);assert.deepEqual(again.data.ack,first.data.ack);assert.equal(again.data.room.revision,first.data.room.revision);
    assert.equal((await ctx.command(current,first.data.room,'COMPLETE_TASK')).data.error.code,'PRESENTATION_IN_PROGRESS');
    ctx.advance();const completed=await ctx.command(current,first.data.room,'COMPLETE_TASK');assert.equal(completed.status,200);
    const staleRetry=await ctx.api('/rooms/'+room.id+'/commands',input,current.cookie);assert.equal(staleRetry.status,200);assert.equal(staleRetry.data.room.revision,completed.data.room.revision);
    const changed=await ctx.api('/rooms/'+room.id+'/commands',{...input,type:'COMPLETE_TASK'},current.cookie);assert.equal(changed.data.error.code,'ACTION_ID_REUSED');
  } finally {ctx.db.close();}
});

test('compare-and-swap accepts only one of two concurrent commands against a revision',async()=>{
  const ctx=context();try {
    const {a,b,room}=await pair(ctx);const current=room.state.current===0?a:b;
    const results=await Promise.all([ctx.command(current,room,'ROLL_REQUEST'),ctx.command(current,room,'ROLL_REQUEST')]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const saved=(await ctx.api('/rooms/'+room.id,undefined,current.cookie)).data.room;assert.equal(saved.revision,room.revision+1);assert.equal(saved.state.players[room.state.current].progress,1);
  } finally {ctx.db.close();}
});

test('reward confirmation moves two squares and triggers the new task on both clients',async()=>{
  const ctx=context();try {
    const {a,b,room}=await pair(ctx);const current=room.state.current===0?a:b;
    const store=new D1Store(ctx.db);const seeded=await store.room(room.id);seeded.state.players[seeded.state.current].progress=4;
    await ctx.db.prepare('UPDATE flight_rooms SET document=? WHERE id=?').bind(JSON.stringify(seeded),room.id).run();
    ctx.random(0);let result=await ctx.command(current,seeded,'ROLL_REQUEST');assert.equal(result.data.room.state.pendingCard.type,'reward');
    ctx.advance();result=await ctx.command(current,result.data.room,'CHOOSE_EFFECT',{optionId:1});assert.equal(result.status,200);assert.equal(result.data.room.state.players[room.state.current].progress,7);assert.equal(result.data.room.state.pendingCard.type,'truth');
    const partner=(await ctx.api('/rooms/'+room.id,undefined,(current===a?b:a).cookie)).data.room;assert.deepEqual(partner.state,result.data.room.state);
  } finally {ctx.db.close();}
});

test('offline partner blocks commands and heartbeat reconnect resumes without losing state',async()=>{
  const ctx=context();try {
    const {a,b,room}=await pair(ctx);const current=room.state.current===0?a:b,other=current===a?b:a;
    ctx.advance(46000);await ctx.api('/rooms/'+room.id+'?heartbeat=1',undefined,current.cookie);
    const blocked=await ctx.command(current,room,'ROLL_REQUEST');assert.equal(blocked.data.error.code,'PARTNER_OFFLINE');
    await ctx.api('/rooms/'+room.id+'?heartbeat=1',undefined,other.cookie);
    assert.equal((await ctx.command(current,room,'ROLL_REQUEST')).status,200);
  } finally {ctx.db.close();}
});

test('precise finish, finale and two-party rematch create a new match identity',async()=>{
  const ctx=context();try {
    const {a,b,room}=await pair(ctx);const current=room.state.current===0?a:b,other=current===a?b:a;
    const store=new D1Store(ctx.db);const seeded=await store.room(room.id);seeded.state.players[seeded.state.current].progress=44;
    await ctx.db.prepare('UPDATE flight_rooms SET document=? WHERE id=?').bind(JSON.stringify(seeded),room.id).run();ctx.random(0);
    let result=await ctx.command(current,seeded,'ROLL_REQUEST');assert.equal(result.data.room.state.phase,'finished');ctx.advance();
    result=await ctx.command(current,result.data.room,'CHOOSE_FINALE',{optionId:2});assert.equal(result.status,200);assert.equal(result.data.room.state.finaleChoice,2);
    result=await ctx.command(current,result.data.room,'REMATCH');assert.equal(result.data.room.matchId,room.matchId);
    result=await ctx.command(other,result.data.room,'REMATCH');assert.equal(result.status,200);assert.notEqual(result.data.room.matchId,room.matchId);assert.ok(result.data.room.state.players.every(p=>p.progress===0));
    const stale=await ctx.command(result.data.room.state.current===0?a:b,result.data.room,'ROLL_REQUEST',{matchId:room.matchId});assert.equal(stale.data.error.code,'MATCH_REPLACED');
  } finally {ctx.db.close();}
});

test('room snapshot and idempotency survive a database close and server recreation',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'flight-test-'));const filename=join(dir,'flight.sqlite');let ctx=context(filename);
  try {
    const {a,b,room}=await pair(ctx);const current=room.state.current===0?a:b;const actionId=crypto.randomUUID();
    const input={type:'ROLL_REQUEST',expectedRevision:room.revision,matchId:room.matchId,actionId};const original=await ctx.api('/rooms/'+room.id+'/commands',input,current.cookie);
    ctx.db.close();ctx=context(filename);
    const restored=await ctx.api('/rooms/'+room.id,undefined,current.cookie);assert.equal(restored.status,200);assert.deepEqual(restored.data.room.state,original.data.room.state);
    const replay=await ctx.api('/rooms/'+room.id+'/commands',input,current.cookie);assert.equal(replay.data.replayed,true);assert.deepEqual(replay.data.ack,original.data.ack);
  } finally {ctx.db.close();rmSync(dir,{recursive:true});}
});

test('same-origin checks, invalid avatars, session and room expiry are enforced',async()=>{
  const ctx=context();try {
    assert.equal((await ctx.api('/visitor',{nickname:'测试',avatar:'https://evil.invalid/x.svg'},null)).status,400);
    assert.equal((await ctx.api('/visitor',{nickname:'测试'},null,{origin:'https://evil.test'})).status,403);
    assert.equal((await ctx.api('/visitor')).status,401);
    const a=await ctx.guest('桃桃');const result=await ctx.api('/rooms',{},a.cookie);const room=result.data.room;
    const same=await ctx.api('/rooms/join',{code:room.code,actionId:crypto.randomUUID()},a.cookie);assert.equal(same.data.room.selfSeat,0);assert.equal(same.data.room.members.length,1);
    ctx.advance(1800001);assert.equal((await ctx.api('/rooms/'+room.id,undefined,a.cookie)).status,404);
    ctx.advance(7*86400000);assert.equal((await ctx.api('/visitor',undefined,a.cookie)).status,401);
  } finally {ctx.db.close();}
});

test('an invitation applicant sees no private board or member avatars before host acceptance',async()=>{
  const ctx=context();try {
    const a=await ctx.guest('桃桃'),b=await ctx.guest('蓝蓝');const room=(await ctx.api('/rooms',{},a.cookie)).data.room;
    const pending=await ctx.api('/rooms/join',{code:room.code,actionId:crypto.randomUUID()},b.cookie);
    assert.equal(pending.data.room.status,'pending');assert.deepEqual(pending.data.room.members,[]);assert.equal(pending.data.room.state,null);
    assert.equal((await ctx.command(b,pending.data.room,'JOIN')).status,403);
    const host=(await ctx.api('/rooms/'+room.id,undefined,a.cookie)).data.room;
    assert.equal(host.pending.length,1);
    assert.equal((await ctx.command(a,host,'REJECT_JOIN',{targetId:b.id})).status,200);
    assert.equal((await ctx.api('/rooms/'+room.id,undefined,b.cookie)).status,403);
  } finally {ctx.db.close();}
});

test('a full two-client game completes from shared start without fixtures or client-supplied dice',async()=>{
  const ctx=context();try {
    const pairResult=await pair(ctx);const {a,b}=pairResult;let room=pairResult.room;let count=0;
    while(room.state.phase!=='finished' && count++<200) {
      ctx.advance();
      await ctx.api('/rooms/'+room.id+'?heartbeat=1',undefined,a.cookie);
      await ctx.api('/rooms/'+room.id+'?heartbeat=1',undefined,b.cookie);
      const current=room.state.current===0?a:b;
      const type=room.state.phase==='await_roll'?'ROLL_REQUEST': ['truth','dare'].includes(room.state.pendingCard.type)?'COMPLETE_TASK':'CHOOSE_EFFECT';
      const result=await ctx.command(current,room,type,type==='CHOOSE_EFFECT'?{optionId:1}:{});
      assert.equal(result.status,200,JSON.stringify(result.data));room=result.data.room;
    }
    assert.ok(count<200);assert.equal(room.state.phase,'finished');assert.ok(engine.validateState(room.state));
    assert.equal(room.state.players[room.state.firstWinner].progress,45);
    const aView=(await ctx.api('/rooms/'+room.id,undefined,a.cookie)).data.room;
    const bView=(await ctx.api('/rooms/'+room.id,undefined,b.cookie)).data.room;
    assert.deepEqual(aView.state,bView.state);
  } finally {ctx.db.close();}
});

test('GitHub Pages visitors use bearer sessions without third-party cookies and can play together',async()=>{
  const ctx=context();const origin='https://snowpr1nt.github.io';
  try {
    const a=await ctx.api('/visitor',{nickname:'粉方',avatar:'cat-pink'},null,{origin});
    const b=await ctx.api('/visitor',{nickname:'蓝方',avatar:'cat-blue'},null,{origin});
    assert.equal(a.status,200);assert.equal(a.cors,origin);assert.equal(a.cookie,undefined);assert.match(a.data.sessionToken,/^[a-f0-9-]{72}$/);
    const ah={origin,authorization:'Bearer '+a.data.sessionToken},bh={origin,authorization:'Bearer '+b.data.sessionToken};
    assert.equal((await ctx.api('/visitor',undefined,null,ah)).data.player.id,a.data.player.id);
    assert.equal((await ctx.api('/visitor',{nickname:'更新名字',avatar:'cat-mint'},null,ah)).data.player.id,a.data.player.id);
    let room=(await ctx.api('/rooms',{},null,ah)).data.room;
    const pending=await ctx.api('/rooms/join',{code:room.code,actionId:crypto.randomUUID()},null,bh);assert.equal(pending.status,200);
    room=(await ctx.api('/rooms/'+room.id+'?heartbeat=1',undefined,null,ah)).data.room;
    const command=async(headers,type,extra={})=>{const response=await ctx.api('/rooms/'+room.id+'/commands',{type,expectedRevision:room.revision,matchId:room.matchId,actionId:crypto.randomUUID(),...extra},null,headers);assert.equal(response.status,200,JSON.stringify(response.data));room=response.data.room;};
    await command(ah,'ACCEPT_JOIN',{targetId:b.data.player.id});await command(ah,'READY');await command(bh,'READY');
    const current=room.state.current===0?ah:bh;await command(current,'ROLL_REQUEST');
    assert.equal(room.state.lastRoll,2);ctx.advance();await command(current,'COMPLETE_TASK');
    const otherView=await ctx.api('/rooms/'+room.id,undefined,null,current===ah?bh:ah);assert.deepEqual(otherView.data.room.state,room.state);
    assert.equal(JSON.stringify(otherView.data).includes(a.data.sessionToken),false);
    ctx.advance(7*86400000);assert.equal((await ctx.api('/visitor',undefined,null,ah)).status,401);
  } finally {ctx.db.close();}
});

test('CORS preflight is restricted to the owned Pages origin, known methods and headers',async()=>{
  const ctx=context();const origin='https://snowpr1nt.github.io';
  try {
    const request=(extra={})=>new Request('https://game.test/api/flight/visitor',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type,x-love-flight',...extra}});
    const good=await handleFlight(request(),ctx.db,ctx.options);assert.equal(good.status,204);assert.equal(good.headers.get('access-control-allow-origin'),origin);assert.equal(good.headers.get('access-control-allow-credentials'),null);
    for(const extra of [{origin:'https://evil.github.io'},{'access-control-request-headers':'x-other'},{'access-control-request-method':'DELETE'},{origin:'null'}]) {
      const response=await handleFlight(request(extra),ctx.db,ctx.options);assert.ok(response.status>=400);
    }
    const evil=await ctx.api('/visitor',{nickname:'测试'},null,{origin:'https://snowpr1nt.github.io.evil.test'});assert.equal(evil.status,403);assert.equal(evil.cors,null);
  } finally {ctx.db.close();}
});

test('cross-origin cookies do not authenticate, malformed bearer never falls back to a cookie',async()=>{
  const ctx=context();try {
    const a=await ctx.guest('桃桃');
    assert.equal((await ctx.api('/visitor',undefined,a.cookie,{origin:'https://snowpr1nt.github.io'})).status,401);
    assert.equal((await ctx.api('/visitor',undefined,a.cookie,{authorization:'Bearer invalid'})).status,401);
    assert.equal((await ctx.api('/visitor',undefined,a.cookie,{origin:'https://evil.test'})).status,403);
    const response=await ctx.api('/visitor',{nickname:'桃桃'},a.cookie);assert.equal('sessionToken' in response.data,false);
  } finally {ctx.db.close();}
});
