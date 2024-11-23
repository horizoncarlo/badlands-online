globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';
globalThis.WS_NORMAL_CLOSE_CODE = 1000;

const gs = { // Game state
  who: null,
  player1: {
    cards: [],
  },
  player2: {
    cards: [],
  },
  deck: [
    /* { id, img, damage? } */
  ],
  slots: [
    /* { index, content } */
  ],
  camps: [
    /* campObj */
  ],
};

const action = {
  joinGame(message) {
    if (onClient) {
      sendC('joinGame', { player: message });
    } else {
      sendS('setPlayer', message.details);

      // Draw initial hand
      action.drawCard(message);
      action.drawCard(message);
      action.drawCard(message);
    }
  },

  playCard(message) {
    if (onClient) {
      sendC('playCard', message);
    } else {
      // TODO Check if card is valid to play on the playCard action
      sendS('slot', {
        // TODO Directly send details here instead of copying just some properties out?
        index: message.details.slot.index,
        card: message.details.card,
      });
      action.removeCard(message);
    }
  },

  removeCard(message) {
    if (!onClient) {
      sendS('removeCard', { card: message.details.card }, message.playerId);
    }
  },

  drawCard(message) {
    if (onClient) {
      sendC('drawCard', message);
    } else {
      const newCard = gs.deck.shift();
      if (newCard) {
        sendS('addCard', { card: newCard, ...message.details }, message.playerId);
      } else {
        sendS('error', { text: 'No cards left to draw' }, message.playerId);
      }
    }
  },

  damageCard(message) {
    if (!onClient) {
      sendS('damageCard', {
        card: {
          id: message.card.id,
        },
        amount: 1,
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
