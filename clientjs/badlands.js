let state = {
  bodyReady: false,
  slots: [
    /* { index, content } */
  ],
  camps: [
    /* campObj */
  ],
  myCards: [
    /* cardObj */
  ],
};

function init() {
  // Listen for Alpine to be done setting up
  document.addEventListener('alpine:initialized', () => {
    alpineInit();
  });
}
init();

function alpineInit() {
  state = Alpine.reactive(state);

  // TODO These would come from the server over the websocket when drawing the initial hand
  state.myCards.push({ id: 1, img: 'scout.png' });
  state.myCards.push({ id: 2, img: 'sniper.png' });
  state.myCards.push({ id: 3, img: 'wounded_soldier.png' });

  state.slots = Array.from({ length: 6 }, (_, index) => ({ index: index, content: null })); // For a 3x2 grid

  // TODO Loose card structure?
  // state.myCards.push({
  //   id: 1,
  //   name: "Wounded Soldier",
  //   img: "Wounded-Soldier.png",
  //   cost: 1,
  //   abilities: [
  //     {
  //       cost: 1,
  //       symbol: "Damage",
  //     }
  //   ],
  //   traits: [
  //     {
  //       text: "When this card enters play, [draw]. Then, damage [damage] this card"
  //     }
  //   ]
  // })
}

function dropCardInSlot(event, slot) {
  const data = event?.dataTransfer?.getData('text/plain');
  if (data) {
    let foundIndex = -1;

    if (slot.content) {
      console.error('Card already here');
      return false;
    }

    state.myCards.find((card, index) => {
      if (card.id === data) {
        foundIndex = index;
        return true;
      }
    });

    if (foundIndex >= 0) {
      action.handlePlayCard({
        card: state.myCards[foundIndex],
        slot: slot,
      });
    }
  }
}
