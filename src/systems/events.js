import * as THREE from 'three';
import { rand } from '../utils/helpers.js';
import { WEATHER_TYPES } from '../config.js';
import { spawnUnit } from './units.js';

export function updateEnvironmentState(state, dt) {
  state.dayTime += dt;
  state.seasonTime += dt;
  state.worldTime += dt;
}

export function maybeChangeWeather(state) {
  const pool = ['clear', 'clear', 'rain', 'mist', 'dust'];
  state.weather = rand(pool);
}

export function updateEnemyWaves(sceneCtx, state, dt, notify) {
  state.enemyWaveTimer -= dt;
  if (state.enemyWaveTimer > 0) return;
  state.enemyWaveTimer = 50 + Math.random() * 18;
  if (!state.enemyCamps.length) return;
  const camp = rand(state.enemyCamps);
  const count = 1 + Math.floor(state.era + Math.random() * 2);
  for (let i = 0; i < count; i++) {
    const p = camp.pos.clone().add(new THREE.Vector3((Math.random() - .5) * 2.4, 0, (Math.random() - .5) * 2.4));
    spawnUnit(sceneCtx, state, 'raider', p);
  }
  state.resources.threat = Math.min(100, state.resources.threat + 4 + count);
  notify(`На горизонте замечен набег: ${count} врагов`);
}
