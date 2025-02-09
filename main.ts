import { serveFile } from 'jsr:@std/http/file-server';
import { v4 as uuidv4 } from 'npm:uuid'; // Couldn't use Deno UUID because v4 just recommends crypto.randomUUID, which is only in HTTPS envs
import { createCampDeck, createNewDeck } from './backendjs/deck.ts';
import { startScraper } from './backendjs/scraper.ts';
import { abilities } from './sharedjs/abilities.mjs';
import { action } from './sharedjs/actions.mjs';
import { createGameState } from './sharedjs/gamestate.mjs';
import { utils } from './sharedjs/utils.mjs';

type WebSocketDetails = {
  playerId: string;
  socket: WebSocket;
};

type PlayerObj = {
  playerId: string;
  playerName: string;
  ready?: boolean;
};

type GameLobby = {
  gameId: string;
  started?: boolean;
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
    if (!socketMap.has(lobbySocketId)) {
      socketMap.set(lobbySocketId, []);
    }

    socket.addEventListener('open', () => {
      const newPlayerId = url.searchParams.get('playerId') ?? DEFAULT_PLAYER_ID;
      players.set(newPlayerId, DEFAULT_PLAYER_NAME);

      // See if we're in a game
      const socketId = utils.getGameIdByPlayerId(newPlayerId) ?? lobbySocketId;

      if (!socketMap.has(socketId)) {
        socketMap.set(socketId, []);
      }

      socketMap.set(socketId, [...socketMap.get(socketId), {
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
    // TODO Even though this is a fast process we should do some aggressive long term caching of our read HTML files - only dynamic part after initial header/component setup is PLAYER_ID (not even CLIENT_WEBSOCKET_ADDRESS which doesn't change)
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
const sendS = (type: string, messageForGs: any, messageDetails?: any, optionalGroup?: string) => {
  if (!type) {
    return;
  }

  const messageObj = {
    type: type,
    details: messageDetails ?? {},
  };

  let socketId = null;

  // If we're sending a Lobby message only bother with players in that group
  if (messageObj.type === 'lobby') {
    socketId = lobbySocketId;
  } // Otherwise try to determine our socketId from whether we're in a game or not
  else {
    socketId = messageForGs ? utils.getGameIdByPlayerId(messageForGs.playerId) ?? lobbySocketId : lobbySocketId;
  }

  if (type !== 'sync' && type !== 'ping' && type !== 'pong') {
    console.log(`SENT to ${socketId}:`, messageObj);
  }

  socketMap.get(socketId)?.forEach((socketDetails: WebSocketDetails) => {
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
    sendS('pong', message, null, message.playerId);
  } else if (message.type === 'unsubscribe') {
    const playerId = message.playerId;
    const gameId = utils.getGameIdByPlayerId(message.playerId) ?? lobbySocketId;

    if (playerId) {
      const foundIndex = socketMap.get(gameId)?.findIndex((socketDetails: WebSocketDetails) =>
        playerId === socketDetails.playerId
      );
      if (foundIndex !== -1) {
        socketMap.get(gameId)[foundIndex].socket?.close(WS_NORMAL_CLOSE_CODE);
        socketMap.get(gameId).splice(foundIndex, 1);
      }
    }
  } else if (message.type === 'lobby') {
    if (!message.details.subtype) {
      console.error('Received lobby message but no subtype');
      return;
    }

    console.log('RECEIVE (Lobby):', message);

    if (message.details.subtype === 'setName') {
      players.set(message.playerId, message.details.playerName);
    } else if (message.details.subtype === 'getLobbyList') {
      // TODO Probably wrap the lobby messages in a helper function, including sendC
      refreshLobbyList(message, { justToPlayer: true });

      // Determine if we are already in a lobby and rejoin it (or the game!)
      utils.lobbies.forEach((lobby: GameLobby) => {
        if (lobby.players.find((player: PlayerObj) => player.playerId === message.playerId)) {
          if (lobby.started) {
            sendS('nav', message, {
              page: 'gotoGame',
              started: lobby.started,
            }, message.playerId);
          } else {
            sendS('lobby', message, {
              subtype: 'joinedLobby',
              gameId: lobby.gameId,
            }, message.playerId);
          }
        }
      });
    } else if (message.details.subtype === 'joinLobby') {
      if (
        message.playerId && message.details.gameId && utils.lobbies.get(message.details.gameId)
      ) {
        // TTODO Figure out what to do with auto opponent - we still want the option so people can at least test out the game, and eventually maybe have AI?
        // TTODO Clean up empty games (that no one is trying to rejoin) automatically after a period
        const lobbyToJoin = utils.lobbies.get(message.details.gameId);
        // TTODO Determine if anyone is waiting to rejoin a game before we go in
        if (lobbyToJoin.players.length >= 2 || lobbyToJoin.players.find((player) => player.playerId === message.playerId)) {
          // Don't need to do anything if the lobby is full
        } else {
          // Check if a password is required, provided, and valid
          if (
            lobbyToJoin.password && lobbyToJoin.password.trim().length > 0 &&
            message.details.password !== lobbyToJoin.password
          ) {
            sendS('lobby', message, {
              subtype: 'wrongPassword',
            }, message.playerId);
            return;
          }

          // Leave all existing lobbies
          utils.leaveAllLobbies(message.playerId);

          lobbyToJoin.players.push({
            playerId: message.playerId,
            playerName: players.get(message.playerId) ?? DEFAULT_PLAYER_NAME,
          });

          // Refresh the lobby list of all viewing parties
          refreshLobbyList(message);

          sendS('lobby', message, {
            subtype: 'joinedLobby',
            gameId: lobbyToJoin.gameId,
          }, message.playerId);
        }
      }
    } else if (message.details.subtype === 'leaveLobby') {
      utils.leaveAllLobbies(message.playerId);
      refreshLobbyList(message);
    } else if (message.details.subtype === 'markReady') {
      const lobbyObj = utils.lobbies.get(message.details.gameId);
      const foundPlayer = lobbyObj?.players.find((player) => player.playerId === message.playerId);
      if (foundPlayer && lobbyObj) {
        foundPlayer.ready = message.details.ready;

        // If both players are ready start the game
        if (foundPlayer.ready && lobbyObj.players.length >= 2) {
          const opponent = lobbyObj.players.find((player) => player.playerId !== message.playerId);
          if (opponent?.ready) {
            // Determine the first player
            const playerRoll = utils.randomRange(0, 1);
            if (playerRoll === 0) {
              lobbyObj.gs.player1.playerId = foundPlayer.playerId;
              lobbyObj.gs.player2.playerId = opponent.playerId;
            } else {
              lobbyObj.gs.player2.playerId = foundPlayer.playerId;
              lobbyObj.gs.player1.playerId = opponent.playerId;
            }

            sendS('nav', message, {
              page: 'gotoGame',
              isFirst: playerRoll === 0,
            }, message.playerId);
            sendS('nav', message, {
              page: 'gotoGame',
              isFirst: playerRoll === 1,
            }, opponent.playerId);

            // Game is set to start
            lobbyObj.started = true;
          }
        }
      }
    } else if (message.details.subtype === 'quickplayLobby') {
      const toSend = { ...message };
      // See if there's an existing non-started non-password lobby we can just join
      for (const loopLobby of utils.lobbies.values()) {
        if (
          !loopLobby.started && !loopLobby.password &&
          loopLobby.players.length <= 1
        ) {
          // Also double check that somehow (ie: by skipping UI validation) we're already in the lobby
          if (loopLobby.players.length === 1 && loopLobby.players[0].playerId === message.details.playerId) {
            return;
          }

          toSend.details.subtype = 'joinLobby';
          toSend.details.gameId = loopLobby.gameId;

          return receiveServerWebsocketMessage(toSend);
        }
      }

      // Otherwise create a default lobby and join it
      toSend.details.subtype = 'createJoinLobby';
      toSend.details.game = {
        title: (players.get(message.playerId) ?? getDefaultQuickplayPrefix()) + ' Lobby',
      };

      return receiveServerWebsocketMessage(toSend);
    } else if (message.details.subtype === 'createJoinLobby') {
      if (message.details.game?.title) {
        createGame({ title: message.details.game.title }, { joinAfter: message });
      }
    } else if (message.details.subtype === 'gamePageLoaded') {
      const gameObj = utils.lobbies.get(utils.getGameIdByPlayerId(message.playerId));

      // If we don't have a game setup, go back to the lobby
      if (!gameObj) {
        sendS('nav', message, {
          page: 'gotoLobby',
        }, message.playerId);
        return;
      }

      let playerNum = 'player1';
      if (gameObj.gs.player2.playerId === message.playerId) {
        playerNum = 'player2';
      }

      action.joinGame({
        playerId: message.playerId,
        details: {
          player: playerNum,
        },
      }, { fromServerRequest: true });
    } else {
      console.error('Received lobby message but unknown subtype=' + message.details.subtype);
    }
    // Non-lobby, in-game messages
  } else {
    if (
      message.type !== 'dumpDebug' &&
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

const createGame = (gameParams: Partial<GameLobby>, status?: { joinAfter?: any /* Is a WS message */ }) => {
  const newGameId = uuidv4();
  const newGamestate = createGameState(newGameId);
  newGamestate.gameId = newGameId;
  newGamestate.deck = createNewDeck();
  newGamestate.campDeck = createCampDeck();

  utils.lobbies.set(newGameId, {
    gameId: newGameId,
    title: gameParams.title ?? 'Unnamed Lobby',
    password: gameParams.password,
    observers: {
      allow: false,
      seeAll: false,
    },
    timeLimit: 0,
    players: [],
    gs: newGamestate,
    undoStack: [], // Stack (LIFO) of gs we can undo back to
  });

  if (status?.joinAfter?.playerId) {
    const toSend = { ...status.joinAfter };
    toSend.details.subtype = 'joinLobby';
    toSend.details.gameId = newGameId;
    return receiveServerWebsocketMessage(toSend);
  }
};

function refreshLobbyList(message, params?: { justToPlayer?: boolean }) {
  sendS('lobby', message, {
    subtype: 'giveLobbyList',
    lobbies: convertLobbiesForClient(),
  }, params?.justToPlayer ? message.playerId : null);
}

function getDefaultQuickplayPrefix() {
  const prefix = String(Date.now());
  return prefix.substring(prefix.length - 4);
}

// Convert our map of lobbies to an array of just public information for the client to display
function convertLobbiesForClient() {
  const toReturn = [];
  if (utils.lobbies?.size) {
    utils.lobbies.forEach((lobby: GameLobby, key: string) => {
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

// TODO TEMPORARY Some default lobbies to populate the list
createGame({ title: 'Test Game 1' });
createGame({ title: 'Private Game', password: 'test' });

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
