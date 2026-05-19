function syncViewportHeight() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`);
}

syncViewportHeight();
window.addEventListener('resize', syncViewportHeight, { passive: true });
window.visualViewport?.addEventListener('resize', syncViewportHeight, { passive: true });
window.visualViewport?.addEventListener('scroll', syncViewportHeight, { passive: true });

import * as THREE from 'three';
import { GAME_CONFIG, BUILDINGS, UNITS } from './config.js';
import { createInitialState } from './state.js';
import { createScene } from './core/scene.js';
import { generateWorld, isTileInsideTerritory, sampleTerrain } from './systems/world.js';
import { updateTerrainVisuals, buildTerrain, sampleTerrainHeight } from './systems/terrain.js';
import { renderTiles, renderRoads, populateDecorModels, updateTerritoryOverlay } from './systems/renderWorld.js';
import { setupHud, updateHud } from './ui/hud.js';
import { drawMinimap } from './ui/minimap.js';
import { notify } from './ui/notifications.js';
import { openBuildMenu, openQuickBuildMenu, openResearchMenu, openTrainMenu, bindDrawerClose, closeDrawer, openBuildingMenu } from './ui/drawer.js';
import { setupModal, openModal, closeModal } from './ui/modal.js';
import { updateSelection } from './ui/selection.js';
import { setupInput } from './core/input.js';
import { canPlaceBuilding, hasCost, payCost, placeConstruction, finishConstruction, getBuildingById, getBuildingOnTile, getCapital, startUpgrade, repairBuilding, destroyBuilding, createGhostBuildingMesh, buildingCenter } from './systems/buildings.js';
import { applyRealTimeEconomy, updateConstruction, collectFinishedConstruction, updateEra, updateObjectives, updateResearch } from './systems/economy.js';
import { autoSpawnWorkers, queueTraining, updateTraining, updateUnits, spawnUnit, spawnPointNearBuilding } from './systems/units.js';
import { updateDefense, updateProjectiles, spawnCollapse } from './systems/combat.js';
import { maybeChangeWeather, updateEnemyWaves, updateEnvironmentState } from './systems/events.js';
import { saveGame, clearSave } from './systems/persistence.js';
import { $, $$ } from './ui/dom.js';
import { clamp } from './utils/helpers.js';
import { loadDecorModel, groundScene } from './core/assets.js';

const state = createInitialState();
const sceneCtx = createScene(document.getElementById('game'));
let ghostMesh = null;
let lastTime = performance.now();
let constructionDustTimer = 0;
let emergencyReleased = false;

function syncTileOverlayHeights() {} // removed since we don't have hex overlays

function emergencyRelease() {
  if (emergencyReleased) return;
  emergencyReleased = true;
  const ls = $('#loading-screen');
  if (ls) ls.style.display = 'none';
  state.timeScale = GAME_CONFIG.simBaseSpeed;
  try { showRules(); } catch { /* safe mode can run without modal UI */ }
  try { animate(); } catch { /* animation fallback is best effort */ }
}

function setLoading(percent, text) {
  $('#loading-fill').style.width = `${percent}%`;
  $('#loading-text').textContent = text;
}

async function bootstrap() {
  let loadingReleased = false;
  const releaseLoading = () => {
    if (loadingReleased) return;
    loadingReleased = true;
    emergencyReleased = true;
    $('#loading-screen').style.display = 'none';
    state.timeScale = GAME_CONFIG.simBaseSpeed;
    showRules();
    animate();
  };
  setupHud();
  setupModal();
  bindDrawerClose();
  hookButtons();

  setLoading(10, 'Генерация рельефа…');
  generateWorld(state);

  setLoading(30, 'Построение terrain mesh…');
  renderTiles(sceneCtx, state);

  setLoading(48, 'Размещение столицы…');
  await spawnCapital();
  createRoadNetworkFromCapital();
  renderRoads(sceneCtx, state);
  await spawnEnemyCamps();

  setLoading(58, 'Подготовка интерфейса…');
  updateHud(state);
  updateSelection(state);

  setLoading(72, 'Подключение ввода…');
  setupInput(sceneCtx, state, {
    onTile: onTileSelected,
    onTileDouble: onTileDoubleSelected,
    onUnit: onUnitSelected,
    onEmpty: () => { state.selected = null; updateSelection(state); }
  });

  setLoading(100, 'Готово');
  setTimeout(() => {
    releaseLoading();
    queueMicrotask(async () => {
      try {
        await populateDecorModels(sceneCtx, state);
      } catch (err) {
        console.warn('Decor background load failed', err);
      }
    });
  }, 260);

  addEventListener('resize', () => {
    sceneCtx.resize();
    refreshConstructionOverlays();
  });
}

setTimeout(() => {
  if ($('#loading-screen')?.style.display !== 'none') {
    setLoading(96, 'Лёгкий запуск мира…');
    emergencyRelease();
  }
}, 2500);

async function spawnCapital() {
  const center = { x: 0, z: 0 };
  const job = { type: 'capital', x: center.x, z: center.z, progress: 0, buildTime: 0, mode: 'new' };
  const capital = await finishConstruction(sceneCtx, state, job);
  state.capitalId = capital.id;
  state.resources.population = 4;
  state.resources.workers = 0;
  capital.level = 1;

  const pickStarter = (type, allowedTypes) => {
    // very hacky initial placement
    for (let r = 5.0; r < 25.0; r += 2.0) {
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
            const px = Math.cos(angle) * r;
            const pz = Math.sin(angle) * r;
            if (canPlaceBuilding(state, type, px, pz)) {
                const terrain = sampleTerrain(state, px, pz);
                if (allowedTypes.includes(terrain.type)) {
                    return { x: px, z: pz };
                }
            }
        }
    }
    return null;
  };

  const starter = [
    ['farm', pickStarter('farm', ['grass', 'fertile', 'river'])],
    ['lumber', pickStarter('lumber', ['forest', 'grass'])],
    ['mine', pickStarter('mine', ['hill', 'rock'])],
  ];
  for (const [type, tile] of starter) {
    if (!tile) continue;
    const build = placeConstruction(state, type, tile.x, tile.z);
    build.progress = build.buildTime;
  }
  // Rebuild terrain after reserving starter pads, so the first farms/mines are grounded from frame one.
  buildTerrain(sceneCtx, state);
  syncTileOverlayHeights();
  const completed = collectFinishedConstruction(state);
  const finishedBuildings = [];
  for (const done of completed) {
    const built = await finishConstruction(sceneCtx, state, done);
    if (built) finishedBuildings.push(built);
  }

  finishedBuildings
    .filter((b) => ['farm', 'lumber', 'mine'].includes(b.type))
    .forEach((building, index) => {
      const spawnPos = spawnPointNearBuilding(state, building, index) || buildingCenter(state, building).clone();
      const worker = spawnUnit(sceneCtx, state, 'worker', spawnPos, null);
      worker.assignedBuildingId = building.id;
      worker.awaitingWork = false;
      worker.taskPhase = building.type === 'farm' ? 'toBuilding' : 'toCapital';
      worker.gatherCooldown = 0;
      worker.forceJob = false;
    });

  state.resources.gold = Math.max(state.resources.gold, 140);
  state.resources.food = Math.max(state.resources.food, 120);
  state.resources.wood = Math.max(state.resources.wood, 95);
  state.resources.stone = Math.max(state.resources.stone, 70);
}

function createRoadNetworkFromCapital() {}

async function makeCampMesh(px, pz, faction) {
  const mesh = new THREE.Group();
  const baseY = sampleTerrainHeight(state, px, pz);
  mesh.position.set(px, baseY, pz);
  const fallback = new THREE.Mesh(new THREE.CylinderGeometry(.76, .94, .42, 6), new THREE.MeshStandardMaterial({ color: faction === 'iron' ? 0x666d76 : faction === 'beasts' ? 0x5c3c18 : 0x7a1711, roughness: 1 }));
  fallback.position.y = .21;
  mesh.add(fallback);
  try {
    const filename = faction === 'iron' ? 'small-watch-tower.glb' : (faction === 'beasts' ? 'wooden-encampment.glb' : 'hut.glb');
    const campModel = await loadDecorModel(filename);
    campModel.scale.setScalar(faction === 'iron' ? 0.95 : 0.9);
    groundScene(campModel, 0.02);
    mesh.add(campModel);
        } catch (e) { console.error('Error loading camp mesh', e); }
  return mesh;
}


async function spawnEnemyCamps() {
  const camps = [];
  for (let i = 0; i < GAME_CONFIG.enemyCampCount; i++) {
    for (let j = 0; j < 50; j++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = state.territoryRadius + 20 + Math.random() * 20;
        const px = Math.cos(angle) * radius;
        const pz = Math.sin(angle) * radius;
        const terrain = sampleTerrain(state, px, pz);
        if (terrain.type !== 'water' && terrain.type !== 'river' && terrain.elevation > 0) {
            camps.push({ px, pz });
            break;
        }
    }
  }

  const factions = ['clans', 'iron', 'beasts'];
  state.enemyCamps = await Promise.all(camps.map((camp, i) => {
    const faction = factions[i % factions.length];
    return makeCampMesh(camp.px, camp.pz, faction).then((mesh) => {
      sceneCtx.groups.enemyCamps.add(mesh);
      const hp = 120 + (faction === 'iron' ? 30 : 0);
      return { id: `camp-${i}`, hp, maxHp: hp, pos: mesh.position.clone(), mesh, faction, spawnCooldown: 5, hitFlash: 0 };
    });
  }));
}

async function tryPlaceBuilding(tile, forcedType = null) {
  if (!tile || !tile.pos) return;
  const px = tile.pos.x; const pz = tile.pos.z;
  const type = forcedType || state.selectedBuildType;
  if (!type) return;
  if (!canPlaceBuilding(state, type, px, pz)) {
    notify('Эту постройку нельзя разместить на выбранной клетке');
    return;
  }
  const cfg = BUILDINGS[type];
  if (!hasCost(state.resources, cfg.cost)) {
    notify('Недостаточно ресурсов');
    return;
  }
  payCost(state.resources, cfg.cost);

  const job = placeConstruction(state, type, px, pz);
  state.lastQuickBuildType = type;
  notify(`Начато строительство: ${cfg.name}`);
  closeDrawer();
  state.selectedBuildType = null;
  removeGhost();
  updateHud(state);
  updateSelection(state);
  buildTerrain(sceneCtx, state); // Пересобираем ландшафт, чтобы выровнять землю под постройкой
  syncTileOverlayHeights();
  refreshConstructionOverlays();
  return job;
}

function openTappedBuildingMenu(tile, building) {
  openBuildingMenu(state, building, tile, {
    upgrade: () => {
      const job = startUpgrade(state, building);
      if (!job) return notify('Не хватает ресурсов или уже идёт улучшение');
      notify(`Начато улучшение: ${BUILDINGS[building.type].name}`);
      updateHud(state);
      openTappedBuildingMenu(tile, building);
      refreshConstructionOverlays();
    },
    train: () => {
      openTrainMenu(state, () => {});
      bindTrainButtons();
    },
    repair: () => {
      const ok = repairBuilding(state, building);
      notify(ok ? 'Постройка укреплена' : 'Недостаточно ресурсов на ремонт');
      updateHud(state);
      openTappedBuildingMenu(tile, building);
    },
    rally: () => {
      state.placementMode = { type: 'rally', buildingId: building.id };
      closeDrawer();
      notify('Коснись клетки: сюда будут стекаться и патрулировать воины из этого здания');
    },
    demolish: () => {
      destroyBuilding(sceneCtx, state, building);

      spawnCollapse(sceneCtx, building.pos.clone().setY(building.surfaceY + 0.5));
      notify(`Постройка снесена: ${BUILDINGS[building.type].name}`);
      closeDrawer();
      updateHud(state);
      updateSelection(state);
      buildTerrain(sceneCtx, state); // Обновляем ландшафт, чтобы вернуть естественные холмы
      syncTileOverlayHeights();
      renderRoads(sceneCtx, state);
    },
  });
}

function onTileSelected(tile) {
  state.selected = { kind: 'tile', ref: tile };
  highlightSelection();
  const building = tile.buildingId ? state.buildings.find(b => b.id === tile.buildingId) : null;
  if (state.placementMode?.type === 'rally') {
    const source = getBuildingById(state, state.placementMode.buildingId);
    if (source) { source.rallyPos = tile.pos.clone(); notify(`Точка сбора назначена для ${BUILDINGS[source.type].name}`); }
    state.placementMode = null;
    return;
  }
  if (state.placementMode?.type === 'unit-command') {
    if (tile.type === 'water') {
      notify('Юниты не могут идти в воду. Выбери берег или сушу.');
      return;
    }
    state.selectedUnits.forEach((unit) => {
      const targetPoint = new THREE.Vector3(tile.pos.x, sampleTerrainHeight.bind(null, state)(tile.pos.x, tile.pos.z), tile.pos.z);
      unit.manualTarget = targetPoint.clone();
      unit.commandTarget = targetPoint.clone();
      unit.patrolCenter = targetPoint.clone();
      unit.mode = 'move';
      unit.forceJob = false;
    });
    if (state.selectedUnits.length) notify('Юнит направлен в точку');
    state.placementMode = null;
    updateSelection(state);
    return;
  }
  if (state.selectedBuildType) {
    tryPlaceBuilding(tile);
  } else if (building) {
    openTappedBuildingMenu(tile, building);
    updateSelection(state);
  } else {
    updateSelection(state);
  }
}

function onTileDoubleSelected(tile) {
  state.selected = { kind: 'tile', ref: tile };
  highlightSelection();
  const building = tile.buildingId ? state.buildings.find(b => b.id === tile.buildingId) : null;
  if (building) {
    openTappedBuildingMenu(tile, building);
    updateSelection(state);
    return;
  }
  const terrain = sampleTerrain(state, tile.pos.x, tile.pos.z);
  if (!isTileInsideTerritory(state, tile.pos.x, tile.pos.z) || terrain.type === 'water' || terrain.type === 'river') {
    notify('Эта сота пока не подходит для строительства');
    return;
  }
  if (state.lastQuickBuildType && canPlaceBuilding(state, state.lastQuickBuildType, tile.pos.x, tile.pos.z)) {
    tryPlaceBuilding(tile, state.lastQuickBuildType);
    return;
  }
  openQuickBuildMenu(state, tile, (type) => tryPlaceBuilding(tile, type));
  updateSelection(state);
}

function onUnitSelected(unit, event = null) {
  state.selected = { kind: 'unit', ref: unit };
  state.selectedUnits = unit.hostile ? [] : [unit];
  if (unit.hostile) {
    state.placementMode = null;
  } else {
    state.placementMode = null;
    openUnitActionMenu(unit, event);
  }
  highlightSelection();
  updateSelection(state);
}

function highlightSelection() {
  state.buildings.forEach((b) => { if (b.selection) b.selection.material.opacity = 0; });
  const sel = state.selected;
  if (sel?.kind === 'tile') {
    const building = getBuildingOnTile(state, sel.ref);
    if (building?.selection) building.selection.material.opacity = .65;
  }
}

function ensureUnitActionMenu() {
  let menu = document.getElementById('unit-action-menu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'unit-action-menu';
  menu.className = 'glass-panel';
  menu.innerHTML = `
    <div class=panel-title>Юнит</div>
    <button class=card-btn data-unit-action=move>Следовать на место</button>
    <button class=card-btn data-unit-action=work>Найти работу</button>
  `;
  document.getElementById('ui-root').appendChild(menu);
  menu.querySelector('[data-unit-action=move]').onclick = () => {
    const unit = state.selected?.ref;
    if (!unit || unit.hostile) return;
    state.selectedUnits = [unit];
    state.placementMode = { type: 'unit-command', unitId: unit.id };
    notify('Нажми на карту, куда должен пойти юнит');
    closeUnitActionMenu();
    updateSelection(state);
  };
  menu.querySelector('[data-unit-action=work]').onclick = () => {
    const unit = state.selected?.ref;
    if (!unit || unit.hostile) return;
    unit.forceJob = true;
    unit.manualTarget = null;
    unit.commandTarget = null;
    unit.patrolCenter = null;
    unit.mode = 'work';
    notify('Рабочий ищет ближайшее свободное здание');
    closeUnitActionMenu();
  };
  document.addEventListener('pointerdown', (e) => {
    const node = document.getElementById('unit-action-menu');
    if (!node || !node.classList.contains('visible')) return;
    if (e.target.closest('#unit-action-menu')) return;
    closeUnitActionMenu();
  });
  return menu;
}

function closeUnitActionMenu() {
  const menu = document.getElementById('unit-action-menu');
  if (menu) menu.classList.remove('visible');
}

function openUnitActionMenu(unit, event) {
  const menu = ensureUnitActionMenu();
  const x = event?.clientX ?? (window.innerWidth * 0.5);
  const y = event?.clientY ?? (window.innerHeight * 0.56);
  menu.style.left = `${Math.min(window.innerWidth - 240, Math.max(14, x - 30))}px`;
  menu.style.top = `${Math.min(window.innerHeight - 170, Math.max(120, y - 20))}px`;
  menu.classList.add('visible');
}

function hookButtons() {
  $$('[data-action]').forEach((btn) => {
    btn.onclick = () => handleAction(btn.dataset.action);
  });
}

function handleAction(action) {
  if (action === 'focus-capital') {
    const capital = getBuildingById(state, state.capitalId);
    if (!capital?.pos) return;
    const y = Number.isFinite(capital.surfaceY) ? capital.surfaceY : capital.pos.y;
    sceneCtx.controls.target.set(capital.pos.x, y, capital.pos.z);
    sceneCtx.camera.position.set(capital.pos.x + 18, y + 19, capital.pos.z + 14);
    closeDrawer();
  }
  if (action === 'build-menu') {
    openBuildMenu(state, (type) => {
      state.selectedBuildType = type;
      closeDrawer();
      showGhost(type);
      notify(`Выбери место для: ${BUILDINGS[type].name}`);
    });
  }
  if (action === 'train-menu') {
    openTrainMenu(state, () => {});
    bindTrainButtons();
  }
  if (action === 'research-menu') {
    openResearchMenu(state, notify);
  }
  if (action === 'select-all-army') {
    state.selectedUnits = state.units.filter((u) => !u.hostile && u.type !== 'worker');
    state.placementMode = state.selectedUnits.length ? { type: 'unit-command' } : null;
    if (state.selectedUnits.length) notify('Все войска выбраны. Укажи точку на карте.');
  }
  if (action === 'rules') {
    showRules();
  }
}

function bindTrainButtons() {
  document.querySelectorAll('[data-unit-type]').forEach((btn) => {
    btn.onclick = () => {
      const building = getBuildingById(state, btn.dataset.trainBuilding);
      const unitType = btn.dataset.unitType;
      if (!building || !unitType) return;
      const unit = UNITS[unitType];
      if (state.era < (unit.minEra ?? 0)) return notify('Эта эпоха ещё не открыла такой тип войск');
      const queuedPopulation = state.buildings.reduce((sum, b) => sum + (b.trainQueue?.length || 0), 0);
      if ((state.resources.population || 0) + queuedPopulation >= (state.resources.populationCap || 0)) {
        return notify('Не хватает места для людей. Улучши столицу или построй поддерживающие здания.');
      }
      const ok = Object.entries(unit.cost).every(([k, v]) => (state.resources[k] || 0) >= v);
      if (!ok) return notify('Недостаточно ресурсов на обучение');
      Object.entries(unit.cost).forEach(([k, v]) => state.resources[k] -= v);
      queueTraining(building, unitType);
      notify(`В очереди: ${unit.name}`);
      updateHud(state);
      openTrainMenu(state, () => {});
      bindTrainButtons();
    };
  });
}

function showRules() {
  openModal(
    'Обучение правителя',
    'Непрерывная RTS стратегия',
    `
      <p><strong>Цель:</strong> Разрушить базу врага или построить все типы зданий включая Чудо Света.</p>
      <p><strong>Управление:</strong> Левый клик для взаимодействия с картой и зданиями. Зажатие мыши или скролл — движение камеры и отдаление.</p>
      <p><strong>Экономика:</strong> Рабочие сами добывают ресурсы из леса и шахт. Строй больше амбаров и ферм, чтобы прокормить растущее население.</p>
      <p><strong>Враги:</strong> ИИ строит базу параллельно с вами и периодически отправляет отряды. Стройте стены и башни, чтобы защитить границы, и нанимайте армию в казармах.</p>
    `,
    [
      { label: 'Начать игру', primary: true, onClick: closeModal },
      { label: 'Стереть сохранение', onClick: () => { clearSave(); closeModal(); notify('Локальное сохранение очищено'); } },
    ]
  );
}

async function showGhost(type) {
  removeGhost();
  const ghostGroup = new THREE.Group();
  const fallback = new THREE.Mesh(
    new THREE.CylinderGeometry(1.28, 1.28, .16, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: .25 })
  );
  fallback.rotation.y = Math.PI / 6;
  ghostGroup.add(fallback);
  try {
    const model = await createGhostBuildingMesh(type);
    if (model) ghostGroup.add(model);
  } catch { /* ghost preview keeps fallback mesh if model is unavailable */ }
  ghostMesh = ghostGroup;
  sceneCtx.groups.ghosts.add(ghostMesh);
  sceneCtx.renderer.domElement.addEventListener('pointermove', pointerGhostMove);
  refreshBuildPreview(type);
}

function clearBuildPreview() {
  sceneCtx.groups.ghosts.children.filter((c) => c.userData?.preview).forEach((c) => sceneCtx.groups.ghosts.remove(c));
}

function refreshBuildPreview() {
  clearBuildPreview();
}

function pointerGhostMove(e) {
  if (!ghostMesh) return;
  const rect = sceneCtx.renderer.domElement.getBoundingClientRect();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, sceneCtx.camera);
  const hits = raycaster.intersectObject(sceneCtx.groups.tiles, true);
  const terrainHit = hits.find(h => h.object.name === 'terrain-mesh');

  if (!terrainHit) return;
  const px = terrainHit.point.x;
  const pz = terrainHit.point.z;

  ghostMesh.position.set(px, terrainHit.point.y, pz);
  const ok = canPlaceBuilding(state, state.selectedBuildType, px, pz);
  ghostMesh.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => { if (m.color) m.color.setHex(ok ? 0xb3ff84 : 0xff7b6f); });
    }
  });
}

function removeGhost() {
  if (!ghostMesh) return;
  sceneCtx.groups.ghosts.remove(ghostMesh);
  ghostMesh.geometry.dispose?.();
  ghostMesh.material.dispose?.();
  ghostMesh = null;
  sceneCtx.renderer.domElement.removeEventListener('pointermove', pointerGhostMove);
  clearBuildPreview();
}

async function processFinishedConstruction() {
  const done = collectFinishedConstruction(state);
  for (const job of done) {
    const entity = await finishConstruction(sceneCtx, state, job);
    if (entity) {
      notify(job.mode === 'upgrade' ? `Улучшено: ${BUILDINGS[entity.type].name} ур. ${entity.level}` : `Построено: ${BUILDINGS[job.type].name}`);
    }
  }
  if (done.length) {
    refreshConstructionOverlays();
    updateTerritoryOverlay(sceneCtx, state);
    renderRoads(sceneCtx, state);
  }
}

function updateDayNightVisual(dt) {
  const t = (state.dayTime % GAME_CONFIG.dayDuration) / GAME_CONFIG.dayDuration;
  const ang = t * Math.PI * 2;
  sceneCtx.sun.position.set(Math.cos(ang) * 40, Math.max(8, Math.sin(ang) * 34), Math.sin(ang) * 20 - 8);
  const weatherKey = state.weather || 'clear';
  const lightMul = { clear: 1, rain: .92, mist: .8, dust: .84, snow: .9 }[weatherKey] || 1;
  sceneCtx.sun.intensity = clamp(Math.sin(ang) * 1.15 + 1.28, 1.0, 2.6) * lightMul;
  sceneCtx.hemi.intensity = 1.05 + sceneCtx.sun.intensity * .4;
  sceneCtx.ambient.intensity = .68 + sceneCtx.sun.intensity * .12;
  if (sceneCtx.fill) sceneCtx.fill.intensity = .56 + sceneCtx.sun.intensity * .16;
  sceneCtx.stars.visible = sceneCtx.sun.position.y < 12;
  sceneCtx.sky.material.uniforms.topColor.value.setHex(sceneCtx.sun.position.y > 14 ? 0xaedfff : 0x33437d);
  sceneCtx.sky.material.uniforms.bottomColor.value.setHex(sceneCtx.sun.position.y > 14 ? 0xffdeb1 : 0x7c4d2b);
  sceneCtx.scene.fog.color.setHex(sceneCtx.sun.position.y > 14 ? 0x8e745f : 0x2a2740);
  sceneCtx.cloudLayer.children.forEach((cloud, i) => {
    cloud.rotation.y += dt * cloud.userData.drift * .1;
    cloud.position.x += Math.sin((state.worldTime * .03) + i) * dt * .1;
    cloud.position.z += Math.cos((state.worldTime * .02) + i) * dt * .08;
  });
  state.buildings.forEach((b) => {
    if (b.glow) b.glow.intensity = (b.type === 'capital' || b.type === 'temple' || b.type === 'tower' ? 1.0 : 0.48) + b.hitFlash * 1.5;
    if (b.hitFlash) {
      b.hitFlash = Math.max(0, b.hitFlash - dt * 3.5);
      b.mesh.scale.setScalar(1 + b.hitFlash * .08);
    } else {
      b.mesh.scale.setScalar(1);
    }
  });
}

function maybeAutoSave(dt) {
  state.autosaveTimer += dt;
  if (state.autosaveTimer < GAME_CONFIG.autosaveEvery) return;
  state.autosaveTimer = 0;
  maybeSaveGame();
}

function checkStateMilestones() {
  if (state.gameEnded) return;
  const capital = getCapital(state);
  if (!capital || capital.hp <= 0 || state.units.filter(u => u.type === 'worker' && !u.dead).length === 0) {
    state.gameEnded = true;
    state.paused = true;
    state.timeScale = 0;
    openModal('Держава пала', 'Власть рассыпалась', '<p>Столица была разрушена или все рабочие погибли. Империя пала под натиском врагов.</p>', [{ label: 'Понятно', primary: true, onClick: closeModal }]);
    return;
  }

  const allObjectives = state.objectives.every((o) => o.done);
  const enemyDefeated = state.enemyCamps.length === 0 && state.units.filter(u => u.hostile && !u.dead).length === 0 && state.era > 0;

  if (enemyDefeated) {
      state.gameEnded = true;
      openModal('Военная победа', 'Враг уничтожен', '<p>Все вражеские базы и юниты уничтожены! Ваша империя будет править вечно.</p>', [{ label: 'Продолжить', primary: true, onClick: closeModal }]);
  } else if (allObjectives) {
    state.gameEnded = true;
    openModal('Экономическая победа', 'Золотой век', '<p>Ты выполнил все строительные квесты и возвел Чудо Света. Империя достигла небывалого величия.</p>', [{ label: 'Продолжить', primary: true, onClick: closeModal }]);
  }
}

function refreshConstructionOverlays() {
  const wrap = $('#construction-overlays');
  if (!wrap) return;
  wrap.innerHTML = '';
  state.construction.forEach((job) => {
    const el = document.createElement('div');
    el.className = 'construction-timer';
    el.dataset.jobId = job.id;
    el.textContent = `${Math.max(0, Math.ceil(job.buildTime - job.progress))}с`;
    wrap.appendChild(el);
  });
}

function updateConstructionOverlays() {
  const wrap = document.getElementById('construction-overlays');
  if (!wrap) return;
  if (wrap.children.length !== state.construction.length) refreshConstructionOverlays();
  state.construction.forEach((job) => {
    const el = wrap.querySelector(`[data-job-id=${job.id}]`);
    if (!el) return;
    const world = new THREE.Vector3(job.x, sampleTerrainHeight(state, job.x, job.z) + 2.7, job.z);
    world.project(sceneCtx.camera);
    const x = (world.x * .5 + .5) * innerWidth;
    const y = (world.y * -.5 + .5) * innerHeight;
    const offscreen = world.z > 1 || x < -50 || x > innerWidth + 50 || y < -50 || y > innerHeight + 50;
    el.style.display = offscreen ? 'none' : 'block';
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.textContent = `${Math.max(0, Math.ceil(job.buildTime - job.progress))}с`;
  });
}

function ensureHealthEl(id) {
  const wrap = $('#health-overlays');
  let el = wrap.querySelector(`[data-health-id="${id}"]`);
  if (el) return el;
  el = document.createElement('div');
  el.className = 'health-bar';
  el.dataset.healthId = id;
  el.innerHTML = '<div class="health-caption"></div><div class="health-track"><div class="health-fill"></div></div>';
  wrap.appendChild(el);
  return el;
}

function updateHealthOverlays() {
  const wrap = $('#health-overlays');
  if (!wrap) return;
  const active = new Set();
  const items = [
    ...state.buildings.map((b) => {
      return { id: `b-${b.id}`, hp: b.hp, maxHp: b.maxHp, pos: new THREE.Vector3(b.pos.x, b.surfaceY + 2.2, b.pos.z) };
    }),
    ...state.units.map((u) => ({ id: `u-${u.id}`, hp: u.hp, maxHp: u.maxHp, pos: u.pos.clone().setY(u.pos.y + 2.4) })),
    ...state.enemyCamps.map((c) => ({ id: `c-${c.id}`, hp: c.hp, maxHp: c.maxHp, pos: c.pos.clone().setY((c.pos.y || 0) + 2.8) }))
  ];
  items.forEach((item) => {
    if (!item.pos || item.hp >= item.maxHp || item.maxHp <= 0) return;
    active.add(item.id);
    const el = ensureHealthEl(item.id);
    const caption = el.querySelector('.health-caption');
    const fill = el.querySelector('.health-fill');
    const ratio = Math.max(0, Math.min(1, item.hp / item.maxHp));
    item.pos.project(sceneCtx.camera);
    const x = (item.pos.x * .5 + .5) * innerWidth;
    const y = (item.pos.y * -.5 + .5) * innerHeight;
    const offscreen = item.pos.z > 1 || x < -80 || x > innerWidth + 80 || y < -80 || y > innerHeight + 80;
    el.style.display = offscreen ? 'none' : 'block';
    el.style.transform = `translate(${x}px, ${y}px)`;
    fill.style.width = `${ratio * 100}%`;
    if (caption) caption.textContent = `${Math.round(item.hp)} / ${Math.round(item.maxHp)}`;
    el.classList.toggle('low', ratio < 0.35);
  });
  wrap.querySelectorAll('.health-bar').forEach((el) => {
    if (!active.has(el.dataset.healthId)) el.remove();
  });
}

function spawnConstructionDust(dt) {
  constructionDustTimer += dt;
  if (constructionDustTimer < 0.18) return;
  constructionDustTimer = 0;
  state.construction.forEach((job) => {
    for (let i = 0; i < 2; i++) {
      const dust = new THREE.Mesh(new THREE.SphereGeometry(.08 + Math.random() * .05, 5, 5), new THREE.MeshBasicMaterial({ color: 0xb79862, transparent: true, opacity: .42 }));
      const h = sampleTerrainHeight(state, job.x, job.z);
      dust.position.set(job.x + (Math.random() - .5) * .9, h + .38 + Math.random() * .35, job.z + (Math.random() - .5) * .9);
      sceneCtx.groups.effects.add(dust);
      sceneCtx.effectBursts.push({
        id: `dust-${performance.now()}-${Math.random()}`,
        mesh: dust,
        vel: new THREE.Vector3((Math.random() - .5) * .3, .32 + Math.random() * .18, (Math.random() - .5) * .3),
        life: .5 + Math.random() * .35,
        kind: 'burst'
      });
    }
  });
}

async function stepSimulation(dt) {
  updateEnvironmentState(state, dt);
  applyRealTimeEconomy(state, dt);
  updateConstruction(state, dt);
  await processFinishedConstruction();
  updateEra(state);
  const completedTech = updateResearch(state, dt);
  if (completedTech) notify(`Изучено: ${completedTech}`);
  updateTraining(sceneCtx, state, dt, notify);
  updateDefense(sceneCtx, state, dt);
  updateUnits(sceneCtx, state, dt, notify);
  updateProjectiles(sceneCtx, state, dt);
  updateEnemyWaves(sceneCtx, state, dt, notify);
  updateObjectives(state);
  if (state.resources.population >= state.territoryGrowthAt) {
    state.territoryGrowthAt += 6;
    state.territoryRadius += 0.9;
    updateTerritoryOverlay(sceneCtx, state);
    notify('Границы державы расширились');
  }
  spawnConstructionDust(dt);

  autoSpawnWorkers(sceneCtx, state, dt, notify);

  if (state.seasonTime >= GAME_CONFIG.seasonDuration) {
    state.seasonTime = 0;
    maybeChangeWeather(state);
    notify(`Погода изменилась: ${state.weather}`);
  }
  checkStateMilestones();
  maybeAutoSave(dt);
}

function maybeSaveGame() {
  saveGame(state);
}

let logicAccumulator = 0;
const LOGIC_TICK = 0.05; // 20 TPS

async function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const rawDt = Math.min(.1, (now - lastTime) / 1000);
  lastTime = now;

  if (!state.paused && state.timeScale > 0) {
      logicAccumulator += rawDt * state.timeScale;
      while(logicAccumulator >= LOGIC_TICK) {
          await stepSimulation(LOGIC_TICK);
          logicAccumulator -= LOGIC_TICK;
      }

      updateSelection(state);
      updateHud(state);

      // Update minimap only occasionally to save frame time
      if (Math.random() < 0.1) {
          drawMinimap(state);
      }
  }

  updateConstructionOverlays();
  updateHealthOverlays();
  updateDayNightVisual(rawDt * Math.max(state.timeScale, .3));
  updateTerrainVisuals(state, now);
  sceneCtx.controls.update();
  sceneCtx.composer.render();
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed', err);
  try {
    $('#loading-text').textContent = 'Мир запущен в безопасном режиме';
    notify('Часть моделей отключена для стабильного запуска');
  } catch { /* UI may already be unavailable after a bootstrap failure */ }
  emergencyRelease();
});
