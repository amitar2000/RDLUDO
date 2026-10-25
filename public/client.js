const socket = io();
let myColor = null;
let state = null;

const $ = (id) => document.getElementById(id);
const COLOR_HEX = { red: '#e63946', green: '#2a9d8f', yellow: '#f4a261', blue: '#457b9d' };

// मुख्य रास्ते के 52 खानों के (column, row) निर्देशांक, 15x15 ग्रिड पर
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
const GOAL = { red: [6.5,7], green: [7,6.5], yellow: [8.5,7], blue: [7,8.5] };

const YARD = {
  red:    [[1.5,1.5],[3.5,1.5],[1.5,3.5],[3.5,3.5]],
  green:  [[10.5,1.5],[12.5,1.5],[10.5,3.5],[12.5,3.5]],
  blue:   [[1.5,10.5],[3.5,10.5],[1.5,12.5],[3.5,12.5]],
  yellow: [[10.5,10.5],[12.5,10.5],[10.5,12.5],[12.5,12.5]],
};

function cellCenter(c, r) {
  return { x: (c + 0.5) / 15 * 100, y: (r + 0.5) / 15 * 100 };
}

function pieceXY(color, pos, index) {
  if (pos === -1) {
    const [c, r] = YARD[color][index];
    return { x: (c + 0.5) / 15 * 100, y: (r + 0.5) / 15 * 100 };
  }
  if (pos <= 50) {
    const [c, r] = PATH[(START[color] + pos) % 52];
    return cellCenter(c, r);
  }
  if (pos <= 55) {
    const [c, r] = HOME_LANE[color][pos - 51];
    return cellCenter(c, r);
  }
  const [c, r] = GOAL[color];
  return { x: (c + 0.5) / 15 * 100, y: (r + 0.5) / 15 * 100 };
}

function drawBoard() {
  const board = $('board');
  board.innerHTML = '';
  ['red', 'green', 'blue', 'yellow'].forEach(c => {
    const d = document.createElement('div');
    d.className = 'yard ' + c;
    board.appendChild(d);
  });
  const center = document.createElement('div');
  center.className = 'center';
  board.appendChild(center);

  PATH.forEach(([c, r], i) => {
    const d = document.createElement('div');
    d.className = 'cell' + (SAFE.includes(i) ? ' safe' : '');
    d.style.left = (c / 15 * 100) + '%';
    d.style.top = (r / 15 * 100) + '%';
    board.appendChild(d);
  });
  Object.keys(HOME_LANE).forEach(color => {
    HOME_LANE[color].forEach(([c, r]) => {
      const d = document.createElement('div');
      d.className = 'cell';
      d.style.left = (c / 15 * 100) + '%';
      d.style.top = (r / 15 * 100) + '%';
      d.style.background = COLOR_HEX[color];
      board.appendChild(d);
    });
  });
}

function render() {
  if (!state) return;
  drawBoard();
  const board = $('board');

  $('roomInfo').textContent = 'रूम: ' + state.code;
  $('youInfo').textContent = 'आपका रंग: ' + myColor;

  $('players').innerHTML = state.players.map(p =>
    '<span class="pchip' + (p.color === state.turn ? ' active' : '') +
    '" style="background:' + COLOR_HEX[p.color] + '">' + p.name + '</span>'
  ).join('');

  const myTurn = state.started && state.turn === myColor && !state.winner;
  $('startBtn').classList.toggle('hidden', state.started);
  $('rollBtn').disabled = !(myTurn && state.dice === null);
  $('diceView').textContent = state.dice ? state.dice : '-';

  Object.keys(state.pieces).forEach(color => {
    state.pieces[color].forEach((pos, i) => {
      const { x, y } = pieceXY(color, pos, i);
      const el = document.createElement('div');
      el.className = 'piece ' + color;
      el.style.left = x + '%';
      el.style.top = y + '%';

      if (myTurn && color === myColor && state.dice !== null) {
        const can = pos === -1 ? state.dice === 6 : (pos !== 56 && pos + state.dice <= 56);
        if (can) {
          el.classList.add('movable');
          el.onclick = () => socket.emit('move', i);
        }
      }
      board.appendChild(el);
    });
  });
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
socket.on('state', (s) => { state = s; render(); });
socket.on('message', (m) => { $('log').textContent = m; });
socket.on('error_msg', (m) => alert(m));
