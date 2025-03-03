globalThis.lobby = { // Local state
  lobbies: [],
  joinedId: null, // Game ID we've joined
  readying: false, // Countdown to the game start or not
  creating: false, // Show the Create Game UI
  isFirst: false,
  countdownSeconds: 5,
  comparePlayerName: '',
  playerName: '',
  enteredPassword: '',
  confirmSave: false,
  confirmSaveTimeout: null,
  createForm: {
    title: null,
    password: null,
    timeLimit: null,
    kickIdle: true,
    observers: {
      allow: false,
      seeAll: false,
    },
  },
  demoDeck: [], // Little demo reel of cards we get from the server
  demoCounter: 0, // Track when to update the demo card
  chat: [], // Local copy of the lobby chat
};

const DEMO_REEL_SPEED_MS = 4000;

// TODO Centralize this function with `init` in game.js
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
    lobby.playerName = localStorage.getItem(LOCAL_STORAGE.playerName) ?? 'Anonymous';
    lobby.comparePlayerName = lobby.playerName;
    if (localStorage.getItem(LOCAL_STORAGE.playerName)) {
      savePlayerName({ noStatus: true });
    }

    getLobbyList();

    setInterval(() => { // Page through the demo deck
      lobby.demoCounter++;
    }, DEMO_REEL_SPEED_MS);
    setTimeout(() => { // Do an initial faster demo reel to show the user what the idea is
      lobby.demoCounter++;
    }, DEMO_REEL_SPEED_MS / 4);
  }
}

function getOpponentName() {
  const lobbyObj = getJoinedLobby();
  return lobbyObj.players.find((player) => player !== lobby.comparePlayerName);
}

function getLobbyList() {
  sendC('lobby', {
    subtype: 'getLobbyList',
  });
}

function getJoinedLobby() {
  if (lobby.joinedId) {
    return lobby.lobbies.find((loopLobby) => lobby.joinedId === loopLobby.gameId);
  }
}

function isInLobby(lobbyObj) {
  return lobby.joinedId && lobby.joinedId === lobbyObj?.gameId;
}

function clickLobby(lobbyObj) {
  // Leave or join a lobby based on our state
  if (isInLobby(lobbyObj)) {
    sendC('lobby', {
      subtype: 'leaveLobby',
    });

    lobby.joinedId = null;
  } else {
    if (lobbyObj.hasPassword && (!lobby.enteredPassword || lobby.enteredPassword.trim().length === 0)) {
      lobbyObj.showPasswordEntry = true;
    } else {
      const toSend = {
        subtype: 'joinLobby',
        gameId: lobbyObj.gameId,
      };
      if (lobbyObj.hasPassword) {
        toSend.password = lobby.enteredPassword;
      }
      sendC('lobby', toSend);
    }
  }
}

function clickQuickplay() {
  if (!lobby.joinedId) {
    sendC('lobby', {
      subtype: 'quickplayLobby',
    });
  }
}

function clickTestGame() {
  if (!lobby.joinedId) {
    sendC('lobby', {
      subtype: 'testGame',
    });
  }
}

function clickCustomGame() {
  lobby.creating = true;
}

function submitCustomGame() {
  if (
    lobby.createForm.title?.trim().length &&
    (!lobby.createForm.timeLimit?.trim().length ||
      !isNaN(parseInt(lobby.createForm.timeLimit)))
  ) {
    lobby.creating = false;
    sendC('lobby', {
      subtype: 'createJoinLobby',
      game: lobby.createForm,
    });
  }
}

function cancelCustomGame() {
  lobby.creating = false;
  lobby.createForm.password = null;
}

function savePlayerName(params) { // params.noStatus true to not do the checkmark
  lobby.comparePlayerName = lobby.playerName;
  localStorage.setItem(LOCAL_STORAGE.playerName, lobby.playerName);

  if (!params?.noStatus) {
    // Flicker the checkbox in the case of multiple saves
    lobby.confirmSave = false;
    setTimeout(() => {
      lobby.confirmSave = true;
    });

    if (lobby.confirmSaveTimeout) {
      clearTimeout(lobby.confirmSaveTimeout);
    }

    lobby.confirmSaveTimeout = setTimeout(() => {
      lobby.confirmSave = false;
    }, 1500);
  }

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

function getDemoCard() {
  if (lobby.demoDeck?.length > 0) {
    try {
      const demoCard = lobby.demoDeck[utils.randomRange(0, lobby.demoDeck.length)];
      return utils.fullCardPath(demoCard);
    } catch (ignored) {}
  }
  return utils.fullCardPath('punk');
}

function getCreatedNote(lobbyObj) {
  const minutesAgo = (Date.now() - new Date(lobbyObj.createdDate).getTime()) / 1000 / 60;
  if (minutesAgo < 1) {
    return 'Created just now';
  } else if (minutesAgo >= 60) {
    return 'Created ' + new Intl.RelativeTimeFormat('en').format((minutesAgo / 60).toFixed(1) * -1, 'hours');
  }
  return 'Created ' + new Intl.RelativeTimeFormat('en').format(Math.round(minutesAgo) * -1, 'minutes');
}
