const ui = {
  app: document.querySelector(".app"),
  roomCode: document.getElementById("roomCode"),
  roomStatus: document.getElementById("roomStatus"),
  copyRoomButton: document.getElementById("copyRoomButton"),
  joinPanel: document.getElementById("joinPanel"),
  tableShell: document.getElementById("tableShell"),
  playerNameInput: document.getElementById("playerNameInput"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  createRoomButton: document.getElementById("createRoomButton"),
  joinRoomButton: document.getElementById("joinRoomButton"),
  startButton: document.getElementById("startButton"),
  hitButton: document.getElementById("hitButton"),
  stayButton: document.getElementById("stayButton"),
  nextRoundButton: document.getElementById("nextRoundButton"),
  lobbyButton: document.getElementById("lobbyButton"),
  phaseLabel: document.getElementById("phaseLabel"),
  turnLabel: document.getElementById("turnLabel"),
  hintText: document.getElementById("hintText"),
  deckCount: document.getElementById("deckCount"),
  playersGrid: document.getElementById("playersGrid"),
  logList: document.getElementById("logList"),
  chatList: document.getElementById("chatList"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  chatSendButton: document.getElementById("chatSendButton"),
  emojiRow: document.getElementById("emojiRow"),
  emojiButtons: [...document.querySelectorAll("#emojiRow button")],
  toast: document.getElementById("toast"),
};

const state = {
  socket: null,
  selfId: "",
  room: null,
  reconnectTimer: null,
};

const quickEmojis = new Set(["🤑", "🥳", "😭", "🙄", "🤭", "😆", "☠️", "☠"]);

function websocketUrl() {
  const configuredUrl = String(window.FLIP7_WS_URL || "").trim();
  if (configuredUrl) return configuredUrl;

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}`;
}

function connect() {
  state.socket = new WebSocket(websocketUrl());

  state.socket.addEventListener("open", () => {
    showToast("서버에 연결되었습니다.");
  });

  state.socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "connected") {
      state.selfId = message.id;
      render();
      return;
    }

    if (message.type === "roomJoined" || message.type === "state") {
      state.room = message.room;
      state.selfId = message.room.selfId || state.selfId;
      render();
      return;
    }

    if (message.type === "errorMessage") {
      showToast(message.message || "오류가 발생했습니다.");
    }
  });

  state.socket.addEventListener("close", () => {
    showToast("연결이 끊어졌습니다. 새로고침하면 다시 연결됩니다.");
  });
}

function send(type, payload = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    showToast("서버 연결이 아직 준비되지 않았습니다.");
    return;
  }
  state.socket.send(JSON.stringify({ type, ...payload }));
}

function playerName() {
  const value = ui.playerNameInput.value.trim();
  if (value) localStorage.setItem("flip7PlayerName", value);
  return value || localStorage.getItem("flip7PlayerName") || `Player ${Math.floor(Math.random() * 90 + 10)}`;
}

function phaseText(phase) {
  return {
    lobby: "LOBBY",
    playing: "PLAYING",
    roundEnd: "ROUND END",
    gameEnd: "GAME END",
  }[phase] || "WAITING";
}

function statusText(status) {
  return {
    waiting: "대기",
    active: "진행 중",
    stayed: "스톱",
    busted: "버스트",
    flip7: "Flip 7",
    away: "연결 끊김",
  }[status] || status;
}

function cardClass(card) {
  if (card.kind === "number") return "number";
  if (card.kind === "modifier") return card.op === "x2" ? "x2" : "modifier";
  if (card.action === "freeze") return "action freeze";
  return "action";
}

function render() {
  const room = state.room;
  const hasRoom = Boolean(room);
  const self = hasRoom ? room.players.find((player) => player.id === room.selfId) : null;
  const isHost = hasRoom && room.hostId === room.selfId;
  const isMyTurn = hasRoom && room.turnId === room.selfId && self?.status === "active";
  const pendingAction = hasRoom ? room.pendingAction : null;
  const isFreezePending = pendingAction?.type === "freeze";
  const isFlip3Pending = pendingAction?.type === "flip3";
  const isPendingActor = pendingAction?.actorId === room.selfId;

  ui.joinPanel.classList.toggle("connected", hasRoom);
  ui.app.classList.toggle("in-room", hasRoom);
  ui.roomStatus.hidden = !hasRoom;
  ui.tableShell.hidden = !hasRoom;
  ui.roomCode.textContent = hasRoom ? room.code : "----";
  ui.phaseLabel.textContent = hasRoom ? phaseText(room.phase) : "LOBBY";
  ui.deckCount.textContent = hasRoom ? String(room.deckCount) : "0";
  ui.chatInput.disabled = !hasRoom;
  ui.chatSendButton.disabled = !hasRoom;
  for (const button of ui.emojiButtons) {
    button.disabled = !hasRoom;
  }

  if (!hasRoom) {
    ui.turnLabel.textContent = "친구를 초대하세요.";
    ui.hintText.textContent = "방을 만들고 코드를 공유하면 같은 테이블에 접속합니다.";
    ui.playersGrid.innerHTML = "";
    ui.logList.innerHTML = "";
    ui.chatList.innerHTML = `<p class="chat-empty">방에 입장하면 채팅을 사용할 수 있습니다.</p>`;
  } else if (room.phase === "lobby") {
    ui.turnLabel.textContent = `${room.players.length}명 접속`;
    ui.hintText.textContent = isHost ? "방장은 게임 시작을 누를 수 있습니다." : "방장이 게임을 시작할 때까지 기다리세요.";
  } else if (room.phase === "playing") {
    if (pendingAction) {
      if (isFreezePending) {
        ui.turnLabel.textContent = isPendingActor ? "Freeze 대상 선택" : `${pendingAction.actorName}님이 Freeze 대상을 고르는 중`;
        ui.hintText.textContent = isPendingActor ? "스톱시킬 플레이어의 버튼을 선택하세요." : "Freeze 카드가 해결될 때까지 기다리세요.";
      } else if (isFlip3Pending) {
        ui.turnLabel.textContent = isPendingActor ? "Flip 3 대상 선택" : `${pendingAction.actorName}님이 Flip 3 대상을 고르는 중`;
        ui.hintText.textContent = isPendingActor ? "카드 3장을 받게 할 플레이어를 선택하세요. 자신도 선택할 수 있습니다." : "Flip 3 카드가 해결될 때까지 기다리세요.";
      }
    } else {
      ui.turnLabel.textContent = isMyTurn ? "당신의 차례입니다." : `${room.turnName}님의 차례`;
      ui.hintText.textContent = isMyTurn ? "카드를 뽑거나 지금 점수를 은행에 넣고 스톱하세요." : "다른 플레이어의 선택을 기다리는 중입니다.";
    }
  } else if (room.phase === "roundEnd") {
    ui.turnLabel.textContent = "라운드 종료";
    ui.hintText.textContent = "다음 라운드로 자동 진행합니다.";
  } else if (room.phase === "gameEnd") {
    const winner = room.players.find((player) => player.id === room.winnerId);
    ui.turnLabel.textContent = `${winner?.name || "승자"} 승리`;
    ui.hintText.textContent = `${room.winningScore}점 이상 도달. 로비로 돌아가 같은 방에서 새 게임을 시작할 수 있습니다.`;
  }

  ui.startButton.disabled = !hasRoom || !isHost || room.phase !== "lobby" || room.players.length < 2;
  ui.hitButton.disabled = !isMyTurn || room.phase !== "playing" || Boolean(pendingAction);
  ui.stayButton.disabled = !isMyTurn || room.phase !== "playing" || Boolean(pendingAction);
  ui.nextRoundButton.disabled = !hasRoom || room.phase !== "roundEnd";
  ui.lobbyButton.disabled = !hasRoom || room.phase !== "gameEnd";
  ui.nextRoundButton.hidden = !hasRoom || room.phase !== "roundEnd";
  ui.lobbyButton.hidden = !hasRoom || room.phase !== "gameEnd";

  if (hasRoom) {
    renderPlayers(room);
    renderLog(room.log);
    renderChat(room.chat || [], room.selfId);
  }
}

function renderPlayers(room) {
  ui.playersGrid.innerHTML = "";
  const pendingAction = room.pendingAction;
  const canResolveAction = pendingAction && pendingAction.actorId === room.selfId;

  for (const player of room.players) {
    const card = document.createElement("article");
    card.className = `player-card ${player.id === room.selfId ? "self" : ""} ${player.id === room.turnId ? "turn" : ""} ${player.status}`;

    const head = document.createElement("div");
    head.className = "player-head";
    head.innerHTML = `
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <span>${statusText(player.status)}${player.secondChance ? " · Second Chance" : ""}</span>
      </div>
      <div class="player-metrics">
        <div class="round-score">
          <span>이번 라운드</span>
          <strong>${player.roundScore}</strong>
        </div>
        <div class="score">
          <span>총점</span>
          <b>${player.score}</b>
        </div>
      </div>
    `;

    const cards = document.createElement("div");
    cards.className = "cards";
    for (const owned of player.cards) {
      const item = document.createElement("span");
      item.className = `card ${cardClass(owned)}`;
      item.textContent = owned.label;
      cards.appendChild(item);
    }

    const message = document.createElement("p");
    message.className = "player-message";
    message.textContent = player.message || (player.connected ? " " : "연결이 끊어졌습니다.");

    card.append(head, cards);

    if (canResolveAction && player.connected && player.status === "active") {
      const targetButton = document.createElement("button");
      targetButton.type = "button";
      targetButton.className = "target-button";
      if (pendingAction.type === "freeze") {
        targetButton.textContent = `${player.name} 스톱`;
        targetButton.addEventListener("click", () => send("resolveFreeze", { targetId: player.id }));
      } else if (pendingAction.type === "flip3") {
        targetButton.textContent = `${player.name} 카드 3장`;
        targetButton.addEventListener("click", () => send("resolveFlip3", { targetId: player.id }));
      }
      card.appendChild(targetButton);
    }

    card.appendChild(message);
    ui.playersGrid.appendChild(card);
  }
}

function renderLog(log) {
  ui.logList.innerHTML = "";
  for (const item of log || []) {
    const li = document.createElement("li");
    li.textContent = item;
    ui.logList.appendChild(li);
  }
}

function renderChat(messages, selfId) {
  ui.chatList.innerHTML = "";
  if (!messages.length) {
    ui.chatList.innerHTML = `<p class="chat-empty">아직 메시지가 없습니다.</p>`;
    return;
  }

  for (const message of messages) {
    const item = document.createElement("article");
    const textValue = String(message.text || "").trim();
    const isEmojiOnly = quickEmojis.has(textValue);
    item.className = `chat-message ${message.playerId === selfId ? "self" : ""} ${isEmojiOnly ? "emoji-only" : ""}`;

    const name = document.createElement("strong");
    name.textContent = message.name;

    const text = document.createElement("p");
    text.textContent = textValue;

    item.append(name, text);
    ui.chatList.appendChild(item);
  }
  ui.chatList.scrollTop = ui.chatList.scrollHeight;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => ui.toast.classList.add("hidden"), 2400);
}

ui.playerNameInput.value = localStorage.getItem("flip7PlayerName") || "";

ui.createRoomButton.addEventListener("click", () => send("createRoom", { name: playerName() }));
ui.joinRoomButton.addEventListener("click", () => send("joinRoom", {
  name: playerName(),
  code: ui.roomCodeInput.value,
}));
ui.startButton.addEventListener("click", () => send("startGame"));
ui.hitButton.addEventListener("click", () => send("hit"));
ui.stayButton.addEventListener("click", () => send("stay"));
ui.nextRoundButton.addEventListener("click", () => send("nextRound"));
ui.lobbyButton.addEventListener("click", () => send("returnLobby"));
ui.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = ui.chatInput.value.trim();
  if (!text) return;
  send("sendChat", { text });
  ui.chatInput.value = "";
});

ui.emojiRow.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-emoji]");
  if (!button || button.disabled) return;
  send("sendChat", { text: button.dataset.emoji });
});
ui.copyRoomButton.addEventListener("click", async () => {
  if (!state.room) return;
  try {
    await navigator.clipboard.writeText(state.room.code);
    showToast("방 코드를 복사했습니다.");
  } catch {
    showToast(state.room.code);
  }
});
ui.roomCodeInput.addEventListener("input", () => {
  ui.roomCodeInput.value = ui.roomCodeInput.value.toUpperCase();
});

connect();
render();
