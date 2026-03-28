import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import { TERRAIN_TYPES, GAME_CONFIG } from "../config.js";

const raycaster = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const noise2D = createNoise2D();

let terrainMesh = null;
let waterMesh = null;

// Фрактальный шум (FBM) для создания реалистичных неровностей
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
  return total / maxValue;
}

// Гребнистый шум для острых горных пиков
function ridgedNoise(x, z, octaves = 3, scale = 1.0) {
  let total = 0;
  let frequency = scale;
  let amplitude = 1;
  let weight = 1.0;

  for (let i = 0; i < octaves; i++) {
    let n = 1.0 - Math.abs(noise2D(x * frequency, z * frequency));
    n *= n;
    total += n * amplitude * weight;
    weight = Math.max(0.1, Math.min(1.0, n * 2.0));
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return total;
}

// Находит ближайший гекс на карте (для определения биома)
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

// Комбинированная функция рельефа
function macroTerrain(x, z) {
  const baseTerrain = fbm(x, z, 5, 0.5, 0.01) * 2.5; 
  const mountains = ridgedNoise(x + 100, z - 50, 4, 0.015) * 3.5;
  const mountainMask = fbm(x, z, 2, 0.5, 0.005);
  const actualMountains = mountains * Math.max(0, mountainMask + 0.2);
  const detail = fbm(x, z, 3, 0.4, 0.08) * 0.3;

  return baseTerrain + actualMountains + detail;
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
    
    const w = Math.max(0, 1.0 - (d2 / maxDist2));
    const smoothW = w * w * (3 - 2 * w);
    
    weightSum += smoothW;
    heightSum += tile.height * smoothW;
  }
  
  const base = weightSum > 0 ? (heightSum / weightSum) : ((dominantTileAt(state, x, z)?.height) || 0);
  return base + macroTerrain(x, z);
}

// Умная раскраска с учетом высоты и крутизны склона
function colorFor(type, h, x, z, steepness) {
  let baseColorHex = TERRAIN_TYPES[type]?.color || 0x6e8e45;
  let c = new THREE.Color(baseColorHex);

  const colorNoise = fbm(x, z, 3, 0.5, 0.05);
  c.offsetHSL(0.0, colorNoise * 0.05, colorNoise * 0.1 - 0.05);

  const rockColor = new THREE.Color(0x7a7a7a).offsetHSL(0, 0, colorNoise * 0.1);
  const dirtColor = new THREE.Color(0x6b543a);
  
  if (steepness > 0.45) {
    const blend = Math.min(1.0, (steepness - 0.45) * 3.0);
    c.lerp(rockColor, blend);
  } else if (steepness > 0.3) {
    const blend = Math.min(1.0, (steepness - 0.3) * 6.0);
    c.lerp(dirtColor, blend);
  }

  if (h > 4.5) {
    const snowColor = new THREE.Color(0xffffff);
    const snowThreshold = 4.5 + fbm(x, z, 2, 0.5, 0.1) * 0.8;
    if (h > snowThreshold) {
      const snowBlend = Math.min(1.0, (h - snowThreshold) * 1.5);
      c.lerp(snowColor, snowBlend);
    }
  }

  // Защита от отсутствия waterLevel в конфиге
  const waterLvl = GAME_CONFIG.terrain?.waterLevel || 0;
  if (h > waterLvl && h < waterLvl + 0.3) {
    const sandColor = new THREE.Color(0xd9c593);
    const sandBlend = 1.0 - ((h - waterLvl) / 0.3);
    c.lerp(sandColor, sandBlend);
  }

  if (type === 'water' || h <= waterLvl) {
    const depth = Math.min(1.0, (waterLvl - h) / 2.0);
    const deepWaterColor = new THREE.Color(0x1a4f66);
    c.lerp(deepWaterColor, depth);
  }

  return c;
}

export function buildTerrain(sceneCtx, state) {
  const { groups } = sceneCtx;
  if (terrainMesh) groups.tiles.remove(terrainMesh);
  if (waterMesh) groups.tiles.remove(waterMesh);

  const size = GAME_CONFIG.mapRadius * GAME_CONFIG.hexSize * 5.2;
  const segments = 80; // Размер полигонов (чем меньше число, тем крупнее грани)
  let geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  
  // 1. Сначала задаем высоту для связанной сетки
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const nearest = dominantTileAt(state, x, z);
    const type = nearest?.type || 'grass';
    
    let h = sampleTerrainHeightFromGrid(state, x, z);
    if (type === 'water') h -= 0.5; 
    
    pos.setY(i, h);
  }

  // 2. Отвязываем полигоны друг от друга для граненого стиля
  geo = geo.toNonIndexed();
  
  const nonIndexedPos = geo.attributes.position;
  const colors = [];

  // 3. Красим каждый треугольник целиком
  for (let i = 0; i < nonIndexedPos.count; i += 3) {
    const v1 = new THREE.Vector3(nonIndexedPos.getX(i), nonIndexedPos.getY(i), nonIndexedPos.getZ(i));
    const v2 = new THREE.Vector3(nonIndexedPos.getX(i+1), nonIndexedPos.getY(i+1), nonIndexedPos.getZ(i+1));
    const v3 = new THREE.Vector3(nonIndexedPos.getX(i+2), nonIndexedPos.getY(i+2), nonIndexedPos.getZ(i+2));

    const centerX = (v1.x + v2.x + v3.x) / 3;
    const centerY = (v1.y + v2.y + v3.y) / 3;
    const centerZ = (v1.z + v2.z + v3.z) / 3;

    // Считаем наклон треугольника
    const cb = new THREE.Vector3().subVectors(v3, v2);
    const ab = new THREE.Vector3().subVectors(v1, v2);
    const normal = cb.cross(ab).normalize();
    const steepness = 1.0 - Math.abs(normal.y);

    const nearest = dominantTileAt(state, centerX, centerZ);
    const type = nearest?.type || 'grass';

    const c = colorFor(type, centerY, centerX, centerZ, steepness);

    // Три точки треугольника красятся в один цвет
    colors.push(c.r, c.g, c.b); 
    colors.push(c.r, c.g, c.b); 
    colors.push(c.r, c.g, c.b); 
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // 4. Создаем землю с flatShading
  terrainMesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
    vertexColors: true, 
    roughness: 0.9, 
    metalness: 0.0, 
    flatShading: true, // Включает "рубленый" свет
    clearcoat: 0.0
  }));
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  terrainMesh.name = 'terrain-mesh';
  groups.tiles.add(terrainMesh);

  // 5. Улучшенная граненая вода
  let waterGeo = new THREE.PlaneGeometry(size * 0.96, size * 0.96, 40, 40);
  waterGeo.rotateX(-Math.PI / 2);
  
  const waterPos = waterGeo.attributes.position;
  for(let i=0; i < waterPos.count; i++) {
      const wx = waterPos.getX(i);
      const wz = waterPos.getZ(i);
      const wave = noise2D(wx * 0.1, wz * 0.1) * 0.2;
      waterPos.setY(i, wave);
  }
  
  waterGeo = waterGeo.toNonIndexed();
  waterGeo.computeVertexNormals();

  waterMesh = new THREE.Mesh(waterGeo, new THREE.MeshPhysicalMaterial({
    color: 0x4da6ff, 
    transparent: true, 
    opacity: 0.8, 
    roughness: 0.2, 
    metalness: 0.1,
    flatShading: true // Грани для воды
  }));
  const waterLevel = GAME_CONFIG.terrain?.waterLevel || 0;
  waterMesh.position.y = waterLevel;
  waterMesh.receiveShadow = true;
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
