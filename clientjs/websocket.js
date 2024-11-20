let socket; // Declared later as a binding for our Websocket

function sendType(type) {
  send({}, type);
}

function send(message, optionalType) {
  if (!socket) {
    setupWebsocket();
  }

  message.playerId = playerId;
  if (optionalType) {
    message.type = optionalType;
  }

  socket.send(JSON.stringify(message));
}

function setupWebsocket() {
  socket = new WebSocket(CLIENT_WEBSOCKET_ADDRESS);
  socket.addEventListener('message', (event) => {
    console.log('Received Event over WS', event);

    if (event && event.data) {
      try {
        const parsedData = JSON.parse(event.data);
        if (parsedData) {
          if (parsedData.type) {
            if (parsedData.type === 'slot') {
              state.slots[parsedData.details.index].content = parsedData.details.card;
            }
          }
        }
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
    sendType('subscribe');
  });

  socket.addEventListener('close', (event) => {
    // If our closure code wasn't normal, try to reconnect
    if (event && event.code !== 1000) { // 1000 is normal Websocket closure
      console.error('Abnormal websocket closure [' + event.code + '], going to reconnect...');
      setTimeout(() => {
        socket = null;
        setupWebsocket();
      });
    }
  });

  setInterval(() => {
    send('ping');
  }, 5000);
}
setupWebsocket();
