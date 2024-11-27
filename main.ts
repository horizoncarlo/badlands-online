import { serveFile } from 'jsr:@std/http/file-server';
import { v4 as uuidv4 } from 'npm:uuid'; // Couldn't use Deno UUID because v4 just recommends crypto.randomUUID, which is only in HTTPS envs
import { startScraper } from './backendjs/scraper.ts';
import { action } from './sharedjs/actions.mjs';
import { gs } from './sharedjs/gamestate.mjs';
import { utils } from './sharedjs/utils.mjs';

type WebSocketDetails = {
  playerId: string;
  socket: WebSocket;
};

const IS_LIVE = Deno.env.get('isLive');
const DECK_IMAGE_EXTENSION = '.png'; // In case we want smaller filesize JPGs in the future
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

const createCampDeck = (): Array<any> => { // TODO Camp typing
  return shuffleNewDeck([
    { img: 'adrenaline_lab', drawCount: 1 },
    { img: 'arcade', drawCount: 1 },
    { img: 'atomic_garden', drawCount: 1 },
    { img: 'bonfire', drawCount: 1 },
    { img: 'blood_bank', drawCount: 1 },
    { img: 'cannon', drawCount: 1 },
    { img: 'cache', drawCount: 1 },
    { img: 'catapult', drawCount: 0 },
    { img: 'command_post', drawCount: 2 },
    { img: 'construction_yard', drawCount: 2 },
    { img: 'garage', drawCount: 0 },
    { img: 'juggernaut', drawCount: 0 },
    { img: 'labor_camp', drawCount: 1 },
    { img: 'mercenary_camp', drawCount: 0 },
    { img: 'mulcher', drawCount: 0 },
    { img: 'nest_of_spies', drawCount: 1 },
    { img: 'oasis', drawCount: 1 },
    { img: 'obelisk', drawCount: 3 },
    { img: 'omen_clock', drawCount: 1 },
    { img: 'outpost', drawCount: 1 },
    { img: 'parachute_base', drawCount: 1 },
    { img: 'pillbox', drawCount: 1 },
    { img: 'railgun', drawCount: 0 },
    { img: 'reactor', drawCount: 1 },
    { img: 'resonator', drawCount: 1 },
    { img: 'scavenger_camp', drawCount: 1 },
    { img: 'scud_launcher', drawCount: 0 },
    { img: 'supply_depot', drawCount: 2 },
    { img: 'the_octagon', drawCount: 0 },
    { img: 'training_camp', drawCount: 1 },
    { img: 'transplant_lab', drawCount: 2 },
    { img: 'victory_totem', drawCount: 1 },
    { img: 'warehouse', drawCount: 1 },
    { img: 'watchtower', drawCount: 0 },
  ]);
};

const createNewDeck = (): Array<any> => { // TODO Card typing
  // TODO Loose card structure?
  // {
  //   id: 1,
  //   name: "Wounded Soldier",
  //   img: "Wounded-Soldier.png",
  //   cost: 1,
  //   abilities: [
  //     {
  //       cost: 1,
  //       symbol: "Damage",
  //     }
  //   ],
  //   traits: [
  //     {
  //       text: "When this card enters play, [draw]. Then, damage [damage] this card"
  //     }
  //   ]
  // }
  // TODO Populate the deck properly
  const dupePeople = [
    { img: 'assassin', cost: 1, junkEffect: 'raid' },
    { img: 'cult_leader', cost: 1, junkEffect: 'draw' },
    { img: 'doomsayer', cost: 1, junkEffect: 'draw' },
    { img: 'exterminator', cost: 1, junkEffect: 'draw' },
    { img: 'gunner', cost: 1, junkEffect: 'restore' },
    { img: 'holdout', cost: 2, junkEffect: 'raid' },
    { img: 'looter', cost: 1, junkEffect: 'water' },
    { img: 'mimic', cost: 1, junkEffect: 'injure' },
    { img: 'muse', cost: 1, junkEffect: 'water' },
    { img: 'mutant', cost: 1, junkEffect: 'injure' },
    { img: 'pyromaniac', cost: 1, junkEffect: 'injure' },
    { img: 'rabble_rouser', cost: 1, junkEffect: 'raid' },
    { img: 'repair_bot', cost: 1, junkEffect: 'injure' },
    { img: 'rescue_team', cost: 1, junkEffect: 'injure' },
    { img: 'scientist', cost: 1, junkEffect: 'raid' },
    { img: 'scout', cost: 1, junkEffect: 'water' },
    { img: 'sniper', cost: 1, junkEffect: 'restore' },
    { img: 'vanguard', cost: 1, junkEffect: 'raid' },
    { img: 'vigilante', cost: 1, junkEffect: 'raid' },
    { img: 'wounded_soldier', cost: 1, junkEffect: 'injure' },
  ];
  const uniqPeople = [
    { img: 'argo_yesky', cost: 3 },
    { img: 'karli_blaze', cost: 3 },
    { img: 'magnus_karv', cost: 3 },
    { img: 'molgur_stang', cost: 4 },
    { img: 'vera_vosh', cost: 3 },
    { img: 'zeto_khan', cost: 3 },
  ].map((uniq) => {
    uniq['junkEffect'] = 'gainPunk';
    return uniq;
  });
  // TODO For now keep events out for simplicity
  const dupeEvents = [];
  // const dupeEvents = [
  //   { img: 'banish', cost: 1 },
  //   { img: 'bombardment', cost: 4 },
  //   { img: 'famine', cost: 1 },
  //   { img: 'high_ground', cost: 0 },
  //   { img: 'interrogate', cost: 1 },
  //   { img: 'napalm', cost: 2 },
  //   { img: 'radiation', cost: 2 },
  //   { img: 'strafe', cost: 2 },
  //   { img: 'truce', cost: 2 },
  //   { img: 'uprising', cost: 1 },
  // ];

  const deck = shuffleNewDeck([
    ...uniqPeople,
    ...structuredClone(dupePeople),
    ...structuredClone(dupePeople),
    ...structuredClone(dupeEvents),
    ...structuredClone(dupeEvents),
  ]);

  return deck;
};

function shuffleNewDeck(array) {
  array = shuffleDeck(array);

  // Assign image extensions to every item and a random ID
  array.forEach((card, index) => {
    card.img += DECK_IMAGE_EXTENSION;
    card.id = index + 1; // Do 1-based IDs
  });
  return array;
}

function shuffleDeck(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

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
