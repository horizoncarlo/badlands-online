const MUTANT_CHOICES = {
  Both: 'Both',
  Damage: 'Damage',
  Restore: 'Restore',
};
let doneMutant = false;

function showMutantDialog() {
  doneMutant = false;
  document.getElementById('mutantChooserDialog')?.showModal();
}

function hideMutantDialog() {
  document.getElementById('mutantChooserDialog')?.close();
}

function chooseMutantAbility() {
  doneMutant = true;
  hideMutantDialog();

  console.log('MUTANT ABIL', ui.cardData.mutantChoice);

  /* TTTODO Handle choosing a mutant ability
  const chosenCardIndex = ui.cardData.scientistChoices.findIndex((choice) => choice === card);
  abilities.doneScientist({
    details: {
      chosenCardIndex: chosenCardIndex,
      cardOptions: ui.cardData.scientistChoices,
    },
  });
  */
}
