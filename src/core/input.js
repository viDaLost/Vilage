import * as THREE from 'three';
import { MOUSE } from 'three';
import { GAME_CONFIG } from '../config.js';
import { closeDrawer } from '../ui/drawer.js';
import { closeModal } from '../ui/modal.js';
import { sampleTerrainHeight } from '../systems/terrain.js';

export function setupInput(sceneCtx, state, handlers) {
  const { camera, renderer, groups, controls } = sceneCtx;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // We'll no longer set MOUSE properties here because MapControls does it during initialization.
  // controls.mouseButtons.LEFT = MOUSE.ROTATE; // Removed to let MapControls govern

  let down = { x: 0, y: 0, t: 0 };

  const closeTransientUi = (target) => {
    if (target.closest('#context-drawer, #bottom-dock, #top-bar, #hud-strip, #side-panels, #modal-window, #unit-action-menu')) return;
    closeDrawer();
    closeModal();
  };

  const updatePointer = (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  };

  const dispatchTile = (hitPoint) => {
    const now = performance.now();
    // Simulate a pseudo-tile object since there's no continuous tile concept now
    const tile = {
      isTile: true,
      pos: new THREE.Vector3(hitPoint.x, 0, hitPoint.z),
      surfaceY: hitPoint.y
    };

    // Fallback: check double tap based on position proximity
    const isDoubleTap = state.lastTapPos && hitPoint.distanceTo(state.lastTapPos) < 2.0 && (now - state.lastTapAt) <= GAME_CONFIG.doubleTapMs;

    state.lastTapPos = hitPoint.clone();
    state.lastTapAt = now;

    if (isDoubleTap && handlers.onTileDouble) handlers.onTileDouble(tile);
    else handlers.onTile(tile);
  };

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // Only process left click for interaction
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    state.dragging = false;
  }, { passive: true });

  renderer.domElement.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) state.dragging = true;
  }, { passive: true });

  renderer.domElement.addEventListener('wheel', (e) => {
    if ('ontouchstart' in window) return;
    updatePointer(e);
    const hits = raycaster.intersectObject(groups.tiles, true);
    if (hits.length) {
      const p = hits[0].point;
      const target = new THREE.Vector3(p.x, Math.max(0, p.y), p.z);
      controls.target.lerp(target, .22);
    }
  }, { passive: true });

  renderer.domElement.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return; // Only process left click for interaction
    if (state.dragging) return;
    if (performance.now() - down.t > 420) return;

    updatePointer(e);
    closeTransientUi(e.target);

    // 1. Check Units
    const unitHits = raycaster.intersectObjects(groups.units.children, true);
    if (unitHits.length) {
      let unitObj = unitHits[0].object;
      while (unitObj && !unitObj.userData.unitId && unitObj.parent) unitObj = unitObj.parent;
      const unitId = unitObj?.userData?.unitId;
      const unit = unitId ? state.units.find((u) => u.id === unitId) : state.units.find((u) => u.mesh === unitObj);
      if (unit) return handlers.onUnit(unit, e);
    }

    // 2. Check Buildings
    const buildingHits = raycaster.intersectObjects(groups.buildings.children, true);
    if (buildingHits.length) {
      let obj = buildingHits[0].object;
      while (obj && !obj.userData.buildingId && obj.parent) obj = obj.parent;
      const buildingId = obj?.userData?.buildingId;
      const building = state.buildings.find(b => b.id === buildingId);

      // If we clicked a building, we can synthesize a tile object representing the building's footprint
      if (building) {
        const tile = {
            isTile: true,
            buildingId: building.id,
            pos: building.pos.clone(),
            surfaceY: building.surfaceY || 0,
            type: 'grass' // fallback
        };
        return dispatchTile(tile);
      }
    }

    // 3. Check Resource nodes (Decor)
    const decorHits = raycaster.intersectObjects(groups.decor.children, true);
    if (decorHits.length) {
        let obj = decorHits[0].object;
        while (obj && !obj.userData.resourceId && obj.parent) obj = obj.parent;
        const resourceId = obj?.userData?.resourceId;

        if (resourceId) {
            let resource = state.trees.find(t => t.id === resourceId) || state.rocks.find(r => r.id === resourceId);
            if (resource) {
                // Return resource interactions if needed, else ignore
                return;
            }
        }
    }

    // 4. Check Terrain
    const hits = raycaster.intersectObject(sceneCtx.groups.tiles, true);
    const terrainHit = hits.find(h => h.object.name === 'terrain-mesh');

    if (terrainHit) {
        return dispatchTile(terrainHit.point);
    }

    state.selected = null;
    handlers.onEmpty?.();
  });
}
