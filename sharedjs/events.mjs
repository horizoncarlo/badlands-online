import { abilities } from './abilities.mjs';
import { action } from './actions.mjs';
import { gs } from './gamestate.mjs';
import { utils } from './utils.mjs';

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

        action.targetMode(message, {
          help: 'Select a card to destroy with Banish',
          cursor: 'destroyCard',
          colorType: 'danger',
        });
      }
    }
  },

  // TTODO All the event effects in events.mjs
  // damage all opponent camps, then drawCard for each destroyed camp they have
  bombardment(message) {
  },

  // each player starting with you destroy all but one of their people (...just choose/target survivor?)
  famine(message) {
  },

  // rearrange your people, then this turn all opponent cards (including camps) are unprotected
  highGround(message) {
  },

  // draw 4 then discard 3 of THOSE drawn cards
  interrogate(message) {
  },

  // destroy all enemies in one column (see magnusKarv for column)
  napalm(message) {
  },

  // injurePerson ALL people
  radiation(message) {
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
  },

  // gain 3 punks (or as many free slots as there are)
  uprising(message) {
  },
};

if (onClient) {
  window.events = events;
  (document || window).dispatchEvent(new Event('sharedReady'));
}
export { events };
