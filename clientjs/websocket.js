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
    case 'slot':
      state.slots[message.details.index].content = message.details.card;
      break;
    case 'removeCard': {
      const foundIndex = state.myCards.findIndex((card) => card.id === message.details.card.id);
      if (foundIndex !== -1) {
        state.myCards.splice(foundIndex, 1);
      }
      break;
    }
  }
};

function sendType(type) {
  sendC({}, type);
}

function sendC(message, overrideType) {
  if (!socket) {
    setupWebsocket();
  }

  message.playerId = playerId;
  if (overrideType) {
    message.type = overrideType;
  }

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
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
    sendType('ping');
  }, WS_PING_INTERVAL);
};

const teardownWebsocket = () => {
  if (socket) {
    try {
      sendType('unsubscribe');

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
