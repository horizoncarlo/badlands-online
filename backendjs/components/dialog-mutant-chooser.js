const MUTANT_CHOICES = {
  Both: 'Both',
  Damage: 'Damage',
  Patch: 'Patch',
};
let doneMutant = false;

function showMutantDialog(img) {
  // Dynamically set the image instead of hardcoded in the HTML as we don't want to needlessly load beforehand
  if (!ui.componentData.mutantCardImage && img) {
    ui.componentData.mutantCardImage = img;
  }
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
      chosenAbilities: ui.componentData.mutantChoice,
    },
  });
}
