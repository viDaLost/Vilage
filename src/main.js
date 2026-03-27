import * as THREE from 'three';
import { GAME_CONFIG, BUILDINGS, ERA_DATA } from './config.js';
import { createInitialState } from './state.js';
import { createScene } from './core/scene.js';
import { generateWorld, getTile, getNeighbors, isTileInsideTerritory } from './systems/world.js';
import { renderTiles, renderRoads } from './systems/renderWorld.js';
import { setupHud, updateHud } from './ui/hud.js';
import { drawMinimap } from './ui/minimap.js';
import { notify } from './ui/notifications.js';
import { openBuildMenu, openResearchMenu, openTrainMenu, bindDrawerClose, closeDrawer } from './ui/drawer.js';
import { setupModal, openModal, closeModal } from './ui/modal.js';
import { updateSelection } from './ui/selection.js';
import { setupInput } from './core/input.js';
import { createHexShape } from './systems/world.js';
import { canPlaceBuilding, hasCost, payCost, placeConstruction, finishConstruction, getBuildingById, getBuildingOnTile } from './systems/buildings.js';
import { applyRealTimeEconomy, updateConstruction, collectFinishedConstruction, updateEra, updateObjectives, updateResearch } from './systems/economy.js';
import { autoSpawnWorkers, queueTraining, updateTraining, updateUnits, spawnUnit } from './systems/units.js';
import { updateDefense, updateProjectiles } from './systems/combat.js';
import { maybeChangeWeather, updateEnemyWaves, updateEnvironmentState } from './systems/events.js';
import { saveGame, loadGame, clearSave } from './systems/persistence.js';
import { $, $$ } from './ui/dom.js';
import { clamp, dist2, fmt } from './utils/helpers.js';

const state = createInitialState();
const sceneCtx = createScene(document.getElementById('game'));
let ghostMesh = null;
let lastTime = performance.now();

function setLoading(percent, text) {
  $('#loading-fill').style.width = `${percent}%`;
  $('#loading-text').textContent = text;
}

async function bootstrap() {
  setupHud();
  setupModal();
  bindDrawerClose();
  hookButtons();

  setLoading(10, 'Генерация рельефа…');
  generateWorld(state);

  setLoading(30, 'Отрисовка земли и окружения…');
  renderTiles(sceneCtx, state);

  setLoading(48, 'Размещение столицы…');
  await spawnCapital();
  createRoadNetworkFromCapital();
  spawnEnemyCamps();
  renderRoads(sceneCtx, state);

  setLoading(66, 'Подготовка интерфейса…');
  updateHud(state);
  drawMinimap(state);
  updateSelection(state);

  setLoading(82, 'Подключение ввода…');
  setupInput(sceneCtx, state, {
    onTile: onTileSelected,
    onUnit: onUnitSelected,
  });

  setLoading(100, 'Готово');
  setTimeout(() => {
    $('#loading-screen').style.display = 'none';
    state.timeScale = 1;
    setSpeedButton(1);
    showRules();
    animate();
  }, 260);

  addEventListener('resize', () => {
    sceneCtx.resize();
    drawMinimap(state);
  });
}

async function spawnCapital() {
  const center = state.map.filter((t) => t.type !== 'water').sort((a, b) => Math.hypot(a.pos.x, a.pos.z) - Math.hypot(b.pos.x, b.pos.z))[0];
  const job = { type: 'capital', tileId: center.id, progress: 0, buildTime: 0 };
  const capital = await finishConstruction(sceneCtx, state, job);
  state.capitalId = capital.id;
  center.buildingId = capital.id;
  state.resources.population = 12;
  state.resources.workers = 4;
  capital.level = 1;

  const starter = [
    ['farm', getNeighbors(state, center).find((t) => ['grass', 'fertile', 'river'].includes(t.type) && !t.buildingId)],
    ['lumber', getNeighbors(state, center).find((t) => ['forest', 'grass'].includes(t.type) && !t.buildingId)],
    ['mine', getNeighbors(state, center).find((t) => ['hill', 'rock'].includes(t.type) && !t.buildingId)],
  ];
  for (const [type, tile] of starter) {
    if (!tile) continue;
    const build = placeConstruction(state, type, tile);
    build.progress = build.buildTime;
  }
  const completed = collectFinishedConstruction(state);
  for (const job of completed) await finishConstruction(sceneCtx, state, job);
}

function createRoadNetworkFromCapital() {
  const capital = getBuildingById(state, state.capitalId);
  if (!capital) return;
  const tile = state.mapIndex.get(capital.tileId);
  for (const neighbor of getNeighbors(state, tile)) {
    if (!neighbor || neighbor.type === 'water') continue;
    addRoad(tile.id, neighbor.id);
  }
}

function spawnEnemyCamps() {
  const farTiles = state.map.filter((t) => Math.hypot(t.pos.x, t.pos.z) > state.territoryRadius + 10 && t.type !== 'water');
  farTiles.sort(() => Math.random() - .5);
  state.enemyCamps = farTiles.slice(0, GAME_CONFIG.enemyCampCount).map((tile, i) => {
    const mesh = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.55, .7, .35, 6), new THREE.MeshStandardMaterial({ color: 0x6b2417, roughness: 1 }));
    base.position.y = tile.height + .2;
    base.castShadow = true;
    const fire = new THREE.Mesh(new THREE.ConeGeometry(.26, .6, 6), new THREE.MeshStandardMaterial({ color: 0xff9345, emissive: 0xff7836, emissiveIntensity: .7 }));
    fire.position.y = tile.height + .85;
    mesh.add(base, fire);
    mesh.position.set(tile.pos.x, 0, tile.pos.z);
    sceneCtx.groups.enemyCamps.add(mesh);
    return { id: `camp-${i}`, tileId: tile.id, pos: tile.pos.clone(), mesh };
  });
}

function addRoad(aId, bId) {
  const key = [aId, bId].sort().join('|');
  if (state.roads.some((r) => r.key === key)) return false;
  state.roads.push({ key, a: aId, b: bId });
  state.resources.roads = state.roads.length;
  return true;
}

async function tryPlaceBuilding(tile) {
  const type = state.selectedBuildType;
  if (!type) return;
  if (!canPlaceBuilding(state, type, tile)) {
    notify('Эту постройку нельзя разместить на выбранной клетке');
    return;
  }
  const cfg = BUILDINGS[type];
  if (!hasCost(state.resources, cfg.cost)) {
    notify('Недостаточно ресурсов');
    return;
  }
  payCost(state.resources, cfg.cost);
  const job = placeConstruction(state, type, tile);
  notify(`Начато строительство: ${cfg.name}`);
  closeDrawer();
  state.selectedBuildType = null;
  removeGhost();
  updateHud(state);
  updateSelection(state);
}

function onTileSelected(tile) {
  state.selected = { kind: 'tile', ref: tile };
  highlightSelection();
  if (state.selectedBuildType) {
    tryPlaceBuilding(tile);
  } else {
    updateSelection(state);
  }
}

function onUnitSelected(unit) {
  state.selected = { kind: 'unit', ref: unit };
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

function hookButtons() {
  $$('.speed-btn').forEach((btn) => {
    btn.onclick = () => {
      const speed = Number(btn.dataset.speed);
      if (speed === 0) {
        state.paused = true;
        state.timeScale = 0;
      } else {
        state.paused = false;
        state.timeScale = speed;
      }
      setSpeedButton(speed);
    };
  });

  $$('[data-action]').forEach((btn) => {
    btn.onclick = () => handleAction(btn.dataset.action);
  });
}

function setSpeedButton(speed) {
  $$('.speed-btn').forEach((btn) => btn.classList.toggle('active', Number(btn.dataset.speed) === speed));
}

function handleAction(action) {
  if (action === 'focus-capital') {
    const capital = getBuildingById(state, state.capitalId);
    if (!capital) return;
    const tile = state.mapIndex.get(capital.tileId);
    sceneCtx.controls.target.set(tile.pos.x, tile.height, tile.pos.z);
    sceneCtx.camera.position.set(tile.pos.x + 22, tile.height + 22, tile.pos.z + 18);
  }
  if (action === 'build-menu') {
    openBuildMenu(state, (type) => {
      state.selectedBuildType = type;
      showGhost(type);
      notify(`Режим строительства: ${BUILDINGS[type].name}`);
    });
  }
  if (action === 'train-menu') {
    openTrainMenu(state, () => {});
    bindTrainButtons();
  }
  if (action === 'research-menu') {
    openResearchMenu(state, notify);
  }
  if (action === 'rules') {
    showRules();
  }
}

async function bindTrainButtons() {
  document.querySelectorAll('[data-unit-type]').forEach(async (btn) => {
    btn.onclick = async () => {
      const { UNITS } = await import('./config.js');
      const building = getBuildingById(state, btn.dataset.trainBuilding);
      const unit = UNITS[btn.dataset.unitType];
      if (!building || !unit) return;
      const ok = Object.entries(unit.cost).every(([k, v]) => (state.resources[k] || 0) >= v);
      if (!ok) return notify('Недостаточно ресурсов на обучение');
      Object.entries(unit.cost).forEach(([k, v]) => state.resources[k] -= v);
      queueTraining(building, btn.dataset.unitType);
      notify(`В очереди: ${unit.name}`);
      updateHud(state);
      openTrainMenu(state, () => {});
      bindTrainButtons();
    };
  });
}

function showRules() {
  openModal(
    'Летопись правителя',
    'Это уже real-time RTS для браузера',
    `
      <p><strong>Главная идея:</strong> ресурсы, строительство, обучение войск, враги, день и погода обновляются непрерывно. Кнопка «Ход» больше не нужна.</p>
      <p><strong>Как играть:</strong> выбери «Строить», затем коснись клетки внутри своих владений. Постройки строятся по времени. В казармах и столице обучаются юниты. Башни и гарнизоны автоматически отбивают врагов.</p>
      <p><strong>Механики:</strong> фермы любят реки и плодородную землю, шахты любят скалы и холмы, рынки усиливаются дорогами, храмы и академии двигают престиж и знание.</p>
      <p><strong>Веб-подход:</strong> проект работает без сборщика, на обычном статическом хостинге вроде GitHub Pages. Сохранение идёт в localStorage.</p>
      <p><strong>Ускорение времени:</strong> справа снизу можно ставить паузу, x1, x2 или x4.</p>
    `,
    [
      { label: 'Начать', primary: true, onClick: closeModal },
      { label: 'Стереть сохранение', onClick: () => { clearSave(); closeModal(); notify('Локальное сохранение очищено'); } },
    ]
  );
}

function showGhost(type) {
  removeGhost();
  const geo = new THREE.CylinderGeometry(1.3, 1.3, .18, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: .35 });
  ghostMesh = new THREE.Mesh(geo, mat);
  ghostMesh.rotation.y = Math.PI / 6;
  sceneCtx.groups.ghosts.add(ghostMesh);
  sceneCtx.renderer.domElement.addEventListener('pointermove', pointerGhostMove);
}

function pointerGhostMove(e) {
  if (!ghostMesh) return;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, sceneCtx.camera);
  const hits = raycaster.intersectObjects(sceneCtx.groups.tiles.children, false);
  if (!hits.length) return;
  const tile = state.map.find((t) => t.mesh === hits[0].object);
  if (!tile) return;
  ghostMesh.position.set(tile.pos.x, tile.height + .16, tile.pos.z);
  ghostMesh.material.color.set(canPlaceBuilding(state, state.selectedBuildType, tile) ? 0xb3ff84 : 0xff7b6f);
}

function removeGhost() {
  if (!ghostMesh) return;
  sceneCtx.groups.ghosts.remove(ghostMesh);
  ghostMesh.geometry.dispose?.();
  ghostMesh.material.dispose?.();
  ghostMesh = null;
  sceneCtx.renderer.domElement.removeEventListener('pointermove', pointerGhostMove);
}

async function processFinishedConstruction() {
  const done = collectFinishedConstruction(state);
  for (const job of done) {
    const entity = await finishConstruction(sceneCtx, state, job);
    if (entity) {
      notify(`Построено: ${BUILDINGS[job.type].name}`);
      const tile = state.mapIndex.get(job.tileId);
      connectRoadsForTile(tile);
    }
  }
  renderRoads(sceneCtx, state);
}

function connectRoadsForTile(tile) {
  const neighbors = getNeighbors(state, tile).filter((n) => n.type !== 'water' && (n.buildingId || isTileInsideTerritory(state, n)));
  neighbors.forEach((n) => addRoad(tile.id, n.id));
}

function updateDayNightVisual(dt) {
  const t = (state.dayTime % GAME_CONFIG.dayDuration) / GAME_CONFIG.dayDuration;
  const ang = t * Math.PI * 2;
  sceneCtx.sun.position.set(Math.cos(ang) * 42, Math.max(8, Math.sin(ang) * 34), Math.sin(ang) * 20 - 8);
  const lightMul = { clear: 1, rain: .86, mist: .72, dust: .78 }[state.weather];
  sceneCtx.sun.intensity = clamp(Math.sin(ang) * .9 + .65, .18, 1.24) * lightMul;
  sceneCtx.hemi.intensity = .28 + sceneCtx.sun.intensity * .45;
  sceneCtx.stars.visible = sceneCtx.sun.position.y < 12;
  sceneCtx.sky.material.uniforms.topColor.value.setHex(sceneCtx.sun.position.y > 14 ? 0x84c4ff : 0x182a56);
  sceneCtx.sky.material.uniforms.bottomColor.value.setHex(sceneCtx.sun.position.y > 14 ? 0xf5d8a3 : 0x522d16);
}

function maybeAutoSave(dt) {
  state.autosaveTimer += dt;
  if (state.autosaveTimer < GAME_CONFIG.autosaveEvery) return;
  state.autosaveTimer = 0;
  saveGame(state);
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

  state.workerSpawnTimer -= dt;
  if (state.workerSpawnTimer <= 0) {
    state.workerSpawnTimer = GAME_CONFIG.workerSpawnEvery;
    autoSpawnWorkers(sceneCtx, state, notify);
  }
  if (state.seasonTime >= GAME_CONFIG.seasonDuration) {
    state.seasonTime = 0;
    maybeChangeWeather(state);
    notify(`Погода изменилась: ${state.weather}`);
  }
  maybeAutoSave(dt);
}

async function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const rawDt = Math.min(.05, (now - lastTime) / 1000);
  lastTime = now;
  const dt = rawDt * state.timeScale;

  if (!state.paused && state.timeScale > 0) {
    await stepSimulation(dt);
    updateSelection(state);
    updateHud(state);
    drawMinimap(state);
  }

  updateDayNightVisual(rawDt * Math.max(state.timeScale, .3));
  sceneCtx.controls.update();
  sceneCtx.composer.render();
}

bootstrap();
