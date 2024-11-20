let socket; // Declared later as a binding for our Websocket
let reconnectAttempts = 0;

function receiveClientWebsocketMessage(message) {
  console.log('Received client message', message);

  if (!message || !message.type) {
    return;
  }

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
}

function sendType(type) {
  send({}, type);
}

function send(message, overrideType) {
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

function setupWebsocket() {
  socket = null;
  socket = new WebSocket(CLIENT_WEBSOCKET_ADDRESS);
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

  socket.addEventListener('open', (event) => {
    // Open a Websocket connection to the server
    console.log('Opened Websocket, subscribing ' + playerId);

    reconnectAttempts = 0;

    sendType('subscribe');
  });

  socket.addEventListener('close', (event) => {
    // If our closure code wasn't normal, try to reconnect
    if (event && event.code !== 1000) { // 1000 is normal Websocket closure
      console.error(`Abnormal websocket closure [${event.code}], going to reconnect (attempt ${reconnectAttempts})...`);

      reconnectAttempts++;
      setTimeout(() => {
        socket = null;
        setupWebsocket();
      }, reconnectAttempts * 1000);
    }
  });

  setInterval(() => {
    send('ping');
  }, 5000);
}
setupWebsocket();
