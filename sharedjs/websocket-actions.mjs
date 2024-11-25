globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';
globalThis.WS_NORMAL_CLOSE_CODE = 1000;

// Game state - server has the single source of truth copy, and each client has their own in-browser copy that the UI reflects
const gs = {
  myPlayerNum: null, // player1 or player2 as a string, only used on client
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
  slots: Array.from({ length: 6 }, (_, index) => ({ index: index, content: null })), // For a 3x2 grid containing { index, content }
};

const action = {
  joinGame(message) {
    if (onClient) {
      sendC('joinGame', { player: message });
    } else {
      /* TODO TEMPORARY For now it's annoying to check if a player already joined for our playerNum, as refreshing our page currently would trigger this
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

      gs.slots[message.details.slot.index].content = message.details.card;
      sendS('slot', {
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
      const cards = utils.getPlayerDataById(message.playerId).cards;
      const foundIndex = cards.findIndex((card) => card.id === message.details.card.id);
      if (foundIndex !== -1) {
        cards.splice(foundIndex, 1);
      }

      action.sync(message.playerId);
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
        utils.getPlayerDataById(message.playerId).cards.push(newCard);
        sendS('addCard', { card: newCard, ...message.details }, message.playerId);
      } else {
        action.sendError('No cards left to draw', message.playerId);
      }
    }
  },

  damageCard(message) {
    if (!onClient) {
      const foundCard = utils.findCardInBoard(message.details.card);
      if (foundCard) {
        foundCard.damage = (foundCard.damage || 0) + message.details.amount;
        if (foundCard.damage >= 2) {
          // TODO Destroy a card
        }
      }

      // TODO Send a separate message to request a damage animation (explosions?) on the client

      action.sync(message.playerId);
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
      } else {
        action.sync(message.playerId);
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

  sync(playerId) {
    /* Dev notes: when to sync vs not
     Syncing is marginally more expensive both in terms of processing and variable allocation here, and Websocket message size going to the client
     But that's also a huge worry about premature optimization given that a realistic game state is still under 5kb
     The best time to sync is if we're doing basically the same calculations on the client and server (which we want to avoid - duplication sucks),
      such as determining which card was damaged
     In most cases after a state change we can just call sync followed by a separate message if the UI needs to trigger some animation (like drawing
      a card or destroying a camp)
     A sync is overkill if we're literally just updating a single property on our client gamestate, such as myPlayerNum, with no additional logic done
    */
    const updatedGs = structuredClone(gs);
    const playerNum = utils.getPlayerNumById(playerId);
    const opponentNum = utils.getOppositePlayerNum(playerNum);

    // Send a minimal version of our current server game state that the UI can apply to itself
    // TODO Could further trim down minor packet size savings like delete slot.content if null, etc.
    delete updatedGs[playerNum].playerId;
    delete updatedGs.myPlayerNum;
    delete updatedGs.campDeck;
    delete updatedGs.deck;

    // Strip out any sensitive information from the opponent
    const { [opponentNum]: opponentData } = updatedGs;
    opponentData.cards = []; // TODO Should put a length here so we can see opponent hand size at least?
    delete opponentData.playerId;
    updatedGs[opponentNum] = opponentData;

    sendS('sync', {
      gs: updatedGs,
    }, playerId);
  },
};

const utils = {
  hasPlayerDataById(playerId) {
    if (gs && playerId) {
      return gs.player1.playerId === playerId || gs.player2.playerId === playerId;
    }
    return false;
  },

  getOppositePlayerNum(playerNum) {
    return playerNum === 'player1' ? 'player2' : 'player1';
  },

  getPlayerNumById(playerId) {
    if (gs && playerId) {
      if (gs.player1.playerId === playerId) return 'player1';
      else if (gs.player2.playerId === playerId) return 'player2';
    }
  },

  getOpponentNumById(playerId) {
    getOppositePlayerNum(utils.getPlayerNumById(playerId));
  },

  getPlayerDataById(playerId) {
    if (gs && playerId) {
      if (gs.player1.playerId === playerId) return gs.player1;
      else if (gs.player2.playerId === playerId) return gs.player2;
    }
    return null;
  },

  findCardInBoard(card) {
    const foundIndex = gs.slots.findIndex((loopSlot) => {
      return loopSlot.content && loopSlot.content.id && loopSlot.content.id === card.id;
    });
    if (foundIndex !== -1) {
      return gs.slots[foundIndex].content;
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
