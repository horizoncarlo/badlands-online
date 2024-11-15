let socket; // Declared later as a binding for our Websocket

function setupWebsocket() {
  socket = new WebSocket(CLIENT_WEBSOCKET_ADDRESS);
  socket.addEventListener('message', (event) => {
    console.log('Received Event over WS', event);

    if (event && event.data) {
      try {
        // const parsedData = JSON.parse(event.data);
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
    socket.send(JSON.stringify({
      playerId: playerId,
      type: 'subscribe',
    }));
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
    socket.send(JSON.stringify({
      playerId: playerId,
      field: 'ping',
    }));
  }, 5000);
}
setupWebsocket();
