import * as THREE from 'three';
import { TERRAIN_TYPES, GAME_CONFIG } from '../config.js';

const raycaster = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);

let terrainMesh = null;
let waterMesh = null;

function dominantTileAt(state, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const tile of state.map) {
    const dx = x - tile.pos.x;
    const dz = z - tile.pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = tile;
    }
  }
  return best;
}

export function sampleTerrainHeightFromGrid(state, x, z) {
  let weightSum = 0;
  let heightSum = 0;
  const maxDist2 = Math.pow(GAME_CONFIG.hexSize * 3.2, 2);
  for (const tile of state.map) {
    const dx = x - tile.pos.x;
    const dz = z - tile.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > maxDist2) continue;
    const w = 1 / Math.pow(d2 + 0.45, 1.18);
    weightSum += w;
    heightSum += tile.height * w;
  }
  if (weightSum <= 0) {
    const t = dominantTileAt(state, x, z);
    return t ? t.height : 0;
  }
  return heightSum / weightSum;
}

function colorForTileType(type) {
  return new THREE.Color(TERRAIN_TYPES[type]?.color || 0xcab98b);
}

export function buildTerrain(sceneCtx, state) {
  const { groups } = sceneCtx;
  if (terrainMesh) groups.tiles.remove(terrainMesh);
  if (waterMesh) groups.tiles.remove(waterMesh);

  const size = GAME_CONFIG.mapRadius * GAME_CONFIG.hexSize * 4.8;
  const segments = 150;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = sampleTerrainHeightFromGrid(state, x, z);
    const nearest = dominantTileAt(state, x, z);
    const type = nearest?.type || 'grass';
    pos.setY(i, h - (type === 'water' ? 0.12 : 0));
    const c = colorForTileType(type);
    if (type === 'forest') c.multiplyScalar(0.92);
    if (type === 'fertile') c.offsetHSL(0.02, 0.02, 0.02);
    if (type === 'hill') c.offsetHSL(-0.01, -0.04, -0.02);
    if (type === 'rock') c.lerp(new THREE.Color(0xd7d0c1), 0.35);
    if (type === 'river' || type === 'water') c.lerp(new THREE.Color(0xa9d8ee), 0.42);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    flatShading: false,
  });
  terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.receiveShadow = true;
  terrainMesh.name = 'terrain-mesh';
  groups.tiles.add(terrainMesh);

  const waterGeo = new THREE.PlaneGeometry(size * 0.96, size * 0.96, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0xbde7f6,
    transparent: true,
    opacity: 0.68,
    roughness: 0.18,
    metalness: 0,
  });
  waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.y = GAME_CONFIG.terrain.waterLevel + 0.06;
  waterMesh.receiveShadow = true;
  waterMesh.name = 'water-plane';
  groups.tiles.add(waterMesh);

  state.map.forEach((tile) => {
    tile.surfaceY = sampleTerrainHeightFromGrid(state, tile.pos.x, tile.pos.z);
  });

  return terrainMesh;
}

export function getTerrainPoint(x, z) {
  if (!terrainMesh) return new THREE.Vector3(x, 0, z);
  raycaster.set(new THREE.Vector3(x, 250, z), down);
  const hits = raycaster.intersectObject(terrainMesh, false);
  return hits.length ? hits[0].point.clone() : new THREE.Vector3(x, 0, z);
}

export function getTerrainY(x, z) {
  return getTerrainPoint(x, z).y;
}

export function getTerrainMesh() {
  return terrainMesh;
}
