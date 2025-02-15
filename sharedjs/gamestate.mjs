import { utils } from './utils.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';

// Game state - server has the single source of truth copy per lobby, and each client has their own in-browser copy that the UI reflects
// NOTE Any drastic changes here should be double checked in the `action.sync` function to ensure we're not sending huge or private data, and in websocket.js on the client to ensure we handle the receive
export function createGameState(gameId) {
  return {
    gameId: gameId,
    gameStarted: false,
    myPlayerNum: null, // player1 or player2 as a string, only used on client
    opponentPlayerNum: null,
    player1: {
      playerId: null,
      waterCount: 3,
      hasWaterSilo: false,
      cards: [],
      camps: [],
      doneCamps: false,
      slots: Array.from({ length: 6 }, (_, index) => ({ index: index, content: null })), // For a 3x2 grid containing { index, content }
      events: Array.from({ length: 4 }), // For a 1-based 3 slot event queue { index, content: cardObj, with .startSpace (aka isEvent) }
    },
    player2: {
      playerId: null,
      waterCount: 3,
      hasWaterSilo: false,
      cards: [],
      camps: [],
      doneCamps: false,
      slots: Array.from({ length: 6 }, (_, index) => ({ index: index, content: null })),
      events: Array.from({ length: 4 }),
    },
    turn: {
      currentPlayer: null, // player1 or player2
      startTime: null, // Date.now when the current turn started, to detect idle or long turns
      interactionTime: null,
      player1: {
        turnCount: 0,
      },
      player2: {
        turnCount: 0,
      },
    },
    deck: [
      /* cardObj: { id, img, damage, unReady, unReadyCost (water tokens to show on UI, such as from play or ability cost) } */
    ],
    discard: [
      /* { same as ... deck} */
    ],
    deckReshuffleCount: 0,
    deckCount: -1,
    discardCount: -1,
    punks: [
      /* Full cardObj only on server, to map client Punks to actual cards by ID */
    ],
    campDeck: [
      /*
    Deck that camps are drawn from at the start of the game
    Format is { id, img, drawCount, selected: boolean, damage: number | undefined, isDestroyed: true | undefined },
    */
    ],
    // TODO Can we leverage the 'universal' concept for Trait (always on) flags? Should we segment by "endOfTurn" or similar and clear flags as needed in those actions?
    universal: {
      // TODO Show universal effects somewhere on the UI - such as High Ground being in effect
      highGround: false, // Whether High Ground was played this turn or not
    },
    chat: [],
    syncBatch: new Map(), // key=playerNum (or null for both), value=setTimeout ref
    pendingTargetAction: null, // Clone of a message that initiated a targetMode
    pendingTargetCancellable: true, // Determine if we allow cancelTarget to the pendingTargetAction
  };
}

const getGS = (messageOrPlayerId) => {
  if (!onClient) {
    return utils.getLobbyByPlayerId(messageOrPlayerId)?.gs;
  } else {
    return gs;
  }
};

if (onClient) {
  window.gs = createGameState();
  window.getGS = getGS;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { getGS };
