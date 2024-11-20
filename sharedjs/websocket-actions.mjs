globalThis.onClient = typeof window !== 'undefined';

const action = {
  handlePlayCard(message) {
    if (onClient) {
      send({
        type: 'playCard',
        details: message,
      });
    } else {
      // TODO Check if card is valid to play
      send({
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
    if (onClient) {
    } else {
      send({
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
