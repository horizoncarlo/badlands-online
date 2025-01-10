function showScientistDialog() {
  console.log('Show scientist dialog');
  if (ui.cardData.doneScientist) {
    console.log("And we're marked done on show");
  } else {
    console.log('Not marked done yet');
  }
  document.getElementById('scientistChooserDialog')?.showModal();
}

function hideScientistDialog() {
  console.log('Hide scientist dialog');
  if (ui.cardData.doneScientist) {
    console.log("And we're marked donw");
  }
  document.getElementById('scientistChooserDialog')?.close();
}

function chooseScientistCard(card) {
  console.log('Choose scientist', ui);

  ui.cardData.doneScientist = true;
  hideScientistDialog();

  const chosenCardIndex = ui.cardData.scientistChoices.findIndex((choice) => choice === card);
  abilities.doneScientist({
    details: {
      chosenCardIndex: chosenCardIndex,
      cardOptions: ui.cardData.scientistChoices,
    },
  });
}
