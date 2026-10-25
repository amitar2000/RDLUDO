const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const COLORS = ['red', 'green', 'yellow', 'blue'];
const START = { red: 0, green: 13, yellow: 26, blue: 39 };
const SAFE = [0, 8, 13, 21, 26, 34, 39, 47];

// -1 = घर में, 0..50 = मुख्य रास्ते पर, 51..55 = घर की सीढ़ी, 56 = मंज़िल
const HOME = -1;
const FINISH = 56;

const rooms = {};

function newRoom(code) {
  return {
    code,
    players: [],
    pieces: {},
    turn: 0,
    dice: null,
    started: false,
    winner: null,
    rolledSix: false,
  };
}

function absPos(color, rel) {
  return (START[color] + rel) % 52;
}

function movablePieces(room, color, dice) {
  const res = [];
  room.pieces[color].forEach((pos, i) => {
    if (pos === FINISH) return;
    if (pos === HOME) {
      if (dice === 6) res.push(i);
    } else if (pos + dice <= FINISH) {
      res.push(i);
    }
  });
  return res;
}

function publicState(room) {
  return {
    code: room.code,
    players: room.players.map(p => ({ name: p.name, color: p.color })),
    pieces: room.pieces,
    turn: room.started ? room.players[room.turn].color : null,
    dice: room.dice,
    started: room.started,
    winner: room.winner,
  };
}

function broadcast(room, message) {
  io.to(room.code).emit('state', publicState(room));
  if (message) io.to(room.code).emit('message', message);
}

function nextTurn(room) {
  room.dice = null;
  room.rolledSix = false;
  room.turn = (room.turn + 1) % room.players.length;
}

io.on('connection', (socket) => {
  socket.on('join', ({ code, name }) => {
    code = String(code || '').toUpperCase().trim();
    name = String(name || 'खिलाड़ी').slice(0, 15);
    if (!code) return socket.emit('error_msg', 'रूम कोड डालें');

    if (!rooms[code]) rooms[code] = newRoom(code);
    const room = rooms[code];

    if (room.started) return socket.emit('error_msg', 'गेम शुरू हो चुका है');
    if (room.players.length >= 4) return socket.emit('error_msg', 'रूम भर चुका है');

    const color = COLORS[room.players.length];
    room.players.push({ id: socket.id, name, color });
    room.pieces[color] = [HOME, HOME, HOME, HOME];
    socket.join(code);
    socket.data.code = code;
    socket.data.color = color;

    socket.emit('joined', { color, code });
    broadcast(room, name + ' जुड़ गया (' + color + ')');
  });

  socket.on('start', () => {
    const room = rooms[socket.data.code];
    if (!room || room.started) return;
    if (room.players.length < 2) {
      return socket.emit('error_msg', 'कम से कम 2 खिलाड़ी चाहिए');
    }
    room.started = true;
    room.turn = 0;
    broadcast(room, 'गेम शुरू! पहली बारी: ' + room.players[0].name);
  });

  socket.on('roll', () => {
    const room = rooms[socket.data.code];
    if (!room || !room.started || room.winner) return;
    const player = room.players[room.turn];
    if (player.id !== socket.id) return socket.emit('error_msg', 'आपकी बारी नहीं है');
    if (room.dice !== null) return socket.emit('error_msg', 'पहले गोटी चलाएँ');

    room.dice = Math.floor(Math.random() * 6) + 1;
    const moves = movablePieces(room, player.color, room.dice);

    if (moves.length === 0) {
      const d = room.dice;
      nextTurn(room);
      broadcast(room, player.name + ' को ' + d + ' आया, कोई चाल नहीं। अगली बारी: ' + room.players[room.turn].name);
    } else {
      broadcast(room, player.name + ' को ' + room.dice + ' आया');
    }
  });

  socket.on('move', (index) => {
    const room = rooms[socket.data.code];
    if (!room || !room.started || room.winner) return;
    const player = room.players[room.turn];
    if (player.id !== socket.id) return;
    if (room.dice === null) return;

    const color = player.color;
    const dice = room.dice;
    const allowed = movablePieces(room, color, dice);
    if (!allowed.includes(index)) return socket.emit('error_msg', 'यह गोटी नहीं चल सकती');

    let msg = '';
    const pos = room.pieces[color][index];
    if (pos === HOME) {
      room.pieces[color][index] = 0;
    } else {
      room.pieces[color][index] = pos + dice;
    }

    // गोटी काटना (सुरक्षित खाने को छोड़कर)
    const newPos = room.pieces[color][index];
    if (newPos >= 0 && newPos <= 50) {
      const abs = absPos(color, newPos);
      if (!SAFE.includes(abs)) {
        for (const other of room.players) {
          if (other.color === color) continue;
          room.pieces[other.color].forEach((p, j) => {
            if (p >= 0 && p <= 50 && absPos(other.color, p) === abs) {
              room.pieces[other.color][j] = HOME;
              msg = player.name + ' ने ' + other.name + ' की गोटी काट दी!';
            }
          });
        }
      }
    }

    // जीत की जाँच
    if (room.pieces[color].every(p => p === FINISH)) {
      room.winner = player.name;
      room.dice = null;
      return broadcast(room, player.name + ' जीत गया! 🎉');
    }

    // 6 आने पर, गोटी कटने पर या मंज़िल पर पहुँचने पर दोबारा बारी
    const extra = dice === 6 || msg !== '' || newPos === FINISH;
    if (extra) {
      room.dice = null;
      broadcast(room, msg || (player.name + ' को दोबारा पासा मिलेगा'));
    } else {
      nextTurn(room);
      broadcast(room, msg || ('अगली बारी: ' + room.players[room.turn].name));
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room) return;
    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx === -1) return;
    const leaving = room.players[idx];

    if (!room.started) {
      room.players.splice(idx, 1);
      delete room.pieces[leaving.color];
      room.players.forEach((p, i) => {
        const old = p.color;
        p.color = COLORS[i];
        if (old !== p.color) {
          room.pieces[p.color] = room.pieces[old];
          delete room.pieces[old];
        }
      });
    } else {
      leaving.id = null;
      if (room.players[room.turn] === leaving) nextTurn(room);
    }

    if (room.players.length === 0 || room.players.every(p => p.id === null)) {
      delete rooms[code];
      return;
    }
    broadcast(room, leaving.name + ' निकल गया');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Ludo server चालू: http://localhost:' + PORT));
