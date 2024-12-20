globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';

// Game state - server has the single source of truth copy, and each client has their own in-browser copy that the UI reflects
// NOTE Any drastic changes here should be double checked in the `action.sync` function to ensure we're not sending huge or private data, and in websocket.js on the client to ensure we handle the receive
const gs = {
  myPlayerNum: null, // player1 or player2 as a string, only used on client
  opponentPlayerNum: null,
  player1: {
    playerId: null,
    waterCount: 3,
    cards: [],
    camps: [],
    doneCamps: false,
  },
  player2: {
    playerId: null,
    waterCount: 3,
    cards: [],
    camps: [],
    doneCamps: false,
  },
  turn: {
    currentPlayer: null, // player1 or player2
    player1: {
      turnCount: 0,
    },
    player2: {
      turnCount: 0,
    },
  },
  slots: {
    player1: Array.from({ length: 6 }, (_, index) => ({ index: index, content: null })), // For a 3x2 grid containing { index, content }
    player2: Array.from({ length: 6 }, (_, index) => ({ index: index, content: null })),
  },
  deck: [
    /* { id, img, damage? } */
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
  chat: [],
  slotIdPrefix: 'slot_',
};

if (onClient) {
  window.gs = gs;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { gs };
