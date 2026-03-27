import { GAME_CONFIG } from '../config.js';

export function saveGame(state) {
  const raw = {
    timeScale: state.timeScale,
    paused: state.paused,
    dayTime: state.dayTime,
    seasonTime: state.seasonTime,
    worldTime: state.worldTime,
    weather: state.weather,
    era: state.era,
    resources: state.resources,
    objectives: state.objectives,
    roads: state.roads,
    territoryRadius: state.territoryRadius,
    techs: [...state.techs],
    techProgress: state.techProgress,
    stats: state.stats,
    map: state.map.map((t) => ({ id: t.id, q: t.q, r: t.r, type: t.type, height: t.height, buildingId: t.buildingId })),
    buildings: state.buildings.map((b) => ({ id: b.id, type: b.type, tileId: b.tileId, level: b.level, hp: b.hp, maxHp: b.maxHp, trainQueue: b.trainQueue })),
    construction: state.construction,
    enemyCampTiles: state.enemyCamps.map((c) => c.tileId),
    units: state.units.map((u) => ({ id: u.id, type: u.type, hp: u.hp, pos: { x: u.pos.x, y: u.pos.y, z: u.pos.z } })),
  };
  localStorage.setItem(GAME_CONFIG.saveKey, JSON.stringify(raw));
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(GAME_CONFIG.saveKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  localStorage.removeItem(GAME_CONFIG.saveKey);
}
