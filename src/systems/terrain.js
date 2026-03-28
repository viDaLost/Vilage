import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import { TERRAIN_TYPES, GAME_CONFIG } from "../config.js";

const raycaster = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const noise2D = createNoise2D();

let terrainMesh = null;
let waterMesh = null;

function dominantTileAt(state, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const tile of state.map) {
    const dx = x - tile.pos.x;
    const dz = z - tile.pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = tile; }
  }
  return best;
}

function macroTerrain(x, z) {
  const broad = noise2D(x * 0.010, z * 0.010) * 1.2;
  const detail = noise2D(x * 0.033 + 17, z * 0.033 - 11) * 0.22;
  const soft = noise2D(x * 0.018 - 70, z * 0.018 + 34) * 0.35;
  return broad + detail + soft;
}

export function sampleTerrainHeightFromGrid(state, x, z) {
  let weightSum = 0;
  let heightSum = 0;
  const maxDist2 = Math.pow(GAME_CONFIG.hexSize * 3.4, 2);
  for (const tile of state.map) {
    const dx = x - tile.pos.x;
    const dz = z - tile.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > maxDist2) continue;
    const w = 1 / Math.pow(d2 + 0.6, 1.18);
    weightSum += w;
    heightSum += tile.height * w;
  }
  const base = weightSum > 0 ? (heightSum / weightSum) : ((dominantTileAt(state, x, z)?.height) || 0);
  return base + macroTerrain(x, z);
}

function colorFor(type, h, x, z) {
  const c = new THREE.Color(TERRAIN_TYPES[type]?.color || 0xcab98b);
  const n = noise2D(x * 0.025 + 9, z * 0.025 - 4);
  if (type === 'grass' || type === 'fertile' || type === 'forest') {
    c.offsetHSL(0.0, 0.02, n * 0.05);
  }
  if (type === 'hill') c.lerp(new THREE.Color(0xd0b98c), 0.35);
  if (type === 'rock') c.lerp(new THREE.Color(0xded7c9), 0.45);
  if (type === 'river' || type === 'water') c.lerp(new THREE.Color(0xbde7f6), 0.58);
  if (h > 1.25) c.lerp(new THREE.Color(0xece7da), 0.25);
  return c;
}

export function buildTerrain(sceneCtx, state) {
  const { groups } = sceneCtx;
  if (terrainMesh) groups.tiles.remove(terrainMesh);
  if (waterMesh) groups.tiles.remove(waterMesh);

  const size = GAME_CONFIG.mapRadius * GAME_CONFIG.hexSize * 5.2;
  const segments = 180;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const nearest = dominantTileAt(state, x, z);
    const type = nearest?.type || 'grass';
    const h = sampleTerrainHeightFromGrid(state, x, z) - (type === 'water' ? 0.22 : 0);
    pos.setY(i, h);
    const c = colorFor(type, h, x, z);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  terrainMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, flatShading: false
  }));
  terrainMesh.receiveShadow = true;
  terrainMesh.name = 'terrain-mesh';
  groups.tiles.add(terrainMesh);

  const waterGeo = new THREE.PlaneGeometry(size * 0.96, size * 0.96, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  waterMesh = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({
    color: 0xbfe8f9, transparent: true, opacity: 0.22, roughness: 0.12, metalness: 0
  }));
  waterMesh.position.y = GAME_CONFIG.terrain.waterLevel + 0.02;
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

export function getTerrainY(x, z) { return getTerrainPoint(x, z).y; }
export function getTerrainMesh() { return terrainMesh; }
