(function () {
  'use strict';

  const engine = window.CoupleFlightEngine;
  const prompts = window.CoupleFlightPrompts;
  const boardData = window.CoupleFlightBoardData;
  const online = window.CoupleFlightOnline || null;
  if (!engine || !prompts || !boardData || prompts.length !== 36 || !boardData.validateBoardData().valid) {
    document.body.textContent = '游戏文件未完整加载，请检查 js 文件夹后刷新页面。';
    return;
  }

  const STORAGE_KEY = 'love-flight-chess-session-v3';
  const LEGACY_KEYS = ['love-flight-chess-session-v2', 'love-flight-chess-session-v1'];
  const FACE_CLASSES = ['face-1', 'face-2', 'face-3', 'face-4', 'face-5', 'face-6'];
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const $ = (id) => document.getElementById(id);
  const dom = {
    board: $('board'), boardCells: $('boardCells'), boardCenter: $('boardCenter'),
    sharedStart: $('sharedStart'),
    pinkStartToken: $('pinkStartToken'), blueStartToken: $('blueStartToken'), finishHeart: $('finishHeart'),
    rollButton: $('rollButton'), finaleEntryButton: $('finaleEntryButton'), diceFace: $('diceFace'), rollLabel: $('rollLabel'),
    turnHeading: $('turnHeading'), turnHint: $('turnHint'), turnNumber: $('turnNumber'),
    currentStop: $('currentStop'), nextPlayerName: $('nextPlayerName'), centerFootnote: $('centerFootnote'),
    playerStack: $('playerStack'), flightTip: $('flightTip'), eventLog: $('eventLog'), announcer: $('announcer'),
    setupDialog: $('setupDialog'), setupForm: $('setupForm'), rulesDialog: $('rulesDialog'), rulesButton: $('rulesButton'),
    settingsDialog: $('settingsDialog'), settingsButton: $('settingsButton'), soundToggle: $('soundToggle'),
    galleryDialog: $('galleryDialog'), galleryList: $('galleryList'),
    cardDialog: $('cardDialog'), cardCategory: $('cardCategory'), cardNumber: $('cardNumber'),
    cardTitle: $('cardTitle'), cardText: $('cardText'), cardExtra: $('cardExtra'),
    effectDialog: $('effectDialog'), effectCategory: $('effectCategory'), effectTitle: $('effectTitle'), effectLead: $('effectLead'),
    effectOptions: $('effectOptions'), effectConfirmButton: $('effectConfirmButton'), effectSkipButton: $('effectSkipButton'),
    winDialog: $('winDialog'), winTitle: $('winTitle'), winText: $('winText'), continueButton: $('continueButton'),
    promiseDialog: $('promiseDialog'), promiseOptions: $('promiseOptions'), promiseText: $('promiseText'),
    promiseInput: $('promiseInput'), promiseSaveButton: $('promiseSaveButton'),
    turnOverlay: $('turnOverlay'), turnOverlayTitle: $('turnOverlayTitle'),
    turnOverlayHint: $('turnOverlayHint'), turnOverlayDismiss: $('turnOverlayDismiss')
  };

  let state = null;
  let logs = ['两位机长在共同起点集合，准备跨越距离一起飞。'];
  let seenCards = [];
  let soundOn = false;
  let promiseNote = '';
  let busy = false;
  let epoch = 0;
  let turnOverlayTimer = null;
  let activeAnimation = null;
  let floatingPiece = null;
  let audioContext = null;
  const tiles = new Map();
  let onlineRevision = 0;
  let onlineMatchId = null;
  let diceTurn = null;
  let diceStopped = false;

  function syncIdleDice() {
    const turn = state ? `${onlineMatchId || 'local'}:${state.turnNumber}` : null;
    if (turn !== diceTurn) { diceTurn = turn; diceStopped = false; }
    dom.diceFace.classList.toggle('is-idle', !busy && !diceStopped && (!state || state.phase === 'await_roll'));
    $('diceTrigger').disabled = !state || busy || state.phase !== 'await_roll' || !dom.turnOverlay.hidden || !!(online && !online.canAct(state));
  }
  window.setInterval(() => {
    if (!reduceMotion && !document.hidden && dom.diceFace.classList.contains('is-idle')) {
      const current = FACE_CLASSES.findIndex(name => dom.diceFace.classList.contains(name));
      setDiceFace((current + 1) % 6 + 1);
    }
  }, 120);

  function makeSpiralCells() {
    const cells = [];
    const add = (x, y) => cells.push({ col: x + 1, row: y + 1 });
    for (let x = 9; x >= 0; x -= 1) add(x, 7);
    for (let y = 6; y >= 0; y -= 1) add(0, y);
    for (let x = 1; x <= 9; x += 1) add(x, 0);
    for (let y = 1; y <= 2; y += 1) add(9, y);
    for (let x = 8; x >= 3; x -= 1) add(x, 2);
    for (let y = 3; y <= 5; y += 1) add(3, y);
    for (let x = 4; x <= 8; x += 1) add(x, 5);
    add(9, 5);
    add(9, 6);
    return cells;
  }

  const spiralCells = makeSpiralCells();
  if (spiralCells.length !== 44 || new Set(spiralCells.map(({ col, row }) => `${col},${row}`)).size !== 44 ||
      spiralCells.some((cell, index) => {
        const next = spiralCells[(index + 1) % 44];
        return Math.abs(cell.col - next.col) + Math.abs(cell.row - next.row) !== 1;
      })) throw new Error('The 44-square spiral route must be continuous and close back to its start.');

  function randomNumber(max) {
    if (window.crypto?.getRandomValues) {
      const values = new Uint8Array(1);
      const ceiling = 256 - (256 % max);
      do { window.crypto.getRandomValues(values); } while (values[0] >= ceiling);
      return values[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function randomDie() { return randomNumber(6) + 1; }
  function pilotName(index) { return index === 0 ? '粉色方' : '蓝色方'; }
  function pilotColor(index) { return index === 0 ? 'pink' : 'blue'; }
  function playerName(index) { return state?.players[index]?.name || pilotName(index); }
  function wait(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }

  function announce(message) {
    dom.announcer.textContent = '';
    window.setTimeout(() => { dom.announcer.textContent = message; }, 15);
  }

  function addLog(message) {
    logs.unshift(message);
    logs = logs.slice(0, 8);
  }

  function readSaved() {
    if (online) {
      try { soundOn = localStorage.getItem('love-flight-online-sound') === 'true'; } catch (_) {}
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && engine.validateState(saved.state)) {
        state = saved.state;
        if (Array.isArray(saved.logs)) logs = saved.logs.filter((line) => typeof line === 'string').slice(0, 8);
        if (Array.isArray(saved.seenCards)) seenCards = saved.seenCards.filter((id) => Number.isInteger(id) && id >= 1 && id <= 36);
        soundOn = saved.soundOn === true;
        promiseNote = typeof saved.promiseNote === 'string' ? saved.promiseNote.slice(0, 240) : '';
        return;
      }
      for (const key of LEGACY_KEYS) {
        const old = JSON.parse(localStorage.getItem(key) || 'null');
        if (!old || typeof old !== 'object') continue;
        soundOn = old.soundOn === true;
        const names = old.state?.players?.map((player) => player?.name);
        if (names?.length === 2 && names.every((name) => typeof name === 'string' && name.trim())) {
          $('playerOneName').value = names[0].slice(0, 12);
          $('playerTwoName').value = names[1].slice(0, 12);
        }
        break;
      }
    } catch (_) { /* Browser storage may be unavailable; the game still works. */ }
  }

  function save() {
    if (online) {
      try { localStorage.setItem('love-flight-online-sound', String(soundOn)); } catch (_) {}
      return;
    }
    if (!state) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, logs, seenCards, soundOn, promiseNote })); }
    catch (_) { /* Keep the current session playable without local storage. */ }
  }

  function tileDescription(tile) {
    if (tile.type === 'truth' || tile.type === 'dare') {
      const prompt = prompts[tile.promptId - 1];
      return `第 ${tile.id} 格，${tile.type === 'truth' ? '真心话' : '大冒险'}：${prompt.title}`;
    }
    return `第 ${tile.id} 格，${tile.type === 'reward' ? '奖励前进两格' : '惩罚回退两格'}`;
  }

  function buildBoard() {
    const labels = { truth: '♡', dare: '✦', reward: '↑', penalty: '↓' };
    boardData.tiles.forEach((tileData) => {
      const desktop = spiralCells[tileData.id - 1];
      const mobile = { col: desktop.row, row: desktop.col };
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = `tile ${tileData.type}`;
      tile.style.setProperty('--col', String(desktop.col));
      tile.style.setProperty('--row', String(desktop.row));
      tile.style.setProperty('--m-col', String(mobile.col));
      tile.style.setProperty('--m-row', String(mobile.row));
      tile.setAttribute('aria-label', tileDescription(tileData));
      const number = document.createElement('span');
      number.className = 'tile-number';
      number.textContent = String(tileData.id).padStart(2, '0');
      const symbol = document.createElement('span');
      symbol.className = 'tile-symbol';
      symbol.textContent = labels[tileData.type];
      symbol.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span');
      title.className = 'tile-title';
      title.textContent = tileData.promptId
        ? prompts[tileData.promptId - 1].shortTitle || prompts[tileData.promptId - 1].title
        : tileData.type === 'reward' ? '前进2格' : '后退2格';
      const tokenList = document.createElement('span');
      tokenList.className = 'tile-token-list';
      tokenList.setAttribute('aria-hidden', 'true');
      tile.append(number, symbol, title, tokenList);
      tile.addEventListener('click', () => {
        if (busy || !dom.turnOverlay.hidden) return;
        if (tileData.promptId) openGallery(tileData.promptId);
        else if (!dom.rulesDialog.open) dom.rulesDialog.showModal();
      });
      dom.boardCells.append(tile);
      tiles.set(tileData.id, { tile, tokenList });
    });
  }

  function makePiece(index, className) {
    const piece = document.createElement('span');
    piece.className = `${className} ${pilotColor(index)}`;
    piece.textContent = index === 0 ? '♀' : '♂';
    if (online) online.paintAvatar(piece, online.avatarFor(index));
    piece.setAttribute('aria-hidden', 'true');
    if (className !== 'moving-piece') piece.addEventListener('click', (event) => {
      event.stopPropagation();
      tapPiece(piece);
    });
    return piece;
  }

  function tapPiece(piece) {
    if (busy || reduceMotion) return;
    piece.classList.remove('is-tapped');
    void piece.offsetWidth;
    piece.classList.add('is-tapped');
    window.setTimeout(() => piece.classList.remove('is-tapped'), 150);
  }

  function squareFor(index, progress) {
    return progress >= 1 && progress <= 44 ? engine.getSquareForProgress(index, progress) : null;
  }

  function targetFor(index, progress) {
    if (progress === 0) return index === 0 ? dom.pinkStartToken : dom.blueStartToken;
    if (progress === 45) return dom.finishHeart;
    return tiles.get(squareFor(index, progress))?.tile || null;
  }

  function renderBoard() {
    if (online) {
      online.paintAvatar(dom.pinkStartToken, online.avatarFor(0));
      online.paintAvatar(dom.blueStartToken, online.avatarFor(1));
    }
    for (const { tile, tokenList } of tiles.values()) {
      tokenList.replaceChildren();
      tile.classList.remove('is-current');
    }
    dom.finishHeart.querySelectorAll('.finish-token').forEach((node) => node.remove());
    dom.pinkStartToken.hidden = !state || state.players[0].progress !== 0;
    dom.blueStartToken.hidden = !state || state.players[1].progress !== 0;
    if (!state) return;
    state.players.forEach((player, index) => {
      if (player.progress === 45) {
        dom.finishHeart.append(makePiece(index, 'finish-token'));
        return;
      }
      if (player.progress === 0) return;
      const entry = tiles.get(squareFor(index, player.progress));
      if (!entry) return;
      entry.tokenList.append(makePiece(index, 'tile-token'));
      if (index === state.current && state.phase !== 'finished') entry.tile.classList.add('is-current');
    });
  }

  function renderPlayers() {
    dom.playerStack.replaceChildren();
    if (!state) return;
    state.players.forEach((player, index) => {
      const card = document.createElement('div');
      card.className = `player-card ${pilotColor(index)}${index === state.current && state.phase !== 'finished' ? ' is-active' : ''}`;
      const avatar = document.createElement('span');
      avatar.className = 'player-avatar';
      avatar.textContent = index === 0 ? '♀' : '♂';
      if (online) online.paintAvatar(avatar, online.avatarFor(index));
      avatar.setAttribute('aria-hidden', 'true');
      const info = document.createElement('div');
      info.className = 'player-info';
      const name = document.createElement('strong');
      name.className = 'player-name';
      name.textContent = player.name;
      const sub = document.createElement('span');
      sub.className = 'player-label';
      sub.textContent = `${pilotName(index)} · ${player.progress === 0 ? '共同起点' : player.progress === 45 ? '已到终点' : `第 ${squareFor(index, player.progress)} 格 · 行程 ${player.progress}/44`}`;
      info.append(name, sub);
      const badge = document.createElement('span');
      badge.className = 'player-badge';
      badge.textContent = player.progress === 45 ? '已抵达' : index === state.current && state.phase !== 'finished' ? '当前回合' : '等待中';
      const top = document.createElement('div');
      top.className = 'player-top';
      top.append(avatar, info, badge);
      const progress = document.createElement('div');
      progress.className = 'progress-top';
      const progressLabel = document.createElement('span');
      progressLabel.textContent = '航线进度';
      const progressValue = document.createElement('b');
      progressValue.textContent = player.progress === 0 ? '起点' : player.progress === 45 ? '终点' : `${player.progress} / 44`;
      progress.append(progressLabel, progressValue);
      const track = document.createElement('div');
      track.className = 'progress-track';
      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      fill.style.width = `${Math.round(player.progress / 45 * 100)}%`;
      track.append(fill);
      card.append(top, progress, track);
      dom.playerStack.append(card);
    });
  }

  function renderLog() {
    dom.eventLog.replaceChildren();
    logs.forEach((line) => {
      const item = document.createElement('li');
      item.textContent = line;
      dom.eventLog.append(item);
    });
  }

  function renderTurn() {
    syncIdleDice();
    const index = state?.current || 0;
    const pilot = pilotColor(index);
    document.body.dataset.pilot = pilot;
    dom.boardCenter.dataset.pilot = pilot;
    dom.turnNumber.textContent = state ? String(state.turnNumber) : '1';
    dom.nextPlayerName.textContent = state?.phase === 'finished' ? '航程已结束' : state ? playerName(1 - index) : '另一位机长';
    const utilityLocked = busy || !dom.turnOverlay.hidden || online?.pending;
    dom.rulesButton.disabled = utilityLocked;
    dom.settingsButton.disabled = utilityLocked;
    $('galleryButton').disabled = utilityLocked;
    $('restartButton').disabled = utilityLocked;
    dom.boardCells.classList.toggle('is-busy', utilityLocked);
    dom.rollButton.hidden = state?.phase === 'finished';
    dom.finaleEntryButton.hidden = state?.phase !== 'finished';
    dom.finaleEntryButton.disabled = busy;
    if (!state) {
      dom.turnHeading.textContent = '等你们一起起飞';
      dom.turnHint.textContent = '输入两个人的名字，开启异地心动航线。';
      dom.currentStop.textContent = '共同起点';
      dom.centerFootnote.textContent = '2 / 4 / 6 起飞 · 精准抵达终点';
      dom.rollLabel.textContent = '掷骰子';
      dom.rollButton.disabled = true;
      if (online) {
        dom.turnHeading.textContent = '两个人的登机时间';
        dom.turnHint.textContent = '创建或加入房间，双方准备好就能一起起飞。';
        lockOnlineControls();
      }
      return;
    }
    const player = state.players[index];
    const atStart = player.progress === 0;
    dom.currentStop.textContent = atStart ? '共同起点' : player.progress === 45 ? '爱心终点' : `第 ${squareFor(index, player.progress)} 格`;
    dom.centerFootnote.textContent = '掷出 2 / 4 / 6 起飞 · 精准落心';
    if (state.phase === 'finished') {
      dom.turnHeading.textContent = `${playerName(state.firstWinner)} 抵达终点！`;
      dom.turnHint.textContent = '一起解锁这趟航程的最终约定。';
      dom.rollLabel.textContent = '已抵达终点';
    } else if (state.phase === 'await_card') {
      const type = state.pendingCard?.type;
      dom.turnHeading.textContent = `${player.name} 的互动时刻`;
      dom.turnHint.textContent = type === 'reward' || type === 'penalty'
        ? '选择一项额外内容，确认后继续沿棋盘移动。'
        : '完成或双方同意跳过当前任务后，才会换人。';
      dom.rollLabel.textContent = '先完成这一站';
    } else {
      dom.turnHeading.textContent = `${pilotName(index)}回合 · ${player.name}`;
      dom.turnHint.textContent = atStart ? '掷出 2、4 或 6，就从共同起点飞入第 1 格。' : `已走 ${player.progress}/44 格；掷骰向中心爱心继续前进。`;
      dom.rollLabel.textContent = '掷骰子';
    }
    dom.rollButton.disabled = busy || state.phase !== 'await_roll' || !dom.turnOverlay.hidden;
    const tip = dom.flightTip?.querySelector('p');
    if (tip) tip.textContent = state.phase === 'finished'
      ? '先抵达爱心终点的一方，可以和对方写下一个双方愿意的最终约定。'
      : '奖励格前进 2 格，惩罚格回退 2 格；每次落地都会再次判定格子。';
    lockOnlineControls();
  }

  function lockOnlineControls() {
    if (!online) return;
    const allowed = online.canAct(state) && !busy;
    const mine = online.isMine(state);
    dom.rollButton.disabled = !allowed || state?.phase !== 'await_roll' || !dom.turnOverlay.hidden;
    if (state?.phase === 'await_roll' && !mine) dom.rollLabel.textContent = '等对方掷骰子';
    if (state && !online.connected) dom.turnHint.textContent = '网络正在恢复，棋局已保存，请稍等一下。';
    else if (state && online.room?.members.some(member => !member.online)) dom.turnHint.textContent = '对方暂时离线，等重新连接后再一起继续。';
    if ($('onlineViewTask')) $('onlineViewTask').disabled = busy || online.pending;
    for (const id of ['completeButton', 'skipButton', 'swapButton', 'effectSkipButton']) $(id).disabled = !allowed;
    dom.effectConfirmButton.disabled = !allowed || !dom.effectOptions.querySelector('input:checked');
    dom.effectOptions.querySelectorAll('input').forEach(input => { input.disabled = !allowed; });
    dom.cardDialog.classList.toggle('online-readonly', !mine);
    dom.cardExtra.textContent = mine ? '由你操作；完成或双方同意跳过后，另一端会同步换人。' : `轮到 ${playerName(state?.current || 0)} 完成这一站，你可以在这里一起看题。`;
    dom.cardDialog.querySelector('.card-consent').textContent = mine ? '以彼此舒服的方式完成；不想回答时，直接跳过就好。' : '另一位机长正在操作。你可以关闭题卡，随时从“查看本轮任务”再打开。';
    dom.promiseOptions.querySelectorAll('input').forEach(input => { input.disabled = !state || state.finaleChoice !== null || !mine; });
    dom.promiseSaveButton.disabled = !state || !state.finaleChoice && (!allowed || !dom.promiseOptions.querySelector('input:checked'));
  }

  async function applyOnlineSnapshot(snapshot, event) {
    const previousState = state;
    const sameMatch = onlineMatchId === snapshot.matchId;
    const hadPromise = dom.promiseDialog.open;
    const animate = !!(event && sameMatch && event.previousRevision === onlineRevision && Date.now() - event.createdAt < 10000);
    if (!sameMatch) {
      stopPendingAnimation();
      dom.finishHeart.classList.remove('is-winning');
      try { promiseNote = localStorage.getItem('love-flight-online-note-' + snapshot.matchId) || ''; } catch (_) {}
    }
    closeGameDialogs();
    [dom.rulesDialog, dom.settingsDialog, dom.galleryDialog].forEach(dialog => { if (dialog.open) dialog.close(); });
    hideTurnOverlay();
    busy = true;
    renderTurn();
    const token = epoch;
    if (animate && state) {
      const rolled = event.events.find(item => item.type === 'roll');
      if (rolled && !await animateDice(rolled.die, token)) return;
      for (const moved of event.events.filter(item => item.type === 'move')) {
        if (!await animateMove(moved, token)) return;
      }
      if (event.events.some(item => item.type === 'move') && !reduceMotion) await wait(300);
    }
    if (token !== epoch) return;
    state = snapshot.state;
    logs = snapshot.logs || ['两位机长即将从共同起点出发。'];
    onlineRevision = snapshot.revision;
    onlineMatchId = snapshot.matchId;
    if (state?.phase === 'finished' && previousState?.phase !== 'finished' && animate) {
      renderBoard();
      dom.finishHeart.classList.add('is-winning');
      await wait(reduceMotion ? 100 : 800);
    }
    busy = false;
    clearDiceAnimation();
    render();
    if (state?.phase === 'await_card') { closeGameDialogs(); showPending(); }
    else if (state?.phase === 'finished') {
      if (previousState?.phase !== 'finished') showWin();
      else if (hadPromise) showPromise();
    } else if (state && (event?.events.some(item => item.type === 'turn_changed' || item.type === 'game_started') || !sameMatch)) {
      showTurnOverlay(state.current);
    }
  }

  function render() {
    renderBoard();
    renderPlayers();
    renderLog();
    renderTurn();
    dom.soundToggle.checked = soundOn;
    if (!busy) setDiceFace(state?.lastRoll || 5);
  }

  function setDiceFace(value) {
    dom.diceFace.classList.remove(...FACE_CLASSES);
    dom.diceFace.classList.add(FACE_CLASSES[value - 1]);
  }

  function clearDiceAnimation() {
    dom.diceFace.classList.remove('is-preparing', 'is-rolling', 'is-decelerating', 'is-settled');
    dom.rollButton.classList.remove('is-rolling');
  }

  async function animateDice(finalValue, token) {
    diceStopped = true;
    dom.diceFace.classList.remove('is-idle');
    clearDiceAnimation();
    setDiceFace(finalValue);
    dom.diceFace.classList.add('is-settled');
    playTone(410 + finalValue * 65, 0.17);
    // Preserve the server's 1.9s presentation lock while showing a stable result.
    await wait(1900);
    if (token !== epoch) return false;
    dom.diceFace.classList.remove('is-settled');
    return true;
  }

  function centerInBoard(element) {
    const target = element.getBoundingClientRect();
    const board = dom.board.getBoundingClientRect();
    const targetY = element === dom.finishHeart ? target.height * 0.83 : target.height / 2;
    return { x: target.left - board.left + target.width / 2, y: target.top - board.top + targetY };
  }

  function hideSourcePiece(index, progress) {
    const selector = `.tile-token.${pilotColor(index)}`;
    const source = progress === 0 ? (index === 0 ? dom.pinkStartToken : dom.blueStartToken)
      : progress === 45 ? dom.finishHeart.querySelector(`.finish-token.${pilotColor(index)}`)
        : targetFor(index, progress)?.querySelector(selector);
    if (source) source.style.visibility = 'hidden';
    return source;
  }

  async function animateMove(event, token) {
    const index = event.player;
    const fromProgress = event.fromProgress ?? event.from;
    const steps = event.steps || event.route || [];
    if (!steps.length) return true;
    const origin = targetFor(index, fromProgress);
    if (!origin) return true;
    const hiddenSource = hideSourcePiece(index, fromProgress);
    const piece = makePiece(index, 'moving-piece');
    piece.classList.add('is-moving');
    piece.style.position = 'absolute';
    piece.style.transition = 'none';
    const squareWidth = tiles.get(1)?.tile.getBoundingClientRect().width || 36;
    const size = Math.max(17, squareWidth * 0.7);
    piece.style.width = `${size}px`;
    piece.style.height = `${size}px`;
    piece.style.fontSize = `${Math.round(size * 0.52)}px`;
    const start = centerInBoard(origin);
    piece.style.left = `${start.x}px`;
    piece.style.top = `${start.y}px`;
    dom.board.append(piece);
    floatingPiece = piece;
    let current = start;
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      if (token !== epoch) break;
      const progress = steps[stepIndex];
      const target = targetFor(index, progress);
      if (!target) continue;
      const next = centerInBoard(target);
      if (reduceMotion) {
        piece.style.left = `${next.x}px`;
        piece.style.top = `${next.y}px`;
      } else {
        let frames = [
          { left: `${current.x}px`, top: `${current.y}px` },
          { left: `${next.x}px`, top: `${next.y}px` }
        ];
        const following = targetFor(index, steps[stepIndex + 1]);
        if (following) {
          const after = centerInBoard(following);
          const incoming = { x: next.x - current.x, y: next.y - current.y };
          const outgoing = { x: after.x - next.x, y: after.y - next.y };
          const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
          if (Math.abs(cross) > 1) {
            // Bend gently inside the corner cell while still visiting its exact center.
            const control = { x: next.x - outgoing.x * 0.22, y: next.y - outgoing.y * 0.22 };
            frames = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
              const remain = 1 - fraction;
              return {
                offset: fraction,
                left: `${remain * remain * current.x + 2 * remain * fraction * control.x + fraction * fraction * next.x}px`,
                top: `${remain * remain * current.y + 2 * remain * fraction * control.y + fraction * fraction * next.y}px`
              };
            });
          }
        }
        const animation = piece.animate(frames, { duration: 300, easing: 'ease-in-out', fill: 'forwards' });
        activeAnimation = animation;
        await animation.finished.catch(() => {});
        activeAnimation = null;
        if (token !== epoch) break;
        piece.style.left = `${next.x}px`;
        piece.style.top = `${next.y}px`;
        animation.cancel();
      }
      current = next;
    }
    piece.remove();
    if (floatingPiece === piece) floatingPiece = null;
    if (hiddenSource) hiddenSource.style.visibility = '';
    return token === epoch;
  }

  function stopPendingAnimation() {
    epoch += 1;
    activeAnimation?.cancel();
    activeAnimation = null;
    floatingPiece?.remove();
    floatingPiece = null;
    busy = false;
    clearDiceAnimation();
  }

  function ensureAudio() {
    if (!soundOn) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      if (!audioContext) audioContext = new Context();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    } catch (_) { /* Audio is optional. */ }
  }

  function playTone(frequency, duration, delay = 0) {
    if (!soundOn) return;
    try {
      ensureAudio();
      if (!audioContext) return;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = audioContext.currentTime + delay;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    } catch (_) { /* Audio is optional. */ }
  }

  function playTurnChime() {
    playTone(480, 0.14);
    playTone(720, 0.2, 0.16);
  }

  function hideTurnOverlay() {
    if (turnOverlayTimer !== null) window.clearTimeout(turnOverlayTimer);
    turnOverlayTimer = null;
    const restoreFocus = dom.turnOverlay.contains(document.activeElement);
    dom.turnOverlay.hidden = true;
    renderTurn();
    if (restoreFocus && state?.phase === 'await_roll') dom.rollButton.focus();
  }

  function showTurnOverlay(index, initial = false) {
    hideTurnOverlay();
    dom.turnOverlay.dataset.pilot = pilotColor(index);
    dom.turnOverlayTitle.textContent = `轮到 ${playerName(index)} 掷骰子！`;
    dom.turnOverlayHint.textContent = initial ? '随机先手已确定，准备从共同起点出发。'
      : '上一站已完成，把好运气交给下一位机长。';
    dom.turnOverlay.hidden = false;
    dom.turnOverlayDismiss.focus();
    renderTurn();
    announce(`${pilotName(index)}回合，轮到 ${playerName(index)} 掷骰子。`);
    playTurnChime();
    turnOverlayTimer = window.setTimeout(hideTurnOverlay, 2600);
  }

  function eventText(event) {
    const name = playerName(event.player);
    switch (event.type) {
      case 'roll': return `${name} 掷出了 ${event.die} 点。`;
      case 'launch': return `${name} 从共同起点起飞！`;
      case 'launch_failed': return `${name} 这次没掷出 2、4 或 6，留在起点等待下一轮。`;
      case 'move': {
        const progress = event.toProgress ?? event.to;
        const place = progress === 45 ? '中心爱心终点' : progress === 0 ? '共同起点' : `第 ${squareFor(event.player, progress)} 格`;
        return `${name} ${event.source === 'penalty' ? '回退' : '前进'}到了${place}。`;
      }
      case 'first_winner': return `${name} 精准抵达爱心终点，解锁最终约定！`;
      case 'chain_stopped': return '连锁效果已安全结束。';
      default: return null;
    }
  }

  async function applyAction(action, token = epoch) {
    if (!state || token !== epoch) return;
    const result = engine.reduce(state, action);
    busy = true;
    renderTurn();
    const moveEvents = result.events.filter((event) => event.type === 'move');
    for (const event of moveEvents) {
      if (!await animateMove(event, token)) return;
    }
    if (moveEvents.length && !reduceMotion) {
      await wait(300);
      if (token !== epoch) return;
    }
    if (result.events.some((event) => event.type === 'first_winner')) {
      state = result.state;
      save();
      renderBoard();
      dom.finishHeart.classList.add('is-winning');
      await wait(reduceMotion ? 100 : 800);
      if (token !== epoch) return;
    }
    state = result.state;
    busy = false;
    const spoken = [];
    result.events.forEach((event) => {
      const line = eventText(event);
      if (line) { addLog(line); spoken.push(line); }
    });
    if (state.pendingCard?.cardId && !seenCards.includes(state.pendingCard.cardId)) seenCards.push(state.pendingCard.cardId);
    save();
    render();
    if (spoken.length) announce(spoken.join(' '));
    if (state.phase === 'await_card') showPending();
    else if (state.phase === 'finished') showWin();
    else if (result.events.some((event) => event.type === 'turn_changed')) showTurnOverlay(state.current);
  }

  async function roll() {
    if (!state || state.phase !== 'await_roll' || busy || !dom.turnOverlay.hidden || document.querySelector('dialog[open]')) return;
    if (online && !online.canAct(state)) return;
    diceStopped = true;
    syncIdleDice();
    if (online) {
      const accepted = await online.command('ROLL_REQUEST');
      if (!accepted && !online.pending) { diceStopped = false; syncIdleDice(); }
      return;
    }
    busy = true;
    renderTurn();
    ensureAudio();
    const token = epoch;
    const die = randomDie();
    if (!await animateDice(die, token)) return;
    await applyAction({ type: 'ROLL', die }, token);
  }

  $('diceTrigger').addEventListener('click', roll);

  function showPending() {
    if (!state || state.phase !== 'await_card' || busy) return;
    const pending = state.pendingCard;
    if (pending.type === 'truth' || pending.type === 'dare') showCard();
    else showEffect();
  }

  function showCard() {
    const pending = state.pendingCard;
    const prompt = prompts[pending.cardId - 1];
    dom.cardDialog.classList.toggle('dare-card', pending.type === 'dare');
    dom.cardCategory.textContent = `${pending.type === 'truth' ? '真心话' : '大冒险'} · ${prompt.stage}`;
    dom.cardNumber.textContent = `STOP ${String(pending.square).padStart(2, '0')} / 44${pending.cardId === boardData.tiles[pending.square - 1]?.promptId ? '' : ` · 换题 ${String(pending.cardId).padStart(2, '0')}`}`;
    dom.cardTitle.textContent = prompt.title;
    dom.cardText.textContent = prompt.text;
    dom.cardExtra.textContent = '完成后点击“已完成”；双方同意时也可以换题或跳过。';
    if (!dom.cardDialog.open) dom.cardDialog.showModal();
    lockOnlineControls();
  }

  function fillOptions(container, items, name) {
    container.replaceChildren();
    items.forEach((item) => {
      const label = document.createElement('label');
      label.className = 'choice-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = String(item.id);
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = item.title;
      const detail = document.createElement('small');
      detail.textContent = item.text;
      copy.append(title, detail);
      label.append(input, copy);
      container.append(label);
    });
  }

  function showEffect() {
    const pending = state.pendingCard;
    const reward = pending.type === 'reward';
    dom.effectDialog.classList.toggle('reward-effect', reward);
    dom.effectDialog.classList.toggle('penalty-effect', !reward);
    dom.effectCategory.textContent = reward ? 'REWARD · 顺风奖励' : 'PENALTY · 云端挑战';
    dom.effectTitle.textContent = reward ? '顺风奖励 · 前进 2 格' : '云端挑战 · 回退 2 格';
    dom.effectLead.textContent = reward
      ? '先选一份额外奖励，再向前飞 2 格；新落点会继续触发。'
      : '先选一项轻松挑战，再向后飞 2 格；新落点会继续触发。';
    fillOptions(dom.effectOptions, reward ? boardData.rewards : boardData.penalties, 'effectOption');
    dom.effectConfirmButton.disabled = true;
    if (online) {
      let previewClose = $('onlineEffectClose');
      if (!previewClose) {
        previewClose = document.createElement('button');
        previewClose.id = 'onlineEffectClose';
        previewClose.type = 'button';
        previewClose.className = 'close-button modal-close';
        previewClose.textContent = '×';
        previewClose.setAttribute('aria-label', '关闭奖惩预览');
        previewClose.addEventListener('click', () => dom.effectDialog.close());
        dom.effectDialog.append(previewClose);
      }
      previewClose.hidden = online.isMine(state);
    }
    if (!dom.effectDialog.open) dom.effectDialog.showModal();
    lockOnlineControls();
  }

  async function resolveCard(skipped = false) {
    if (!state || state.phase !== 'await_card' || busy) return;
    const pending = state.pendingCard;
    if (pending.type !== 'truth' && pending.type !== 'dare') return;
    if (online) {
      if (!online.isMine(state)) { dom.cardDialog.close(); return; }
      await online.command(skipped ? 'SKIP_TASK' : 'COMPLETE_TASK');
      return;
    }
    if (dom.cardDialog.open) dom.cardDialog.close();
    const prompt = prompts[pending.cardId - 1];
    addLog(`${playerName(state.current)} ${skipped ? '经双方同意跳过' : '已完成'}“${prompt.title}”。`);
    playTone(skipped ? 520 : 660, 0.16);
    await applyAction({ type: 'RESOLVE_CARD', skipped });
  }

  async function resolveEffect(skipped = false) {
    if (!state || state.phase !== 'await_card' || busy) return;
    const pending = state.pendingCard;
    if (pending.type !== 'reward' && pending.type !== 'penalty') return;
    if (online && !online.isMine(state)) { dom.effectDialog.close(); return; }
    const selected = dom.effectOptions.querySelector('input[name="effectOption"]:checked');
    if (!skipped && !selected) return;
    if (online) {
      await online.command(skipped ? 'SKIP_TASK' : 'CHOOSE_EFFECT', selected ? { optionId: Number(selected.value) } : {});
      return;
    }
    if (dom.effectDialog.open) dom.effectDialog.close();
    const options = pending.type === 'reward' ? boardData.rewards : boardData.penalties;
    const optionId = selected ? Number(selected.value) : undefined;
    const title = options.find((option) => option.id === optionId)?.title;
    addLog(`${playerName(state.current)} ${skipped ? '跳过现实额外奖惩' : `选择了“${title}”`}；棋盘${pending.type === 'reward' ? '前进' : '回退'} 2 格。`);
    playTone(pending.type === 'reward' ? 750 : 440, 0.16);
    await applyAction(skipped ? { type: 'RESOLVE_CARD', skipped: true } : { type: 'RESOLVE_CARD', optionId });
  }

  function swapCard() {
    if (!state || state.phase !== 'await_card' || busy) return;
    const pending = state.pendingCard;
    if (pending.type !== 'truth' && pending.type !== 'dare') return;
    if (online) { online.command('SWAP_TASK'); return; }
    const options = prompts.filter((prompt) => prompt.type === pending.type && prompt.id !== pending.cardId);
    const unused = options.filter((prompt) => !seenCards.includes(prompt.id));
    const pool = unused.length ? unused : options;
    const cardId = pool[randomNumber(pool.length)].id;
    const result = engine.reduce(state, { type: 'SWAP_CARD', cardId });
    state = result.state;
    if (!seenCards.includes(cardId)) seenCards.push(cardId);
    save();
    render();
    showCard();
    playTone(550, 0.13);
  }

  function showWin() {
    if (!state || state.phase !== 'finished') return;
    dom.winTitle.textContent = `${playerName(state.firstWinner)} 精准抵达！`;
    dom.winText.textContent = '跨过 44 格，也跨过一点距离。现在一起挑选一个双方都愿意的最终约定，让下一次心动有个具体日期。';
    dom.continueButton.hidden = false;
    if (!dom.winDialog.open && !dom.promiseDialog.open) dom.winDialog.showModal();
  }

  function showPromise() {
    if (dom.winDialog.open) dom.winDialog.close();
    fillOptions(dom.promiseOptions, boardData.finaleOptions, 'finaleOption');
    if (state.finaleChoice) {
      const chosen = dom.promiseOptions.querySelector(`input[value="${state.finaleChoice}"]`);
      if (chosen) chosen.checked = true;
      dom.promiseOptions.querySelectorAll('input').forEach((input) => { input.disabled = !input.checked; });
    }
    dom.promiseInput.value = promiseNote;
    dom.promiseSaveButton.disabled = !dom.promiseOptions.querySelector('input[name="finaleOption"]:checked');
    dom.promiseText.textContent = '选一个终点奖励，再把你们愿意兑现的时间或做法写下来。';
    if (!dom.promiseDialog.open) dom.promiseDialog.showModal();
    if (online) {
      dom.promiseText.textContent = state.finaleChoice ? '终点奖励已同步。下面的具体约定文字只保存在你的这台设备。' : '由获胜方选一个双方愿意的终点奖励，两端会一起看到结果。';
      dom.promiseSaveButton.firstChild.textContent = state.finaleChoice ? '保存本机约定 ' : '确认终点奖励 ';
      lockOnlineControls();
    }
  }

  async function savePromise() {
    if (!state || state.phase !== 'finished') return;
    const selected = dom.promiseOptions.querySelector('input[name="finaleOption"]:checked');
    if (!selected) return;
    const optionId = Number(selected.value);
    if (online) {
      if (!state.finaleChoice && !await online.command('CHOOSE_FINALE', { optionId })) return;
      promiseNote = dom.promiseInput.value.trim().slice(0, 120);
      try { localStorage.setItem('love-flight-online-note-' + online.room.matchId, promiseNote); } catch (_) {}
      dom.promiseDialog.close();
      online.notify('终点奖励已同步；具体文字约定已保存在本机。');
      return;
    }
    if (state.finaleChoice === null) state = engine.reduce(state, { type: 'CHOOSE_FINALE', optionId }).state;
    else if (state.finaleChoice !== optionId) return;
    promiseNote = dom.promiseInput.value.trim().slice(0, 120);
    const title = boardData.finaleOptions.find((option) => option.id === optionId).title;
    addLog(`最终约定：${title}${promiseNote ? ` · ${promiseNote}` : ''}`);
    save();
    render();
    dom.promiseDialog.close();
    announce(`最终约定已保存：${title}。`);
    playTone(760, 0.2);
  }

  function buildGallery(filter = 'all', selectedId) {
    dom.galleryList.replaceChildren();
    document.querySelectorAll('.gallery-tabs button').forEach((button) => {
      const active = button.dataset.filter === filter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    prompts.filter((prompt) => filter === 'all' || prompt.type === filter).forEach((prompt) => {
      const item = document.createElement('div');
      item.className = `gallery-item ${prompt.type}`;
      item.id = `gallery-card-${prompt.id}`;
      const number = document.createElement('span');
      number.textContent = String(prompt.id).padStart(2, '0');
      const title = document.createElement('strong');
      title.textContent = `${prompt.type === 'truth' ? '♡' : '✦'} ${prompt.title} · ${prompt.stage}`;
      const detail = document.createElement('small');
      detail.textContent = prompt.text;
      item.append(number, title, detail);
      dom.galleryList.append(item);
    });
    if (selectedId) window.setTimeout(() => $(`gallery-card-${selectedId}`)?.scrollIntoView({ block: 'center' }), 20);
  }

  function openGallery(selectedId) {
    if (busy || !dom.turnOverlay.hidden) return;
    buildGallery('all', selectedId);
    if (!dom.galleryDialog.open) dom.galleryDialog.showModal();
  }

  function closeGameDialogs() {
    [dom.cardDialog, dom.effectDialog, dom.winDialog, dom.promiseDialog].forEach((dialog) => {
      if (dialog?.open) dialog.close();
    });
  }

  function startGame(names) {
    stopPendingAnimation();
    hideTurnOverlay();
    closeGameDialogs();
    state = engine.createGame(names, randomNumber(2));
    logs = ['两位机长从共同起点出发；先手由随机抽签决定。'];
    seenCards = [];
    promiseNote = '';
    dom.finishHeart.classList.remove('is-winning');
    save();
    render();
    if (dom.setupDialog.open) dom.setupDialog.close();
    showTurnOverlay(state.current, true);
  }

  function restart() {
    if (busy || !dom.turnOverlay.hidden) return;
    if (online) {
      if (state?.phase !== 'finished') { online.openLobby(); return; }
      closeGameDialogs();
      online.command('REMATCH').then(() => online.openLobby());
      return;
    }
    if (!state) { if (!dom.setupDialog.open) dom.setupDialog.showModal(); return; }
    if (!window.confirm('确定开启新航程吗？当前进度与约定会清空。')) return;
    const names = state.players.map((player) => player.name);
    startGame(names);
  }

  function initEvents() {
    dom.setupForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const first = $('playerOneName').value.trim().slice(0, 12) || '小粉';
      const second = $('playerTwoName').value.trim().slice(0, 12) || '小蓝';
      startGame([first, second]);
    });
    dom.setupDialog.addEventListener('cancel', (event) => event.preventDefault());
    dom.cardDialog.addEventListener('cancel', (event) => { event.preventDefault(); resolveCard(true); });
    dom.effectDialog.addEventListener('cancel', (event) => { event.preventDefault(); resolveEffect(true); });
    dom.winDialog.addEventListener('cancel', (event) => event.preventDefault());
    dom.promiseDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      dom.promiseDialog.close();
    });
    [dom.pinkStartToken, dom.blueStartToken].forEach((piece) => piece.addEventListener('click', () => tapPiece(piece)));
    dom.rollButton.addEventListener('click', roll);
    $('completeButton').addEventListener('click', () => resolveCard(false));
    $('skipButton').addEventListener('click', () => resolveCard(true));
    $('cardCloseButton').addEventListener('click', () => resolveCard(true));
    $('swapButton').addEventListener('click', swapCard);
    dom.effectOptions.addEventListener('change', () => {
      dom.effectConfirmButton.disabled = !dom.effectOptions.querySelector('input[name="effectOption"]:checked');
    });
    dom.effectConfirmButton.addEventListener('click', () => resolveEffect(false));
    dom.effectSkipButton.addEventListener('click', () => resolveEffect(true));
    dom.promiseOptions.addEventListener('change', () => {
      dom.promiseSaveButton.disabled = !dom.promiseOptions.querySelector('input[name="finaleOption"]:checked');
    });
    dom.promiseSaveButton.addEventListener('click', savePromise);
    $('rulesButton').addEventListener('click', () => { if (!busy && dom.turnOverlay.hidden) dom.rulesDialog.showModal(); });
    $('galleryButton').addEventListener('click', () => openGallery());
    $('restartButton').addEventListener('click', restart);
    dom.settingsButton.addEventListener('click', () => { if (!busy && dom.turnOverlay.hidden) dom.settingsDialog.showModal(); });
    dom.soundToggle.addEventListener('change', () => {
      soundOn = dom.soundToggle.checked;
      save();
      if (soundOn) playTone(570, 0.12);
    });
    dom.turnOverlayDismiss.addEventListener('click', hideTurnOverlay);
    document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
    document.querySelectorAll('.gallery-tabs button').forEach((button) => button.addEventListener('click', () => buildGallery(button.dataset.filter)));
    dom.continueButton.addEventListener('click', showPromise);
    dom.finaleEntryButton.addEventListener('click', showPromise);
    $('playAgainButton').addEventListener('click', restart);
    document.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && document.activeElement === document.body &&
          !document.querySelector('dialog[open]') && dom.turnOverlay.hidden && state?.phase === 'await_roll' && !busy) {
        event.preventDefault();
        roll();
      }
    });
  }

  buildBoard();
  readSaved();
  initEvents();
  render();
  if (online) online.mount({ apply: applyOnlineSnapshot, refresh: renderTurn, showTask: showPending,
    reset() { stopPendingAnimation(); hideTurnOverlay(); closeGameDialogs(); state = null; onlineRevision = 0; onlineMatchId = null; render(); }
  });
  else if (!state) dom.setupDialog.showModal();
  else if (state.phase === 'await_card') showPending();
  else if (state.phase === 'finished' && state.finaleChoice === null) showWin();
})();
