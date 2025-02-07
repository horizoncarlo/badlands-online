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

type PlayerObj = {
  playerId: string;
  playerName: string;
};

type GameLobby = {
  gameId: string;
  title: string;
  password?: string;
  observers: {
    allow: boolean;
    seeAll: boolean;
  };
  timeLimit?: number;
  players: PlayerObj[];
  gs: any;
};

const IS_LIVE = Deno.env.get('isLive');
const DEFAULT_PORT = IS_LIVE ? 80 : 2000;
const DEFAULT_HOSTNAME = IS_LIVE ? 'badlands.deno.dev' : 'localhost'; // Or 0.0.0.0 for local public / self hosting
const DEFAULT_PATH = '/lobby.html';
const CLIENT_WEBSOCKET_ADDRESS = IS_LIVE ? `wss://${DEFAULT_HOSTNAME}/ws` : `ws://${DEFAULT_HOSTNAME}:${DEFAULT_PORT}/ws`;
const PRIVATE_FILE_LIST = ['deno.jsonc', 'deno.lock', 'main.ts', '/backendjs/'];
const DEFAULT_PLAYER_ID = 'newPlayer';
const DEFAULT_PLAYER_NAME = 'Anonymous';
const TEMPLATE_COMPONENTJS = '<component-js />';
const TEMPLATE_HEADER = '<include-header />';
const COMPONENT_DIRECTORY = './backendjs/components/';

const lobbySocketId = 'lobby';
const socketMap = new Map<string, WebSocketDetails[]>(); // Track which actual socket is in what channel (the string identifier), such as lobby or a gameId
const htmlComponentMap = new Map<string, string>();
const jsComponentList = new Array<string>();
const lobbies = new Map<string, GameLobby>();
const players = new Map<string, string>(); // key is playerId, value is name

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
    if (!socketMap.get(lobbySocketId)) {
      socketMap.set(lobbySocketId, []);
    }

    socket.addEventListener('open', () => {
      // TODO When someone creates a game we add that gameId socket to the list?
      const newPlayerId = url.searchParams.get('playerId') ?? DEFAULT_PLAYER_ID;
      players.set(newPlayerId, DEFAULT_PLAYER_NAME);
      socketMap.set(lobbySocketId, [...socketMap.get(lobbySocketId), {
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

  socketMap.get(lobbySocketId).forEach((socketDetails: WebSocketDetails) => {
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

  // TODO Be consistent between this and the client-side receive message and just use switch statements in both
  if (message.type === 'ping') {
    sendS('pong', null, message.playerId);
  } else if (message.type === 'unsubscribe') {
    const playerId = message.playerId;
    if (playerId) {
      const foundIndex = socketMap.get(lobbySocketId).findIndex((socketDetails: WebSocketDetails) =>
        playerId === socketDetails.playerId
      );
      if (foundIndex !== -1) {
        socketMap.get(lobbySocketId)[foundIndex].socket?.close(WS_NORMAL_CLOSE_CODE);
        socketMap.get(lobbySocketId).splice(foundIndex, 1);
      }
    }
  } else if (message.type === 'lobby') {
    if (!message.details.subtype) {
      console.error('Received lobby message but no subtype');
      return;
    }

    console.log('RECEIVE LOBBY', message);

    if (message.details.subtype === 'setName') {
      players.set(message.details.playerId, message.details.playerName);
    } else if (message.details.subtype === 'getLobbyList') {
      sendS('lobby', {
        subtype: 'giveLobbyList',
        lobbies: convertLobbiesForClient(),
      }, message.playerId);

      // Determine if we are already in a lobby and rejoin it
      lobbies.forEach((lobby: GameLobby) => {
        if (lobby.players.find((player: PlayerObj) => player.playerId === message.playerId)) {
          sendS('lobby', {
            subtype: 'joinedLobby',
            gameId: lobby.gameId,
          }, message.playerId);
        }
      });
    } else if (message.details.subtype === 'joinLobby') {
      if (
        message.playerId && message.details.gameId && lobbies.get(message.details.gameId)
      ) {
        const lobbyToJoin = lobbies.get(message.details.gameId);
        // TTODO Determine if we can join a lobby - has a slot, and no one is waiting to rejoin
        if (lobbyToJoin.players.length >= 2) {
          // TTODO Send error if the lobby is full?
        } else {
          lobbyToJoin.players.push({
            playerId: message.playerId,
            playerName: players.get(message.playerId) ?? DEFAULT_PLAYER_NAME,
          });

          // Refresh the lobby list of all viewing parties
          sendS('lobby', {
            subtype: 'giveLobbyList',
            lobbies: convertLobbiesForClient(),
          });

          sendS('lobby', {
            subtype: 'joinedLobby',
            gameId: lobbyToJoin.gameId,
          }, message.playerId);
        }
      }
    } else {
      console.error('Received lobby message but unknown subtype=' + message.details.subtype);
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

const createGame = (title: string, password?: string) => {
  const newGameId = uuidv4();

  const newGamestate = structuredClone(gs);
  newGamestate.deck = createNewDeck();
  newGamestate.campDeck = createCampDeck();

  lobbies.set(newGameId, {
    gameId: newGameId,
    title: title,
    password: password,
    observers: {
      allow: false,
      seeAll: false,
    },
    timeLimit: 0,
    players: [],
    gs: newGamestate,
  });
};

// Convert our map of lobbies to an array of just public information for the client to display
function convertLobbiesForClient() {
  const toReturn = [];
  if (lobbies?.size) {
    lobbies.forEach((lobby: GameLobby, key: string) => {
      toReturn.push({
        gameId: key,
        title: lobby.title,
        hasPassword: typeof lobby.password === 'string',
        observers: {
          ...lobby.observers,
        },
        timeLimit: lobby.timeLimit ?? 0,
        players: lobby.players.map((player) => player.playerName), // Strip IDs and just send names
      });
    });
  }
  return toReturn;
}

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

// TTODO Some default lobbies to populate the list
createGame('Test Game 1');
createGame('Private Game', 'test');

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
