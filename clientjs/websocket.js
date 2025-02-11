const WS_PING_INTERVAL = 30000;

let socket; // Declared later as a binding for our Websocket
let pingPongIntervaler;
let reconnectAttempts = 0;

const receiveClientWebsocketMessage = (message) => {
  if (!message || !message.type || message.type === 'pong') {
    return;
  }

  console.log('Received client message', JSON.parse(JSON.stringify(message)));

  switch (message.type) {
    case 'lobby': {
      if (!message.details.subtype) {
        return;
      }

      if (message.details.subtype === 'giveLobbyList') {
        lobby.lobbies = message.details.lobbies;
      } else if (message.details.subtype === 'joinedLobby') {
        if (message.details.gameId) {
          const toJoin = lobby.lobbies.find((loopLobby) => loopLobby.gameId === message.details.gameId);
          if (toJoin) {
            lobby.joinedId = toJoin.gameId;
          }
        }

        // Also auto-ready if we're vs AI
        if (message.details.vsAI) {
          markReady({ checked: true });
        }
      } else if (message.details.subtype === 'wrongPassword') {
        alert('Lobby password is incorrect');
        lobby.enteredPassword = '';
      }

      break;
    }
    case 'nav': {
      if (message.details.page === 'gotoGame') {
        // Either hop right to our game or do a countdown
        if (message.details.started) {
          utils.performNav('game.html');
        } else {
          lobby.readying = true;
          lobby.isFirst = message.details.isFirst;
          lobby.countdownSeconds = GAME_START_COUNTDOWN_S;
          setInterval(() => { // Countdown on an interval for the game to be ready
            lobby.countdownSeconds = Math.max(0, lobby.countdownSeconds - 1);
          }, 999);
          setTimeout(() => { // Navigate to the game after our countdown is done
            utils.performNav('game.html');
          }, lobby.countdownSeconds * 1000);
        }
      } else if (message.details.page === 'gotoLobby') {
        utils.performNav('lobby.html');
      }

      break;
    }
    case 'sync': {
      // Update all our existing gamestate options, and if a property doesn't exist fallback to our current version
      const updatedGs = message.details.gs;
      for (const [key, value] of Object.entries(updatedGs)) {
        gs[key] = value ?? gs[key];
      }
      break;
    }
    case 'setPlayer':
      gs.myPlayerNum = message.details.player;
      gs.opponentPlayerNum = utils.getOppositePlayerNum(gs.myPlayerNum);
      ui.inGame = true;
      break;
    case 'slot':
      gs[message.details.playerNum].slots[message.details.index].content = message.details.card;
      break;
    case 'events':
      gs[message.details.playerNum].events = message.details.events;
      break;
    case 'addCard': {
      const addUniqCard = (cardToAdd) => {
        const myCards = getMyCards();
        if (!myCards.some((card) => card.id === cardToAdd.id)) {
          myCards.push(cardToAdd);
        }
      };

      if (message.details.showAnimation) {
        setTimeout(() => { // Some variance so fast cards, such as initial hand, don't overlap
          ui.drawAnimationCount++;
          setTimeout(() => { // Draw the card properly
            addUniqCard(message.details.card);
          }, 1100);
          setTimeout(() => { // Keep track of our draw animation count
            ui.drawAnimationCount--;
          }, 1400);
        }, message.details.multiAnimation ? utils.randomRange(0, 500) : 0);
      } else {
        addUniqCard(message.details.card);
      }

      if (typeof message.details.deckCount === 'number') {
        gs.deckCount = message.details.deckCount;
      }

      break;
    }
    case 'reduceWater':
      getPlayerData().waterCount -= message.details.cost;
      break;
    case 'gainWater':
      getPlayerData().waterCount += 1;
      break;
    case 'promptCamps':
      getPlayerData().camps = message.details.camps;
      if (DEBUG_AUTO_SELECT_CAMPS_START_TURN) {
        const camps = getPlayerData().camps;
        [camps[0], camps[1], camps[2]].forEach(chooseCamp);
        doneChooseCamps();
        action.startTurn();
        break;
      }
      showCampPromptDialog();
      break;
    case 'chat': {
      // If we're on the lobby page just append there
      if (typeof ui === 'undefined') {
        lobby.chat.push(message.details.text);
        break;
      }

      // Some cutesy behaviour to ensure spammed messages just note their count. So 'Hey dude' becomes 'Hey dude (x1)' then x2 and so on
      if (gs.chat.length > 0 && gs.chat[gs.chat.length - 1].startsWith(message.details.text)) {
        let count = gs.chat[gs.chat.length - 1].substring(message.details.text.length).trim();
        if (count.length === 0) {
          count = '(x1)';
        }
        if (count.startsWith('(x')) {
          count = count.substring('(x'.length);
          count = count.substring(0, count.length - 1);
          if (!isNaN(Number(count))) {
            // Replace our last message
            gs.chat.splice(gs.chat.length - 1, 1, `${message.details.text} (x${Number(count) + 1})`);
            break;
          }
        }
      }
      gs.chat.push(message.details.text);
      break;
    }
    case 'chatCatchup':
      // Get a big list of chat messages to catch up from in the lobby
      if (typeof ui === 'undefined') {
        message.details.chats?.forEach((text) => {
          lobby.chat.push(text);
        });

        scrollChatToBottom();
      }
      break;
    case 'cancelTarget':
      disableTargetMode();
      break;
    case 'targetMode':
      enableTargetMode(message.details);
      break;
    case 'useCard':
      action.useCard(message);
      break;
    case 'useAbility':
      if (abilities && typeof abilities[message.details.effectName] === 'function') {
        abilities[message.details.effectName](message);
      } else if (events && typeof events[message.details.effectName] === 'function') {
        events[message.details.effectName](message);
      }
      break;
  }
};

function sendC(type, messageDetails) {
  if (!socket) {
    setupWebsocket();
  }

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: type,
      playerId: playerId,
      details: messageDetails ?? {},
    }));
  }
}

const setupWebsocket = () => {
  // Clean up any old socket
  if (socket) {
    teardownWebsocket();
    socket = null;
  }

  socket = new WebSocket(CLIENT_WEBSOCKET_ADDRESS + (playerId ? `?playerId=${playerId}` : ''));
  socket.addEventListener('message', (event) => {
    if (event && event.data) {
      try {
        receiveClientWebsocketMessage(JSON.parse(event.data));
      } catch (err) {
        console.error('Error receiving WS message', err);
      }
    }
  });

  socket.addEventListener('error', (err) => {
    console.error('Websocket error', err);
  });

  socket.addEventListener('open', () => {
    // Open a Websocket connection to the server
    console.log('Opened Websocket, subscribing ' + playerId);
    reconnectAttempts = 0;

    setTimeout(() => { // TODO Bad, need to reliably know when we're connected to the Websocket, which can happen so fast our JS isn't ready
      (document || window).dispatchEvent(new Event('websocketReady'));
    }, 100);
  });

  socket.addEventListener('close', (event) => {
    // If our closure code wasn't normal, try to reconnect
    if (event && event.code !== WS_NORMAL_CLOSE_CODE) {
      console.error(`Abnormal websocket closure [${event.code}], going to reconnect (attempt ${reconnectAttempts})...`);

      reconnectAttempts++;
      setTimeout(() => { // Reconnect failed Websocket on a throttled scale
        socket = null;
        setupWebsocket();
      }, reconnectAttempts * 1000);
    }
  });

  if (pingPongIntervaler) {
    clearInterval(pingPongIntervaler);
  }
  pingPongIntervaler = setInterval(() => { // Keep the socket alive the usual way
    sendC('ping');
  }, WS_PING_INTERVAL);
};

const teardownWebsocket = () => {
  if (socket) {
    try {
      sendC('teardown', {
        checkConnection: ui.inGame,
      });

      if (
        socket.readyState !== WebSocket.CLOSED &&
        socket.readyState !== WebSocket.CLOSING
      ) {
        socket.close(WS_NORMAL_CLOSE_CODE); // Send a normal code that we closed on purpose
      }
    } catch (ignored) {}
  }
};

// Before we unload, teardown our Websocket if possible
window.onbeforeunload = function () {
  teardownWebsocket();
};

// Initialize our Websocket
setupWebsocket();
