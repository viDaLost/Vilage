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
    trees: state.trees.map(t => ({ x: t.x, z: t.z, hp: t.hp })),
    rocks: state.rocks.map(r => ({ x: r.x, z: r.z, hp: r.hp, isGold: r.isGold })),
    buildings: state.buildings.map((b) => ({ id: b.id, type: b.type, pos: { x: b.pos.x, z: b.pos.z }, level: b.level, hp: b.hp, maxHp: b.maxHp, trainQueue: b.trainQueue })),
    construction: state.construction.map((c) => ({ id: c.id, type: c.type, x: c.x, z: c.z, progress: c.progress, mode: c.mode })),
    enemyCamps: state.enemyCamps.map((c) => ({ x: c.pos.x, z: c.pos.z, faction: c.faction, hp: c.hp })),
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
