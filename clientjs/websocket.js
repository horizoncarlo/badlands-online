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
      gs.slots[message.details.playerNum][message.details.index].content = message.details.card;
      break;
    case 'addCard': {
      const addUniqCard = (cardToAdd) => {
        const myCards = getMyCards();
        if (!myCards.some((card) => card.id === cardToAdd.id)) {
          myCards.push(cardToAdd);
        }
      };

      if (message.details.showAnimation) {
        setTimeout(() => {
          ui.drawAnimationCount++;
          setTimeout(() => {
            addUniqCard(message.details.card);
          }, 1100);
          setTimeout(() => {
            ui.drawAnimationCount--;
          }, 1400);
        }, message.details.multiAnimation ? utils.randomRange(0, 500) : 0); // Some variance so fast cards, such as initial hand, don't overlap
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
    case 'cancelTarget':
      disableTargetMode();
      break;
    case 'targetMode':
      enableTargetMode(message.details);
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
  });

  socket.addEventListener('close', (event) => {
    // If our closure code wasn't normal, try to reconnect
    if (event && event.code !== WS_NORMAL_CLOSE_CODE) {
      console.error(`Abnormal websocket closure [${event.code}], going to reconnect (attempt ${reconnectAttempts})...`);

      reconnectAttempts++;
      setTimeout(() => {
        socket = null;
        setupWebsocket();
      }, reconnectAttempts * 1000);
    }
  });

  if (pingPongIntervaler) {
    clearInterval(pingPongIntervaler);
  }
  pingPongIntervaler = setInterval(() => {
    sendC('ping');
  }, WS_PING_INTERVAL);
};

const teardownWebsocket = () => {
  if (socket) {
    try {
      sendC('unsubscribe');

      if (
        socket.readyState !== WebSocket.CLOSED &&
        socket.readyState !== WebSocket.CLOSING
      ) {
        socket.close(WS_NORMAL_CLOSE_CODE); // Send a normal code that we closed on purpose
      }
    } catch (ignored) {}
  }
};

// Before we unload, unsubscribe from our Websocket if possible
window.onbeforeunload = function () {
  teardownWebsocket();
};

// Initialize our Websocket
setupWebsocket();
