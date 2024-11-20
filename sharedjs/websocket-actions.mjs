const action = {
  playCard(card, slot) {
    send({
      type: 'playCard',
      details: {
        card: card,
        slot: slot,
      },
    });
  },
};

if (typeof window !== 'undefined') {
  window.action = action;
}

export { action };
