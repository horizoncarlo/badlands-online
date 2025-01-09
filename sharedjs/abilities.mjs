import { action } from './actions.mjs';
import { gs } from './gamestate.mjs';
import { utils } from './utils.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';

/**
 * Internal function to centralize handling targetting
 * Returns true if still need to do targetting, false if we had targets and handled them
 * By default calls damageCard, but can pass an optionalFunc string name to use instead (such as destroyCard)
 */
function _needTargets(message, optionalFunc) {
  const targets = utils.checkSelectedTargets(message);
  if (targets?.length) {
    targets.forEach((targetId) => {
      if (typeof optionalFunc === 'string') {
        action[optionalFunc]({ ...message, details: { card: { id: targetId } } });
      } else {
        action.damageCard({ ...message, details: { card: { id: targetId } } });
      }
    });
    return false;
  }
  return true;
}

// Abilities that require targetting or special cases are generally called twice
// Once without targets, when we turn targetMode on, then again after the client has chosen
// On the second call we should apply our effect, such as damageCard from Sniper
const abilities = {
  // destroyCard an unprotected enemy person
  assassin(message) {
    if (!onClient) {
      if (_needTargets(message, 'destroyCard')) {
        // Get a list of valid targets for injurePerson, then when we target destroyCard instead
        const unprotectedPeopleIds = utils.determineValidTargets('injurePerson', message);

        if (unprotectedPeopleIds?.length) {
          message.validTargets = unprotectedPeopleIds;

          action.targetMode(message, {
            help: 'Select an unprotected person to destroy with Assassin',
            cursor: 'destroyCard',
            colorType: 'danger',
          });
        } else {
          throw new Error('No valid targets for card effect');
        }
      }
    }
  },

  // destroyCard to all damaged enemy people
  exterminator(message) {
    if (!onClient) {
      const opponentNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
      const damagedSlots = gs.slots[opponentNum].filter((slot) =>
        slot.content && typeof slot.content.damage === 'number' && slot.content.damage > 0
      );

      if (damagedSlots.length === 0) {
        throw new Error('No valid targets for card effect');
        return;
      }

      damagedSlots.forEach((slot) => {
        action.destroyCard({
          type: message.type,
          playerId: message.playerId,
          details: {
            noSlideDown: true,
            card: slot.content,
          },
        });
      });
    }
  },

  // injurePerson all unprotected enemy people
  gunner(message) {
    if (!onClient) {
      // Get a list of valid targets for injurePerson, instead of targetting these we just injure them all
      const unprotectedPeopleIds = utils.determineValidTargets('injurePerson', message);

      if (unprotectedPeopleIds?.length) {
        unprotectedPeopleIds.forEach((targetId) => {
          action.damageCard({ ...message, details: { card: { id: +targetId } } });
        });
      } else {
        throw new Error('No valid targets for card effect');
      }
    }
  },

  // damageCard unprotected card, if it's a camp, draw a card
  looter(message) {
    // TTODO Looter
  },

  // damageCard an unprotected enemy camp
  pyromaniac(message) {
    if (!onClient) {
      if (_needTargets(message)) {
        // TTODO Move abilities to a proxy/raw like actions, then skip everything if we're onClient = true. THEN also store a bunch of local convenience variables from our utility functions, like playerNum, opponentNum, etc. so we don't have to do long chains like the next line in each function
        const opponentPlayerNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
        const opponentCamps = utils.getPlayerDataById(utils.getPlayerIdByNum(opponentPlayerNum))?.camps;
        const unprotectedCampIds = [];

        if (opponentCamps?.length) {
          for (let i = 0; i < opponentCamps.length; i++) {
            if (!opponentCamps[i].isDestroyed && utils.isColumnEmpty(i, opponentPlayerNum)) {
              unprotectedCampIds.push(String(opponentCamps[i].id));
            }
          }
        }

        if (!unprotectedCampIds?.length) {
          throw new Error('No valid targets for card effect');
        }

        message.validTargets = unprotectedCampIds;

        action.targetMode(message, {
          help: 'Select an unprotected camp to damage with Pyromaniac',
          cursor: 'damageCard',
          colorType: 'danger',
        });
      }
    }
  },

  // discard top 3 cards of the deck, MAY use the junk effect from 1 of them
  scientist(message) {
    // TTODO Scientist
  },

  // damageCard to ANY card
  sniper(message) {
    if (!onClient) {
      if (_needTargets(message)) {
        const opponentNum = utils.getOppositePlayerNum(utils.getPlayerNumById(message.playerId));
        message.validTargets = [
          ...gs.slots[opponentNum].filter((slot) => slot.content ? true : false).map((slot) => String(slot.content.id)),
          ...gs[opponentNum].camps.map((camp) => String(camp.id)),
        ];

        action.targetMode(message, {
          help: 'Select a card to damage with Sniper',
          cursor: 'damageCard',
          colorType: 'danger',
        });
      }
    }
  },
};

if (onClient) {
  window.abilities = abilities;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { abilities };
