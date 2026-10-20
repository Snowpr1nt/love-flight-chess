(function () {
  'use strict';
  const API=window.LOVE_FLIGHT_CONFIG?.apiBase||'/api/flight';
  const crossOrigin=new URL(API,location.href).origin!==location.origin;
  const tokenKey='love-flight-api-token:'+new URL(API,location.href).origin;
  let sessionToken=null;
  if(crossOrigin)try{sessionToken=localStorage.getItem(tokenKey);}catch{/* Memory-only sessions still work until reload. */}
  const $=id=>document.getElementById(id);
  const safeStore={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);}catch{}}};
  let hook=null,player=null,room=null,timer=null,polling=false,connected=false,sending=false,pendingCommand=null;
  let failures=0,lastHeartbeat=0,avatar='cat-pink',uploadedAvatar=null,applying=Promise.resolve();
  let profileReady=false,toastTimer=null;
  const invite=(new URLSearchParams(location.search).get('invite')||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,6);
  const online={
    get room(){return room;},get player(){return player;},get pending(){return sending||!!pendingCommand;},
    get connected(){return connected;},get seat(){return room?.selfSeat??-1;},
    canAct(state){return !!(connected&&room&&room.selfSeat>=0&&room.members.length===2&&room.members.every(m=>m.online)&&Date.now()+room.serverTime-(room.receivedAt||Date.now())>=room.notBefore&&state&&state.current===room.selfSeat&&!sending&&!pendingCommand);},
    isMine(state){return room?.selfSeat===state?.current;},
    avatarFor(index){return room?.members[index]?.avatar||`cat-${index===0?'pink':'blue'}`;},
    command, notify, mount, openLobby(){renderLobby();$('onlineLobby').showModal();},
  };
  window.CoupleFlightOnline=online;
  function image(node,value) {
    node.replaceChildren();const img=document.createElement('img');
    img.src=value?.startsWith('data:image/')?value:'assets/decor/pixel-cat.svg';
    img.alt='';img.className='online-avatar-img '+(value?.startsWith('cat-')?value:'');
    img.addEventListener('error',()=>{img.src='assets/decor/pixel-cat.svg';},{once:true});node.append(img);
  }
  online.paintAvatar=image;
  function notify(message,error=false) {
    const el=$('onlineToast');el.textContent=message;el.dataset.error=String(error);el.hidden=false;
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true;},error?7000:3500);
  }
  async function request(path,body) {
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetch(API+path,{method:body===undefined?'GET':'POST',credentials:crossOrigin?'omit':'same-origin',cache:'no-store',signal:controller.signal,
        headers:{...(body===undefined?{}:{'content-type':'application/json','x-love-flight':'1'}),...(crossOrigin&&sessionToken?{authorization:'Bearer '+sessionToken}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      let data;try{data=await response.json();}catch{throw Object.assign(new Error('服务正在连接，请稍后重试。'),{code:'NETWORK'});}
      if(!response.ok){if(crossOrigin&&data.error?.code==='SESSION_EXPIRED'){sessionToken=null;try{localStorage.removeItem(tokenKey);}catch{}}throw Object.assign(new Error(data.error?.message||'操作未完成，请重试。'),{code:data.error?.code,status:response.status});}
      if(crossOrigin&&data.sessionToken){sessionToken=data.sessionToken;safeStore.set(tokenKey,sessionToken);delete data.sessionToken;}
      return data;
    } catch(error) {
      if(error.name==='AbortError'||error instanceof TypeError)throw Object.assign(new Error('网络连接暂时中断，棋局已保存在服务器。'),{code:'NETWORK'});
      throw error;
    } finally {clearTimeout(timeout);}
  }
  function mount(callback) {
    hook=callback;
    const lobby=document.createElement('dialog');lobby.id='onlineLobby';lobby.className='modal online-lobby';
    lobby.setAttribute('aria-labelledby','onlineTitle');
    lobby.innerHTML=`<button type="button" id="onlineLobbyClose" class="close-button modal-close" aria-label="返回棋盘" hidden>×</button>
      <div class="online-intro"><img src="assets/decor/pixel-cat.svg" alt=""><span>LOVE FLIGHT · 两个人的同一趟航程</span><img class="cat-blue" src="assets/decor/pixel-cat.svg" alt=""></div>
      <h2 id="onlineTitle">隔着距离，<em>也能一起起飞。</em></h2>
      <p class="online-lead" id="onlineLead">各用自己的设备，邀请另一半，一起绕过想念的每一格。</p>
      <form id="onlineProfileForm" class="online-profile-form">
        <label class="online-name-label" for="onlineNickname">你的昵称<input id="onlineNickname" maxlength="12" placeholder="给对方熟悉的那个名字" autocomplete="nickname" required></label>
        <fieldset class="online-avatar-picker"><legend>挑一枚属于你的头像棋子</legend><div id="onlineAvatarOptions"></div><label class="online-upload">＋ 选一张自己的照片<input id="onlineAvatarUpload" type="file" accept="image/png,image/jpeg,image/webp"></label></fieldset>
        <button class="primary-button full-width" id="onlineProfileSubmit" type="submit">领取我的登机牌 ↗</button>
        <p class="online-demo-note">网页版联机体验 · 昵称头像体验身份，微信登录尚未接入。</p>
      </form>
      <section id="onlineHome" hidden>
        <div class="online-self"><span id="onlineSelfAvatar"></span><div><strong id="onlineSelfName"></strong><small>登机牌已准备好 ♡</small></div><button type="button" id="onlineEditProfile" class="subtle-button">修改</button></div>
        <button type="button" class="primary-button full-width" id="onlineCreate">创建双人房间 <span>↗</span></button>
        <p class="online-divider">或输入对方的邀请码</p>
        <form id="onlineJoinForm" class="online-join"><label class="sr-only" for="onlineCode">6 位房间邀请码</label><input id="onlineCode" maxlength="6" placeholder="6 位邀请码" autocomplete="off" spellcheck="false"><button class="subtle-button" id="onlineJoin" type="submit">加入航程</button></form>
        <button type="button" class="text-button online-resume" id="onlineResume" hidden>继续上次的航程 →</button>
        <p class="online-demo-note">房间仅限两人，加入需要房主确认。<a href="local.html">也可以在同一台设备上玩</a></p>
      </section>
      <section id="onlineWaiting" hidden>
        <div class="online-invite-card"><span>你们的心动房间</span><strong id="onlineRoomCode"></strong><div><button type="button" id="onlineCopyInvite" class="subtle-button">复制邀请链接</button><button type="button" id="onlineCopyCode" class="subtle-button">复制邀请码</button></div></div>
        <div id="onlineMembers" class="online-members"></div><div id="onlineJoinRequests" class="online-join-requests"></div>
        <p id="onlineWaitingHint" class="online-waiting-hint" role="status"></p>
        <button type="button" id="onlineReady" class="primary-button full-width">我准备好了 ♡</button>
      </section>
      <p id="onlineLobbyError" class="online-error" role="alert" hidden></p>`;
    document.body.append(lobby);
    const strip=document.createElement('div');strip.className='online-room-strip';strip.innerHTML=`<div class="online-strip-main"><span id="onlineNetworkDot" class="online-network-dot"></span><strong id="onlineConnection">双人联机体验</strong><span id="onlineSeatLabel"></span></div><div class="online-strip-actions"><button id="onlineRetry" type="button" hidden>重试上次操作</button><button id="onlineViewTask" type="button" hidden>查看本轮任务</button><button id="onlineRoomMenu" type="button">我的航程</button></div>`;
    document.querySelector('.game-section').before(strip);
    const toast=document.createElement('div');toast.id='onlineToast';toast.className='online-toast';toast.setAttribute('role','status');toast.hidden=true;document.body.append(toast);
    for(const color of ['pink','blue','mint','lilac']) {
      const btn=document.createElement('button');btn.type='button';btn.className='online-avatar-choice';btn.dataset.avatar='cat-'+color;btn.setAttribute('aria-label',({pink:'粉色',blue:'蓝色',mint:'薄荷',lilac:'淡紫'})[color]+'像素猫头像');image(btn,'cat-'+color);
      btn.addEventListener('click',()=>{avatar='cat-'+color;uploadedAvatar=null;renderAvatarPicker();});$('onlineAvatarOptions').append(btn);
    }
    $('onlineAvatarUpload').addEventListener('change',uploadAvatar);
    $('onlineProfileForm').addEventListener('submit',async event=>{event.preventDefault();await runLobby(async()=>{
      const result=await request('/visitor',{nickname:$('onlineNickname').value,avatar:uploadedAvatar||avatar});player=result.player;profileReady=true;renderLobby();
    });});
    $('onlineCreate').addEventListener('click',()=>runLobby(async()=>{const result=await request('/rooms',{});consume(result.room);startPolling();}));
    $('onlineJoinForm').addEventListener('submit',event=>{event.preventDefault();runLobby(async()=>{const result=await request('/rooms/join',{code:$('onlineCode').value,actionId:crypto.randomUUID()});consume(result.room);startPolling();});});
    $('onlineReady').addEventListener('click',()=>command(room?.state?.phase==='finished'?'REMATCH':'READY'));
    $('onlineEditProfile').addEventListener('click',()=>{profileReady=false;renderLobby();});
    $('onlineRoomMenu').addEventListener('click',()=>online.openLobby());
    $('onlineLobbyClose').addEventListener('click',()=>lobby.close());
    lobby.addEventListener('cancel',event=>{if(!room?.state)event.preventDefault();});
    $('onlineViewTask').addEventListener('click',()=>hook.showTask());
    $('onlineRetry').addEventListener('click',()=>pendingCommand&&sendPending());
    $('onlineResume').addEventListener('click',()=>runLobby(async()=>{const id=safeStore.get('love-flight-room');if(id){const result=await request('/rooms/'+id+'?heartbeat=1');consume(result.room);startPolling();}}));
    $('onlineCopyInvite').addEventListener('click',()=>{const link=new URL('play.html',location.href);link.searchParams.set('invite',room.code);copy(link.href);});
    $('onlineCopyCode').addEventListener('click',()=>copy(room.code));
    $('onlineCode').value=invite;
    renderAvatarPicker();renderLobby();lobby.showModal();
    request('/visitor').then(async result=>{
      player=result.player;avatar=player.avatar;uploadedAvatar=avatar.startsWith('data:')?avatar:null;profileReady=true;$('onlineNickname').value=player.nickname;renderAvatarPicker();renderLobby();
      const previous=safeStore.get('love-flight-room');
      if(previous)try{const saved=await request('/rooms/'+previous+'?heartbeat=1');if(!invite||saved.room.code===invite){consume(saved.room);startPolling();}}catch{/* A stale invitation must not prevent a new game. */}
    }).catch(error=>{if(error.code!=='SESSION_EXPIRED')notify(error.message,true);});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&room){clearTimeout(timer);poll();}});
    window.addEventListener('online',()=>{if(room){clearTimeout(timer);poll();}});
    window.addEventListener('offline',()=>{connected=false;renderStrip();hook.refresh();});
  }
  function renderAvatarPicker() {
    document.querySelectorAll('.online-avatar-choice').forEach(btn=>{const active=btn.dataset.avatar===avatar&&!uploadedAvatar;btn.classList.toggle('selected',active);btn.setAttribute('aria-pressed',String(active));});
    const label=document.querySelector('.online-upload');label.classList.toggle('has-upload',!!uploadedAvatar);
    if(uploadedAvatar)label.firstChild.textContent='✓ 已选择自己的照片 ';else label.firstChild.textContent='＋ 选一张自己的照片 ';
  }
  async function uploadAvatar() {
    const file=$('onlineAvatarUpload').files[0];if(!file)return;
    try {
      if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>5*1024*1024)throw new Error('请选择 5 MB 以内的 PNG、JPG 或 WebP 图片。');
      const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;
      const context=canvas.getContext('2d');const side=Math.min(bitmap.width,bitmap.height);context.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,96,96);bitmap.close();
      const data=canvas.toDataURL('image/webp',.72);if(data.length>24000)throw new Error('照片细节较多，请换一张简单的头像。');
      uploadedAvatar=data;renderAvatarPicker();notify('照片已裁成圆形棋子，进入房间后双方都能看到。');
    } catch(error){notify(error.message||'这张照片暂时无法读取，请换一张。',true);}
  }
  async function copy(value) {
    try {await navigator.clipboard.writeText(value);notify('已复制，发给另一半就能一起登机 ♡');}
    catch {window.prompt('复制下面的邀请内容，发给另一半：',value);}
  }
  async function runLobby(fn) {
    if(sending)return;sending=true;setError('');renderLobby();
    try{await fn();}catch(error){setError(error.message);}finally{sending=false;renderLobby();renderStrip();}
  }
  function setError(message){$('onlineLobbyError').textContent=message;$('onlineLobbyError').hidden=!message;}
  function renderLobby() {
    if(!$('onlineLobby'))return;
    $('onlineProfileForm').hidden=profileReady;
    $('onlineHome').hidden=!profileReady||!!room;
    $('onlineWaiting').hidden=!profileReady||!room;
    $('onlineLobbyClose').hidden=!room?.state;
    $('onlineCreate').disabled=sending;$('onlineJoin').disabled=sending;$('onlineProfileSubmit').disabled=sending;
    if(player){$('onlineSelfName').textContent=player.nickname;image($('onlineSelfAvatar'),player.avatar);}
    $('onlineResume').hidden=!safeStore.get('love-flight-room')||!!room;
    if(!room)return;
    $('onlineRoomCode').textContent=room.code;$('onlineMembers').replaceChildren();
    for(let seat=0;seat<2;seat++) {
      const member=room.members[seat];const card=document.createElement('div');card.className='online-member '+(seat?'blue':'pink');
      const art=document.createElement('span');art.className='online-member-avatar';image(art,member?.avatar||`cat-${seat?'blue':'pink'}`);
      const name=document.createElement('strong');name.textContent=member?.nickname||(room.status==='pending'&&seat===0?room.hostName:'等待另一半');
      const status=document.createElement('small');status.textContent=member?(room.selfSeat===seat?'这是你 · ':'')+(room.ready?.includes(member.id)?'已准备':member.online?'已登机':'暂时离线'):'留给心里的那个人';
      card.append(art,name,status);$('onlineMembers').append(card);
    }
    $('onlineJoinRequests').replaceChildren();
    for(const guest of room.pending||[]) {
      const request=document.createElement('div');request.className='online-join-request';
      const name=document.createElement('span');name.textContent=guest.nickname+' 想加入这趟航程';
      const accept=document.createElement('button');accept.type='button';accept.textContent='接受';accept.disabled=sending;
      accept.addEventListener('click',()=>command('ACCEPT_JOIN',{targetId:guest.id}));
      const reject=document.createElement('button');reject.type='button';reject.textContent='婉拒';reject.disabled=sending;reject.addEventListener('click',()=>command('REJECT_JOIN',{targetId:guest.id}));
      request.append(name,accept,reject);$('onlineJoinRequests').append(request);
    }
    const ready=$('onlineReady');ready.hidden=room.selfSeat<0||!!room.state&&room.state.phase!=='finished';
    const ownId=room.members[room.selfSeat]?.id;
    if(room.state?.phase==='finished') {
      ready.textContent=room.rematch?.includes(ownId)?'已邀请对方再来一局':'再来一局 ♡';ready.disabled=sending||room.rematch?.includes(ownId);
      $('onlineWaitingHint').textContent=room.rematch?.length?'另一位确认后，新一趟航程就会开始。':'这趟航程已结束，也可以一起再玩一次。';
    } else {
      ready.disabled=sending||room.members.length!==2||room.ready?.includes(ownId);
      ready.textContent=room.ready?.includes(ownId)?'你已准备好，等另一半 ♡':'我准备好了 ♡';
      $('onlineWaitingHint').textContent=room.status==='pending'?'加入申请已送达，等房主确认即可登机。':room.members.length<2?'把邀请发给对方。对方加入后，请在这里确认。':room.state?'棋局已同步，关闭窗口即可继续飞行。':'两人分别点击准备，由服务器随机决定先手。';
    }
  }
  function renderStrip() {
    if(!$('onlineConnection'))return;
    $('onlineNetworkDot').dataset.online=String(connected);
    $('onlineConnection').textContent=!room?'双人联机体验':!connected?'正在重新连接…':room.state?'双人航线已连接':'等待一起起飞';
    $('onlineSeatLabel').textContent=room?.selfSeat>=0?`${room.code} · 你是${room.selfSeat===0?'粉色':'蓝色'}方`:'';
    $('onlineRetry').hidden=!pendingCommand||sending;
    $('onlineViewTask').hidden=!room?.state?.pendingCard;
    $('onlineRoomMenu').textContent=room?.rematch?.length?'对方邀请再来一局':'我的航程';
  }
  function consume(next) {
    if(room?.id===next.id&&next.revision<room.revision)return;
    const before=room;room=next;room.receivedAt=Date.now();connected=true;failures=0;
    safeStore.set('love-flight-room',room.id);
    if(invite&&room.code===invite){const clean=new URL(location.href);clean.searchParams.delete('invite');history.replaceState(history.state,'',clean.href);}
    if(pendingCommand&&room.events?.some(e=>e.actionId===pendingCommand.actionId))pendingCommand=null;
    renderLobby();renderStrip();
    if(!before||before.id!==room.id||before.revision!==room.revision) {
      const snapshot=structuredClone(room);
      const event=before?.id===room.id&&room.revision===before.revision+1?room.events?.find(e=>e.revision===room.revision):null;
      applying=applying.then(()=>room?.id===snapshot.id?hook.apply(snapshot,event):undefined).catch(error=>{console.error('display update failed',error);notify('画面正在重新同步，请刷新恢复棋局。',true);});
      if(room.state&&$('onlineLobby').open)$('onlineLobby').close();
    } else hook.refresh();
  }
  function startPolling(){clearTimeout(timer);poll();}
  async function poll() {
    if(polling||!room)return;polling=true;
    const heartbeat=Date.now()-lastHeartbeat>10000;
    try {
      const result=await request('/rooms/'+room.id+'?after='+room.revision+(heartbeat?'&heartbeat=1':''));
      if(heartbeat)lastHeartbeat=Date.now();
      if(result.unchanged){connected=true;failures=0;room.members.forEach((m,i)=>{m.online=result.online[i];});room.serverTime=result.serverTime;room.receivedAt=Date.now();renderStrip();renderLobby();hook.refresh();}
      else consume(result.room);
    } catch(error) {
      connected=false;failures++;renderStrip();hook.refresh();
      if(['SESSION_EXPIRED','ROOM_EXPIRED','NOT_A_MEMBER'].includes(error.code)) {
        clearTimeout(timer);room=null;pendingCommand=null;safeStore.set('love-flight-room','');if(error.code==='SESSION_EXPIRED')profileReady=false;
        hook.reset();
        setError(error.message);renderLobby();$('onlineLobby').showModal();return;
      }
    } finally {polling=false;if(room)timer=setTimeout(poll,failures?Math.min(8000,1000*2**Math.min(failures,3)):1100);}
  }
  async function command(type,extra={}) {
    if(sending||!room)return false;
    if(pendingCommand) {
      if(pendingCommand.type!==type){notify('有一项操作正在等待确认，请先重试。',true);return false;}
    } else pendingCommand={type,...extra,matchId:room.matchId,expectedRevision:room.revision,actionId:crypto.randomUUID()};
    return sendPending();
  }
  async function sendPending() {
    if(sending||!pendingCommand||!room)return false;
    sending=true;renderStrip();hook.refresh();
    try {
      const result=await request('/rooms/'+room.id+'/commands',pendingCommand);pendingCommand=null;consume(result.room);return true;
    } catch(error) {
      if(error.status&&error.status<500){pendingCommand=null;setError(error.message);await poll();}
      else connected=false;
      notify(error.message,true);return false;
    } finally {sending=false;renderLobby();renderStrip();hook.refresh();}
  }
})();
