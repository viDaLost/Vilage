import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import { TERRAIN_TYPES, GAME_CONFIG } from "../config.js";

const raycaster = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const noise2D = createNoise2D();

let terrainMesh = null;
let waterMesh = null;

function fbm(x, z, octaves = 4, persistence = 0.5, scale = 1.0) {
  let total = 0;
  let frequency = scale;
  let amplitude = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    total += noise2D(x * frequency, z * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= 2;
  }
  return total / Math.max(0.0001, maxValue);
}

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

function macroTerrain(x, z, tile) {
  const gentle = fbm(x, z, 4, 0.55, 0.014) * 0.28;
  const detail = fbm(x + 40, z - 10, 3, 0.45, 0.05) * 0.05;
  const ridge = Math.max(0, fbm(x - 120, z + 90, 3, 0.52, 0.018));
  if (!tile) return gentle + detail;
  if (tile.type === 'river') return -0.18 + detail * 0.3;
  if (tile.type === 'fertile' || tile.type === 'grass' || tile.type === 'forest' || tile.type === 'sacred') return gentle + detail;
  if (tile.type === 'hill') return 0.34 + ridge * 0.42 + detail;
  if (tile.type === 'rock') return 0.72 + ridge * 0.7 + detail * 0.7;
  return gentle + detail;
}

export function sampleTerrainHeightFromGrid(state, x, z) {
  const tile = dominantTileAt(state, x, z);
  const base = tile?.height || 0;
  return base + macroTerrain(x, z, tile);
}

function colorFor(type, h, x, z, steepness) {
  const baseColorHex = TERRAIN_TYPES[type]?.color || 0x6e8e45;
  const c = new THREE.Color(baseColorHex);
  const shade = fbm(x, z, 2, 0.5, 0.06);
  c.offsetHSL(0, 0.015 * shade, 0.06 * shade);
  if (type === 'river') {
    c.lerp(new THREE.Color(0x7ac5e8), 0.35);
  }
  if (steepness > 0.42 || type === 'rock') {
    c.lerp(new THREE.Color(0x8e8a82), Math.min(1, 0.4 + steepness));
  }
  if (type !== 'river' && h > 1.25) c.lerp(new THREE.Color(0xe8e3db), Math.min(1, (h - 1.25) * 0.6));
  if (type === 'fertile' || type === 'grass') {
    c.lerp(new THREE.Color(0xd8c69b), Math.max(0, Math.min(1, (0.05 - h) * 2.5)) * 0.35);
  }
  return c;
}

export function buildTerrain(sceneCtx, state) {
  const { groups } = sceneCtx;
  if (terrainMesh) groups.tiles.remove(terrainMesh);
  if (waterMesh) groups.tiles.remove(waterMesh);

  const size = GAME_CONFIG.mapRadius * GAME_CONFIG.hexSize * 8.2;
  const segments = 220;
  let geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const tile = dominantTileAt(state, x, z);
    let h = sampleTerrainHeightFromGrid(state, x, z);
    if (tile?.type === 'river') h = Math.min(h, GAME_CONFIG.terrain.waterLevel - 0.02 + fbm(x, z, 2, 0.5, 0.1) * 0.015);
    pos.setY(i, h);
  }

  geo.computeVertexNormals();
  const normals = geo.attributes.normal;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const steepness = 1 - Math.abs(normals.getY(i));
    const tile = dominantTileAt(state, x, z);
    const c = colorFor(tile?.type || 'grass', y, x, z, steepness);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  terrainMesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    flatShading: false,
    clearcoat: 0
  }));
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  terrainMesh.name = 'terrain-mesh';
  groups.tiles.add(terrainMesh);

  let waterGeo = new THREE.PlaneGeometry(size, size, 120, 120);
  waterGeo.rotateX(-Math.PI / 2);
  const waterPos = waterGeo.attributes.position;
  for (let i = 0; i < waterPos.count; i++) {
    const x = waterPos.getX(i), z = waterPos.getZ(i);
    const tile = dominantTileAt(state, x, z);
    let visible = tile?.type === 'river' ? 1 : 0;
    visible *= Math.max(0, 1 - Math.min(1, (tile?.riverDistance || 99) / 6));
    const wave = noise2D(x * 0.08, z * 0.08) * 0.03 * visible;
    waterPos.setY(i, GAME_CONFIG.terrain.waterLevel + wave + (visible ? 0.02 : -8));
  }
  waterGeo.computeVertexNormals();
  waterMesh = new THREE.Mesh(waterGeo, new THREE.MeshPhysicalMaterial({
    color: 0x67b8df,
    transparent: true,
    opacity: 0.78,
    roughness: 0.16,
    metalness: 0.08
  }));
  waterMesh.receiveShadow = true;
  groups.tiles.add(waterMesh);

  state.map.forEach((tile) => { tile.surfaceY = sampleTerrainHeightFromGrid(state, tile.pos.x, tile.pos.z); });
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
