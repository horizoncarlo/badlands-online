import { serveFile } from 'jsr:@std/http/file-server';
import { v4 as uuidv4 } from 'npm:uuid'; // Couldn't use Deno UUID because v4 just recommends crypto.randomUUID, which is only in HTTPS envs
import { gs } from './sharedjs/gamestate.mjs';

const DEFAULT_PORT = Deno.env.get('isLive') ? 80 : 2000;
const DEFAULT_HOSTNAME = Deno.env.get('isLive') ? 'badlands-online.deno.dev' : 'localhost'; // Or 0.0.0.0 for local public / self hosting
const CLIENT_WEBSOCKET_ADDRESS = Deno.env.get('isLive') ? `wss://${DEFAULT_HOSTNAME}/ws` : `ws://${DEFAULT_HOSTNAME}:${DEFAULT_PORT}/ws`;
const PRIVATE_FILE_LIST = ['deno.jsonc', 'deno.lock', 'main.ts'];
const gameId = uuidv4(); // TODO Generate different game IDs as we add a lobby system
const socketList = new Map<string, WebSocket[]>();

const handler = async (req: Request) => {
  const url = new URL(req.url);
  const filePath = url.pathname;

  if (filePath === '/ws') {
    if (req.headers.get('upgrade') != 'websocket') {
      return new Response(null, { status: 501 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req, { idleTimeout: 60 });
    if (!socketList.get(gameId)) {
      socketList.set(gameId, []);
    }
    socketList.set(gameId, [...socketList.get(gameId), socket]);

    socket.addEventListener('open', () => {
      // TODO Unlike Bun, we'll need to do our own group sub/unsub management to broadcast to each Websocket we're managing that matches some session/game ID we setup. See https://bun.sh/guides/websocket/pubsub
      // console.log("WS client connected!");
    });
    socket.addEventListener('message', (event) => {
      try {
        const dataJSON = JSON.parse(event.data);
        handleWebsocketMessage(dataJSON);
      } catch (err) {
        console.error('Websocket Message error', err); // TODO Probably can just silently ignore these as it'd just be bad/junk data coming in
      }
    });
    return response;
  } else if (filePath === '/' || filePath === '/game.html') {
    // Get our main HTML to return, but replace any templating variables first
    let html = await Deno.readTextFile('./game.html');

    html = html.replaceAll('${PLAYER_ID}', uuidv4());
    html = html.replaceAll('${CLIENT_WEBSOCKET_ADDRESS}', CLIENT_WEBSOCKET_ADDRESS);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Block access to any restricted files
  if (PRIVATE_FILE_LIST.find((item) => filePath.toLowerCase().indexOf(item) !== -1)) {
    console.error('Requested a private file, aborting', filePath);
    return new Response(null, { status: 401 });
  }

  return serveFile(req, '.' + filePath);
};

const send = (message: any) => {
  if (!message) {
    return;
  }

  socketList.get(gameId).forEach((socket) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  });
};

const handleWebsocketMessage = (message: any) => { // TODO Better typing for receiving Websocket messages once we have a more realistic idea of our incoming format
  if (!message || !message.type) {
    return;
  }

  if (message.type === 'ping') {
    send({
      type: 'pong',
    });
  } else {
    console.log('Received WS message', message);

    switch (message.type) {
      case 'playCard':
        // TODO Check if card is valid to play
        send({
          type: 'slot',
          details: { // TODO Directly send details here instead of copying just some properties out?
            index: message.details.slot.index,
            card: message.details.card,
          },
        });
        break;
    }
  }
};

console.log('TODO shared code test (Deno side)', gs.basicTestCall());

/* TODO HTTPS support
  port: 443,
  cert: Deno.readTextFileSync("./cert.pem"),
  key: Deno.readTextFileSync("./key.pem"),
*/
Deno.serve({ port: DEFAULT_PORT, hostname: DEFAULT_HOSTNAME }, handler);
