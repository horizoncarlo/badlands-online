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
  gs = Alpine.reactive(gs);
  gs.bodyReady = true;

  // TODO These would come from the server over the websocket when drawing the initial hand
  gs.player1.cards.push({ id: 1, img: 'scout.png' });
  gs.player1.cards.push({ id: 2, img: 'sniper.png' });
  gs.player1.cards.push({ id: 3, img: 'wounded_soldier.png' });

  gs.slots = Array.from({ length: 6 }, (_, index) => ({ index: index, content: null })); // For a 3x2 grid

  // TODO Loose card structure?
  // gs.player1.cards.push({
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

    gs.player1.cards.find((card, index) => {
      if (card.id == data) {
        foundIndex = index;
        return true;
      }
    });

    if (foundIndex >= 0) {
      action.playCard({
        card: gs.player1.cards[foundIndex],
        slot: slot,
      });
    }
  }
}
