import { abilities } from './abilities.mjs';
import { action } from './actions.mjs';
import { gs } from './gamestate.mjs';
import { codeQueue, utils } from './utils.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';

// Events work similar to abilities (which were implemented first)
// The function can be called twice - once to do any targetting, and the second to apply the effect
const events = {
  // destroy any enemy person
  banish(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        targets.forEach((targetId) => {
          action.destroyCard({ ...message, details: { card: { id: targetId } } });
        });
      } else {
        const opponentNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
        message.validTargets = [
          ...gs[opponentNum].slots.filter((slot) => slot.content ? true : false).map((slot) => String(slot.content.id)),
        ];

        if (message.validTargets?.length) {
          action.targetMode(message, {
            help: 'Select a card to destroy with Banish',
            cursor: 'destroyCard',
            colorType: 'danger',
            hideCancel: true,
          });
        } else {
          throw new Error(MSG_INVALID_TARGETS);
        }
      }
    }
  },

  // damage all opponent camps, then drawCard for each destroyed camp they have
  bombardment(message) {
    const opponentCamps = gs[utils.getOpponentNumById(message.playerId)].camps;
    opponentCamps.forEach((camp) => {
      action.doDamageCard({ ...message, details: { card: { id: camp.id } } });
    });

    const drawCount = opponentCamps.filter((camp) => camp.isDestroyed)?.length;
    if (drawCount > 0) {
      action.drawCard({
        ...message,
        details: {
          multiAnimation: drawCount > 1,
        },
      }, { fromServerRequest: true });
    }
  },

  // each player starting with you destroy all but one of their people
  famine(message) {
    if (!onClient) {
      message.type = 'doneFamine';
      const opponentMessage = { ...message };
      opponentMessage.playerId = utils.getOppositePlayerId(message.playerId);

      codeQueue.add(null, () => events.doneFamine(message));
      codeQueue.add('doneTargets', () => events.doneFamine(opponentMessage));
      codeQueue.add('doneTargets', () => action.wait());
      codeQueue.start({ skipPreprocess: true });
    }
  },

  doneFamine(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        const famineList = utils.getPlayerDataById(message.playerId).slots
          .filter((slot) => slot.content && slot.content.id !== +message.details.targets[0]);
        famineList.forEach((slot) => {
          action.destroyCard({
            playerId: message.playerId,
            details: {
              card: slot.content,
            },
          });
        });
      } else {
        message.validTargets = utils.determineOwnSlotTargets(message);
        if (message.validTargets?.length) {
          action.targetMode(message, {
            help: 'Select your one survivor of Famine (all others will be destroyed)',
            colorType: 'success',
            hideCancel: true,
          });
        } else {
          action.doneTargets(); // This is to fire off the matching event to contine our codeQueue
          action.sendError('Famine does nothing to player'); // TODO Integrate player names
        }
      }
    }
  },

  // rearrange your people, then this turn all opponent cards (including camps) are unprotected
  highGround(message) {
    if (!onClient) {
      utils.universal.highGround = true;

      const playerSlots = utils.getPlayerDataById(message.playerId)?.slots;
      const targets = utils.checkSelectedTargets(message);

      // Swap our two targets from the client
      if (targets?.length === 2) {
        // Repetition is readable!
        const target0SlotIndex = targets[0].startsWith(SLOT_ID_PREFIX)
          ? parseInt(targets[0].substring(SLOT_ID_PREFIX.length))
          : utils.findCardInGame({ id: targets[0] })?.slotIndex;
        const target1SlotIndex = targets[1].startsWith(SLOT_ID_PREFIX)
          ? parseInt(targets[1].substring(SLOT_ID_PREFIX.length))
          : utils.findCardInGame({ id: targets[1] })?.slotIndex;
        const target0Content = structuredClone(playerSlots[target0SlotIndex].content);
        const target1Content = structuredClone(playerSlots[target1SlotIndex].content);

        playerSlots[target0SlotIndex].content = target1Content;
        playerSlots[target1SlotIndex].content = target0Content;

        // Have any card movement with empty slots below fall as normal
        const settleCards = function (slotIndex, slotContent) {
          if (utils.isTopRow(slotIndex)) {
            const slotBelow = playerSlots[utils.indexBelow(slotIndex)];
            if (!slotBelow.content) {
              playerSlots[slotIndex].content = null;
              slotBelow.content = slotContent;
            }
          }
        };
        settleCards(target0SlotIndex, target1Content);
        settleCards(target1SlotIndex, target0Content);

        action.sync();
      }

      // Keep on slamming targetting requests until the user cancels
      let hasPeople = false; // Ensure we even have valid people to rearrange
      message.type = 'highGround';
      message.validTargets = playerSlots.map((slot) => {
        if (slot.content) {
          hasPeople = true;
        }
        return slot.content ? String(slot.content.id) : SLOT_ID_PREFIX + slot.index;
      });

      if (hasPeople && message.validTargets?.length) {
        action.targetMode(message, {
          expectedTargetCount: 2,
          help: 'Select a card to rearrange with High Ground (click Cancel when done)',
        });
      } else {
        action.sendError('High Ground has no valid targets');
      }
    }
  },

  // draw 4 then discard 3 of THOSE drawn cards
  interrogate(message) {
    if (!onClient) {
      for (let i = 0; i < 4; i++) {
        action.drawCard({
          ...message,
          details: {
            ...message.details,
            multiAnimation: true,
          },
        }, { fromServerRequest: true });
      }

      action.sync(message.playerId);

      // Setup our return message, but only include card choices from the pile we just drew
      const abilityMessage = { ...message.details, effectName: message.details.card.abilityEffect, expectedDiscards: 3 };
      const playerCards = gs[utils.getPlayerNumById(message.playerId)].cards;
      abilityMessage['cardChoices'] = playerCards.slice(playerCards.length - 4);
      gs.pendingTargetAction = structuredClone(abilityMessage);
      sendS('useAbility', abilityMessage, message.playerId);
    } else {
      showDiscardDialog(message, { allowWaterSilo: false });
    }
  },

  // destroy all enemies in one column
  napalm(message) {
    abilities.blowUpColumn(message, { isDamageAbility: false });
  },

  // injurePerson ALL people
  radiation(message) {
    if (!onClient) {
      const giveEmTheFallout = [...gs.player1.slots, ...gs.player2.slots];
      giveEmTheFallout.forEach((slot) => {
        if (slot.content) {
          action.doDamageCard({ ...message, details: { card: { id: +slot.content.id } } });
        }
      });
    }
  },

  // injurePerson all unprotected enemy people
  strafe(message) {
    if (!onClient) {
      // Psst Strafe is just the Gunner ability
      abilities.gunner(message);
    }
  },

  // return all people (including punks) to their owners' hands
  truce(message) {
    function performTruceForPlayer(playerId) {
      const playerNum = utils.getPlayerNumById(playerId);
      gs[playerNum].slots.forEach((slot) => {
        if (slot.content) {
          utils.returnCardToHand(playerId, slot.content.id);
        }
      });
    }

    performTruceForPlayer(message.playerId);
    performTruceForPlayer(utils.getOppositePlayerId(message.playerId));

    action.sync();
  },

  // gain 3 punks (or as many free slots as there are)
  uprising(message) {
    if (!onClient) {
      // Determine how many empty slots we have
      const playerData = utils.getPlayerDataById(message.playerId);
      const numPunks = Math.min(3, playerData.slots.filter((slot) => !slot.content).length);

      for (let i = 0; i < numPunks; i++) {
        codeQueue.add(
          i === 0 ? null : 'doneTargets',
          () => utils.fireAbilityOrJunk(message, 'gainPunk'),
        );
      }
      codeQueue.start();
    }
  },
};

if (onClient) {
  window.events = events;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { events };
