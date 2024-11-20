globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';
globalThis.WS_NORMAL_CLOSE_CODE = 1000;

const action = {
  handlePlayCard(message) {
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
};

if (onClient) {
  window.action = action;
}
export { action };
