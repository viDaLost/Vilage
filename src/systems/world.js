import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { GAME_CONFIG, TERRAIN_TYPES } from '../config.js';
import { tileKey } from '../utils/helpers.js';

const HEX_DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];

export function axialToWorld(q, r, size = GAME_CONFIG.hexSize) {
  return new THREE.Vector3(
    size * Math.sqrt(3) * (q + r / 2) * GAME_CONFIG.axialScaleX,
    0,
    size * 1.5 * r * GAME_CONFIG.axialScaleZ
  );
}

export function createHexShape(size = GAME_CONFIG.hexSize * 1.04) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 3 * i + Math.PI / 6;
    const x = Math.cos(angle) * size;
    const y = Math.sin(angle) * size;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function biomeNoise(noise2D, q, r, scale, ox = 0, oy = 0) {
  return noise2D(q * scale + ox, r * scale + oy);
}

export function generateWorld(state) {
  const noise2D = createNoise2D();
  const radius = GAME_CONFIG.mapRadius;
  const maxWorldRadius = radius * GAME_CONFIG.hexSize * 1.78;
  state.map.length = 0;
  state.mapIndex.clear();

  const riverAngle = noise2D(11.4, -7.2) * 0.75 + 0.35;
  const riverDir = new THREE.Vector2(Math.cos(riverAngle), Math.sin(riverAngle));
  const riverNormal = new THREE.Vector2(-riverDir.y, riverDir.x);

  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const s = -q - r;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > radius) continue;

      const pos = axialToWorld(q, r);
      const d = Math.hypot(pos.x, pos.z);
      const edge = d / maxWorldRadius;
      const centerSafe = Math.max(0, 1 - d / 8.5);

      const moisture = biomeNoise(noise2D, q, r, 0.075, -41, 13);
      const elevation = biomeNoise(noise2D, q, r, 0.055, 88, -23) * 0.72 + biomeNoise(noise2D, q, r, 0.12, 9, 61) * 0.28;
      const detail = biomeNoise(noise2D, q, r, 0.24, 4, -7);
      const coast = noise2D(pos.x * 0.035 + 19, pos.z * 0.035 - 7) * 0.12 + noise2D(pos.x * 0.085, pos.z * 0.085) * 0.045;

      const worldPos = new THREE.Vector2(pos.x, pos.z);
      const along = worldPos.dot(riverDir);
      const meander = Math.sin(along * 0.105) * 2.9 + noise2D(q * 0.16 + 12, r * 0.16 - 2) * 2.2;
      const across = Math.abs(worldPos.dot(riverNormal) + meander);
      const riverWidth = 1.55 + Math.max(0, 1 - Math.abs(along) / (maxWorldRadius * 0.95)) * 1.15;

      const lakeA = Math.hypot(pos.x - maxWorldRadius * 0.28, pos.z + maxWorldRadius * 0.18) < 4.7 + noise2D(q * .2, r * .2) * 1.1;
      const lakeB = Math.hypot(pos.x + maxWorldRadius * 0.38, pos.z - maxWorldRadius * 0.22) < 3.3 + noise2D(q * .23 - 3, r * .23 + 8) * 0.9;

      let type = 'grass';
      let height = 0.12 + detail * 0.035;
      const finalElevation = elevation - centerSafe * 0.9 - Math.max(0, edge - 0.72) * 0.6;
      const seaLine = 0.88 + coast;
      const beachLine = 0.82 + coast;

      if ((edge > seaLine && centerSafe < 0.02) || lakeA || lakeB) {
        type = 'water';
        height = GAME_CONFIG.terrain.waterLevel - 0.28 + detail * 0.025;
      } else if (edge > beachLine && centerSafe < 0.02) {
        type = 'fertile';
        height = 0.02 + detail * 0.025;
      } else if (across < riverWidth * 0.42 && centerSafe < 0.75) {
        type = 'water';
        height = GAME_CONFIG.terrain.waterLevel - 0.18 + detail * 0.015;
      } else if (across < riverWidth * 1.28) {
        type = 'river';
        height = 0.04 + detail * 0.018;
      } else if (finalElevation > 0.48 && d > 7.2) {
        type = 'rock';
        height = 0.78 + finalElevation * 0.58 + detail * 0.08;
      } else if (finalElevation > 0.26 && d > 5.2) {
        type = 'hill';
        height = 0.36 + finalElevation * 0.24 + detail * 0.045;
      } else if (moisture > 0.18 && d > 4.2) {
        type = 'forest';
        height = 0.16 + detail * 0.035;
      } else if (moisture < -0.26 || across < riverWidth * 2.15) {
        type = 'fertile';
        height = 0.10 + detail * 0.025;
      }

      if (d < 5.2 && d > 2.1 && type === 'grass' && noise2D(q * 0.45, r * 0.45) > 0.62) {
        type = 'sacred';
        height = 0.16;
      }

      const tile = {
        id: tileKey(q, r), q, r, type, pos, height,
        noise: detail,
        moisture,
        elevation: finalElevation,
        riverDistance: across,
        buildingId: null,
        roadLinks: new Set(),
        selected: false,
        mesh: null,
        decorMeshes: []
      };
      state.map.push(tile);
      state.mapIndex.set(tile.id, tile);
    }
  }
}

export function getTile(state, q, r) {
  return state.mapIndex.get(tileKey(q, r)) || null;
}

export function getNeighbors(state, tile) {
  return HEX_DIRS.map(([dq, dr]) => getTile(state, tile.q + dq, tile.r + dr)).filter(Boolean);
}

export function isTileInsideTerritory(state, tile) {
  return Math.hypot(tile.pos.x, tile.pos.z) <= state.territoryRadius;
}

export function terrainColor(type) {
  return TERRAIN_TYPES[type].color;
}
