import { sampleTerrainHeight } from '../systems/terrain.js';
import { sampleTerrain } from '../systems/world.js';
import { GAME_CONFIG, TERRAIN_TYPES } from '../config.js';

export function drawMinimap(state) {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const size = Math.floor(canvas.clientWidth * dpr);
  if (canvas.width !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#0f0906';
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const scale = size / 86;

  const R = GAME_CONFIG.mapRadius * GAME_CONFIG.hexSize * 2.0;
  for (let x = -R; x <= R; x += 4.0) {
      for (let z = -R; z <= R; z += 4.0) {
          const terrain = sampleTerrain(state, x, z);
          ctx.fillStyle = '#' + (TERRAIN_TYPES[terrain.type]?.color || 0x000000).toString(16).padStart(6, '0');
          ctx.beginPath();
          ctx.arc(cx + x * scale, cy + z * scale, terrain.type === 'water' ? 1.7 : 2.4, 0, Math.PI * 2);
          ctx.fill();
      }
  }

  ctx.strokeStyle = 'rgba(255,214,107,.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, state.territoryRadius * scale, 0, Math.PI * 2);
  ctx.stroke();


  state.enemyCamps.forEach((camp) => {
    ctx.fillStyle = '#ff826d';
    ctx.fillRect(cx + camp.pos.x * scale - 2, cy + camp.pos.z * scale - 2, 4, 4);
  });
  state.buildings.forEach((b) => {
    ctx.fillStyle = b.type === 'capital' ? '#ffd66b' : '#ffffff';
    ctx.fillRect(cx + b.pos.x * scale - 2, cy + b.pos.z * scale - 2, 4, 4);
  });
}
