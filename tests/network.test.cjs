const {test}=require('node:test');
const assert=require('node:assert/strict');
const {requestJSON,isConnectionError}=require('../js/network.js');
const url='https://api.example.test/api/flight/visitor';
const call=(response,options={})=>requestJSON(url,{}, {fetchImpl:async()=>response,...options});

test('normal JSON and application errors preserve session/error semantics',async()=>{
  assert.deepEqual(await call(Response.json({player:{id:'demo'}})),{player:{id:'demo'}});
  await assert.rejects(call(Response.json({error:{code:'SESSION_EXPIRED',message:'重新登录'}},{status:401})),e=>e.code==='SESSION_EXPIRED'&&e.status===401&&!isConnectionError(e));
});
test('WAF 403 HTML is an access failure, never an assertion that data was saved',async()=>{
  await assert.rejects(call(new Response('<h1>You have been blocked</h1>',{status:403})),e=>e.code==='ACCESS_BLOCKED'&&e.status===403&&!e.message.includes('已保存'));
});
test('CORS/fetch rejection while browser is online is service unreachable, not device offline',async()=>{
  await assert.rejects(requestJSON(url,{}, {fetchImpl:async()=>{throw new TypeError('Failed to fetch');},isOnline:()=>true}),e=>e.code==='SERVICE_UNREACHABLE'&&!e.message.includes('已保存'));
  await assert.rejects(requestJSON(url,{}, {fetchImpl:async()=>{throw new TypeError('Failed to fetch');},isOnline:()=>false}),e=>e.code==='OFFLINE');
});
test('timeout remains unconfirmed so an idempotent command may be retried',async()=>{
  await assert.rejects(requestJSON(url,{method:'POST'}, {timeoutMs:5,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))}),e=>e.code==='TIMEOUT'&&!e.status&&!e.message.includes('已保存'));
});
test('malformed success and server HTML are distinguished without discarding uncertain commands',async()=>{
  await assert.rejects(call(new Response('<html>Gateway</html>',{status:200})),e=>e.code==='INVALID_RESPONSE'&&!e.status);
  await assert.rejects(call(new Response('<html>Unavailable</html>',{status:503})),e=>e.code==='SERVICE_UNAVAILABLE'&&e.status===503);
  await assert.rejects(call(Response.json({error:{code:'SERVICE_ERROR',message:'服务异常'}},{status:503})),e=>isConnectionError(e));
});
