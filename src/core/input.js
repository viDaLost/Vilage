import * as THREE from 'three';
import { GAME_CONFIG } from '../config.js';
import { closeDrawer } from '../ui/drawer.js';
import { closeModal } from '../ui/modal.js';

export function setupInput(sceneCtx, state, handlers) {
  const { camera, renderer, groups } = sceneCtx;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = { x: 0, y: 0, t: 0 };

  const closeTransientUi = (target) => {
    if (target.closest('#context-drawer, #bottom-dock, #top-bar, #hud-strip, #side-panels, #modal-window')) return;
    closeDrawer();
    closeModal();
  };

  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    state.dragging = false;
  });

  renderer.domElement.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) state.dragging = true;
  });

  renderer.domElement.addEventListener('pointerup', (e) => {
    if (state.dragging) return;
    if (performance.now() - down.t > 360) return;

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    closeTransientUi(e.target);

    const unitHits = raycaster.intersectObjects(groups.units.children, true);
    if (unitHits.length) {
      const unitObj = unitHits[0].object;
      const unit = state.units.find((u) => u.mesh === unitObj.parent || u.mesh === unitObj || u.mesh.children.includes(unitObj));
      if (unit) return handlers.onUnit(unit);
    }

    const buildingHits = raycaster.intersectObjects(groups.buildings.children, true);
    if (buildingHits.length) {
      let obj = buildingHits[0].object;
      while (obj && !obj.userData.tileId && obj.parent) obj = obj.parent;
      const tileId = obj?.userData?.tileId;
      const tile = tileId ? state.mapIndex.get(tileId) : null;
      if (tile) {
        const now = performance.now();
        const isDoubleTap = state.lastTapTileId === tile.id && (now - state.lastTapAt) <= GAME_CONFIG.doubleTapMs;
        state.lastTapTileId = tile.id;
        state.lastTapAt = now;
        return isDoubleTap && handlers.onTileDouble ? handlers.onTileDouble(tile) : handlers.onTile(tile);
      }
    }

    const hits = raycaster.intersectObjects(groups.tiles.children, false);
    if (!hits.length) {
      state.selected = null;
      handlers.onEmpty?.();
      return;
    }

    const tile = state.map.find((t) => t.mesh === hits[0].object);
    if (!tile) return;

    const now = performance.now();
    const isDoubleTap = state.lastTapTileId === tile.id && (now - state.lastTapAt) <= GAME_CONFIG.doubleTapMs;
    state.lastTapTileId = tile.id;
    state.lastTapAt = now;

    if (isDoubleTap && handlers.onTileDouble) handlers.onTileDouble(tile);
    else handlers.onTile(tile);
  });
}
