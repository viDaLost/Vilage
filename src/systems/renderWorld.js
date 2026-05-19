import * as THREE from 'three';
import { DECOR_MODELS, GAME_CONFIG } from '../config.js';
import { loadDecorModel } from '../core/assets.js';
import { buildTerrain, sampleTerrainHeight } from './terrain.js';
import { sampleTerrain } from './world.js';

async function addDistantMountains(group) {
  group.clear();
  const fallbackMat = new THREE.MeshStandardMaterial({ color: 0xbcb2a1, roughness: 1, transparent: true, opacity: .96 });
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const radius = 54 + (i % 5) * 4 + Math.random() * 2;
    try {
      const model = await loadDecorModel(i % 3 === 0 ? 'mountain-group.glb' : 'mountain.glb');
      const scale = i % 3 === 0 ? 3.2 : 2.4;
      model.scale.setScalar(scale + Math.random() * .5);
      model.position.set(Math.cos(angle) * radius, -1.4, Math.sin(angle) * radius);
      model.rotation.y = angle + Math.PI;
      group.add(model);
    } catch {
      const height = 16 + Math.random() * 10;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(7 + Math.random() * 4, height, 4), fallbackMat.clone());
      mountain.position.set(Math.cos(angle) * radius, -1.2 + height / 2, Math.sin(angle) * radius);
      group.add(mountain);
    }
  }
}

export function renderTiles(sceneCtx, state) {
  const { groups } = sceneCtx;
  groups.tiles.clear();
  groups.decor.clear();
  groups.overlays.clear();
  groups.backdrop.clear();
  addDistantMountains(groups.backdrop);

  const ringGeo = new THREE.RingGeometry(state.territoryRadius - .15, state.territoryRadius + .1, 128);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: .14, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .08;
  ring.name = 'territory-ring';
  groups.overlays.add(ring);

  buildTerrain(sceneCtx, state);
}

export function updateTerritoryOverlay(sceneCtx, state) {
  const ring = sceneCtx.groups.overlays.getObjectByName('territory-ring');
  if (!ring) return;
  ring.geometry.dispose();
  ring.geometry = new THREE.RingGeometry(state.territoryRadius - .15, state.territoryRadius + .1, 128);
}

function clearGroup(group) {
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
      else obj.material?.dispose?.();
    }
  });
  group.clear();
}

export function renderRoads(sceneCtx) {
  clearGroup(sceneCtx.groups.roads);
  // Roads will be completely revamped with continuous map
}

function decorChoices(terrainType, noise) {
  const list = [];
  const r = (salt) => {
    const x = Math.sin(noise * 127.1 + salt * 74.7) * 43758.5453123;
    return x - Math.floor(x);
  };
  switch (terrainType) {
    case 'forest':
      list.push(r(1) > .45 ? 'pineAlt' : 'pine');
      if (r(2) > .52) list.push('tree');
      if (r(3) > .68) list.push('logs');
      break;
    case 'grass':
      if (r(1) > .85) list.push('tree');
      break;
    case 'fertile':
      if (r(2) > .88) list.push('tree');
      break;
    case 'rock':
      list.push(r(1) > .58 ? 'goldRock' : 'rocks');
      if (r(2) > .5) list.push('rocks');
      if (r(3) > .7) list.push('mountain');
      break;
    case 'hill':
      list.push(r(1) > .45 ? 'mountainGroup' : 'rocks');
      if (r(2) > .58) list.push('tree');
      break;
  }
  return list.filter(Boolean).slice(0, 2);
}

async function spawnDecorModel(sceneCtx, state, x, z, key) {
  if (!key) return;
  const cfg = DECOR_MODELS[key];
  if (!cfg) return;
  try {
    const root = 'decor';
    const model = await loadDecorModel(cfg.file, root);
    if (!model) return;

    const h = sampleTerrainHeight(state, x, z);
    const y = h + (cfg.y || 0.0);
    const rand = Math.random();

    model.scale.setScalar((cfg.scale || 0.25) * (0.92 + rand * 0.16));
    model.position.set(x, y, z);
    model.rotation.y = rand * Math.PI * 2;
    model.traverse((obj) => {
      if (obj.isMesh || obj.isSkinnedMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    // Convert generic decor to actual gameplay resource nodes
    if (['tree', 'oak', 'pine', 'pineAlt', 'pineRound'].includes(key)) {
        state.trees.push({ x, y, z, hp: 50, maxHp: 50, mesh: model, id: `tree-${Math.random()}` });
    } else if (['rocks', 'goldRock'].includes(key)) {
        state.rocks.push({ x, y, z, hp: 100, maxHp: 100, isGold: key === 'goldRock', mesh: model, id: `rock-${Math.random()}` });
    } else {
        sceneCtx.groups.decor.add(model);
    }
  } catch (err) {
    console.warn('Decor load failed', key, err);
  }
}

export async function populateDecorModels(sceneCtx, state) {
  const tasks = [];
  const R = GAME_CONFIG.mapRadius * GAME_CONFIG.hexSize * 2.0;

  // Grid sampling for continuous decor placement
  for (let x = -R; x <= R; x += 3.5) {
      for (let z = -R; z <= R; z += 3.5) {
          if (Math.hypot(x, z) > R * 0.95) continue;

          const terrain = sampleTerrain(state, x, z);
          if (terrain.type === 'water' || terrain.type === 'river') continue;

          const choices = decorChoices(terrain.type, terrain.noise);
          choices.forEach((c, idx) => {
              const density = Math.abs(Math.sin(x * 17.7 + z * 9.3 + idx));
              if (density < (1 - GAME_CONFIG.decorModelDensity)) return;

              const offsetX = (Math.random() - 0.5) * 2.0;
              const offsetZ = (Math.random() - 0.5) * 2.0;
              tasks.push(spawnDecorModel(sceneCtx, state, x + offsetX, z + offsetZ, c));
          });
      }
  }

  for (let i = 0; i < tasks.length; i += 8) { await Promise.allSettled(tasks.slice(i, i + 8)); }

  // Add tree and rock meshes to the scene after populating lists
  for (const tree of state.trees) sceneCtx.groups.decor.add(tree.mesh);
  for (const rock of state.rocks) sceneCtx.groups.decor.add(rock.mesh);
}
