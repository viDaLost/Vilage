import { getCapital } from './buildings.js';
import * as THREE from 'three';
import { rand } from '../utils/helpers.js';
import { spawnUnit } from './units.js';

const FACTIONS = {
  clans: { name: 'Степные кланы', color: 0x8a2318, units: ['raider', 'raider', 'raiderArcher'] },
  iron: { name: 'Железные мятежники', color: 0x5c5f68, units: ['raider', 'brute', 'raiderArcher'] },
  beasts: { name: 'Звериные всадники', color: 0x4f3316, units: ['wolfRider', 'raider', 'wolfRider'] },
};

export function updateEnvironmentState(state, dt) {
  state.dayTime += dt;
  state.seasonTime += dt;
  state.worldTime += dt;
}

export function maybeChangeWeather(state) {
  const pool = ['clear', 'clear', 'rain', 'mist', 'dust'];
  state.weather = rand(pool);
}

export function campFactionLabel(camp) {
  return FACTIONS[camp.faction]?.name || 'Налётчики';
}

export function updateEnemyWaves(sceneCtx, state, dt, notify) {
  // Now that the AI plays symmetrically and builds its own buildings, we bypass simple wave generation.
  // We'll manage AI base building and attacks here.

  if (!state.aiState) {
    state.aiState = {
        gold: 150, wood: 100, stone: 50, food: 100, army: [], phase: 'build', timer: 5.0
    };
  }
  const ai = state.aiState;
  ai.timer -= dt;
  if (ai.timer > 0) return;
  ai.timer = 5.0; // AI logic ticks every 5 seconds

  const camps = state.enemyCamps || [];
  if (!camps.length) return;

  // Very simplistic symmetric AI for now:
  // AI generates resources out of thin air to simulate an off-screen economy, and buys units from its camps.
  ai.gold += 15 + state.era * 5;
  ai.wood += 10;
  ai.food += 15;

  for (const camp of camps) {
      if (ai.gold >= 25 && ai.food >= 10 && camp.hp > 0) {
          ai.gold -= 25;
          ai.food -= 10;
          const p = camp.pos.clone().add(new THREE.Vector3((Math.random() - .5) * 2.8, 0, (Math.random() - .5) * 2.8));
          const type = Math.random() > 0.5 ? 'raider' : 'raiderArcher';
          const unit = spawnUnit(sceneCtx, state, type, p);
          ai.army.push(unit);
      }
  }

  // Filter dead units
  ai.army = ai.army.filter(u => !u.dead);

  // Decide attack wave
  if (ai.phase === 'build' && ai.army.length >= 3 + state.era * 2) {
      ai.phase = 'attack';
      notify('Враг накопил силы и выдвигается на вашу столицу!');

      const capital = getCapital(state);
      if (capital) {
          for (const unit of ai.army) {
              unit.commandTarget = capital.pos.clone();
          }
      }
  } else if (ai.phase === 'attack' && ai.army.length <= 1) {
      ai.phase = 'build';
  }
}
