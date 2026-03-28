import * as THREE from 'three';
import { GAME_CONFIG } from '../config.js';

export function setupInput(sceneCtx, state, handlers) {
  const { camera, renderer, groups } = sceneCtx;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = { x: 0, y: 0 };

  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    state.dragging = false;
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) state.dragging = true;
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (state.dragging) return;
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const unitHits = raycaster.intersectObjects(groups.units.children, true);
    if (unitHits.length) {
      const unitObj = unitHits[0].object;
      const unit = state.units.find((u) => u.mesh === unitObj.parent || u.mesh === unitObj || u.mesh.children.includes(unitObj));
      if (unit) return handlers.onUnit(unit);
    }

    const hits = raycaster.intersectObjects(groups.tiles.children, false);
    if (!hits.length) return;
    const hit = hits[0].object;
    const tile = state.map.find((t) => t.mesh === hit);
    if (!tile) return;

    const now = performance.now();
    const isDoubleTap = state.lastTapTileId === tile.id && (now - state.lastTapAt) <= GAME_CONFIG.doubleTapMs;
    state.lastTapTileId = tile.id;
    state.lastTapAt = now;

    if (isDoubleTap && handlers.onTileDouble) {
      handlers.onTileDouble(tile);
    } else {
      handlers.onTile(tile);
    }
  });
}
