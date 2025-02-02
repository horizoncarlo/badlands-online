import { utils } from '../sharedjs/utils.mjs';

let currentCardId = 0;

const createCampDeck = (): Array<any> => { // TODO Camp typing
  return _shuffleNewDeck([
    { img: 'adrenaline_lab', drawCount: 1 },
    { img: 'arcade', drawCount: 1 },
    { img: 'atomic_garden', drawCount: 1 },
    { img: 'bonfire', drawCount: 1 },
    { img: 'blood_bank', drawCount: 1 },
    { img: 'cannon', drawCount: 1 },
    { img: 'cache', drawCount: 1 },
    { img: 'catapult', drawCount: 0 },
    { img: 'command_post', drawCount: 2 },
    { img: 'construction_yard', drawCount: 2 },
    { img: 'garage', drawCount: 0 },
    { img: 'juggernaut', drawCount: 0 },
    { img: 'labor_camp', drawCount: 1 },
    { img: 'mercenary_camp', drawCount: 0 },
    { img: 'mulcher', drawCount: 0 },
    { img: 'nest_of_spies', drawCount: 1 },
    { img: 'oasis', drawCount: 1 },
    { img: 'obelisk', drawCount: 3 },
    { img: 'omen_clock', drawCount: 1 },
    { img: 'outpost', drawCount: 1 },
    { img: 'parachute_base', drawCount: 1 },
    { img: 'pillbox', drawCount: 1 },
    { img: 'railgun', drawCount: 0 },
    { img: 'reactor', drawCount: 1 },
    { img: 'resonator', drawCount: 1 },
    { img: 'scavenger_camp', drawCount: 1 },
    { img: 'scud_launcher', drawCount: 0 },
    { img: 'supply_depot', drawCount: 2 },
    { img: 'the_octagon', drawCount: 0 },
    { img: 'training_camp', drawCount: 1 },
    { img: 'transplant_lab', drawCount: 2 },
    { img: 'victory_totem', drawCount: 1 },
    { img: 'warehouse', drawCount: 1 },
    { img: 'watchtower', drawCount: 0 },
  ]);
};

const createNewDeck = (): Array<any> => { // TODO Card typing
  // TODO Loose card structure?
  // {
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
  // }
  const dupePeople = [
    { img: 'assassin', cost: 1, junkEffect: 'raid', abilities: [{ cost: 2, abilityEffect: 'assassin' }] },
    { img: 'cult_leader', cost: 1, junkEffect: 'drawCard', abilities: [{ cost: 0, abilityEffect: 'cultLeader' }] },
    { img: 'doomsayer', cost: 1, junkEffect: 'drawCard', abilities: [{ cost: 1, abilityEffect: 'doomsayer' }] },
    { img: 'exterminator', cost: 1, junkEffect: 'drawCard', abilities: [{ cost: 1, abilityEffect: 'exterminator' }] },
    { img: 'gunner', cost: 1, junkEffect: 'restoreCard', abilities: [{ cost: 2, abilityEffect: 'gunner' }] },
    { img: 'holdout', cost: 2, junkEffect: 'raid', abilities: [{ cost: 1, abilityEffect: 'damageCard' }] },
    { img: 'looter', cost: 1, junkEffect: 'gainWater', abilities: [{ cost: 2, abilityEffect: 'looter' }] },
    { img: 'mimic', cost: 1, junkEffect: 'injurePerson', abilities: [{ cost: 0, abilityEffect: 'mimic' }] },
    { img: 'muse', cost: 1, junkEffect: 'injurePerson', abilities: [{ cost: 0, abilityEffect: 'gainWater' }] },
    { img: 'mutant', cost: 1, junkEffect: 'injurePerson', abilities: [{ cost: 0, abilityEffect: 'mutant' }] },
    { img: 'pyromaniac', cost: 1, junkEffect: 'injurePerson', abilities: [{ cost: 1, abilityEffect: 'pyromaniac' }] },
    {
      img: 'rabble_rouser',
      cost: 1,
      junkEffect: 'raid',
      abilities: [{ cost: 1, abilityEffect: 'gainPunk' }, { cost: 1, abilityEffect: 'rabbleRouser' }],
    },
    { img: 'repair_bot', cost: 1, junkEffect: 'injurePerson', abilities: [{ cost: 2, abilityEffect: 'restoreCard' }] },
    { img: 'rescue_team', cost: 1, junkEffect: 'injurePerson', abilities: [{ cost: 0, abilityEffect: 'rescueTeam' }] },
    { img: 'scientist', cost: 1, junkEffect: 'raid', abilities: [{ cost: 1, abilityEffect: 'scientist' }] },
    { img: 'scout', cost: 1, junkEffect: 'gainWater', abilities: [{ cost: 1, abilityEffect: 'raid' }] },
    { img: 'sniper', cost: 1, junkEffect: 'restoreCard', abilities: [{ cost: 2, abilityEffect: 'sniper' }] },
    { img: 'vanguard', cost: 1, junkEffect: 'raid', abilities: [{ cost: 1, abilityEffect: 'vanguard' }] },
    { img: 'vigilante', cost: 1, junkEffect: 'raid', abilities: [{ cost: 1, abilityEffect: 'injurePerson' }] },
    { img: 'wounded_soldier', cost: 1, junkEffect: 'injurePerson', abilities: [{ cost: 1, abilityEffect: 'damageCard' }] },
  ];
  const uniqPeople = [
    { img: 'argo_yesky', cost: 3, abilities: [{ cost: 1, abilityEffect: 'damageCard' }] },
    { img: 'karli_blaze', cost: 3, abilities: [{ cost: 1, abilityEffect: 'damageCard' }] },
    { img: 'magnus_karv', cost: 3, abilities: [{ cost: 2, abilityEffect: 'magnusKarv' }] },
    { img: 'molgur_stang', cost: 4, abilities: [{ cost: 1, abilityEffect: 'molgurStang' }] },
    { img: 'vera_vosh', cost: 3, abilities: [{ cost: 1, abilityEffect: 'injurePerson' }] },
    { img: 'zeto_khan', cost: 3, abilities: [{ cost: 1, abilityEffect: 'zetoKhan' }] },
  ].map((uniq) => {
    uniq['junkEffect'] = 'gainPunk';
    return uniq;
  });
  const dupeEvents = [
    { img: 'banish', cost: 1, startSpace: 1, junkEffect: 'raid', abilityEffect: 'banish' },
    { img: 'bombardment', cost: 4, startSpace: 3, junkEffect: 'restoreCard', abilityEffect: 'bombardment' },
    { img: 'famine', cost: 1, startSpace: 1, junkEffect: 'injurePerson', abilityEffect: 'famine' },
    { img: 'high_ground', cost: 0, startSpace: 1, junkEffect: 'gainWater', abilityEffect: 'highGround' },
    { img: 'interrogate', cost: 1, startSpace: 0, junkEffect: 'gainWater', abilityEffect: 'interrogate' },
    { img: 'napalm', cost: 2, startSpace: 1, junkEffect: 'restoreCard', abilityEffect: 'napalm' },
    { img: 'radiation', cost: 2, startSpace: 1, junkEffect: 'raid', abilityEffect: 'radiation' },
    { img: 'strafe', cost: 2, startSpace: 0, junkEffect: 'drawCard', abilityEffect: 'strafe' },
    { img: 'truce', cost: 2, startSpace: 0, junkEffect: 'injurePerson', abilityEffect: 'truce' },
    { img: 'uprising', cost: 1, startSpace: 2, junkEffect: 'injurePerson', abilityEffect: 'uprising' },
  ];

  const deck = _shuffleNewDeck([
    ...uniqPeople,
    ...structuredClone(dupePeople),
    ...structuredClone(dupePeople),
    ...structuredClone(dupeEvents),
    ...structuredClone(dupeEvents),
  ]);

  return deck;
};

const _shuffleNewDeck = (array) => {
  array = utils.shuffleDeck(array);

  // Assign image extensions to every item and a sequential ID
  array.forEach((card) => {
    currentCardId++;
    card.id = currentCardId;
    card.img += DECK_IMAGE_EXTENSION;
  });
  return array;
};

export { createCampDeck, createNewDeck };
