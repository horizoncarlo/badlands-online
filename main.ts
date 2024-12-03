import { serveFile } from 'jsr:@std/http/file-server';
import { v4 as uuidv4 } from 'npm:uuid'; // Couldn't use Deno UUID because v4 just recommends crypto.randomUUID, which is only in HTTPS envs
import { createCampDeck, createNewDeck } from './backendjs/deck.ts';
import { startScraper } from './backendjs/scraper.ts';
import { action } from './sharedjs/actions.mjs';
import { gs } from './sharedjs/gamestate.mjs';
import { utils } from './sharedjs/utils.mjs';

type WebSocketDetails = {
  playerId: string;
  socket: WebSocket;
};

const IS_LIVE = Deno.env.get('isLive');
const DEFAULT_PORT = IS_LIVE ? 80 : 2000;
const DEFAULT_HOSTNAME = IS_LIVE ? 'badlands.deno.dev' : 'localhost'; // Or 0.0.0.0 for local public / self hosting
const CLIENT_WEBSOCKET_ADDRESS = IS_LIVE ? `wss://${DEFAULT_HOSTNAME}/ws` : `ws://${DEFAULT_HOSTNAME}:${DEFAULT_PORT}/ws`;
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
      const newPlayerId = url.searchParams.get('playerId') ?? DEFAULT_PLAYER_ID;
      socketList.set(gameId, [...socketList.get(gameId), {
        playerId: newPlayerId,
        socket: socket,
      }]);

      sendS('alert', { text: 'Choose which player you want to be from the menu' }, newPlayerId);
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

// TODO Do a set type of...well...type, such as 'playCard' | 'drawCard' | etc.
const sendS = (type: string, messageDetails?: any, optionalGroup?: string) => {
  if (!type) {
    return;
  }

  socketList.get(gameId).forEach((socketDetails: WebSocketDetails) => {
    if (!optionalGroup || (optionalGroup && optionalGroup === socketDetails.playerId)) {
      if (socketDetails && socketDetails.socket && socketDetails.socket.readyState === WebSocket.OPEN) {
        socketDetails.socket.send(JSON.stringify({
          type: type,
          details: messageDetails ?? {},
        }));
      }
    }
  });
};

const receiveServerWebsocketMessage = (message: any) => { // TODO Better typing for receiving Websocket messages once we have a more realistic idea of our incoming format
  if (!message || !message.type) {
    return;
  }

  if (message.type === 'ping') {
    sendS('pong', null, message.playerId);
  } else if (message.type === 'unsubscribe') {
    const playerId = message.playerId;
    if (playerId) {
      const foundIndex = socketList.get(gameId).findIndex((socketDetails: WebSocketDetails) =>
        playerId === socketDetails.playerId
      );
      if (foundIndex !== -1) {
        socketList.get(gameId)[foundIndex].socket?.close(WS_NORMAL_CLOSE_CODE);
        socketList.get(gameId).splice(foundIndex, 1);
      }
    }
  } else {
    // Check if the player matches someone in the game
    if (
      message.type !== 'joinGame' &&
      (!message.playerId || !utils.hasPlayerDataById(message.playerId))
    ) {
      action.sendError('Invalid player data, join a game first', message.playerId);
      return;
    }

    console.log('Received server message', message);

    if (typeof action[message.type] === 'function') {
      action[message.type](message);
    } else {
      action.sendError(`Invalid action ${message.type}`, message.playerId);
    }
  }
};

gs.deck = createNewDeck();
gs.campDeck = createCampDeck();

/* TODO HTTPS support example for a self hosted setup with our own certs
  port: 443,
  cert: Deno.readTextFileSync("./cert.pem"),
  key: Deno.readTextFileSync("./key.pem"),
*/
Deno.serve({ port: DEFAULT_PORT, hostname: DEFAULT_HOSTNAME }, handler);

// Pseudo exports for use in sharedjs and other places
globalThis.sendS = sendS;

// Dev-specific APIs
if (!IS_LIVE) {
  const devHandler = (req: Request) => {
    const url = new URL(req.url);
    const filePath = url.pathname;

    if (filePath === '/scraper/start') {
      return new Response(startScraper(), {
        headers: { 'Content-Type': 'text/html' },
      });
    }
    return new Response(null, { status: 401 });
  };
  Deno.serve({ port: 8080, hostname: 'localhost' }, devHandler);
}
