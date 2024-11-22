globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';
globalThis.WS_NORMAL_CLOSE_CODE = 1000;

const gs = { // Game state
  player1: {
    cards: [],
  },
  player2: {
    cards: [],
  },
  deck: [
    /* cardObj */
  ],
  slots: [
    /* { index, content } */
  ],
  camps: [
    /* campObj */
  ],
};

const action = {
  playCard(message) {
    if (onClient) {
      sendC({
        type: 'playCard',
        details: message,
      });
    } else {
      // TODO Check if card is valid to play
      sendS({
        type: 'slot',
        details: { // TODO Directly send details here instead of copying just some properties out?
          index: message.details.slot.index,
          card: message.details.card,
        },
      });
      action.removeCard(message);
    }
  },

  removeCard(message) {
    if (!onClient) {
      sendS({
        type: 'removeCard',
        details: {
          card: message.details.card,
        },
      }, message.playerId);
    }
  },

  drawCard(message) {
    if (onClient) {
      sendC({
        type: 'drawCard',
        details: {
          // TODO Probably pass if we're using water or initial draw or what?
        },
      });
    } else {
      sendS({
        type: 'addCard',
        details: {
          card: message.card,
        },
      });
    }
  },
};

if (onClient) {
  window.action = action;
  window.gs = gs;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { action, gs };
