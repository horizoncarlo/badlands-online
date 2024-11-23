let ui = { // Local state
  playDrawAnimation: false,
  waterCount: 3,
  draggingCard: false,
  repositionOffsetX: 0,
  repositionOffsetY: 0,
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

function repositionEnd(event, el, coords) {
  if (!el) {
    return;
  }
  if (!coords || !Array.isArray(coords) || coords.length < 2) {
    coords = [0, 0];
  }

  // Long winded one liner, but basically limit our left and top to within the window dimensions
  // Also account for where the mouse was on the draggable element when we started (that's coords)
  // And if we're scrolled on the page
  el.style.left = Math.min(document.documentElement.scrollWidth - el.offsetWidth, Math.max(0, event.clientX - coords[0] + window.scrollX)) + 'px';
  el.style.top = Math.min(document.documentElement.scrollHeight - el.offsetHeight, Math.max(0, event.clientY - coords[1] + window.scrollY)) + 'px';
}

function getMyCards() {
  if (gs.who) {
    return gs[gs.who].cards;
  }
  return [];
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
    console.log('Loop Slot', loopSlot, loopSlot.content && loopSlot.content.id && loopSlot.content.id, card.id);
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
      action.playCard({
        card: getMyCards()[foundIndex],
        slot: slot,
      });
    }
  }
}
