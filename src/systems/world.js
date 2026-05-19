import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { GAME_CONFIG } from '../config.js';

// Continuous space mapping
export function worldToGrid(x, z) {
  return {
    gx: Math.floor(x / GAME_CONFIG.gridSize),
    gz: Math.floor(z / GAME_CONFIG.gridSize)
  };
}

export function gridToWorld(gx, gz) {
  return new THREE.Vector3(
    gx * GAME_CONFIG.gridSize + GAME_CONFIG.gridSize / 2,
    0,
    gz * GAME_CONFIG.gridSize + GAME_CONFIG.gridSize / 2
  );
}

function biomeNoise(noise2D, x, z, scale, ox = 0, oy = 0) {
  return noise2D(x * scale + ox, z * scale + oy);
}

export function generateWorld(state) {
  const noise2D = createNoise2D();
  const radius = GAME_CONFIG.mapRadius * GAME_CONFIG.hexSize * 2.5; // Scale mapping correctly to new size

  state.worldConfig = {
    radius,
    noise2D,
    riverAngle: noise2D(11.4, -7.2) * 0.75 + 0.35
  };

  state.worldConfig.riverDir = new THREE.Vector2(Math.cos(state.worldConfig.riverAngle), Math.sin(state.worldConfig.riverAngle));
  state.worldConfig.riverNormal = new THREE.Vector2(-state.worldConfig.riverDir.y, state.worldConfig.riverDir.x);
}

export function sampleTerrain(state, x, z) {
  if (!state.worldConfig) return { type: 'grass', height: 0, steepness: 0, elevation: 0 };

  const { radius, noise2D, riverDir, riverNormal } = state.worldConfig;

  const d = Math.hypot(x, z);
  const edge = d / radius;
  const centerSafe = Math.max(0, 1 - d / (radius * 0.25));

  const qx = x / (GAME_CONFIG.hexSize * 1.5);
  const qz = z / (GAME_CONFIG.hexSize * Math.sqrt(3));

  const moisture = biomeNoise(noise2D, qx, qz, 0.075, -41, 13);
  const elevation = biomeNoise(noise2D, qx, qz, 0.055, 88, -23) * 0.72 + biomeNoise(noise2D, qx, qz, 0.12, 9, 61) * 0.28;
  const detail = biomeNoise(noise2D, qx, qz, 0.24, 4, -7);
  const coast = noise2D(x * 0.035 + 19, z * 0.035 - 7) * 0.12 + noise2D(x * 0.085, z * 0.085) * 0.045;

  const worldPos = new THREE.Vector2(x, z);
  const along = worldPos.dot(riverDir);
  const meander = Math.sin(along * 0.105) * 2.9 + noise2D(qx * 0.16 + 12, qz * 0.16 - 2) * 2.2;
  const across = Math.abs(worldPos.dot(riverNormal) + meander);
  const riverWidth = 3.5 + Math.max(0, 1 - Math.abs(along) / (radius * 0.95)) * 2.5;

  const lakeA = Math.hypot(x - radius * 0.28, z + radius * 0.18) < 12.0 + noise2D(qx * .2, qz * .2) * 3.0;
  const lakeB = Math.hypot(x + radius * 0.38, z - radius * 0.22) < 9.0 + noise2D(qx * .23 - 3, qz * .23 + 8) * 2.0;

  let type = 'grass';
  const finalElevation = elevation - centerSafe * 0.9 - Math.max(0, edge - 0.72) * 0.6;
  let height = 0.12 + detail * 0.035 + finalElevation;
  const seaLine = 0.88 + coast;
  const beachLine = 0.82 + coast;

  if ((edge > seaLine && centerSafe < 0.02) || lakeA || lakeB) {
    type = 'water';
    height = GAME_CONFIG.terrain.waterLevel - 0.28 + detail * 0.025;
  } else if (edge > beachLine && centerSafe < 0.02) {
    type = 'fertile';
    height = 0.02 + detail * 0.025 + Math.max(0, finalElevation);
  } else if (across < riverWidth * 0.42 && centerSafe < 0.75) {
    type = 'water';
    height = GAME_CONFIG.terrain.waterLevel - 0.18 + detail * 0.015;
  } else if (across < riverWidth * 1.28) {
    type = 'river';
    height = 0.04 + detail * 0.018 + Math.max(0, finalElevation * 0.2);
  } else if (finalElevation > 0.48 && d > 15.0) {
    type = 'rock';
    height = 0.78 + finalElevation * 0.58 + detail * 0.08;
  } else if (finalElevation > 0.26 && d > 10.0) {
    type = 'hill';
    height = 0.36 + finalElevation * 0.24 + detail * 0.045;
  } else if (moisture > 0.18 && d > 8.0) {
    type = 'forest';
    height = 0.16 + detail * 0.035 + Math.max(0, finalElevation * 0.4);
  } else if (moisture < -0.26 || across < riverWidth * 2.15) {
    type = 'fertile';
    height = 0.10 + detail * 0.025 + Math.max(0, finalElevation * 0.5);
  }

  if (d < 12.0 && d > 5.0 && type === 'grass' && noise2D(qx * 0.45, qz * 0.45) > 0.62) {
    type = 'sacred';
    height = 0.16 + Math.max(0, finalElevation * 0.5);
  }

  // Flatten under buildings
  if (state.buildings) {
      for (const building of state.buildings) {
          const dx = x - building.pos.x;
          const dz = z - building.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist < building.blockRadius * 1.5) {
              const blend = Math.max(0, 1 - dist / (building.blockRadius * 1.5));
              height = height * (1 - blend) + building.surfaceY * blend;
          }
      }
  }

  return { type, height, moisture, elevation: finalElevation, riverDistance: across, noise: detail };
}

export function isTileInsideTerritory(state, x, z) {
  return Math.hypot(x, z) <= state.territoryRadius;
}
