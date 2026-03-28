import * as THREE from 'three';
import { TERRAIN_TYPES, DECOR_MODELS, GAME_CONFIG } from '../config.js';
import { loadDecorModel } from '../core/assets.js';
import { buildTerrain, getTerrainPoint, getTerrainY } from './terrain.js';

const terrainMaterials = new Map();

function getTerrainMaterial(type) {
  if (terrainMaterials.has(type)) return terrainMaterials.get(type);
  const cfg = TERRAIN_TYPES[type];
  const mat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    roughness: type === 'river' || type === 'water' ? .28 : .98,
    metalness: 0,
    emissive: type === 'water' ? 0x356d93 : 0x000000,
    emissiveIntensity: type === 'water' ? .12 : 0,
  });
  terrainMaterials.set(type, mat);
  return mat;
}

function makeOrganicShape(tile) {
  const size = GAME_CONFIG.hexSize * 1.05;
  const shape = new THREE.Shape();
  for (let i = 0; i < 12; i++) {
    const sector = Math.floor((i / 12) * 6);
    const local = ((i / 12) * 6) - sector;
    const angle = Math.PI / 3 * sector + Math.PI / 6 + local * (Math.PI / 3);
    const radius = size * (0.985 + Math.sin((tile.q * 7 + tile.r * 11 + i) * 0.7) * 0.022);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function makeHexMesh(tile) {
  const geo = new THREE.CircleGeometry(GAME_CONFIG.hexSize * 0.82, 18);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }));
  mesh.position.set(tile.pos.x, tile.surfaceY + 0.02, tile.pos.z);
  mesh.userData.tileId = tile.id;
  return mesh;
}

function addDistantMountains(group) {
  group.clear();
  const mat = new THREE.MeshStandardMaterial({ color: 0xbcb2a1, roughness: 1, transparent: true, opacity: .96 });
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    const radius = 52 + (i % 5) * 4 + Math.random() * 2;
    const height = 14 + Math.random() * 10;
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(7 + Math.random() * 4, height, 4), mat.clone());
    mountain.position.set(Math.cos(angle) * radius, -1.2 + height / 2, Math.sin(angle) * radius);
    group.add(mountain);
  }
}

export function clearDecorOnTile(sceneCtx, tile) {
  if (!tile?.decorMeshes?.length) return;
  for (const mesh of tile.decorMeshes) sceneCtx.groups.decor.remove(mesh);
  tile.decorMeshes.length = 0;
}

export function sampleTileSurfaceY(tile, x = tile.pos.x, z = tile.pos.z) {
  return getTerrainY(x, z);
}

function decorChoices(tile) {
  const r = (salt) => {
    const x = Math.sin(tile.q * 127.1 + tile.r * 311.7 + salt * 74.7) * 43758.5453123;
    return x - Math.floor(x);
  };
  const list = [];
  switch (tile.type) {
    case 'forest':
      list.push(r(1) > .45 ? 'pine' : 'tree');
      if (r(2) > .52) list.push('pineRound');
      if (r(3) > .68) list.push('logs');
      break;
    case 'grass':
      if (r(1) > .55) list.push('tree');
      if (r(2) > .72) list.push('logs');
      break;
    case 'fertile':
      list.push('crops');
      if (r(2) > .62) list.push('crops');
      break;
    case 'rock':
      list.push(r(1) > .58 ? 'goldRock' : 'rocks');
      if (r(2) > .5) list.push('rocks');
      break;
    case 'hill':
      list.push('rocks');
      if (r(2) > .58) list.push('tree');
      break;
    case 'river':
      if (r(1) > .4) list.push('crops');
      if (r(2) > .66) list.push('tree');
      break;
    case 'sacred':
      if (r(1) > .5) list.push('tree');
      break;
  }
  return list.filter(Boolean).slice(0, 2);
}

export function renderTiles(sceneCtx, state) {
  const { groups } = sceneCtx;
  groups.tiles.clear();
  groups.decor.clear();
  groups.overlays.clear();
  addDistantMountains(groups.backdrop);

  const ringGeo = new THREE.RingGeometry(state.territoryRadius - .15, state.territoryRadius + .1, 128);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: .14, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .08;
  ring.name = 'territory-ring';
  groups.overlays.add(ring);

  buildTerrain(sceneCtx, state);

  state.map.forEach((tile) => {
    tile.decorMeshes = [];
    const mesh = makeHexMesh(tile);
    groups.overlays.add(mesh);
    tile.mesh = mesh;
  });
}

export function updateTerritoryOverlay(sceneCtx, state) {
  const ring = sceneCtx.groups.overlays.getObjectByName('territory-ring');
  if (!ring) return;
  ring.geometry.dispose();
  ring.geometry = new THREE.RingGeometry(state.territoryRadius - .15, state.territoryRadius + .1, 128);
}

export function renderRoads(sceneCtx, state) {
  const { groups } = sceneCtx;
  groups.roads.clear();
  const roadMat = new THREE.MeshStandardMaterial({ color: 0xcaa66a, roughness: 1 });
  state.roads.forEach((road) => {
    const a = state.mapIndex.get(road.a);
    const b = state.mapIndex.get(road.b);
    if (!a || !b) return;
    const dir = new THREE.Vector3().subVectors(b.pos, a.pos);
    const len = dir.length();
    const midX = (a.pos.x + b.pos.x) / 2;
    const midZ = (a.pos.z + b.pos.z) / 2;
    const y = (sampleTileSurfaceY(a, a.pos.x, a.pos.z) + sampleTileSurfaceY(b, b.pos.x, b.pos.z)) / 2 + 0.015;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.14, .02, len), roadMat);
    mesh.position.set(midX, y, midZ);
    mesh.lookAt(b.pos.x, y, b.pos.z);
    mesh.rotateY(Math.PI);
    mesh.receiveShadow = true;
    groups.roads.add(mesh);
  });
}

async function spawnDecorModel(sceneCtx, tile, key, slot = 0) {
  if (!key || tile.buildingId) return;
  const cfg = DECOR_MODELS[key];
  if (!cfg) return;
  try {
    const root = 'decor';
    const model = await loadDecorModel(cfg.file, root);
    if (!model) return;
    const seed = Math.sin(tile.q * 53.2 + tile.r * 71.9 + slot * 19.3) * 43758.5453;
    const rand = seed - Math.floor(seed);
    const angle = rand * Math.PI * 2;
    const radius = slot === 0 ? 0.35 : 0.75 + slot * 0.28;
    const x = tile.pos.x + Math.cos(angle) * radius;
    const z = tile.pos.z + Math.sin(angle) * radius;
    const point = getTerrainPoint(x, z);
    const y = point.y + (cfg.y || 0.0);
    model.scale.setScalar((cfg.scale || 0.25) * (0.92 + rand * 0.16));
    model.position.set(point.x, y, point.z);
    model.rotation.y = rand * Math.PI * 2;
    model.traverse((obj) => {
      if (obj.isMesh || obj.isSkinnedMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    model.userData.baseY = y;
    sceneCtx.groups.decor.add(model);
    tile.decorMeshes.push(model);
  } catch (err) {
    console.warn('Decor load failed', key, err);
  }
}

export async function populateDecorModels(sceneCtx, state) {
  const tasks = [];
  for (const tile of state.map) {
    if (tile.buildingId || tile.type === 'water') continue;
    const choices = decorChoices(tile);
    choices.forEach((c, idx) => {
      const density = Math.abs(Math.sin(tile.q * 17.7 + tile.r * 9.3 + idx));
      if (density < (1 - GAME_CONFIG.decorModelDensity)) return;
      tasks.push(spawnDecorModel(sceneCtx, tile, c, idx));
    });
  }
  // avoid blocking on any single failed asset
  for (let i = 0; i < tasks.length; i += 8) { await Promise.allSettled(tasks.slice(i, i + 8)); }
}
