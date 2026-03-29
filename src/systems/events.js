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
  state.enemyWaveTimer -= dt;
  if (state.enemyWaveTimer > 0) return;
  const baseDelay = state.era === 0 ? 95 : state.era === 1 ? 78 : 64;
  state.enemyWaveTimer = baseDelay + Math.random() * 22;
  if (!state.enemyCamps.length) return;
  const camp = rand(state.enemyCamps);
  const faction = FACTIONS[camp.faction] || FACTIONS.clans;
  const count = state.era === 0 ? (Math.random() > 0.7 ? 2 : 1) : 1 + Math.floor(state.era + Math.random() * 2.1);
  const spawned = [];
  for (let i = 0; i < count; i++) {
    const p = camp.pos.clone().add(new THREE.Vector3((Math.random() - .5) * 2.8, 0, (Math.random() - .5) * 2.8));
    let type = rand(faction.units);
    if (state.era === 0 && type === 'brute') type = 'raider';
    if (state.era === 0 && type === 'wolfRider') type = 'raider';
    spawned.push(type);
    spawnUnit(sceneCtx, state, type, p);
  }
  state.resources.threat = Math.min(100, state.resources.threat + 4 + count * 1.2);
  const archers = spawned.filter((t) => t === 'raiderArcher').length;
  const brutes = spawned.filter((t) => t === 'brute').length;
  const wolves = spawned.filter((t) => t === 'wolfRider').length;
  notify(`${faction.name} атакуют: ${count} врагов${archers ? `, лучники ${archers}` : ''}${brutes ? `, крушители ${brutes}` : ''}${wolves ? `, всадники ${wolves}` : ''}`);
}
