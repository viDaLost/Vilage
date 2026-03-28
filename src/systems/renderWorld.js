import * as THREE from 'three';
import { TERRAIN_TYPES, DECOR_MODELS, GAME_CONFIG } from '../config.js';
import { loadDecorModel, loadUnitModel } from '../core/assets.js';
import { createHexShape, isTileInsideTerritory } from './world.js';

const terrainMaterials = new Map();
const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 1, metalness: 0 });

function getTerrainMaterial(type) {
  if (terrainMaterials.has(type)) return terrainMaterials.get(type);
  const cfg = TERRAIN_TYPES[type];
  const mat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    roughness: type === 'river' || type === 'water' ? .18 : .94,
    metalness: type === 'water' ? .08 : 0,
    emissive: type === 'water' ? 0x285274 : 0x000000,
    emissiveIntensity: type === 'water' ? .24 : 0
  });
  terrainMaterials.set(type, mat);
  return mat;
}

function tint(color, amt) {
  const c = new THREE.Color(color);
  c.offsetHSL(0, 0, amt);
  return c;
}

function makeOrganicShape(tile) {
  const size = GAME_CONFIG.hexSize * 1.1;
  const shape = new THREE.Shape();
  for (let i = 0; i < 12; i++) {
    const step = i / 12;
    const sector = Math.floor(step * 6);
    const local = (step * 6) - sector;
    const angle = Math.PI / 3 * sector + Math.PI / 6 + local * (Math.PI / 3);
    const wobble = 0.96 + Math.sin((tile.q * 11 + tile.r * 7 + i) * 0.7) * 0.03;
    const radius = size * wobble;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function makeHexMesh(tile) {
  const depth = tile.type === 'water' ? .28 : .72 + Math.max(0, tile.height * .06);
  const shape = makeOrganicShape(tile);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .03, bevelThickness: .03, bevelSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(tile.pos.x, tile.height - depth, tile.pos.z);
  const mesh = new THREE.Mesh(geo, [edgeMaterial, getTerrainMaterial(tile.type)]);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.tileId = tile.id;
  mesh.rotation.y = tile.noise * .045;
  return mesh;
}

function addMesh(group, tile, mesh) {
  tile.decorMeshes.push(mesh);
  group.add(mesh);
}

function addBushCluster(group, tile, pos, y, spread = 1) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x376d2a, roughness: 1 });
  for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
    const bush = new THREE.Mesh(new THREE.SphereGeometry(.18 + Math.random() * .12, 7, 7), mat);
    bush.scale.y = .8;
    bush.position.set(pos.x + (Math.random() - .5) * spread, y + .14, pos.z + (Math.random() - .5) * spread);
    bush.castShadow = true;
    addMesh(group, tile, bush);
  }
}

function addFlowerDots(group, tile, pos, y) {
  const colors = [0xf3d36b, 0xd7f0ff, 0xffb2b2];
  for (let i = 0; i < 6; i++) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.03, 5, 5), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], emissive: colors[i % colors.length], emissiveIntensity: .08 }));
    dot.position.set(pos.x + (Math.random() - .5) * 1.1, y + .12, pos.z + (Math.random() - .5) * 1.1);
    addMesh(group, tile, dot);
  }
}

function addTreeCluster(group, tile, pos, y, pine = false) {
  const matTrunk = new THREE.MeshStandardMaterial({ color: 0x714a24, roughness: 1 });
  for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
    const leafColor = pine ? 0x2b5e34 : (Math.random() > .55 ? 0x2f6d2d : 0x1f5120);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.08, .11, .72, 5), matTrunk);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(.38 + Math.random() * .16, pine ? 1.28 : 1.05, 7), new THREE.MeshStandardMaterial({ color: leafColor, roughness: 1 }));
    const crown2 = new THREE.Mesh(new THREE.ConeGeometry(.28 + Math.random() * .1, pine ? .9 : .7, 7), new THREE.MeshStandardMaterial({ color: tint(leafColor, .08), roughness: 1 }));
    const ox = (Math.random() - .5) * 1.3;
    const oz = (Math.random() - .5) * 1.3;
    trunk.position.set(pos.x + ox, y + .38, pos.z + oz);
    crown.position.set(pos.x + ox, y + (pine ? 1.18 : 1.04), pos.z + oz);
    crown2.position.set(pos.x + ox, y + (pine ? 1.62 : 1.42), pos.z + oz);
    trunk.castShadow = crown.castShadow = crown2.castShadow = true;
    addMesh(group, tile, trunk); addMesh(group, tile, crown); addMesh(group, tile, crown2);
  }
}

function addRockCluster(group, tile, pos, y, golden = false) {
  for (let i = 0; i < 3 + Math.floor(Math.random() * 2); i++) {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(.2 + Math.random() * .18, 0),
      new THREE.MeshStandardMaterial({ color: golden ? 0xc9a44d : (Math.random() > .5 ? 0x8b8b8b : 0x6f706f), roughness: 1, emissive: golden ? 0x8b6822 : 0x000000, emissiveIntensity: golden ? .18 : 0 })
    );
    rock.position.set(pos.x + (Math.random() - .5) * 1.15, y + .12 + Math.random() * .18, pos.z + (Math.random() - .5) * 1.15);
    rock.scale.setScalar(.8 + Math.random() * 1.2);
    rock.castShadow = true;
    addMesh(group, tile, rock);
  }
}

function addGrassCluster(group, tile, pos, y, color = 0xc4c15f, density = 7) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 1 });
  for (let i = 0; i < density; i++) {
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(.015, .03, .35 + Math.random() * .18, 4), mat);
    blade.position.set(pos.x + (Math.random() - .5) * 1.45, y + .14, pos.z + (Math.random() - .5) * 1.45);
    blade.rotation.z = (Math.random() - .5) * .24;
    addMesh(group, tile, blade);
  }
}

function addReedCluster(group, tile, pos, y) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9be71, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const reed = new THREE.Mesh(new THREE.CylinderGeometry(.02, .03, .48 + Math.random() * .2, 5), mat);
    reed.position.set(pos.x + (Math.random() - .5) * 1.2, y + .18, pos.z + (Math.random() - .5) * 1.2);
    addMesh(group, tile, reed);
  }
}

function addDistantMountains(group) {
  group.clear();
  const fogMat = new THREE.MeshStandardMaterial({ color: 0x5d5147, roughness: 1, transparent: true, opacity: .96 });
  for (let i = 0; i < 32; i++) {
    const angle = (i / 22) * Math.PI * 2;
    const radius = 44 + (i % 4) * 4 + Math.random() * 3;
    const h = 10 + Math.random() * 14;
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(5 + Math.random() * 5, h, 6 + Math.floor(Math.random() * 3)), fogMat.clone());
    mountain.position.set(Math.cos(angle) * radius, -1 + h / 2, Math.sin(angle) * radius);
    mountain.castShadow = true;
    group.add(mountain);
  }
}

export function clearDecorOnTile(sceneCtx, tile) {
  if (!tile?.decorMeshes?.length) return;
  for (const mesh of tile.decorMeshes) sceneCtx.groups.decor.remove(mesh);
  tile.decorMeshes.length = 0;
}

export function renderTiles(sceneCtx, state) {
  const { groups } = sceneCtx;
  groups.tiles.clear();
  groups.decor.clear();
  groups.overlays.clear();
  addDistantMountains(groups.backdrop);

  const ringGeo = new THREE.RingGeometry(state.territoryRadius - .2, state.territoryRadius + .18, 128);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: .16, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .08;
  ring.name = 'territory-ring';
  groups.overlays.add(ring);

  state.map.forEach((tile) => {
    tile.decorMeshes = [];
    const mesh = makeHexMesh(tile);
    groups.tiles.add(mesh);
    tile.mesh = mesh;

    if (tile.type === 'forest') { addTreeCluster(groups.decor, tile, tile.pos, tile.height + .02, false); addBushCluster(groups.decor, tile, tile.pos, tile.height + .02, 1.2); addGrassCluster(groups.decor, tile, tile.pos, tile.height + .02, 0x9bb067, 4); }
    if (tile.type === 'rock') addRockCluster(groups.decor, tile, tile.pos, tile.height + .02, false);
    if (tile.type === 'hill') { addRockCluster(groups.decor, tile, tile.pos, tile.height + .02, false); if (Math.random() > .55) addGrassCluster(groups.decor, tile, tile.pos, tile.height + .02, 0xb0b768, 4); }
    if (tile.type === 'fertile') { addGrassCluster(groups.decor, tile, tile.pos, tile.height + .02, 0xcfce6a, 10); addFlowerDots(groups.decor, tile, tile.pos, tile.height + .02); }
    if (tile.type === 'grass') { addGrassCluster(groups.decor, tile, tile.pos, tile.height + .02, 0x9ab55b, 8); if (Math.random() > .55) addBushCluster(groups.decor, tile, tile.pos, tile.height + .02); }
    if (tile.type === 'river') { addReedCluster(groups.decor, tile, tile.pos, tile.height + .02); addGrassCluster(groups.decor, tile, tile.pos, tile.height + .02, 0xcccd79, 5); }
    if (tile.type === 'sacred') { addGrassCluster(groups.decor, tile, tile.pos, tile.height + .02, 0xe0d386, 5); addFlowerDots(groups.decor, tile, tile.pos, tile.height + .02); }
  });
}

export function updateTerritoryOverlay(sceneCtx, state) {
  const ring = sceneCtx.groups.overlays.getObjectByName('territory-ring');
  if (!ring) return;
  ring.geometry.dispose();
  ring.geometry = new THREE.RingGeometry(state.territoryRadius - .2, state.territoryRadius + .18, 128);
}

export function renderRoads(sceneCtx, state) {
  const { groups } = sceneCtx;
  groups.roads.clear();
  const roadMat = new THREE.MeshStandardMaterial({ color: 0xb6915d, roughness: 1 });
  state.roads.forEach((road) => {
    const a = state.mapIndex.get(road.a);
    const b = state.mapIndex.get(road.b);
    if (!a || !b) return;
    const dir = new THREE.Vector3().subVectors(b.pos, a.pos);
    const len = dir.length();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.72, .06, len), roadMat);
    mesh.position.set((a.pos.x + b.pos.x) / 2, ((a.height + b.height) / 2) + .08, (a.pos.z + b.pos.z) / 2);
    mesh.lookAt(b.pos.x, mesh.position.y, b.pos.z);
    mesh.rotateY(Math.PI);
    mesh.receiveShadow = true;
    groups.roads.add(mesh);
  });
}

function seeded(tile, salt = 1) {
  const x = Math.sin(tile.q * 127.1 + tile.r * 311.7 + salt * 74.7) * 43758.5453123;
  return x - Math.floor(x);
}

function decorChoices(tile) {
  const choices = [];
  const r1 = seeded(tile, 1);
  const r2 = seeded(tile, 2);
  const r3 = seeded(tile, 3);
  if (tile.type === 'forest') {
    choices.push(r1 > 0.45 ? 'pine' : 'trees');
    if (r2 > 0.48) choices.push('logs');
  } else if (tile.type === 'rock') {
    choices.push(r1 > 0.72 ? 'gold' : 'rocks');
    if (r2 > 0.5) choices.push('rocks');
  } else if (tile.type === 'hill') {
    choices.push(r1 > 0.76 ? 'gold' : 'rocks');
    if (r2 > 0.46) choices.push('logs');
  } else if (tile.type === 'fertile') {
    choices.push('crops');
    if (r2 > 0.4) choices.push('logs');
  } else if (tile.type === 'grass') {
    if (r1 > 0.58) choices.push('trees');
    if (r2 > 0.72) choices.push('logs');
  } else if (tile.type === 'river') {
    if (r1 > 0.42) choices.push('crops');
    if (r2 > 0.62) choices.push('trees');
  } else if (tile.type === 'sacred') {
    choices.push(r1 > 0.5 ? 'cleric' : 'wizard');
    if (r3 > 0.48) choices.push('trees');
  }
  return choices.slice(0, GAME_CONFIG.decorPerTileSoftCap || 4);
}

async function spawnDecorModel(sceneCtx, tile, key, slot = 0) {
  if (!key || tile.buildingId) return;
  const cfg = DECOR_MODELS[key];
  if (!cfg) return;
  const rand = seeded(tile, 3 + slot * 7);
  try {
    const root = cfg.root === 'units' ? 'units' : 'decor';
    const modelData = root === 'units' ? await loadUnitModel(cfg.file) : await loadDecorModel(cfg.file);
    const model = root === 'units' ? modelData.scene : modelData;
    if (!model) return;
    const scale = (cfg.scale || 0.7) * (0.84 + rand * 0.3);
    model.scale.setScalar(scale);
    model.rotation.y = rand * Math.PI * 2;
    const angle = rand * Math.PI * 2;
    const radius = slot === 0 ? 0.12 : 0.34 + slot * 0.12;
    model.position.set(
      tile.pos.x + Math.cos(angle) * radius,
      tile.height + (cfg.y || 0.02),
      tile.pos.z + Math.sin(angle) * radius
    );
    model.traverse((obj) => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; } });
    sceneCtx.groups.decor.add(model);
    tile.decorMeshes.push(model);
  } catch {}
}

export async function populateDecorModels(sceneCtx, state) {
  const tasks = [];
  state.map.forEach((tile) => {
    if (tile.buildingId || tile.type === 'water') return;
    const choices = decorChoices(tile);
    choices.forEach((c, idx) => {
      const densityRoll = seeded(tile, 11 + idx * 3);
      const minRoll = tile.type === 'forest' || tile.type === 'rock' || tile.type === 'hill' ? 0.06 : 1 - GAME_CONFIG.decorModelDensity;
      if (densityRoll < minRoll) return;
      tasks.push(spawnDecorModel(sceneCtx, tile, c, idx));
    });
  });
  await Promise.all(tasks);
}
