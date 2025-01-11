let doneScientist = false;

function showScientistDialog() {
  doneScientist = false;
  document.getElementById('scientistChooserDialog')?.showModal();
}

function hideScientistDialog() {
  document.getElementById('scientistChooserDialog')?.close();
}

function chooseScientistCard(card) {
  doneScientist = true;
  hideScientistDialog();

  const chosenCardIndex = ui.cardData.scientistChoices.findIndex((choice) => choice === card);
  abilities.doneScientist({
    details: {
      chosenCardIndex: chosenCardIndex,
      cardOptions: ui.cardData.scientistChoices,
    },
  });
}
