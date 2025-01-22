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

  abilities.doneMutant({
    details: {
      chosenAbilities: ui.cardData.mutantChoice,
    },
  });
}
