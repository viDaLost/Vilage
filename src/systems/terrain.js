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
    // Делаем шум "острым", переворачивая его модулем
    let n = 1.0 - Math.abs(noise2D(x * frequency, z * frequency));
    n *= n; // Усиливаем остроту
    total += n * amplitude * weight;
    weight = Math.max(0.1, Math.min(1.0, n * 2.0)); // Умная эрозия: пики порождают пики
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return total;
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

// Комбинированная функция рельефа
function macroTerrain(x, z) {
  // Базовая форма (холмы, равнины)
  const baseTerrain = fbm(x, z, 5, 0.5, 0.01) * 2.5; 
  
  // Горные хребты
  const mountains = ridgedNoise(x + 100, z - 50, 4, 0.015) * 3.5;
  
  // Маска, чтобы горы появлялись только в определенных местах
  const mountainMask = fbm(x, z, 2, 0.5, 0.005);
  const actualMountains = mountains * Math.max(0, mountainMask + 0.2);

  // Мелкие детали (камни, кочки)
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
    // Более плавное затухание веса для мягких переходов биомов
    const w = Math.max(0, 1.0 - (d2 / maxDist2));
    const smoothW = w * w * (3 - 2 * w); // Smoothstep функция
    
    weightSum += smoothW;
    heightSum += tile.height * smoothW;
  }
  
  const base = weightSum > 0 ? (heightSum / weightSum) : ((dominantTileAt(state, x, z)?.height) || 0);
  return base + macroTerrain(x, z);
}

// Умная раскраска с учетом высоты и крутизны склона
function colorFor(type, h, x, z, steepness) {
  // Базовые цвета биомов берем из конфига или ставим реалистичные дефолты
  let baseColorHex = TERRAIN_TYPES[type]?.color || 0x6e8e45; // Зеленый по умолчанию
  let c = new THREE.Color(baseColorHex);

  // 1. Добавляем цветовой шум (чтобы трава не была однотонной)
  const colorNoise = fbm(x, z, 3, 0.5, 0.05);
  c.offsetHSL(0.0, colorNoise * 0.05, colorNoise * 0.1 - 0.05);

  // 2. Раскраска по крутизне склона (Slope texturing)
  // Если склон крутой, обнажается скальная порода или грязь
  const rockColor = new THREE.Color(0x7a7a7a).offsetHSL(0, 0, colorNoise * 0.1); // Серый камень
  const dirtColor = new THREE.Color(0x6b543a); // Темная земля
  
  if (steepness > 0.45) {
    // Очень крутой склон - камень
    const blend = Math.min(1.0, (steepness - 0.45) * 3.0);
    c.lerp(rockColor, blend);
  } else if (steepness > 0.3) {
    // Средний склон - земля/грязь
    const blend = Math.min(1.0, (steepness - 0.3) * 6.0);
    c.lerp(dirtColor, blend);
  }

  // 3. Снежные шапки на больших высотах
  if (h > 4.5) {
    const snowColor = new THREE.Color(0xffffff);
    // Делаем край снега неровным с помощью шума
    const snowThreshold = 4.5 + fbm(x, z, 2, 0.5, 0.1) * 0.8;
    if (h > snowThreshold) {
      const snowBlend = Math.min(1.0, (h - snowThreshold) * 1.5);
      c.lerp(snowColor, snowBlend);
    }
  }

  // 4. Песок/земля у воды
  const waterLvl = GAME_CONFIG.terrain.waterLevel || 0;
  if (h > waterLvl && h < waterLvl + 0.3) {
    const sandColor = new THREE.Color(0xd9c593); // Песочный
    const sandBlend = 1.0 - ((h - waterLvl) / 0.3);
    c.lerp(sandColor, sandBlend);
  }

  // Усиливаем цвет дна для глубины
  if (type === 'water' || h <= waterLvl) {
    const depth = Math.min(1.0, (waterLvl - h) / 2.0);
    const deepWaterColor = new THREE.Color(0x1a4f66); // Темно-синий
    c.lerp(deepWaterColor, depth);
  }

  return c;
}

export function buildTerrain(sceneCtx, state) {
  const { groups } = sceneCtx;
  if (terrainMesh) groups.tiles.remove(terrainMesh);
  if (waterMesh) groups.tiles.remove(waterMesh);

  const size = GAME_CONFIG.mapRadius * GAME_CONFIG.hexSize * 5.2;
  const segments = 220; // Увеличил количество полигонов для детализации рельефа
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = [];
  
  // Кэшируем высоты, чтобы посчитать крутизну склонов (нормали)
  const heights = new Float32Array(pos.count);

  // Первый проход: вычисляем только высоту
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const nearest = dominantTileAt(state, x, z);
    const type = nearest?.type || 'grass';
    
    let h = sampleTerrainHeightFromGrid(state, x, z);
    if (type === 'water') h -= 0.5; // Углубляем реки/озера
    
    heights[i] = h;
    pos.setY(i, h);
  }

  // Второй проход: красим с учетом уклона
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heights[i];
    
    const nearest = dominantTileAt(state, x, z);
    const type = nearest?.type || 'grass';

    // Примерная оценка крутизны склона по соседним вершинам
    let steepness = 0;
    // Проверяем соседа справа и снизу (защита от выхода за границы массива)
    if (i % (segments + 1) !== segments && i + segments + 1 < pos.count) {
      const hRight = heights[i + 1];
      const hDown = heights[i + segments + 1];
      const dx = Math.abs(h - hRight);
      const dz = Math.abs(h - hDown);
      // Чем больше разница высот на шаг сетки, тем круче склон
      const stepSize = size / segments;
      steepness = Math.sqrt(dx * dx + dz * dz) / stepSize; 
    }

    const c = colorFor(type, h, x, z, steepness);
    colors.push(c.r, c.g, c.b);
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // Используем MeshPhysicalMaterial для реалистичного освещения
  terrainMesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
    vertexColors: true, 
    roughness: 0.85, 
    metalness: 0.05, 
    flatShading: false,
    clearcoat: 0.0 // Земля матовая
  }));
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true; // Теперь горы отбрасывают тени!
  terrainMesh.name = 'terrain-mesh';
  groups.tiles.add(terrainMesh);

  // Улучшенная вода
  const waterGeo = new THREE.PlaneGeometry(size * 0.96, size * 0.96, 64, 64);
  waterGeo.rotateX(-Math.PI / 2);
  
  // Делаем воду слегка неровной (волны)
  const waterPos = waterGeo.attributes.position;
  for(let i=0; i < waterPos.count; i++) {
      const wx = waterPos.getX(i);
      const wz = waterPos.getZ(i);
      const wave = noise2D(wx * 0.1, wz * 0.1) * 0.1;
      waterPos.setY(i, wave);
  }
  waterGeo.computeVertexNormals();

  waterMesh = new THREE.Mesh(waterGeo, new THREE.MeshPhysicalMaterial({
    color: 0x4da6ff, 
    transparent: true, 
    opacity: 0.75, 
    roughness: 0.1, // Вода гладкая
    metalness: 0.1,
    transmission: 0.5, // Эффект преломления/стекла
    ior: 1.33 // Индекс преломления воды
  }));
  waterMesh.position.y = GAME_CONFIG.terrain.waterLevel || 0;
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
