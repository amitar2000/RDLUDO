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
    face.textContent = '🎲';
    clearTimeout(rollTimer);
    rollTimer = setTimeout(() => {
      box.classList.remove('rolling');
      face.textContent = s.dice ? s.dice : (face.dataset.last || '🎲');
      if (s.dice) face.dataset.last = s.dice;
    }, 600);
  } else if (!box.classList.contains('rolling')) {
    if (s.dice) { face.textContent = s.dice; face.dataset.last = s.dice; }
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

  prevPositions = JSON.parse(JSON.stringify(s.pieces));
  renderControls();

  // इस बीच कोई नई स्थिति आ गई हो तो उसे लगाएँ
  if (pendingState) {
    const nxt = pendingState;
    pendingState = null;
    applyState(nxt);
  }
}

$('joinBtn').onclick = () => {
  socket.emit('join', { code: $('code').value, name: $('name').value });
};
$('startBtn').onclick = () => socket.emit('start');
$('rollBtn').onclick = () => socket.emit('roll');

socket.on('joined', ({ color }) => {
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
