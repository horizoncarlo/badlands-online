let ui = { // Local state
  inGame: false,
  playDrawAnimation: false,
  draggingCard: false,
  repositionOffsetX: 0,
  repositionOffsetY: 0,
  waterTokenEles: [],
};

function init() {
  let alpineReady = false;
  let sharedReady = false;

  // Listen for Alpine to be done setting up
  document.addEventListener('alpine:initialized', () => {
    alpineReady = true;
    checkInit(alpineReady && sharedReady);
  });

  document.addEventListener('sharedReady', (e) => {
    sharedReady = true;
    checkInit(alpineReady && sharedReady);
  });
}
init();

function checkInit(status) {
  if (status) {
    alpineInit();
  }
}

function alpineInit() {
  ui = Alpine.reactive(ui);
  gs = Alpine.reactive(gs);
  gs.bodyReady = true;
  gs.slots = Array.from({ length: 6 }, (_, index) => ({ index: index, content: null })); // For a 3x2 grid
}

function repositionStart(event) {
  ui.repositionOffsetX = event.offsetX;
  ui.repositionOffsetY = event.offsetY;
}

function repositionEnd(event, ele, coords) {
  if (!ele) {
    return;
  }
  if (!coords || !Array.isArray(coords) || coords.length < 2) {
    coords = [0, 0];
  }

  // Long winded one liner, but basically limit our left and top to within the window dimensions
  // Also account for where the mouse was on the draggable element when we started (that's coords)
  // And if we're scrolled on the page
  // TODO Should use a global `ui` var for z-index that increases and applies to the dragged element, so we can nautrally layer them with last dragged on top
  ele.style.left = Math.min(
    document.documentElement.scrollWidth - ele.offsetWidth,
    Math.max(0, event.clientX - coords[0] + window.scrollX),
  ) + 'px';
  ele.style.top = Math.min(
    document.documentElement.scrollHeight - ele.offsetHeight,
    Math.max(0, event.clientY - coords[1] + window.scrollY),
  ) + 'px';
}

function getMyCards() {
  return getPlayerData()?.cards || [];
}

function getPlayerData() {
  if (gs.who) {
    return gs[gs.who];
  }
  return null;
}

function findCardInHand(card) {
  const foundIndex = getMyCards().findIndex((loopCard) => loopCard.id === card.id);
  if (foundIndex !== -1) {
    return getMyCards()[foundIndex];
  }
  return null;
}

function findCardInBoard(card) {
  const foundIndex = gs.slots.findIndex((loopSlot) => {
    return loopSlot.content && loopSlot.content.id && loopSlot.content.id === card.id;
  });
  if (foundIndex !== -1) {
    return gs.slots[foundIndex].content;
  }
  return null;
}

function findCardInGame(card) {
  return findCardInHand(card) || findCardInBoard(card) || null;
}

function showWaterCost(cost) {
  if (cost > getPlayerData().waterCount) {
    console.error('Not enough water for desired action');
    return;
  }

  for (let i = 0; i < cost; i++) {
    ui.waterTokenEles[i]?.classList.add('water-token-cost');
  }
}

function hideWaterCost() {
  ui.waterTokenEles.forEach((water) => {
    water?.classList.remove('water-token-cost');
  });
}

function dropCardInSlot(event, slot) {
  const data = event?.dataTransfer?.getData('text/plain');
  if (data) {
    let foundIndex = -1;

    if (slot.content) {
      console.error('Card already here');
      return false;
    }

    getMyCards().find((card, index) => {
      if (card.id == data) {
        foundIndex = index;
        return true;
      }
    });

    if (foundIndex >= 0) {
      if (getMyCards()[foundIndex].cost > getPlayerData().waterCount) {
        // TODO Proper error component or logging - maybe shake the water token wrapper panel
        console.error('Not enough water to play that card');
        return;
      }

      action.playCard({
        card: getMyCards()[foundIndex],
        slot: slot,
      });
    }
  }
}
