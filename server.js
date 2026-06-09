const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3007);
const PUBLIC_DIR = path.join(__dirname, "public");
const WINNING_SCORE = 200;
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const rooms = new Map();
const clients = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

function id(prefix = "") {
  return `${prefix}${crypto.randomBytes(8).toString("hex")}`;
}

function roomCode() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    let code = "";
    for (let i = 0; i < 4; i += 1) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function createDeck() {
  const deck = [];
  let cardId = 1;

  deck.push({ id: cardId++, kind: "number", value: 0, label: "0" });
  for (let value = 1; value <= 12; value += 1) {
    for (let count = 0; count < value; count += 1) {
      deck.push({ id: cardId++, kind: "number", value, label: String(value) });
    }
  }

  for (const value of [2, 4, 6, 8, 10]) {
    deck.push({ id: cardId++, kind: "modifier", op: "add", value, label: `+${value}` });
  }
  deck.push({ id: cardId++, kind: "modifier", op: "x2", value: 2, label: "x2" });

  for (let i = 0; i < 3; i += 1) {
    deck.push({ id: cardId++, kind: "action", action: "freeze", label: "Freeze" });
    deck.push({ id: cardId++, kind: "action", action: "flip3", label: "Flip 3" });
    deck.push({ id: cardId++, kind: "action", action: "secondChance", label: "Second Chance" });
  }

  return shuffle(deck);
}

function createPlayer(socketId, name) {
  return {
    id: socketId,
    name: cleanName(name),
    connected: true,
    score: 0,
    roundScore: 0,
    status: "waiting",
    cards: [],
    numbers: [],
    modifiers: [],
    secondChance: false,
    message: "",
  };
}

function cleanName(name) {
  const text = String(name || "").trim().slice(0, 16);
  return text || "Player";
}

function createRoom(hostId, hostName) {
  const code = roomCode();
  const room = {
    code,
    hostId,
    phase: "lobby",
    players: [createPlayer(hostId, hostName)],
    deck: [],
    discard: [],
    turnIndex: 0,
    dealerIndex: 0,
    round: 0,
    winnerId: null,
    log: ["방이 생성되었습니다."],
  };
  rooms.set(code, room);
  return room;
}

function findPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function activePlayers(room) {
  return room.players.filter((player) => player.connected && player.status === "active");
}

function currentPlayer(room) {
  return room.players[room.turnIndex] || null;
}

function currentPlayerIsActive(room) {
  const player = currentPlayer(room);
  return player && player.connected && player.status === "active";
}

function pushLog(room, text) {
  room.log.unshift(text);
  room.log = room.log.slice(0, 12);
}

function calculateRoundScore(player) {
  const numberScore = player.numbers.reduce((sum, value) => sum + value, 0);
  const doubled = player.modifiers.some((card) => card.op === "x2") ? numberScore * 2 : numberScore;
  const bonus = player.modifiers
    .filter((card) => card.op === "add")
    .reduce((sum, card) => sum + card.value, 0);
  const flip7 = player.numbers.length >= 7 ? 15 : 0;
  return doubled + bonus + flip7;
}

function updateRoundScore(player) {
  player.roundScore = calculateRoundScore(player);
}

function drawCard(room) {
  if (room.deck.length === 0) {
    room.deck = shuffle(room.discard.splice(0));
    pushLog(room, "덱을 모두 사용해 버림패를 다시 섞었습니다.");
  }
  return room.deck.pop() || null;
}

function giveCard(room, player, card, options = {}) {
  if (!card || player.status !== "active") return;

  player.cards.push(card);

  if (card.kind === "number") {
    if (player.numbers.includes(card.value)) {
      if (player.secondChance) {
        player.secondChance = false;
        player.cards = player.cards.filter((owned) => owned.id !== card.id);
        room.discard.push(card);
        player.message = `Second Chance로 ${card.value} 중복을 막았습니다.`;
        pushLog(room, `${player.name}님이 Second Chance로 버스트를 피했습니다.`);
        return;
      }

      player.status = "busted";
      player.roundScore = 0;
      player.message = `${card.value} 중복으로 버스트.`;
      pushLog(room, `${player.name}님이 ${card.value} 중복으로 버스트했습니다.`);
      return;
    }

    player.numbers.push(card.value);
    updateRoundScore(player);
    player.message = `${card.label} 획득. 현재 ${player.roundScore}점.`;

    if (player.numbers.length >= 7) {
      player.status = "flip7";
      updateRoundScore(player);
      bankActivePlayers(room);
      room.phase = "roundEnd";
      pushLog(room, `${player.name}님이 Flip 7! 라운드가 즉시 종료됩니다.`);
      checkGameEnd(room);
    }
    return;
  }

  if (card.kind === "modifier") {
    player.modifiers.push(card);
    updateRoundScore(player);
    player.message = `${card.label} 보정 카드. 현재 ${player.roundScore}점.`;
    return;
  }

  if (card.action === "secondChance") {
    if (player.secondChance) {
      room.discard.push(card);
      player.cards = player.cards.filter((owned) => owned.id !== card.id);
      player.message = "Second Chance는 이미 있어서 버렸습니다.";
    } else {
      player.secondChance = true;
      player.message = "Second Chance 보유.";
    }
    return;
  }

  if (card.action === "freeze") {
    bankPlayer(room, player, "Freeze로 자동 스톱.");
    return;
  }

  if (card.action === "flip3") {
    player.message = "Flip 3: 추가 카드 3장을 받습니다.";
    pushLog(room, `${player.name}님이 Flip 3을 받았습니다.`);
    for (let i = 0; i < 3 && player.status === "active"; i += 1) {
      giveCard(room, player, drawCard(room), { forced: true });
    }
  }

  if (options.forced) updateRoundScore(player);
}

function bankPlayer(room, player, reason = "스톱.") {
  if (!["active", "flip7"].includes(player.status)) return;
  updateRoundScore(player);
  player.score += player.roundScore;
  player.status = "stayed";
  player.message = `${reason} ${player.roundScore}점 획득.`;
  pushLog(room, `${player.name}님이 ${player.roundScore}점을 은행에 넣었습니다.`);
}

function bankActivePlayers(room) {
  for (const player of room.players) {
    if (player.status === "active" || player.status === "flip7") {
      bankPlayer(room, player, player.status === "flip7" ? "Flip 7 보너스 포함." : "라운드 종료 정산.");
    }
  }
}

function resetRoundPlayer(player) {
  player.roundScore = 0;
  player.status = player.connected ? "active" : "away";
  player.cards = [];
  player.numbers = [];
  player.modifiers = [];
  player.secondChance = false;
  player.message = "";
}

function startRound(room) {
  room.phase = "playing";
  room.round += 1;
  room.deck = createDeck();
  room.discard = [];
  room.players.forEach(resetRoundPlayer);

  room.turnIndex = room.dealerIndex % room.players.length;
  pushLog(room, `라운드 ${room.round} 시작. ${room.players[room.turnIndex].name}님부터 진행합니다.`);

  for (const player of room.players) {
    if (player.connected) giveCard(room, player, drawCard(room));
  }

  normalizeTurn(room);
  checkRoundEnd(room);
}

function normalizeTurn(room) {
  if (room.phase !== "playing") return;
  if (activePlayers(room).length === 0) return;

  for (let i = 0; i < room.players.length; i += 1) {
    const index = (room.turnIndex + i) % room.players.length;
    const player = room.players[index];
    if (player.connected && player.status === "active") {
      room.turnIndex = index;
      return;
    }
  }
}

function advanceTurn(room) {
  if (room.phase !== "playing") return;
  for (let i = 1; i <= room.players.length; i += 1) {
    const index = (room.turnIndex + i) % room.players.length;
    const player = room.players[index];
    if (player.connected && player.status === "active") {
      room.turnIndex = index;
      return;
    }
  }
}

function checkRoundEnd(room) {
  if (room.phase !== "playing") return;
  if (activePlayers(room).length > 0) return;

  room.phase = "roundEnd";
  room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
  pushLog(room, "라운드가 종료되었습니다.");
  checkGameEnd(room);
}

function checkGameEnd(room) {
  const leader = [...room.players].sort((a, b) => b.score - a.score)[0];
  if (leader && leader.score >= WINNING_SCORE) {
    room.phase = "gameEnd";
    room.winnerId = leader.id;
    pushLog(room, `${leader.name}님이 ${leader.score}점으로 승리했습니다.`);
  }
}

function sanitizeRoom(room, viewerId) {
  return {
    code: room.code,
    hostId: room.hostId,
    selfId: viewerId,
    phase: room.phase,
    round: room.round,
    turnId: currentPlayer(room)?.id || null,
    turnName: currentPlayer(room)?.name || "",
    deckCount: room.deck.length,
    winnerId: room.winnerId,
    winningScore: WINNING_SCORE,
    log: room.log,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connected,
      score: player.score,
      roundScore: player.roundScore,
      status: player.status,
      cards: player.cards,
      numbers: player.numbers,
      modifiers: player.modifiers,
      secondChance: player.secondChance,
      message: player.message,
    })),
  };
}

function send(ws, type, payload = {}) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function broadcast(room) {
  for (const [socketId, client] of clients) {
    if (client.roomCode !== room.code) continue;
    send(client.ws, "state", { room: sanitizeRoom(room, socketId) });
  }
}

function sendError(ws, message) {
  send(ws, "errorMessage", { message });
}

function getClientRoom(client) {
  return client.roomCode ? rooms.get(client.roomCode) : null;
}

function ensureCurrentTurn(room, client) {
  if (room.phase !== "playing") return "게임 진행 중이 아닙니다.";
  if (currentPlayer(room)?.id !== client.id) return "아직 당신의 차례가 아닙니다.";
  if (!currentPlayerIsActive(room)) return "현재 플레이어가 활성 상태가 아닙니다.";
  return "";
}

function handleMessage(ws, raw) {
  const client = clients.get(ws._socketId);
  let message;

  try {
    message = JSON.parse(raw);
  } catch {
    sendError(ws, "잘못된 메시지입니다.");
    return;
  }

  if (message.type === "createRoom") {
    const room = createRoom(client.id, message.name);
    client.roomCode = room.code;
    send(ws, "roomJoined", { room: sanitizeRoom(room, client.id) });
    broadcast(room);
    return;
  }

  if (message.type === "joinRoom") {
    const code = String(message.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      sendError(ws, "방을 찾을 수 없습니다.");
      return;
    }
    if (room.phase !== "lobby") {
      sendError(ws, "이미 시작된 방입니다.");
      return;
    }
    if (room.players.length >= 8) {
      sendError(ws, "방이 가득 찼습니다.");
      return;
    }

    const player = createPlayer(client.id, message.name);
    room.players.push(player);
    client.roomCode = room.code;
    pushLog(room, `${player.name}님이 참가했습니다.`);
    send(ws, "roomJoined", { room: sanitizeRoom(room, client.id) });
    broadcast(room);
    return;
  }

  const room = getClientRoom(client);
  if (!room) {
    sendError(ws, "먼저 방을 만들거나 참가하세요.");
    return;
  }

  if (message.type === "startGame") {
    if (client.id !== room.hostId) {
      sendError(ws, "방장만 시작할 수 있습니다.");
      return;
    }
    if (room.players.filter((player) => player.connected).length < 2) {
      sendError(ws, "테스트는 2명 이상부터 시작할 수 있습니다.");
      return;
    }
    startRound(room);
    broadcast(room);
    return;
  }

  if (message.type === "nextRound") {
    if (room.phase !== "roundEnd") {
      sendError(ws, "아직 다음 라운드로 갈 수 없습니다.");
      return;
    }
    startRound(room);
    broadcast(room);
    return;
  }

  if (message.type === "hit") {
    const error = ensureCurrentTurn(room, client);
    if (error) {
      sendError(ws, error);
      return;
    }

    const player = currentPlayer(room);
    giveCard(room, player, drawCard(room));
    if (room.phase === "playing") {
      advanceTurn(room);
      checkRoundEnd(room);
    }
    broadcast(room);
    return;
  }

  if (message.type === "stay") {
    const error = ensureCurrentTurn(room, client);
    if (error) {
      sendError(ws, error);
      return;
    }

    bankPlayer(room, currentPlayer(room));
    advanceTurn(room);
    checkRoundEnd(room);
    broadcast(room);
    return;
  }
}

wss.on("connection", (ws) => {
  ws._socketId = id("p_");
  clients.set(ws._socketId, { id: ws._socketId, ws, roomCode: "" });
  send(ws, "connected", { id: ws._socketId });

  ws.on("message", (raw) => handleMessage(ws, raw));
  ws.on("close", () => {
    const client = clients.get(ws._socketId);
    clients.delete(ws._socketId);
    const room = client ? rooms.get(client.roomCode) : null;
    if (!room) return;

    const player = findPlayer(room, ws._socketId);
    if (player) {
      player.connected = false;
      if (player.status === "active") player.status = "away";
      pushLog(room, `${player.name}님이 연결을 종료했습니다.`);
      normalizeTurn(room);
      checkRoundEnd(room);
      broadcast(room);
    }

    if (room.players.every((member) => !member.connected)) {
      rooms.delete(room.code);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Flip 7 realtime skeleton running on http://localhost:${PORT}`);
});
