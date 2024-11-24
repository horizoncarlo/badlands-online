globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';
globalThis.WS_NORMAL_CLOSE_CODE = 1000;

const gs = { // Game state
  who: null,
  player1: {
    playerId: null,
    waterCount: 3,
    cards: [],
    camps: [],
  },
  player2: {
    playerId: null,
    waterCount: 3,
    cards: [],
    camps: [],
  },
  deck: [
    /* { id, img, damage? } */
  ],
  campDeck: [
    /* Deck that camps are drawn from at the start of the game */
  ],
  slots: [
    /* { index, content } */
  ],
};

const action = {
  joinGame(message) {
    if (onClient) {
      sendC('joinGame', { player: message });
    } else {
      /* TODO TEMPORARY For now it's annoying to check if a player is in our slot, as refreshing our page currently would trigger this
                        Because we don't have proper leaving and rejoining support yet. So for now just count each request as valid...
      const desiredPlayer = message.details.player;
      if (gs[desiredPlayer] && (!gs[desiredPlayer].playerId || gs[desiredPlayer].playerId === message.playerId)) {
        gs[desiredPlayer].playerId = message.playerId;
      }
      else {
        return action.sendError('Invalid join request or someone already playing', message.playerId);
      }
      */
      gs[message.details.player].playerId = message.playerId;

      sendS('setPlayer', message.details, message.playerId);

      // Draw our initial set of camps to choose from
      action.promptCamps(message);
    }
  },

  playCard(message) {
    if (onClient) {
      sendC('playCard', message);
    } else {
      const waterCost = message.details.card.cost || 0;
      if (waterCost > utils.getPlayerDataById(message.playerId).waterCount) {
        action.sendError('Not enough water to play that card', message.playerId);
        return;
      }

      // TODO Check if card is valid to play on the playCard action
      sendS('slot', {
        // TODO Directly send details here instead of copying just some properties out?
        index: message.details.slot.index,
        card: message.details.card,
      });

      action.reduceWater(message, waterCost);
      action.removeCard(message);
    }
  },

  reduceWater(message, overrideCost) {
    if (!onClient) {
      utils.getPlayerDataById(message.playerId).waterCount -= overrideCost || message.details.cost;

      sendS('reduceWater', {
        cost: overrideCost || message.details.cost,
      }, message.playerId);
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
      if (message.details.fromWater) {
        // TODO Slightly inconsistent, the play a card blocks at the UI level and on the server, but drawing only does on the server. Should decide which one we want
        //      Probably just on server as the WS messages are small and fast enough and then we can treat the server as the single source of truth and the client as dumb
        if (2 > utils.getPlayerDataById(message.playerId).waterCount) {
          action.sendError('Not enough water to draw a card', message.playerId);
          return;
        }
        action.reduceWater(message, 2);
      }

      const newCard = gs.deck.shift();
      if (newCard) {
        // TTODO Maintain card state on the server as well, similar to camps (bonus is easy approach for now to persist between refreshes)
        sendS('addCard', { card: newCard, ...message.details }, message.playerId);
      } else {
        action.sendError('No cards left to draw', message.playerId);
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

  promptCamps(message) {
    if (!onClient) {
      let campOptions = utils.getPlayerDataById(message.playerId).camps;
      if (!campOptions || campOptions.length === 0) {
        campOptions = gs.campDeck.splice(0, 6);
        utils.getPlayerDataById(message.playerId).camps = campOptions;
      }

      if (campOptions.length !== 3) {
        sendS('promptCamps', {
          camps: campOptions,
        }, message.playerId);
      }
    }
  },

  doneCamps(message) {
    if (onClient) {
      sendC('doneCamps', {
        camps: message,
      });
    } else {
      // TODO Validate the camps were available choices and there's the proper number
      utils.getPlayerDataById(message.playerId).camps = message.details.camps;

      const totalDrawCount = message.details.camps.reduce((total, camp) => total + camp.drawCount, 0);
      for (let i = 0; i < totalDrawCount; i++) {
        action.drawCard(message);
      }
    }
  },

  sendError(text, playerId) {
    if (!onClient) {
      sendS('error', { text: text }, playerId);
    }
  },
};

const utils = {
  hasPlayerDataById(playerId) {
    if (gs && playerId) {
      return gs.player1.playerId === playerId || gs.player2.playerId === playerId;
    }
    return false;
  },

  getPlayerDataById(playerId) {
    if (gs && playerId) {
      if (gs.player1.playerId === playerId) return gs.player1;
      else if (gs.player2.playerId === playerId) return gs.player2;
    }
    return null;
  },
};

if (onClient) {
  window.action = action;
  window.gs = gs;
  window.utils = utils;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { action, gs, utils };
