// 画面間で共有する一時的なUI状態(永続化しない)
import { recommendShelf } from './derive.js';
import { getShelves } from './store.js';

export const state = {
  currentShelfId: null,
  shelfFilter: 'all',
  albumFilter: 'all',
  weekOffset: 0,
  calendarMonthOffset: 0,
  reviewView: 'calendar',
};

export function ensureCurrentShelf() {
  const shelves = getShelves();
  if (state.currentShelfId && shelves.some((s) => s.id === state.currentShelfId)) {
    return state.currentShelfId;
  }
  const rec = recommendShelf(shelves);
  state.currentShelfId = rec ? rec.id : null;
  return state.currentShelfId;
}
