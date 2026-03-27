import * as THREE from 'three';
import { BUILDINGS } from '../config.js';
import { loadBuildingModel, makeFallbackMesh } from '../core/assets.js';
import { getNeighbors, isTileInsideTerritory } from './world.js';
import { dist2 } from '../utils/helpers.js';

let buildingId = 1;

function selectionRing() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.4, 1.65, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .04;
  return ring;
}

function scaleForBuilding(type, level) {
  const base = {
    capital: 1.0, farm: .82, lumber: .82, mine: .85, market: .84,
    granary: .82, temple: .86, barracks: .88, wall: .78, tower: .8,
    academy: .85, harbor: .88, wonder: 1.0
  };
  return (base[type] || .85) * (1 + (level - 1) * .07);
}

export function canPlaceBuilding(state, type, tile) {
  const cfg = BUILDINGS[type];
  if (!cfg || !tile) return false;
  if (!isTileInsideTerritory(state, tile)) return false;
  if (!tile || tile.type === 'water' || tile.buildingId) return false;
  if (cfg.minEra != null && state.era < cfg.minEra) return false;
  if (cfg.terrain && !cfg.terrain.includes(tile.type)) return false;
  if (type === 'wonder' && state.buildings.some((b) => b.type === 'wonder')) return false;
  return true;
}

export function payCost(resources, cost) {
  if (!cost) return true;
  for (const [key, value] of Object.entries(cost)) {
    if ((resources[key] || 0) < value) return false;
  }
  for (const [key, value] of Object.entries(cost)) {
    resources[key] -= value;
  }
  return true;
}

export function hasCost(resources, cost) {
  if (!cost) return true;
  return Object.entries(cost).every(([k, v]) => (resources[k] || 0) >= v);
}

export function placeConstruction(state, type, tile) {
  const cfg = BUILDINGS[type];
  const id = `c-${buildingId++}`;
  const job = {
    id,
    type,
    tileId: tile.id,
    progress: 0,
    buildTime: cfg.baseBuildTime,
  };
  state.construction.push(job);
  tile.buildingId = id;
  return job;
}

export async function finishConstruction(sceneCtx, state, job) {
  const cfg = BUILDINGS[job.type];
  const tile = state.mapIndex.get(job.tileId);
  if (!cfg || !tile) return null;

  const entity = {
    id: `b-${buildingId++}`,
    type: job.type,
    tileId: tile.id,
    level: 1,
    hp: cfg.health,
    maxHp: cfg.health,
    cooldown: 0,
    trainQueue: [],
    mesh: new THREE.Group(),
    selection: null,
  };

  let model;
  try {
    model = await loadBuildingModel(cfg.model);
  } catch {
    model = makeFallbackMesh();
  }
  model.scale.setScalar(scaleForBuilding(job.type, 1));
  model.position.y = tile.height + .08;
  entity.mesh.add(model);

  const ring = selectionRing();
  ring.position.y = tile.height + .05;
  entity.mesh.add(ring);
  entity.selection = ring;

  const light = new THREE.PointLight(0xffcc88, 0, 6);
  light.position.set(0, tile.height + 1.8, 0);
  entity.mesh.add(light);
  entity.mesh.userData.tileId = tile.id;
  entity.mesh.position.set(tile.pos.x, 0, tile.pos.z);
  sceneCtx.groups.buildings.add(entity.mesh);

  state.buildings.push(entity);
  tile.buildingId = entity.id;

  if (cfg.territory) state.territoryRadius += cfg.territory;
  if (job.type === 'wonder') state.stats.wonderBuilt = 1;
  return entity;
}

export function getBuildingById(state, id) {
  return state.buildings.find((b) => b.id === id) || null;
}

export function getBuildingOnTile(state, tile) {
  if (!tile?.buildingId) return null;
  return getBuildingById(state, tile.buildingId);
}

export function computeBuildingYield(state, building) {
  const cfg = BUILDINGS[building.type];
  const tile = state.mapIndex.get(building.tileId);
  const out = { ...(cfg.yields || {}) };
  const levelFactor = 1 + (building.level - 1) * .35;
  for (const key of Object.keys(out)) out[key] *= levelFactor;

  const neighbors = getNeighbors(state, tile);
  if (building.type === 'farm') {
    if (tile.type === 'fertile') out.food += .32;
    if (tile.type === 'river') out.food += .25;
    if (state.techs.has('irrigation') && ['river', 'fertile'].includes(tile.type)) out.food += .22;
  }
  if (building.type === 'lumber') {
    out.wood += neighbors.filter((n) => n.type === 'forest').length * .09;
  }
  if (building.type === 'mine') {
    if (tile.type === 'rock') out.stone += .18;
    if (tile.type === 'hill') out.gold += .06;
  }
  if (building.type === 'market') {
    out.gold += neighbors.filter((n) => n.buildingId).length * .04;
    if (state.techs.has('caravans')) out.gold += state.resources.roads * .008;
  }
  if (building.type === 'temple') {
    if (tile.type === 'sacred') out.prestige += .12;
  }
  if (building.type === 'academy' && state.techs.has('archives')) {
    out.knowledge += .08;
  }
  if (building.type === 'tower' && state.techs.has('discipline')) {
    out.defense += .25;
  }
  if (building.type === 'capital' && state.era > 0) {
    out.gold += .14 * state.era;
    out.populationCap += 2 * state.era;
  }
  return out;
}

export function getCapital(state) {
  return state.buildings.find((b) => b.type === 'capital') || null;
}

export function buildingCenter(state, building) {
  const tile = state.mapIndex.get(building.tileId);
  return new THREE.Vector3(tile.pos.x, tile.height + .1, tile.pos.z);
}

export function nearestDefense(state, targetPos, radius = 7) {
  let best = null;
  let bestD = Infinity;
  state.buildings.forEach((b) => {
    if (!['tower', 'barracks', 'capital', 'wall'].includes(b.type)) return;
    const pos = buildingCenter(state, b);
    const d = dist2(pos, targetPos);
    if (d < bestD && d <= radius) {
      bestD = d;
      best = b;
    }
  });
  return best;
}
