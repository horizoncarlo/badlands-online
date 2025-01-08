import { action } from './actions.mjs';
import { gs } from './gamestate.mjs';
import { utils } from './utils.mjs';

globalThis.onClient = typeof window !== 'undefined' && typeof Deno === 'undefined';

// Abilities that require targetting or special cases are generally called twice
// Once without targets, when we turn targetMode on, then again after the client has chosen
// On the second call we should apply our effect, such as damageCard from Sniper
const abilities = {
  // destroyCard an unprotected enemy person
  assassin(message) {
    // TTODO Assassin
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
    // TTODO Gunner
  },

  // damageCard unprotected, if it's a camp, draw a card
  looter(message) {
    // TTODO Looter
  },

  // damageCard an unprotected enemy camp
  pyromaniac(message) {
    // TTODO Pyromaniac
  },

  // discard top 3 cards of the deck, MAY use the junk effect from 1 of them
  scientist(message) {
    // TTODO Scientist
  },

  // damageCard to ANY card
  sniper(message) {
    if (!onClient) {
      const targets = utils.checkSelectedTargets(message);
      if (targets?.length) {
        targets.forEach((targetId) => {
          action.damageCard({ ...message, details: { card: { id: targetId } } });
        });
      } else {
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
