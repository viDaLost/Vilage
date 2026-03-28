import * as THREE from 'three';
import { BUILDINGS } from '../config.js';
import { loadBuildingModel, makeFallbackMesh, loadDecorModel } from '../core/assets.js';
import { getNeighbors, isTileInsideTerritory } from './world.js';
import { clearDecorOnTile } from './renderWorld.js';

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
    capital: 1.95, farm: .9, lumber: .9, mine: .92, market: .94,
    granary: .9, temple: 1.0, barracks: 1.02, wall: .88, tower: .95,
    academy: .96, harbor: .98, wonder: 1.12
  };
  return (base[type] || .9) * (1 + (level - 1) * .08);
}

export function getUpgradeCost(type, nextLevel) {
  const cfg = BUILDINGS[type];
  const base = cfg.cost || {};
  const mul = 0.7 + nextLevel * 0.42;
  const out = {};
  Object.entries(base).forEach(([k, v]) => { out[k] = Math.max(1, Math.round(v * mul)); });
  if (!Object.keys(out).length) {
    out.gold = 45 * nextLevel;
    out.stone = 18 * nextLevel;
  }
  return out;
}

export function getUpgradeTime(type, nextLevel) {
  return Math.round((BUILDINGS[type].baseBuildTime || 12) * (0.85 + nextLevel * 0.28));
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

export function canUpgradeBuilding(state, building) {
  if (!building) return false;
  const cfg = BUILDINGS[building.type];
  if (!cfg || building.level >= (cfg.maxLevel || 1)) return false;
  if (state.construction.some((job) => job.buildingId === building.id)) return false;
  return hasCost(state.resources, getUpgradeCost(building.type, building.level + 1));
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
    mode: 'new',
  };
  state.construction.push(job);
  tile.buildingId = id;
  return job;
}

export function startUpgrade(state, building) {
  const nextLevel = building.level + 1;
  const cost = getUpgradeCost(building.type, nextLevel);
  if (!hasCost(state.resources, cost)) return null;
  payCost(state.resources, cost);
  const job = {
    id: `c-${buildingId++}`,
    type: building.type,
    buildingId: building.id,
    tileId: building.tileId,
    progress: 0,
    buildTime: getUpgradeTime(building.type, nextLevel),
    mode: 'upgrade',
    targetLevel: nextLevel,
  };
  state.construction.push(job);
  building.upgrading = true;
  return job;
}

export function repairBuilding(state, building) {
  if (!building || building.hp >= building.maxHp) return false;
  const missing = building.maxHp - building.hp;
  const cost = {
    wood: Math.max(1, Math.round(missing / 25)),
    stone: Math.max(0, Math.round(missing / 40)),
    gold: Math.max(1, Math.round(missing / 35)),
  };
  if (!hasCost(state.resources, cost)) return false;
  payCost(state.resources, cost);
  building.hp = Math.min(building.maxHp, building.hp + missing * .7);
  return true;
}

export function destroyBuilding(sceneCtx, state, building) {
  if (!building || building.type === 'capital') return false;
  const tile = state.mapIndex.get(building.tileId);
  if (tile) tile.buildingId = null;
  sceneCtx.groups.buildings.remove(building.mesh);
  if (building.extraMeshes?.length) building.extraMeshes.forEach((m) => sceneCtx.groups.decor.remove(m));
  state.buildings = state.buildings.filter((b) => b.id !== building.id);
  const refund = Math.round((BUILDINGS[building.type].cost?.wood || 0) * .25);
  state.resources.wood += refund;
  state.resources.stone += Math.round((BUILDINGS[building.type].cost?.stone || 0) * .2);
  return true;
}

async function spawnFarmBeds(sceneCtx, tile, entity) {
  const beds = [];
  try {
    for (let i = 0; i < 3; i++) {
      const model = await loadDecorModel('crops.glb');
      const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const radius = 0.7;
      model.scale.setScalar(0.42);
      model.rotation.y = angle + Math.PI / 2;
      model.position.set(tile.pos.x + Math.cos(angle) * radius, tile.height + 0.03, tile.pos.z + Math.sin(angle) * radius);
      sceneCtx.groups.decor.add(model);
      beds.push(model);
    }
  } catch {}
  entity.extraMeshes = beds;
}

export async function createGhostBuildingMesh(type) {
  const cfg = BUILDINGS[type];
  if (!cfg?.model) return null;
  try {
    const model = await loadBuildingModel(cfg.model);
    model.scale.setScalar(scaleForBuilding(type, 1));
    model.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          m = m.clone();
          m.transparent = true;
          m.opacity = 0.38;
          m.depthWrite = false;
          obj.material = m;
        });
      }
    });
    return model;
  } catch {
    return null;
  }
}

export async function finishConstruction(sceneCtx, state, job) {
  if (job.mode === 'upgrade') {
    const building = getBuildingById(state, job.buildingId);
    if (!building) return null;
    const cfg = BUILDINGS[building.type];
    building.level = job.targetLevel;
    building.maxHp = Math.round(cfg.health * (1 + (building.level - 1) * .25));
    building.hp = building.maxHp;
    building.upgrading = false;
    const model = building.modelRoot || building.mesh.children[0];
    if (model) model.scale.setScalar(scaleForBuilding(building.type, building.level));
    if (building.glow) building.glow.intensity = .9 + building.level * .1;
    if (cfg.territory) state.territoryRadius += cfg.territory * 0.32;
    return building;
  }

  const cfg = BUILDINGS[job.type];
  const tile = state.mapIndex.get(job.tileId);
  if (!cfg || !tile) return null;

  clearDecorOnTile(sceneCtx, tile);

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
    glow: null,
    hitFlash: 0,
    upgrading: false,
    extraMeshes: []
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
  entity.modelRoot = model;

  const ring = selectionRing();
  ring.position.y = tile.height + .05;
  entity.mesh.add(ring);
  entity.selection = ring;

  const light = new THREE.PointLight(0xffcc88, job.type === 'capital' ? 1.2 : 0.82, job.type === 'capital' ? 9 : 6);
  light.position.set(0, tile.height + 2.2, 0);
  entity.mesh.add(light);
  entity.glow = light;
  entity.mesh.userData.tileId = tile.id;
  entity.mesh.position.set(tile.pos.x, 0, tile.pos.z);
  sceneCtx.groups.buildings.add(entity.mesh);

  state.buildings.push(entity);
  tile.buildingId = entity.id;

  if (cfg.territory) state.territoryRadius += cfg.territory;
  if (job.type === 'wonder') state.stats.wonderBuilt = 1;
  if (job.type === 'farm') await spawnFarmBeds(sceneCtx, tile, entity);
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
  if (building.type === 'lumber') out.wood += neighbors.filter((n) => n.type === 'forest').length * .09;
  if (building.type === 'mine') {
    if (tile.type === 'rock') out.stone += .18;
    if (tile.type === 'hill') out.gold += .06;
  }
  if (building.type === 'market') {
    out.gold += neighbors.filter((n) => n.buildingId).length * .04;
    if (state.techs.has('caravans')) out.gold += state.resources.roads * .008;
  }
  if (building.type === 'temple' && tile.type === 'sacred') out.prestige += .12;
  if (building.type === 'academy' && state.techs.has('archives')) out.knowledge += .08;
  if (building.type === 'tower' && state.techs.has('discipline')) out.defense += .25;
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
  return tile.pos.clone().setY(tile.height + .6);
}

export function getBuildingStatus(state, building) {
  const cfg = BUILDINGS[building.type];
  const canUpgrade = canUpgradeBuilding(state, building);
  return {
    cfg,
    canUpgrade,
    upgradeCost: getUpgradeCost(building.type, building.level + 1),
    upgradeTime: getUpgradeTime(building.type, building.level + 1),
    repairNeeded: building.hp < building.maxHp * .96,
  };
}
