import { serveFile } from 'jsr:@std/http/file-server';
import { v4 as uuidv4 } from 'npm:uuid'; // Couldn't use Deno UUID because v4 just recommends crypto.randomUUID, which is only in HTTPS envs
import { action } from './sharedjs/websocket-actions.mjs';

type WebSocketDetails = {
  playerId: string;
  socket: WebSocket;
};

const DEFAULT_PORT = Deno.env.get('isLive') ? 80 : 2000;
const DEFAULT_HOSTNAME = Deno.env.get('isLive') ? 'badlands.deno.dev' : 'localhost'; // Or 0.0.0.0 for local public / self hosting
const CLIENT_WEBSOCKET_ADDRESS = Deno.env.get('isLive') ? `wss://${DEFAULT_HOSTNAME}/ws` : `ws://${DEFAULT_HOSTNAME}:${DEFAULT_PORT}/ws`;
const PRIVATE_FILE_LIST = ['deno.jsonc', 'deno.lock', 'main.ts'];
const DEFAULT_PLAYER_ID = 'newPlayer';

const gameId = uuidv4(); // TODO Generate different game IDs as we add a lobby system
const socketList = new Map<string, WebSocketDetails[]>();

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

    socket.addEventListener('open', () => {
      socketList.set(gameId, [...socketList.get(gameId), {
        playerId: url.searchParams.get('playerId') ?? DEFAULT_PLAYER_ID,
        socket: socket,
      }]);
    });
    socket.addEventListener('message', (event) => {
      try {
        receiveServerWebsocketMessage(JSON.parse(event.data));
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

  // Basic server side file hosting by path
  return serveFile(req, '.' + filePath);
};

const sendS = (message: any, optionalGroup?: string) => {
  if (!message) {
    return;
  }

  socketList.get(gameId).forEach((socketDetails: WebSocketDetails) => {
    if (!optionalGroup || (optionalGroup && optionalGroup === socketDetails.playerId)) {
      if (socketDetails && socketDetails.socket && socketDetails.socket.readyState === WebSocket.OPEN) {
        socketDetails.socket.send(JSON.stringify(message));
      }
    }
  });
};

const receiveServerWebsocketMessage = (message: any) => { // TODO Better typing for receiving Websocket messages once we have a more realistic idea of our incoming format
  if (!message || !message.type) {
    return;
  }

  if (message.type === 'ping') {
    sendS({
      type: 'pong',
    }, message.playerId);
  } else if (message.type === 'unsubscribe') {
    const playerId = message.playerId;
    if (playerId) {
      const foundIndex = socketList.get(gameId).findIndex((socketDetails: WebSocketDetails) => playerId === socketDetails.playerId);
      if (foundIndex !== -1) {
        socketList.get(gameId)[foundIndex].socket?.close(WS_NORMAL_CLOSE_CODE);
        socketList.get(gameId).splice(foundIndex, 1);
      }
    }
  } else {
    console.log('Received server message', message);

    switch (message.type) {
      case 'playCard':
        action.handlePlayCard(message);
        break;
    }
  }
};

/* TODO HTTPS support
  port: 443,
  cert: Deno.readTextFileSync("./cert.pem"),
  key: Deno.readTextFileSync("./key.pem"),
*/
Deno.serve({ port: DEFAULT_PORT, hostname: DEFAULT_HOSTNAME }, handler);

// Pseudo exports for use in sharedjs and other places
globalThis.sendS = sendS;
