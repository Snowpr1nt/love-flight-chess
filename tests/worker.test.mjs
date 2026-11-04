import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/worker.mjs';
import {openLocalDatabase} from '../server/sqlite-local.mjs';

test('standalone Worker binds the migrated DB, accepts two Pages players and preserves command receipts',async()=>{
  const db=openLocalDatabase(':memory:');
  const origin='https://snowpr1nt.github.io';
  const api=async(path,body,token)=>{
    const response=await worker.fetch(new Request('https://worker.example.test/api/flight'+path,{method:body===undefined?'GET':'POST',headers:{origin,...(body===undefined?{}:{'content-type':'application/json','x-love-flight':'1'}),...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),{DB:db});
    assert.equal(response.headers.get('access-control-allow-origin'),origin);
    const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
  };
  try {
    assert.equal((await api('/health')).ok,true);
    const a=await api('/visitor',{nickname:'甲',avatar:'cat-pink'}),b=await api('/visitor',{nickname:'乙',avatar:'cat-blue'});
    let room=(await api('/rooms',{},a.sessionToken)).room;
    await api('/rooms/join',{code:room.code,actionId:crypto.randomUUID()},b.sessionToken);
    room=(await api('/rooms/'+room.id+'?heartbeat=1',undefined,a.sessionToken)).room;
    const command=async(type,token,extra={})=>{const input={type,actionId:crypto.randomUUID(),matchId:room.matchId,expectedRevision:room.revision,...extra};const result=await api('/rooms/'+room.id+'/commands',input,token);room=result.room;return {input,result};};
    await command('ACCEPT_JOIN',a.sessionToken,{targetId:b.player.id});await command('READY',a.sessionToken);await command('READY',b.sessionToken);
    const token=room.state.current===0?a.sessionToken:b.sessionToken;
    const {input,result}=await command('ROLL_REQUEST',token);
    const replay=await api('/rooms/'+room.id+'/commands',input,token);
    assert.equal(replay.replayed,true);assert.deepEqual(replay.ack,result.ack);assert.deepEqual(replay.room.state,result.room.state);
    assert.equal((await worker.fetch(new Request('https://worker.example.test/'),{DB:db})).status,404);
    assert.equal((await worker.fetch(new Request('https://worker.example.test/api/flight/health'),{})).status,503);
  }finally{db.close();}
});
