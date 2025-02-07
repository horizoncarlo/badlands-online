globalThis.lobby = { // Local state
  lobbies: [],
  joinedId: '', // Game ID we've joined
  readying: false, // Countdown to the game start or not
  isFirst: false,
  countdownSeconds: 5,
  playerName: 'No Name',
  enteredPassword: '',
};

function init(funcOnReady) {
  let alpineReady = false;
  let sharedReady = false;
  let websocketReady = false;

  document.addEventListener('alpine:initialized', () => {
    alpineReady = true;
    funcOnReady(alpineReady && sharedReady && websocketReady);
  });

  document.addEventListener('sharedReady', (e) => {
    sharedReady = true;
    funcOnReady(alpineReady && sharedReady && websocketReady);
  });

  document.addEventListener('websocketReady', (e) => {
    websocketReady = true;
    funcOnReady(alpineReady && sharedReady && websocketReady);
  });
}
init(initLobby);

function initLobby(status) {
  if (status) {
    lobby = Alpine.reactive(lobby);
    lobby.playerName = localStorage.getItem(LOCAL_STORAGE.playerName) ?? 'No Name';
    if (localStorage.getItem(LOCAL_STORAGE.playerName)) {
      savePlayerName();
    }

    getLobbyList();
  }
}

function getJoinedLobby() {
  if (lobby.joinedId) {
    return lobby.lobbies.find((loopLobby) => lobby.joinedId === loopLobby.gameId);
  }
}

function getOpponentName() {
  const lobbyObj = getJoinedLobby();
  return lobbyObj.players.find((player) => player !== lobby.playerName) ?? 'None Yet';
}

function getLobbyList() {
  sendC('lobby', {
    subtype: 'getLobbyList',
  });
}

function joinLobby(lobbyObj) {
  if (lobbyObj.hasPassword && (!lobby.enteredPassword || lobby.enteredPassword.trim().length === 0)) {
    lobbyObj.showPasswordEntry = true;
  } else {
    const toSend = {
      subtype: 'joinLobby',
      gameId: lobbyObj.gameId,
      playerId: playerId,
    };
    if (lobbyObj.hasPassword) {
      toSend.password = lobby.enteredPassword;
    }
    sendC('lobby', toSend);
  }
}

function savePlayerName() {
  localStorage.setItem(LOCAL_STORAGE.playerName, lobby.playerName);

  sendC('lobby', {
    subtype: 'setName',
    playerName: lobby.playerName,
  });
}

function markReady(ele) {
  sendC('lobby', {
    subtype: 'markReady',
    gameId: lobby.joinedId,
    ready: ele.checked,
  });
}
