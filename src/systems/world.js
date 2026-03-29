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

export function generateWorld(state) {
  const noise2D = createNoise2D();
  const radius = GAME_CONFIG.mapRadius;
  state.map.length = 0;
  state.mapIndex.clear();

  const riverAngle = noise2D(11.4, -7.2) * 0.5;
  const riverDir = new THREE.Vector2(Math.cos(riverAngle), Math.sin(riverAngle));
  const riverNormal = new THREE.Vector2(-riverDir.y, riverDir.x);

  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const s = -q - r;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > radius) continue;
      const pos = axialToWorld(q, r);
      const d = Math.hypot(pos.x, pos.z);
      const low = noise2D(q * .12, r * .12);
      const detail = noise2D(q * .24 + 70, r * .24 - 50);
      const ridge = noise2D(q * .09 - 200, r * .09 + 140);

      const worldPos = new THREE.Vector2(pos.x, pos.z);
      const along = worldPos.dot(riverDir);
      const across = Math.abs(worldPos.dot(riverNormal) + noise2D(q * .17 + 5, r * .17 - 9) * 2.2 + Math.sin(along * 0.09) * 1.8);
      const riverWidth = 2.4 + Math.max(0, (radius - Math.abs(along / (GAME_CONFIG.hexSize * 2.2))) * 0.03);

      let type = 'grass';
      let height = 0.16 + low * 0.08 + detail * 0.05;

      if (across < riverWidth * 0.55) {
        type = 'river';
        height = GAME_CONFIG.terrain.waterLevel + 0.04 + detail * 0.03;
      } else if (across < riverWidth + 1.4) {
        type = 'fertile';
        height = 0.08 + low * 0.05;
      } else if (ridge > 0.42 && d > 8) {
        type = 'rock';
        height = 0.9 + ridge * 0.28 + detail * 0.08;
      } else if (ridge > 0.22 && d > 6) {
        type = 'hill';
        height = 0.48 + ridge * 0.18 + detail * 0.06;
      } else if (detail < -0.38 && across > riverWidth + 2.5) {
        type = 'forest';
        height = 0.19 + low * 0.05;
      } else if (across < riverWidth + 2.6) {
        type = 'fertile';
        height = 0.12 + low * 0.04;
      }

      if (d < 4.5 && type !== 'river') {
        type = 'sacred';
        height = 0.16;
      }

      const tile = {
        id: tileKey(q, r), q, r, type, pos, height,
        noise: detail,
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
