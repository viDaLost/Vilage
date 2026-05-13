import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import { TERRAIN_TYPES, GAME_CONFIG } from "../config.js";

const raycaster = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const noise2D = createNoise2D();

let terrainMesh = null;
let waterMesh = null;
let terrainMaterial = null;
let waterMaterial = null;

function disposeObjectTree(root) {
  if (!root) return;
  root.traverse?.((obj) => {
    if (obj.isMesh) obj.geometry?.dispose?.();
  });
}

function makeCanvas(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function makeRepeatingTexture(drawFn, repeatX = 12, repeatY = 12) {
  const canvas = makeCanvas(512);
  const ctx = canvas.getContext('2d');
  drawFn(ctx, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Более натуральная текстура травы (эффект нарисованных пятен)
function makeGrassTexture() {
  return makeRepeatingTexture((ctx, w, h) => {
    ctx.fillStyle = '#658a3e';
    ctx.fillRect(0, 0, w, h);

    // Рисуем мягкие пятна
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 10 + Math.random() * 30;
      const isLight = Math.random() > 0.5;
      
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, isLight ? 'rgba(125, 168, 79, 0.15)' : 'rgba(78, 107, 47, 0.15)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Немного мелких деталей "цветов" и "камней"
    for (let i = 0; i < 150; i++) {
      ctx.fillStyle = Math.random() > 0.8 ? 'rgba(255,235,170,0.3)' : 'rgba(40,50,30,0.2)';
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 10, 10);
}

function makeGrassNormalTexture() {
  return makeRepeatingTexture((ctx, w, h) => {
    ctx.fillStyle = 'rgb(128,128,255)';
    ctx.fillRect(0, 0, w, h);
    // Мягкий бамп-маппинг
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 5 + Math.random() * 15;
      const c = 128 + (Math.random() - 0.5) * 40;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${c},${c},255, 0.3)`);
      grad.addColorStop(1, 'rgba(128,128,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 10, 10);
}

// Более глубокая и красивая вода
function makeWaterTexture() {
  return makeRepeatingTexture((ctx, w, h) => {
    ctx.fillStyle = '#2d7a9d';
    ctx.fillRect(0, 0, w, h);

    // Световые блики (каустика)
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const rw = 15 + Math.random() * 40;
      const rh = 3 + Math.random() * 8;
      
      const grad = ctx.createRadialGradient(x, y, 0, x, y, rw);
      grad.addColorStop(0, 'rgba(130, 210, 240, 0.2)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(x, y, rw, rh, Math.random() * 0.2 - 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 6, 6);
}

function makeWaterNormalTexture() {
  return makeRepeatingTexture((ctx, w, h) => {
    ctx.fillStyle = 'rgb(128,128,255)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 200; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.fillStyle = `rgba(140, 140, 255, 0.4)`;
        ctx.beginPath();
        ctx.ellipse(x, y, 20 + Math.random() * 20, 5 + Math.random() * 10, 0, 0, Math.PI * 2);
        ctx.fill();
    }
  }, 6, 6);
}

function ensureTerrainMaterials() {
  if (!terrainMaterial) {
    terrainMaterial = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      map: makeGrassTexture(),
      normalMap: makeGrassNormalTexture(),
      normalScale: new THREE.Vector2(0.6, 0.6),
      envMapIntensity: 0.3
    });
  }
  if (!waterMaterial) {
    waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x4fb4e3,
      transparent: true,
      opacity: 0.9,
      roughness: 0.1,
      metalness: 0.1,
      clearcoat: 0.8,
      reflectivity: 0.5,
      map: makeWaterTexture(),
      normalMap: makeWaterNormalTexture(),
      normalScale: new THREE.Vector2(0.7, 0.7),
      envMapIntensity: 0.8,
      depthWrite: false
    });
  }
}

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
  if (!tile) return 0;
  
  // If a building or construction placeholder occupies the tile, the pad stays flat and stable.
  if (tile.buildingId) return 0;

  const gentle = fbm(x, z, 4, 0.55, 0.014) * 0.24;
  const detail = fbm(x + 40, z - 10, 3, 0.45, 0.05) * 0.055;

  if (tile.type === 'water') return -0.05 + detail * 0.04;
  if (tile.type === 'river') return -0.03 + detail * 0.07;
  if (tile.type === 'rock') return 0.42 + detail * 0.75;
  if (tile.type === 'hill') return 0.18 + detail * 0.38;
  if (tile.type === 'fertile') return gentle * 0.45 + detail * 0.45;

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
  
  if (type === 'water') {
    c.setHex(0x2f88b7);
    c.offsetHSL(0, 0.03 * shade, 0.08 * shade);
  }

  if (type === 'river') {
    c.lerp(new THREE.Color(0x6f9e6d), 0.35);
    if (Math.abs(shade) > 0.35) c.lerp(new THREE.Color(0xd5c28d), 0.12);
  }

  if (type === 'fertile') {
    c.lerp(new THREE.Color(0x9c8b53), 0.12);
  }
  
  // Камень на крутых склонах
  if (steepness > 0.35 || type === 'rock') {
    c.lerp(new THREE.Color(0x7a7770), Math.min(1, 0.2 + steepness * 1.5));
  }
  
  // Снег на вершинах
  if (type !== 'river' && h > 1.4) {
      c.lerp(new THREE.Color(0xffffff), Math.min(1, (h - 1.4) * 0.8));
  }
  
  if (type === 'forest') {
    c.lerp(new THREE.Color(0x3a5423), 0.25);
  }
  return c;
}

export function buildTerrain(sceneCtx, state) {
  const { groups } = sceneCtx;
  if (terrainMesh) {
    groups.tiles.remove(terrainMesh);
    terrainMesh.geometry?.dispose?.();
  }
  if (waterMesh) {
    groups.tiles.remove(waterMesh);
    disposeObjectTree(waterMesh);
  }
  ensureTerrainMaterials();

  const size = GAME_CONFIG.mapRadius * GAME_CONFIG.hexSize * 8.2;
  const segments = 220;
  let geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const tile = dominantTileAt(state, x, z);
    let h = sampleTerrainHeightFromGrid(state, x, z);
    
    // Water cells are carved below the animated water surface; river-bank cells stay walkable.
    if (tile?.type === 'water') h = Math.min(h, GAME_CONFIG.terrain.waterLevel - 0.22);
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

  terrainMesh = new THREE.Mesh(geo, terrainMaterial);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  terrainMesh.name = 'terrain-mesh';
  groups.tiles.add(terrainMesh);

  waterMesh = new THREE.Group();
  waterMesh.name = 'water-surfaces';
  for (const tile of state.map) {
    const isOpenWater = tile.type === 'water';
    const wetRiverEdge = tile.type === 'river' && (tile.riverDistance || 99) < 1.45;
    if (!isOpenWater && !wetRiverEdge) continue;
    const radius = GAME_CONFIG.hexSize * (isOpenWater ? 0.9 : 0.48);
    const waterGeo = new THREE.CircleGeometry(radius, 28);
    waterGeo.rotateX(-Math.PI / 2);
    const patch = new THREE.Mesh(waterGeo, waterMaterial);
    patch.position.set(tile.pos.x, GAME_CONFIG.terrain.waterLevel + 0.018, tile.pos.z);
    patch.rotation.y = (tile.q * 0.37 + tile.r * 0.21) % (Math.PI * 2);
    patch.receiveShadow = true;
    waterMesh.add(patch);
  }
  waterMesh.renderOrder = 2;
  groups.tiles.add(waterMesh);

  state.map.forEach((tile) => { tile.surfaceY = sampleTerrainHeightFromGrid(state, tile.pos.x, tile.pos.z); });
  return terrainMesh;
}

export function updateTerrainVisuals(state, time = 0) {
  if (waterMaterial?.map) {
    waterMaterial.map.offset.x = (time * 0.0002) % 1;
    waterMaterial.map.offset.y = (time * 0.0001) % 1;
  }
  if (waterMaterial?.normalMap) {
    waterMaterial.normalMap.offset.x = (-time * 0.0003) % 1;
    waterMaterial.normalMap.offset.y = (time * 0.00015) % 1;
  }
}

export function getTerrainPoint(x, z) {
  if (!terrainMesh) return new THREE.Vector3(x, 0, z);
  raycaster.set(new THREE.Vector3(x, 250, z), down);
  const hits = raycaster.intersectObject(terrainMesh, false);
  return hits.length ? hits[0].point.clone() : new THREE.Vector3(x, 0, z);
}

export function getTerrainY(x, z) { return getTerrainPoint(x, z).y; }
export function getTerrainMesh() { return terrainMesh; }
