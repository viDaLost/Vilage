import { BUILDINGS, UNITS, TERRAIN_TYPES } from '../config.js';
import { getBuildingOnTile } from '../systems/buildings.js';
import { isTileInsideTerritory } from '../systems/world.js';
import { fmt } from '../utils/helpers.js';
import { $ } from './dom.js';

export function updateSelection(state) {
  const title = $('#selection-title');
  const body = $('#selection-content');
  const sel = state.selected;
  if (!sel) {
    title.textContent = 'Выбор';
    body.innerHTML = state.placementMode?.type === 'unit-command' ? 'Нажми на карту, чтобы отправить юнита в выбранную точку.' : 'Коснись клетки, здания или юнита.';
    return;
  }
  if (sel.kind === 'tile') {
    const tile = sel.ref;
    const building = getBuildingOnTile(state, tile);
    const terrain = TERRAIN_TYPES[tile.type || 'grass'] || TERRAIN_TYPES.grass;
    title.textContent = building ? BUILDINGS[building.type].name : terrain.name;
    body.innerHTML = `
      <div>Земля: <strong>${terrain.name}</strong></div>
      <div>Высота: <strong>${fmt(tile.height)}</strong></div>
      <div>Зона: <strong>${isTileInsideTerritory(state, tile.pos.x, tile.pos.z) ? 'Во владениях' : 'Вне владений'}</strong></div>
      ${building ? `<div>Здание: <strong>${BUILDINGS[building.type].name}</strong></div><div>Прочность: <strong>${fmt(building.hp)} / ${fmt(building.maxHp)}</strong></div><div>Рабочие: <strong>${building.activeWorkers || 0}${building.workerDemand ? ` / ${building.workerDemand}` : ''}</strong></div>` : '<div>Свободная клетка</div>'}
    `;
  }
  if (sel.kind === 'unit') {
    const unit = sel.ref;
    title.textContent = UNITS[unit.type].name;
    body.innerHTML = `<div>HP: <strong>${fmt(unit.hp)} / ${fmt(unit.maxHp)}</strong></div><div>Скорость: <strong>${fmt(unit.speed)}</strong></div><div>${unit.hostile ? 'Вражеский' : 'Свой'} юнит</div>${!unit.hostile ? '<div>Открой меню юнита: можно отправить в точку или назначить на работу.</div>' : ''}`;
  }
}
