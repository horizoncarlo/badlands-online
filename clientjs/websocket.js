const WS_PING_INTERVAL = 30000;

let socket; // Declared later as a binding for our Websocket
let pingPongIntervaler;
let reconnectAttempts = 0;

const receiveClientWebsocketMessage = (message) => {
  if (!message || !message.type || message.type === 'pong') {
    return;
  }

  console.log('Received client message', message);

  switch (message.type) {
    case 'alert':
      // TODO Proper alert component on UI
      console.warn('ALERT:', message.details.text);
      break;
    case 'error':
      // TODO Proper error component on UI
      console.error(message.details.text);
      break;
    case 'setPlayer':
      gs.who = message.details.player;
      ui.inGame = true;
      break;
    case 'slot':
      gs.slots[message.details.index].content = message.details.card;
      break;
    case 'damageCard': {
      const foundCard = findCardInBoard(message.details.card);
      if (foundCard) {
        foundCard.damage = (foundCard.damage || 0) + message.details.amount;
        if (foundCard.damage >= 2) {
          // TODO Destroy a card
        }
      }
      break;
    }
    case 'removeCard': {
      const foundIndex = getMyCards().findIndex((card) => card.id === message.details.card.id);
      if (foundIndex !== -1) {
        getMyCards().splice(foundIndex, 1);
      }
      break;
    }
    case 'addCard':
      if (message.details.fromWater) {
        ui.playDrawAnimation = true;
        setTimeout(() => {
          getMyCards().push(message.details.card);
        }, 1100);
        setTimeout(() => {
          ui.playDrawAnimation = false;
        }, 1400);
      } else {
        getMyCards().push(message.details.card);
      }

      break;
    case 'reduceWater':
      getPlayerData().waterCount -= message.details.cost;
      break;
    case 'promptCamps':
      getPlayerData().camps = message.details.camps;
      showCampPromptDialog();
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
