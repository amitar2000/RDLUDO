const socket = io();
let myColor = null;
let state = null;
let prevPositions = {};   // color -> [positions] जो स्क्रीन पर दिख रही हैं
let animating = false;
let pendingState = null;
let lastRollId = 0;
let lastMoveId = 0;
let rollTimer = null;

const $ = (id) => document.getElementById(id);

// ---------- आवाज़ और म्यूज़िक (Web Audio, किसी फ़ाइल की ज़रूरत नहीं) ----------
let audioCtx = null;
let muted = localStorage.getItem('ludoMuted') === '1';
let musicStarted = false;
let musicGain = null;
let musicTimer = null;

function ac() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, start, dur, type, vol, dest) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type || 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g); g.connect(dest || a.destination);
  o.start(start); o.stop(start + dur + 0.05);
}

// हल्का, धीमा बैकग्राउंड म्यूज़िक (शांत धुन)
function startMusic() {
  const a = ac(); if (!a || musicStarted) return;
  musicStarted = true;
  musicGain = a.createGain();
  musicGain.gain.value = muted ? 0 : 0.5;
  musicGain.connect(a.destination);

  const N = { C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392.0, A4:440.0, C5:523.25, E5:659.25, G5:783.99 };
  const melody = [
    ['E4',1],['G4',1],['A4',1],['G4',1],['E4',1],['D4',1],['C4',2],
    ['D4',1],['E4',1],['G4',1],['E4',1],['D4',1],['C4',1],['D4',2],
    ['E4',1],['G4',1],['C5',1],['A4',1],['G4',1],['E4',1],['G4',2],
    ['A4',1],['G4',1],['E4',1],['D4',1],['C4',1],['D4',1],['C4',2]
  ];
  const chords = [[130.81,196.0,261.63],[146.83,220.0,293.66],[130.81,196.0,261.63],[174.61,220.0,261.63]];
  const beat = 0.55;

  function playLoop() {
    const t0 = a.currentTime + 0.1;
    let t = t0;
    melody.forEach(([n, len]) => {
      tone(N[n], t, len * beat * 0.95, 'triangle', 0.12, musicGain);
      t += len * beat;
    });
    const total = t - t0;
    const per = total / chords.length;
    chords.forEach((ch, i) => {
      ch.forEach(f => tone(f, t0 + i * per, per * 0.98, 'sine', 0.05, musicGain));
    });
    musicTimer = setTimeout(playLoop, (total - 0.3) * 1000);
  }
  playLoop();
}

function setMuted(m) {
  muted = m;
  localStorage.setItem('ludoMuted', m ? '1' : '0');
  if (musicGain) musicGain.gain.value = m ? 0 : 0.5;
  $('muteBtn').textContent = m ? '🔇' : '🔊';
}

// पासे की मध्यम खड़खड़ाहट
function playDiceSound() {
  if (muted) return;
  const a = ac(); if (!a) return;
  const t = a.currentTime;
  for (let i = 0; i < 9; i++) {
    const when = t + i * 0.06 + Math.random() * 0.02;
    const len = 0.04;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1400 + Math.random() * 1200; f.Q.value = 1.2;
    const g = a.createGain();
    g.gain.value = 0.28 * (1 - i / 14);
    src.connect(f); f.connect(g); g.connect(a.destination);
    src.start(when);
  }
  tone(180, t + 0.58, 0.12, 'sine', 0.25);   // आख़िर में हल्की ठक
}

// गोटी चलने की हल्की टिक
function playStepSound() {
  if (muted) return;
  const a = ac(); if (!a) return;
  tone(620, a.currentTime, 0.07, 'triangle', 0.12);
}


// गोटी कटने की आवाज़ (नीचे गिरती धुन + धमाका)
function playCaptureSound() {
  if (muted) return;
  const a = ac(); if (!a) return;
  const t = a.currentTime;
  [520, 420, 320, 220].forEach((f, i) => tone(f, t + i * 0.08, 0.14, 'sawtooth', 0.12));
  const len = 0.18;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length);
  const src = a.createBufferSource(); src.buffer = buf;
  const g = a.createGain(); g.gain.value = 0.25;
  src.connect(g); g.connect(a.destination); src.start(t + 0.3);
}
// जीत की आवाज़
function playWinSound() {
  if (muted) return;
  const a = ac(); if (!a) return;
  const t = a.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.15, 0.4, 'triangle', 0.18));
}
// चैट संदेश की हल्की टन
function playChatPing() {
  if (muted) return;
  const a = ac(); if (!a) return;
  tone(880, a.currentTime, 0.1, 'sine', 0.08);
}

// ---------- टेक्स्ट चैट ----------
function addChat(m) {
  const box = $('chatMsgs');
  const d = document.createElement('div');
  d.className = 'cmsg';
  const b = document.createElement('b');
  b.style.color = COLOR_HEX[m.color] || '#fff';
  b.textContent = m.name + ':';
  const t = document.createElement('span');
  t.textContent = m.text;
  d.appendChild(b); d.appendChild(t);
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

// ---------- वॉइस चैट (WebRTC) ----------
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
let localStream = null;
let voiceOn = false;
const peers = {};   // socketId -> RTCPeerConnection

function makePeer(id, initiator) {
  if (peers[id]) return peers[id];
  const pc = new RTCPeerConnection(ICE);
  peers[id] = pc;
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('voice_signal', { to: id, data: { candidate: e.candidate } });
  };
  pc.ontrack = (e) => {
    let au = document.getElementById('au-' + id);
    if (!au) {
      au = document.createElement('audio');
      au.id = 'au-' + id;
      au.autoplay = true;
      $('audioHolder').appendChild(au);
    }
    au.srcObject = e.streams[0];
    au.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) dropPeer(id);
  };
  if (initiator) {
    pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => {
      socket.emit('voice_signal', { to: id, data: { sdp: pc.localDescription } });
    });
  }
  return pc;
}

function dropPeer(id) {
  if (peers[id]) { try { peers[id].close(); } catch (e) {} delete peers[id]; }
  const au = document.getElementById('au-' + id);
  if (au) au.remove();
}

async function startVoice() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    alert('माइक की इजाज़त नहीं मिली। ब्राउज़र में माइक की अनुमति दें।');
    return;
  }
  voiceOn = true;
  $('micBtn').classList.add('live');
  $('micBtn').textContent = '🎤 वॉइस चालू';
  $('voiceInfo').classList.remove('hidden');
  $('voiceInfo').textContent = 'वॉइस चालू है। बात करने के लिए माइक खुला है।';
  socket.emit('voice_join');
}

function stopVoice() {
  voiceOn = false;
  socket.emit('voice_leave');
  Object.keys(peers).forEach(dropPeer);
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  $('micBtn').classList.remove('live');
  $('micBtn').textContent = '🎤 वॉइस';
  $('voiceInfo').classList.add('hidden');
}

socket.on('voice_peers', (ids) => { ids.forEach(id => makePeer(id, true)); });
socket.on('voice_signal', async ({ from, data }) => {
  if (!voiceOn) return;
  const pc = makePeer(from, false);
  try {
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === 'offer') {
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        socket.emit('voice_signal', { to: from, data: { sdp: pc.localDescription } });
      }
    } else if (data.candidate) {
      await pc.addIceCandidate(data.candidate);
    }
  } catch (e) { console.log('voice err', e); }
});
socket.on('voice_gone', (id) => dropPeer(id));

// पासे की बिंदियाँ
const PIP_POS = {
  1: [[50,50]],
  2: [[25,25],[75,75]],
  3: [[25,25],[50,50],[75,75]],
  4: [[25,25],[75,25],[25,75],[75,75]],
  5: [[25,25],[75,25],[50,50],[25,75],[75,75]],
  6: [[25,25],[75,25],[25,50],[75,50],[25,75],[75,75]]
};
function drawPips(container, n, cls) {
  container.innerHTML = '';
  (PIP_POS[n] || []).forEach(([x, y]) => {
    const p = document.createElement('span');
    p.className = cls;
    p.style.left = x + '%';
    p.style.top = y + '%';
    container.appendChild(p);
  });
}
function setBtnDice(n) { drawPips(document.querySelector('#btnDice .pips'), n, 'pip'); }
function setBigDice(n) {
  const face = $('diceFace');
  face.classList.add('pipsface');
  drawPips(face, n, 'bigpip');
}
const COLOR_HEX = { red: '#e63946', green: '#2a9d8f', yellow: '#f4c20d', blue: '#3a7bd5' };

// मुख्य रास्ते के 52 खाने (column, row), 15x15 ग्रिड
const PATH = [
  [1,6],[2,6],[3,6],[4,6],[5,6],
  [6,5],[6,4],[6,3],[6,2],[6,1],[6,0],
  [7,0],[8,0],
  [8,1],[8,2],[8,3],[8,4],[8,5],
  [9,6],[10,6],[11,6],[12,6],[13,6],[14,6],
  [14,7],[14,8],
  [13,8],[12,8],[11,8],[10,8],[9,8],
  [8,9],[8,10],[8,11],[8,12],[8,13],[8,14],
  [7,14],[6,14],
  [6,13],[6,12],[6,11],[6,10],[6,9],
  [5,8],[4,8],[3,8],[2,8],[1,8],[0,8],
  [0,7],[0,6]
];
const START = { red: 0, green: 13, yellow: 26, blue: 39 };
const SAFE = [0, 8, 13, 21, 26, 34, 39, 47];

const HOME_LANE = {
  red:    [[1,7],[2,7],[3,7],[4,7],[5,7]],
  green:  [[7,1],[7,2],[7,3],[7,4],[7,5]],
  yellow: [[13,7],[12,7],[11,7],[10,7],[9,7]],
  blue:   [[7,13],[7,12],[7,11],[7,10],[7,9]],
};
const GOAL = { red: [6.4,7], green: [7,6.4], yellow: [8.6,7], blue: [7,8.6] };

// घर के चार गोल खाने (15x15 ग्रिड के निर्देशांक)
const YARD = {
  red:    [[1.9,1.9],[4.1,1.9],[1.9,4.1],[4.1,4.1]],
  green:  [[10.9,1.9],[13.1,1.9],[10.9,4.1],[13.1,4.1]],
  blue:   [[1.9,10.9],[4.1,10.9],[1.9,13.1],[4.1,13.1]],
  yellow: [[10.9,10.9],[13.1,10.9],[10.9,13.1],[13.1,13.1]],
};

function pct(v) { return (v + 0.5) / 15 * 100; }

function pieceXY(color, pos, index) {
  if (pos === -1) {
    const [c, r] = YARD[color][index];
    return { x: (c + 0.5) / 15 * 100, y: (r + 0.5) / 15 * 100 };
  }
  if (pos <= 50) {
    const [c, r] = PATH[(START[color] + pos) % 52];
    return { x: pct(c), y: pct(r) };
  }
  if (pos <= 55) {
    const [c, r] = HOME_LANE[color][pos - 51];
    return { x: pct(c), y: pct(r) };
  }
  const [c, r] = GOAL[color];
  // चार गोटियाँ मंज़िल पर थोड़ी अलग-अलग दिखें
  const off = (index - 1.5) * 0.18;
  const horizontal = (color === 'red' || color === 'yellow');
  return { x: pct(c) + (horizontal ? 0 : off * 6), y: pct(r) + (horizontal ? off * 6 : 0) };
}

// ---------- बोर्ड बनाना ----------
function buildBoard() {
  const board = $('board');
  board.innerHTML = '';

  ['red', 'green', 'blue', 'yellow'].forEach(c => {
    const y = document.createElement('div');
    y.className = 'yard ' + c;
    const inner = document.createElement('div');
    inner.className = 'yard-inner';
    y.appendChild(inner);
    YARD[c].forEach(([cx, cy]) => {
      const d = document.createElement('div');
      d.className = 'yard-dot';
      // yard के अंदर की % स्थिति
      const ox = (c === 'green' || c === 'yellow') ? 9 : 0;
      const oy = (c === 'blue' || c === 'yellow') ? 9 : 0;
      d.style.left = ((cx + 0.5 - ox) / 6 * 100) + '%';
      d.style.top = ((cy + 0.5 - oy) / 6 * 100) + '%';
      y.appendChild(d);
    });
    board.appendChild(y);
  });

  // रास्ते के खाने
  PATH.forEach(([c, r], i) => {
    const d = document.createElement('div');
    let cls = 'cell';
    if (SAFE.includes(i)) cls += ' safe';
    for (const col of Object.keys(START)) {
      if (START[col] === i) cls += ' ' + col + ' startcell';
    }
    d.className = cls;
    d.style.left = (c / 15 * 100) + '%';
    d.style.top = (r / 15 * 100) + '%';
    if (SAFE.includes(i) && !Object.values(START).includes(i)) d.textContent = '★';
    board.appendChild(d);
  });

  // घर की रंगीन सीढ़ी
  Object.keys(HOME_LANE).forEach(color => {
    HOME_LANE[color].forEach(([c, r]) => {
      const d = document.createElement('div');
      d.className = 'cell ' + color;
      d.style.left = (c / 15 * 100) + '%';
      d.style.top = (r / 15 * 100) + '%';
      board.appendChild(d);
    });
  });

  // बीच का चार रंगों वाला त्रिकोण
  const center = document.createElement('div');
  center.className = 'center';
  center.innerHTML =
    '<svg viewBox="0 0 100 100" preserveAspectRatio="none">' +
    '<polygon points="0,0 50,50 0,100" fill="' + COLOR_HEX.red + '"/>' +
    '<polygon points="0,0 100,0 50,50" fill="' + COLOR_HEX.green + '"/>' +
    '<polygon points="100,0 100,100 50,50" fill="' + COLOR_HEX.yellow + '"/>' +
    '<polygon points="0,100 100,100 50,50" fill="' + COLOR_HEX.blue + '"/>' +
    '</svg>';
  board.appendChild(center);
}

// ---------- गोटियाँ ----------
const pieceEls = {};  // 'color-index' -> element

function ensurePieces() {
  const board = $('board');
  Object.keys(state.pieces).forEach(color => {
    state.pieces[color].forEach((pos, i) => {
      const key = color + '-' + i;
      if (!pieceEls[key] || !pieceEls[key].isConnected) {
        const el = document.createElement('div');
        el.className = 'piece ' + color;
        const p = pieceXY(color, prevPositions[color] ? prevPositions[color][i] : -1, i);
        el.style.left = p.x + '%';
        el.style.top = p.y + '%';
        board.appendChild(el);
        pieceEls[key] = el;
      }
    });
  });
}

function setPiece(color, i, pos) {
  const el = pieceEls[color + '-' + i];
  if (!el) return;
  const p = pieceXY(color, pos, i);
  el.style.left = p.x + '%';
  el.style.top = p.y + '%';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// खाना-दर-खाना चलाना
async function animateMove(mv, finalPositions) {
  const key = mv.color + '-' + mv.index;
  const el = pieceEls[key];
  const finalPos = finalPositions[mv.color][mv.index];
  if (el) el.classList.add('moving');

  if (mv.from === -1) {
    setPiece(mv.color, mv.index, 0);
    await sleep(350);
  } else {
    for (let p = mv.from + 1; p <= finalPos; p++) {
      setPiece(mv.color, mv.index, p);
      playStepSound();
      await sleep(240);
    }
  }
  if (el) el.classList.remove('moving');
}

// ---------- पासा ----------
function showDice(s) {
  const box = $('diceBox');
  const face = $('diceFace');
  box.classList.remove('red', 'green', 'yellow', 'blue', 'idle');
  const col = s.rollColor || s.turn;
  if (col) box.classList.add(col); else box.classList.add('idle');

  if (s.rollId && s.rollId !== lastRollId) {
    lastRollId = s.rollId;
    box.classList.add('rolling');
    playDiceSound();
    // घूमते समय बिंदियाँ बदलती दिखें
    let ticks = 0;
    const spin = setInterval(() => {
      setBigDice(1 + Math.floor(Math.random() * 6));
      if (++ticks > 5) clearInterval(spin);
    }, 100);
    clearTimeout(rollTimer);
    rollTimer = setTimeout(() => {
      box.classList.remove('rolling');
      if (s.dice) { setBigDice(s.dice); face.dataset.last = s.dice; }
      else if (face.dataset.last) setBigDice(+face.dataset.last);
    }, 650);
  } else if (!box.classList.contains('rolling')) {
    if (s.dice) { setBigDice(s.dice); face.dataset.last = s.dice; }
    else if (face.dataset.last) setBigDice(+face.dataset.last);
    else setBigDice(6);
  }
}

// ---------- मुख्य render ----------
function renderStatic() {
  $('roomInfo').textContent = 'रूम: ' + state.code;
  $('youInfo').textContent = 'आपका रंग: ' + myColor;
  $('players').innerHTML = state.players.map(p =>
    '<span class="pchip' + (p.color === state.turn ? ' active' : '') +
    '" style="background:' + COLOR_HEX[p.color] + '">' + p.name + '</span>'
  ).join('');
}

function renderControls() {
  const myTurn = state.started && state.turn === myColor && !state.winner;
  $('startBtn').classList.toggle('hidden', state.started);
  $('rollBtn').disabled = !(myTurn && state.dice === null) || animating;

  Object.keys(state.pieces).forEach(color => {
    state.pieces[color].forEach((pos, i) => {
      const el = pieceEls[color + '-' + i];
      if (!el) return;
      el.classList.remove('movable');
      el.onclick = null;
      if (!animating && myTurn && color === myColor && state.dice !== null) {
        const can = pos === -1 ? state.dice === 6 : (pos !== 56 && pos + state.dice <= 56);
        if (can) {
          el.classList.add('movable');
          el.onclick = () => socket.emit('move', i);
        }
      }
    });
  });
}

async function applyState(s) {
  state = s;
  if (!$('board').firstChild) buildBoard();
  ensurePieces();
  renderStatic();
  showDice(s);

  const mv = s.lastMove;
  if (mv && mv.id !== lastMoveId) {
    lastMoveId = mv.id;
    animating = true;
    renderControls();
    // पहले चलने वाली गोटी की चाल दिखाएँ
    await animateMove(mv, s.pieces);
    if (mv.captured) playCaptureSound();
    // फिर सब गोटियों को असली स्थिति पर ले जाएँ (कटी हुई गोटी घर वापस जाएगी)
    Object.keys(s.pieces).forEach(color => {
      s.pieces[color].forEach((pos, i) => setPiece(color, i, pos));
    });
    animating = false;
  } else {
    Object.keys(s.pieces).forEach(color => {
      s.pieces[color].forEach((pos, i) => setPiece(color, i, pos));
    });
  }

  if (s.winner && !window._wonPlayed) { window._wonPlayed = true; playWinSound(); }
  prevPositions = JSON.parse(JSON.stringify(s.pieces));
  renderControls();

  // इस बीच कोई नई स्थिति आ गई हो तो उसे लगाएँ
  if (pendingState) {
    const nxt = pendingState;
    pendingState = null;
    applyState(nxt);
  }
}

function doJoin() {
  const code = $('code').value, name = $('name').value;
  localStorage.setItem('ludoName', name);
  localStorage.setItem('ludoCode', code);
  socket.emit('join', { code, name });
}
$('joinBtn').onclick = () => { startMusic(); doJoin(); };
$('name').value = localStorage.getItem('ludoName') || '';
$('code').value = localStorage.getItem('ludoCode') || '';

// इंटरनेट कटकर वापस आए तो अपने-आप उसी सीट पर जुड़ें
let hasJoined = false;
socket.on('connect', () => {
  if (hasJoined) {
    $('log').textContent = 'दोबारा जुड़ रहा है...';
    doJoin();
    if (voiceOn) { Object.keys(peers).forEach(dropPeer); socket.emit('voice_join'); }
  }
});
$('startBtn').onclick = () => socket.emit('start');
$('rollBtn').onclick = () => { startMusic(); socket.emit('roll'); };
$('muteBtn').onclick = () => { startMusic(); setMuted(!muted); };
setBtnDice(5);
setInterval(() => { if (!$('rollBtn').disabled) setBtnDice(1 + Math.floor(Math.random() * 6)); }, 900);
setMuted(muted);
$('micBtn').onclick = () => { startMusic(); voiceOn ? stopVoice() : startVoice(); };
$('chatForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('chatInput').value.trim();
  if (!v) return;
  socket.emit('chat', v);
  $('chatInput').value = '';
};
socket.on('chat', (m) => { addChat(m); if (m.name !== ($('name').value || '').trim().slice(0, 15)) playChatPing(); });
socket.on('chat_history', (list) => { $('chatMsgs').innerHTML = ''; list.forEach(addChat); });

socket.on('joined', ({ color }) => {
  hasJoined = true;
  myColor = color;
  $('lobby').classList.add('hidden');
  $('game').classList.remove('hidden');
});
socket.on('state', (s) => {
  if (animating) { pendingState = s; return; }
  applyState(s);
});
socket.on('message', (m) => { $('log').textContent = m; });
socket.on('error_msg', (m) => alert(m));
