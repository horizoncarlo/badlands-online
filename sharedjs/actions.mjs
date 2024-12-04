import { gs } from './gamestate.mjs';
import { utils } from './utils.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';

const FAST_AND_LOOSE = true; // Debugging flag to avoid a few checks to make it easier to test the main game logic. Such as can start your turn without an opponent present

const rawAction = {
  joinGame(message) {
    if (onClient) {
      sendC('joinGame', message);
    } else {
      /* TODO TEMPORARY For now it's annoying to check if a player already joined for our playerNum, as refreshing our page currently would trigger this
                        Because we don't have proper leaving and rejoining support yet. So for now just count each request as valid... */
      if (!FAST_AND_LOOSE) {
        const desiredPlayer = message.details.player;
        if (gs[desiredPlayer] && (!gs[desiredPlayer].playerId || gs[desiredPlayer].playerId === message.playerId)) {
          gs[desiredPlayer].playerId = message.playerId;
        } else {
          return action.sendError('Invalid join request or someone already playing', message.playerId);
        }
      }

      gs[message.details.player].playerId = message.playerId;

      sendS('setPlayer', message.details, message.playerId);

      // Draw our initial set of camps to choose from
      action.sync(message.playerId);
      action.promptCamps(message);
    }
  },

  startTurn(message) {
    if (onClient) {
      sendC('startTurn');
    } else {
      // Don't allow starting the game until an opponent is present
      if (!FAST_AND_LOOSE) {
        if (!gs.player1.playerId || !gs.player2.playerId) {
          action.sendError('Cannot start the turn, no opponent yet', message.playerId);
          return;
        }
      }

      const nextPlayerNum = utils.getPlayerNumById(message.playerId);
      gs[nextPlayerNum].waterCount = 3;
      gs.turn[nextPlayerNum].turnCount++;
      gs.turn.currentPlayer = nextPlayerNum;

      action.drawCard(message, { fromServerRequest: true });

      action.sync(); // Sync to update turn status
    }
  },

  endTurn(message) {
    if (onClient) {
      sendC('endTurn');
    } else {
      gs.turn.currentPlayer = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
      action.startTurn({
        playerId: utils.getPlayerIdByNum(gs.turn.currentPlayer),
      });
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

      gs.slots[utils.getPlayerNumById(message.playerId)][message.details.slot.index].content = message.details.card;
      sendS('slot', {
        playerNum: utils.getPlayerNumById(message.playerId),
        index: message.details.slot.index,
        card: message.details.card,
      });

      action.reduceWater(message, waterCost);
      action.removeCard(message);
    }
  },

  useCard(message) {
    if (onClient) {
      sendC('useCard', message);
    } else {
      // TODO Deal with trying to use a card ability - check if card is not ready, reduce water cost if possible, mark unready, request client targets with a valid list of targets sent by the server
    }
  },

  gainWater(message) {
    if (!onClient) {
      utils.getPlayerDataById(message.playerId).waterCount += 1;
      sendS('gainWater', {}, message.playerId);
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

  drawCard(message, params) { // params has params.fromServerRequest boolean
    if (onClient) {
      sendC('drawCard', message);
    } else {
      if (!params?.fromServerRequest && !utils.isPlayersTurn(message.playerId)) {
        return;
      }

      if (message.details?.fromWater) {
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

        const newMessage = {
          card: newCard,
          ...message.details,
        };
        if (message.details?.fromWater || params?.fromServerRequest) {
          newMessage.showAnimation = true;
        }

        sendS('addCard', newMessage, message.playerId);
      } else {
        action.sendError('No cards left to draw', message.playerId);
      }
    }
  },

  junkCard(message) {
    console.log(`received junkCard with message=${JSON.stringify(message)}`);
    if (onClient) {
      sendC('junkCard', message);
    } else {
      // TODO: Validate

      // damage
      // TTODO Note there are no current cards that have straight pure Damage as a junk effect

      // injure
      // TTODO Do injure person junk effect first
      // action.injurePerson(message); // Done, just needs target and damage amount

      const junkEffect = 'injurePerson'; //message?.details?.card?.junkEffect; // TODO
      if (typeof action[junkEffect] === 'function') {
        action[junkEffect](message, junkEffect === 'drawCard' ? true : undefined);
      } else {
        action.sendError(`Invalid junk effect ${junkEffect}`, message.playerId);
      }

      // TODO
      /*if (hasValidTargets) {
        action.removeCard(message);
      } else {
        action.sendError('No valid targets for that Junk effect', message.playerId);
      }*/

      action.sync(); // TODO: Remove - each sub-action should handle it's own updates
    }
  },

  gainPunk(message) {
    if (!onClient) {
      // TODO draw card from top face down, select target
    }
  },

  raid(message) {
    if (!onClient) {
      // TODO insert or advance raiders
    }
  },

  injurePerson(message) {
    if (!onClient) {
      if (!message.details.target) {
        action.targetMode({
          ...message,
          validTargets: utils.determineValidTargets(),
        });
      } else {
        action.damageCard({ ...message, damage: 1 });
      }
    }
  },

  damageCard(message) {
    if (!onClient) {
      const foundCard = utils.findCardInSlots(message.details.card);
      if (foundCard) {
        foundCard.damage = (foundCard.damage ?? 0) + (message.details.amount ?? 1);
        if (foundCard.damage >= 2) {
          // TODO Destroy a card
        }
      }

      // TODO Send a separate message to request for injure and damage animations (explosions?) on the client

      action.sync();
    }
  },

  restoreCard(message) {
    if (!onClient) {
      const foundCard = utils.findCardInSlots(message.details.card);
      if (foundCard && typeof foundCard.damage === 'number') {
        foundCard.damage = Math.min(0, foundCard.damage - 1);

        action.sync();
      }
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
      sendC('doneCamps', message);
    } else {
      // TODO Validate the camps were available choices and there's the proper number
      const playerData = utils.getPlayerDataById(message.playerId);
      playerData.camps = message.details.camps;
      playerData.chosenCamps = true;

      const totalDrawCount = message.details.camps.reduce((total, camp) => total + camp.drawCount, 0);
      for (let i = 0; i < totalDrawCount; i++) {
        action.drawCard({
          ...message,
          details: {
            multiAnimation: totalDrawCount > 1,
          },
        }, { fromServerRequest: true });
      }

      action.sync();
    }
  },

  sendError(text, playerId) {
    if (!onClient) {
      sendS('error', { text: text }, playerId);
    }
  },

  chat(message) {
    if (onClient) {
      sendC('chat', message);
    } else {
      // TODO Don't blindly append chat messages - validate first
      // TODO Have the concept of a System level message too, maybe special formatting on the client
      const text = utils.getPlayerNumById(message.playerId) + ': ' + message.details.text;
      gs.chat.push(text);
      sendS('chat', { text: text });
    }
  },

  targetMode(message) {
    if (!onClient) {
      sendS('targetMode', message);
    }
  },

  sync(playerIdOrNullForBoth) {
    /* Dev notes: when to sync vs not
     Syncing is marginally more expensive both in terms of processing and variable allocation here, and Websocket message size going to the client
     But that's also a huge worry about premature optimization given that a realistic game state is still under 5kb
     The best time to sync is if we're doing basically the same calculations on the client and server (which we want to avoid - duplication sucks),
      such as determining which card was damaged
     In most cases after a state change we can just call sync followed by a separate message if the UI needs to trigger some animation (like drawing
      a card or destroying a camp)
     A sync is overkill if we're literally just updating a single property on our client gamestate, such as myPlayerNum, with no additional logic done
    */
    // TODO Could just call sync as a post-process feature of the actionHandler instead of scattering it throughout the app?

    function internalSync(playerNum) {
      const currentPlayerId = utils.getPlayerIdByNum(playerNum);
      if (!currentPlayerId) {
        return;
      }

      const updatedGs = structuredClone(gs);
      const opponentNum = utils.getOppositePlayerNum(playerNum);

      // Send a minimal version of our current server game state that the UI can apply to itself
      // TODO Could further trim down minor packet size savings like delete slot.content if null, etc.
      delete updatedGs[playerNum].playerId;
      delete updatedGs.myPlayerNum;
      delete updatedGs.opponentPlayerNum;
      delete updatedGs.campDeck;
      delete updatedGs.deck;

      // TODO Should have an option to sync with or without Chat Log as that could add a TON of data depending on the size

      // Strip out any sensitive information from the opponent
      const { [opponentNum]: opponentData } = updatedGs;
      opponentData.cards = Array.from({ length: opponentData.cards.length }, (_, index) => index * -1); // Just fill with numbered junk, but negative in case this ever gets looped over looking for IDs
      if (!opponentData.chosenCamps) {
        opponentData.camps = [];
      }
      delete opponentData.playerId;
      updatedGs[opponentNum] = opponentData;

      // TODO Need a way to send a sync to both players, such as when playerId that's passed in is null
      sendS('sync', {
        gs: updatedGs,
      }, currentPlayerId);
    }

    // Request a sync to both if no
    if (!playerIdOrNullForBoth) {
      internalSync('player1');
      internalSync('player2');
    } else {
      internalSync(utils.getPlayerNumById(playerIdOrNullForBoth));
    }
  },
};

// Certain actions can be done outside of our turn, which means skipping the preprocessor
rawAction.joinGame.skipPreprocess = true;
rawAction.promptCamps.skipPreprocess = true;
rawAction.doneCamps.skipPreprocess = true;
rawAction.startTurn.skipPreprocess = true;
rawAction.drawCard.skipPreprocess = true;
rawAction.sendError.skipPreprocess = true;
rawAction.chat.skipPreprocess = true;
rawAction.sync.skipPreprocess = true;

const actionHandler = {
  get(target, prop) {
    const originalMethod = target[prop];
    if (typeof originalMethod === 'function') {
      return function (...args) {
        if (originalMethod?.skipPreprocess) {
          return originalMethod.apply(this, args);
        }

        // TODO Although cool this proxy approach is probably overengineered given how many messages we skipPreprocess on anyway
        //      Likely can just do on a function by function basis in actions (see drawCard for an example of a manual isPlayersTurn check)
        //      Or just in main.ts itself as the Websocket messages come in (ignore or process them accordingly)
        //      Reminder that the entire intent was to have server side protection from out of turn client actions like playing a card
        // PRE PROCESS hook for all actions
        if (!onClient && !utils.isPlayersTurn(args[0].playerId)) {
          console.error(`Ignored action [${originalMethod.name}] out of turn order by playerId=${args[0].playerId}`);
          return;
        }

        return originalMethod.apply(this, args);
      };
    }

    return originalMethod;
  },
};

const action = new Proxy(rawAction, actionHandler);

if (onClient) {
  window.action = action;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { action };
