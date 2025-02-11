import { serveFile } from 'jsr:@std/http/file-server';
import { v4 as uuidv4 } from 'npm:uuid'; // Couldn't use Deno UUID because v4 just recommends crypto.randomUUID, which is only in HTTPS envs
import { createCampDeck, createDemoDeck, createNewDeck } from './backendjs/deck.ts';
import { startScraper } from './backendjs/scraper.ts';
import { abilities } from './sharedjs/abilities.mjs';
import { action } from './sharedjs/actions.mjs';
import { createGameState } from './sharedjs/gamestate.mjs';
import { ai, utils } from './sharedjs/utils.mjs';

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
  idleCheckInterval?: number | null;
  title: string;
  password?: string;
  observers: { // TODO Implement observers to the game (and lobby)
    allow: boolean;
    seeAll: boolean;
  };
  timeLimit?: number; // TODO Implement timeLimit functionality in the actual game
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
const LOBBY_CHAT_CATCHUP_COUNT = 300;
const IDLE_RULES = {
  intervalDelay: 15 * 1000, // Check for idleness every 15 seconds
  warningAfter: 60 * 2 * 1000, // Default warning after 2 minutes
  kickAfter: 35 * 1000, // Kick after an additional ~30 seconds from the warning
  teardownAfter: 10 * 1000, // Warn about connection problems if a Websocket drops for this long without a reconnect
};

const lobbySocketId = 'lobby';
const socketMap = new Map<string, WebSocketDetails[]>(); // Track which actual socket is in what channel (the string identifier), such as lobby or a gameId
const teardownMap = new Map<string, number | null>(); // Track teardown timer notifications, key=playerId and value=setTimeout ref
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

      // If we're using an invalid playerId, in the case of bad client data, just bail
      if (ai.isAI(newPlayerId)) {
        socket.close(1003, 'Bad playerId');
        return false;
      }

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

  if (
    type !== 'sync' && type !== 'ping' && type !== 'pong' &&
    (type === 'lobby' && messageDetails.subtype && messageDetails.subtype !== 'giveDemoDeck')
  ) {
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
  } else if (message.type === 'teardown') {
    const playerId = message.playerId;

    if (playerId) {
      const gameId = utils.getGameIdByPlayerId(playerId) ?? lobbySocketId;

      // Notify the opponent about the potential connection problems
      // This would be a Websocket that closes - they might rejoin, but if they don't the normal idle timeout will handle it
      const teardownDetails = teardownMap.get(playerId);
      if (teardownDetails) {
        clearTimeout(teardownDetails);
        teardownMap.delete(playerId);
      }

      if (utils.lobbies.get(gameId)?.started && message.details.checkConnection) {
        const timeoutRef = setTimeout(() => {
          // Check if we have a socket, if not then we never reconnected and should show the connection problem warning
          const ourPlayerId = socketMap.get(gameId).find((details) => playerId === details.playerId);
          const gsPlayerId = socketMap.get(gameId).find((details) => details.playerId); // Opponent who we want to leverage to send an error
          if (gsPlayerId && !ourPlayerId) {
            action.sendError('Player having connection problems', { gsMessage: { playerId: gsPlayerId.playerId } });
          }
        }, IDLE_RULES.teardownAfter);
        teardownMap.set(playerId, timeoutRef);
      }

      const foundIndex = socketMap.get(gameId)?.findIndex((socketDetails: WebSocketDetails) =>
        playerId === socketDetails.playerId
      );

      if (typeof foundIndex === 'number' && foundIndex !== -1) {
        socketMap.get(gameId)[foundIndex]?.socket?.close(WS_NORMAL_CLOSE_CODE);
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
      utils.refreshLobbyList(message, { justToPlayer: true });

      // Determine if we are already in a lobby and rejoin it (or the game!)
      for (const loopLobby of utils.lobbies.values()) {
        if (loopLobby.players.find((player: PlayerObj) => player.playerId === message.playerId)) {
          if (loopLobby.started) {
            sendS('nav', message, {
              page: 'gotoGame',
              started: loopLobby.started,
            }, message.playerId);
            return;
          } else {
            sendS('lobby', message, {
              subtype: 'joinedLobby',
              gameId: loopLobby.gameId,
            }, message.playerId);
            return;
          }
        }
      }

      // If we're not rejoining also dump the most recent chat log, up to a reasonable point
      const toSend = utils.lobbyChat.slice(
        Math.max(utils.lobbyChat.length - LOBBY_CHAT_CATCHUP_COUNT, 0),
        utils.lobbyChat.length,
      );
      sendS('lobby', message, { subtype: 'chatCatchup', chats: toSend }, message.playerId);

      // Also give a "demo deck" to the player which will show some of the cards
      sendS('lobby', message, { subtype: 'giveDemoDeck', deck: createDemoDeck() }, message.playerId);
    } else if (message.details.subtype === 'joinLobby') {
      if (
        message.playerId && message.details.gameId && utils.lobbies.get(message.details.gameId)
      ) {
        const lobbyToJoin = utils.lobbies.get(message.details.gameId);
        if (lobbyToJoin.players.length >= 2 || lobbyToJoin.players.find((player) => player.playerId === message.playerId)) {
          // Currently don't need to do anything if the lobby is full
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
          utils.leaveAllLobbies(message, { noRefreshAfter: true });

          lobbyToJoin.players.push({
            playerId: message.playerId,
            playerName: players.get(message.playerId) ?? DEFAULT_PLAYER_NAME,
          });

          // Refresh the lobby list of all viewing parties
          utils.refreshLobbyList(message);

          const toSend = {
            subtype: 'joinedLobby',
            gameId: lobbyToJoin.gameId,
          };

          // Determine if we joined vs AI
          if (lobbyToJoin.players.find((player) => ai.isAI(player.playerId))) {
            toSend['vsAI'] = true;
          }

          sendS('lobby', message, toSend, message.playerId);
        }
      }
    } else if (message.details.subtype === 'leaveLobby') {
      utils.leaveAllLobbies(message);
    } else if (message.details.subtype === 'markReady') {
      const lobbyObj = utils.lobbies.get(message.details.gameId);
      const foundPlayer = lobbyObj?.players.find((player) => player.playerId === message.playerId);
      if (foundPlayer && lobbyObj) {
        foundPlayer.ready = message.details.ready;

        // Rarer code path of the game already being started
        // This specifically would be a person leaving the game, then someone else joining from the lobby
        // In which case we can do a truncated approach to the process
        if (lobbyObj.started) {
          // Set to an open slot
          if (!lobbyObj.gs.player1.playerId) {
            lobbyObj.gs.player1.playerId = foundPlayer.playerId;
          } else if (!lobbyObj.gs.player2.playerId) {
            lobbyObj.gs.player2.playerId = foundPlayer.playerId;
          } else {
            return false;
          }

          sendS('nav', null, {
            page: 'gotoGame',
          }, foundPlayer.playerId);

          return true;
        }

        // If both players are ready start the game
        if (foundPlayer.ready && lobbyObj.players.length >= 2) {
          const opponent = lobbyObj.players.find((player) => player.playerId !== message.playerId);

          if (opponent?.ready || ai.isAI(opponent.playerId)) { // Human opponent is ready or AI is
            // Determine the first player - AI always goes first, otherwise proper randomize
            let playerRoll = utils.randomRange(0, 1);

            if (ai.isAI(opponent.playerId)) {
              playerRoll = 1;
            }

            if (playerRoll === 0) {
              lobbyObj.gs.player1.playerId = foundPlayer.playerId;
              lobbyObj.gs.player2.playerId = opponent.playerId;
            } else {
              lobbyObj.gs.player2.playerId = foundPlayer.playerId;
              lobbyObj.gs.player1.playerId = opponent.playerId;
            }

            sendS('nav', null, {
              page: 'gotoGame',
              isFirst: playerRoll === 0,
            }, message.playerId);
            sendS('nav', null, {
              page: 'gotoGame',
              isFirst: playerRoll === 1,
            }, opponent.playerId);

            // Game is set to start
            lobbyObj.started = true;

            if (!DEBUG_NO_IDLE_TIMEOUT) {
              // Determine if a player is idling too long on their turn
              let errorSent = false;
              lobbyObj.idleCheckInterval = setInterval(() => {
                if (lobbyObj?.gs?.turn?.currentPlayer) {
                  const idleAmount = Date.now() - lobbyObj.gs.turn.interactionTime;

                  if (!errorSent && idleAmount >= IDLE_RULES.warningAfter) {
                    const gsPlayerId = lobbyObj.gs.player1.playerId || lobbyObj.gs.player2.playerId;
                    action.sendError('Player is idle, will kick in 30 seconds', { gsMessage: { playerId: gsPlayerId } });
                    errorSent = true;
                  } else if (errorSent && idleAmount >= IDLE_RULES.kickAfter) {
                    const gsPlayerId = lobbyObj.gs.player1.playerId || lobbyObj.gs.player2.playerId;
                    const kickId = utils.getPlayerIdByNum(lobbyObj.gs.turn.currentPlayer, gsPlayerId);
                    if (kickId) {
                      console.warn('Kicked player for being idle', kickId);
                      action.leaveGame({ playerId: kickId });
                    }
                  }
                } else {
                  // Maintain non-idle state until we have a current player
                  lobbyObj.gs.turn.interactionTime = Date.now();
                }
              }, IDLE_RULES.intervalDelay);
            }
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
    } else if (message.details.subtype === 'testGame') {
      const toSend = { ...message };
      toSend.details.subtype = 'createJoinLobby';
      toSend.details.game = {
        title: ((players.get(message.playerId) ?? '') + ' Lobby vs AI').trim(),
        vsAI: true,
      };

      return receiveServerWebsocketMessage(toSend);
    } else if (message.details.subtype === 'createJoinLobby') {
      if (message.details.game?.title) {
        createGame({ ...message.details.game }, { joinAfter: message });
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

      // Also have the AI join game if we're in a test game
      const aiPlayer = gameObj.players?.find((player) => ai.isAI(player.playerId));
      if (aiPlayer) {
        action.joinGame({
          playerId: aiPlayer.playerId,
          details: {
            player: utils.getOppositePlayerNum(playerNum),
          },
        }, { fromServerRequest: true });
      }
    } else {
      console.error('Received lobby message but unknown subtype=' + message.details.subtype);
    }
    // Non-lobby, in-game messages
  } else {
    if (
      message.type !== 'chat' &&
      message.type !== 'dumpDebug' &&
      (!message.playerId || !utils.hasPlayerDataById(message.playerId))
    ) {
      // TODO Could also key off the getGS(message).gameStarted boolean?
      action.sendError('Invalid player data, join a game first', { gsMessage: message }, message.playerId);
      return;
    }

    console.log('RECEIVE:', message);

    const possibleFunc = action[message.type];
    if (typeof possibleFunc === 'function') {
      possibleFunc(message);
    } else if (typeof abilities[message.type] === 'function') {
      abilities[message.type](message);
    } else {
      action.sendError(`Invalid action ${message.type}`, { gsMessage: message }, message.playerId);
    }
  }
};

const createGame = (gameParams: Partial<GameLobby>, status?: { joinAfter?: any /* Is a WS message */ }) => {
  const newGameId = uuidv4();
  const newGamestate = createGameState(newGameId);
  newGamestate.gameId = newGameId;
  newGamestate.deck = createNewDeck();
  newGamestate.campDeck = createCampDeck();

  const playerList = [];

  if (gameParams['vsAI']) {
    playerList.push({
      playerId: ai.makeAIPlayerId(),
      playerName: 'Simple AI',
    });
  }

  let parsedTimeLimit = 0;
  try {
    parsedTimeLimit = typeof gameParams.timeLimit === 'string'
      ? parseInt(gameParams.timeLimit)
      : (gameParams.timeLimit ?? 0);
  } catch (ignored) {}

  utils.lobbies.set(newGameId, {
    gameId: newGameId,
    title: gameParams.title ?? 'Unnamed Lobby',
    password: gameParams.password,
    observers: {
      allow: gameParams.observers?.allow ?? false,
      seeAll: gameParams.observers?.seeAll ?? false,
    },
    timeLimit: parsedTimeLimit,
    players: playerList,
    gs: newGamestate,
    undoStack: [], // Stack (LIFO) of gs we can undo back to
  });

  if (status?.joinAfter?.playerId) {
    const toSend = { ...status.joinAfter };
    toSend.details.subtype = 'joinLobby';
    toSend.details.gameId = newGameId;
    toSend.details.password = gameParams.password;
    return receiveServerWebsocketMessage(toSend);
  }
};

function getDefaultQuickplayPrefix() {
  const prefix = String(Date.now());
  return prefix.substring(prefix.length - 4);
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
