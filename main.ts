import { serveFile } from 'jsr:@std/http/file-server';
import { v4 as uuidv4 } from 'npm:uuid'; // Couldn't use Deno UUID because v4 just recommends crypto.randomUUID, which is only in HTTPS envs
import { createCampDeck, createNewDeck } from './backendjs/deck.ts';
import { startScraper } from './backendjs/scraper.ts';
import { abilities } from './sharedjs/abilities.mjs';
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
const DEFAULT_PATH = 'lobby.html';
const CLIENT_WEBSOCKET_ADDRESS = IS_LIVE ? `wss://${DEFAULT_HOSTNAME}/ws` : `ws://${DEFAULT_HOSTNAME}:${DEFAULT_PORT}/ws`;
const PRIVATE_FILE_LIST = ['deno.jsonc', 'deno.lock', 'main.ts', '/backendjs/'];
const DEFAULT_PLAYER_ID = 'newPlayer';
const TEMPLATE_COMPONENTJS = '<component-js />';
const TEMPLATE_HEADER = '<include-header />';
const COMPONENT_DIRECTORY = './backendjs/components/';

const gameId = uuidv4(); // TODO Generate different game IDs as we add a lobby system
const socketMap = new Map<string, WebSocketDetails[]>();
const htmlComponentMap = new Map<string, string>();
const jsComponentList = new Array<string>();

const handler = (req: Request) => {
  const url = new URL(req.url);
  let filePath = url.pathname;

  // Default our root
  if (filePath === '/') {
    filePath = DEFAULT_PATH;
  }

  if (filePath === '/ws') {
    if (req.headers.get('upgrade') != 'websocket') {
      return new Response(null, { status: 501 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req, { idleTimeout: 60 });
    if (!socketMap.get(gameId)) {
      socketMap.set(gameId, []);
    }

    socket.addEventListener('open', () => {
      const newPlayerId = url.searchParams.get('playerId') ?? DEFAULT_PLAYER_ID;
      socketMap.set(gameId, [...socketMap.get(gameId), {
        playerId: newPlayerId,
        socket: socket,
      }]);
    });
    socket.addEventListener('message', (event) => {
      try {
        receiveServerWebsocketMessage(JSON.parse(event.data));
      } catch (err) {
        console.error('Websocket Message error', err);
      }
    });
    return response;
  } else if (filePath === '/lobby.html' || filePath === '/game.html') {
    // Get our main HTML to return, but replace any templating variables first
    let html = Deno.readTextFileSync('.' + filePath);

    // Common header file shared between pages
    if (html.includes(TEMPLATE_HEADER)) {
      html = html.replaceAll(TEMPLATE_HEADER, Deno.readTextFileSync('./includes/header.html'));
    }

    html = html.replaceAll('${PLAYER_ID}', uuidv4());
    html = html.replaceAll('${CLIENT_WEBSOCKET_ADDRESS}', CLIENT_WEBSOCKET_ADDRESS);

    // Replace any components we've read from files and can find tags for
    if (filePath === '/game.html') {
      if (htmlComponentMap.size > 0) {
        htmlComponentMap.forEach((value, key) => {
          html = html.replaceAll(key, value);
        });
      }

      if (jsComponentList.length > 0) {
        let combinedJS = '';
        for (let i = 0; i < jsComponentList.length; i++) {
          combinedJS += jsComponentList[i];
        }

        html = html.replaceAll(TEMPLATE_COMPONENTJS, combinedJS);
      }
    } else {
      html = html.replaceAll(TEMPLATE_COMPONENTJS, '');
    }

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Block access to any restricted files
  if (PRIVATE_FILE_LIST.find((item) => filePath.toLowerCase().indexOf(item) !== -1)) {
    console.error('Requested a private file, aborting', filePath);
    return new Response(null, { status: 403 });
  }

  // Basic server side file hosting by path
  return serveFile(req, '.' + filePath);
};

// TODO Do a set type of...well...type, such as 'playCard' | 'drawCard' | etc.
const sendS = (type: string, messageDetails?: any, optionalGroup?: string) => {
  if (!type) {
    return;
  }

  const messageObj = {
    type: type,
    details: messageDetails ?? {},
  };

  if (type !== 'sync' && type !== 'ping' && type !== 'pong') {
    console.log('SENT:', messageObj);
  }

  socketMap.get(gameId).forEach((socketDetails: WebSocketDetails) => {
    if (!optionalGroup || (optionalGroup && optionalGroup === socketDetails.playerId)) {
      if (socketDetails && socketDetails.socket && socketDetails.socket.readyState === WebSocket.OPEN) {
        socketDetails.socket.send(JSON.stringify(messageObj));
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
      const foundIndex = socketMap.get(gameId).findIndex((socketDetails: WebSocketDetails) =>
        playerId === socketDetails.playerId
      );
      if (foundIndex !== -1) {
        socketMap.get(gameId)[foundIndex].socket?.close(WS_NORMAL_CLOSE_CODE);
        socketMap.get(gameId).splice(foundIndex, 1);
      }
    }
  } else {
    // Check if the player matches someone in the game
    if (
      message.type !== 'joinGame' && message.type !== 'dumpDebug' &&
      (!message.playerId || !utils.hasPlayerDataById(message.playerId))
    ) {
      action.sendError('Invalid player data, join a game first', message.playerId);
      return;
    }

    console.log('RECEIVE:', message);

    const possibleFunc = action[message.type];
    if (typeof possibleFunc === 'function') {
      possibleFunc(message);
    } else if (typeof abilities[message.type] === 'function') {
      abilities[message.type](message);
    } else {
      action.sendError(`Invalid action ${message.type}`, message.playerId);
    }
  }
};

gs.deck = createNewDeck();
gs.campDeck = createCampDeck();

// Read our components/ in preparation for replacing in the HTML
function setupComponents() {
  // TODO When needed allow for component subdirectories and smart handling of that
  for (const dirEntry of Deno.readDirSync(COMPONENT_DIRECTORY)) {
    if (dirEntry?.name?.toLowerCase().endsWith('.html')) {
      const tag = `<${dirEntry.name.substring(0, dirEntry.name.length - '.html'.length)} />`;
      htmlComponentMap.set(tag, Deno.readTextFileSync(COMPONENT_DIRECTORY + dirEntry.name));
    } else if (dirEntry?.name?.toLowerCase().endsWith('.js')) {
      jsComponentList.push(Deno.readTextFileSync(COMPONENT_DIRECTORY + dirEntry.name));
    }
  }
}
setupComponents();

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
    return new Response(null, { status: 403 });
  };
  Deno.serve({ port: 8080, hostname: 'localhost' }, devHandler);
}
