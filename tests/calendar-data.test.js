import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../js/store.js';
import { requireRecordDate, localIsoDate } from '../js/date-utils.js';
import { weeklyStats } from '../js/derive.js';
process.env.TZ = 'Asia/Tokyo';
class Storage {
  data = new Map(); fail = null;
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k, v) { if (k === this.fail) { this.fail = null; throw new Error('QuotaExceededError'); } this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
}
globalThis.localStorage = new Storage();
beforeEach(() => { localStorage.data.clear(); s.seedIfEmpty(); });
const burn = (date, extra = {}) => s.saveBurnRecord({ date, ...extra });
const current = () => { const date = localIsoDate(); const yesterday = new Date(date + 'T00:00:00'); yesterday.setDate(yesterday.getDate() - 1); return { today: date, yesterday: localIsoDate(yesterday) }; };

test('burn save is shared, once per day, and never subtracts shelf quantity', () => {
  const shelf = s.addShelf({ totalVolumeM3: 2, usableVolumeM3: 0, remainingPercent: 0 });
  const first = burn('2025-12-31', { shelfId: shelf.id, note: '初焚き' });
  const retry = burn('2025-12-31', { shelfId: shelf.id, note: '上書きしない' });
  assert.equal(retry.duplicate, true); assert.equal(retry.record.id, first.record.id);
  assert.equal(s.getBurnLogs().length, 1); assert.equal(s.getBurnLogs()[0].note, '初焚き');
  assert.equal(s.getShelf(shelf.id).usableVolumeM3, 0);
});
test('a burn can be remembered without a shelf; invalid destinations are rejected', () => {
  burn('2025-12-31'); assert.equal(s.getBurnLogs()[0].shelfId, '');
  assert.throws(() => burn('2026-01-01', { shelfId: 'missing' })); assert.equal(s.getBurnLogs().length, 1);
});
test('backfilling yesterday moves the current first burn and creates no second season', () => {
  const { today, yesterday } = current(); burn(today); burn(yesterday);
  assert.equal(s.getSeasons().length, 1); assert.equal(s.getCurrentSeason().startDate, yesterday);
  assert.equal(s.getBurnLogs().length, 2);
});
test('a missed older winter creates a closed period without opening it as current', () => {
  const { today } = current(); burn(today); const active = s.getCurrentSeason();
  burn('2024-12-10'); burn('2024-12-01'); burn('2025-03-01');
  const old = s.getSeasons().find((season) => season.id !== active.id);
  assert.equal(old.startDate, '2024-12-01'); assert.equal(old.endDate, '2025-03-01');
  assert.equal(s.getCurrentSeason().id, active.id);
});
test('a backfill extends an explicitly closed winter at either end', () => {
  s.startNewSeason('2024-11-30'); s.endCurrentSeason('2025-03-20');
  burn('2024-11-29'); burn('2025-03-21');
  assert.equal(s.getSeasons().length, 1); assert.equal(s.getSeasons()[0].startDate, '2024-11-29'); assert.equal(s.getSeasons()[0].endDate, '2025-03-21');
});
test('year-end backfills stay in the same winter, summer boundary does not merge winters', () => {
  burn('2024-12-31'); burn('2025-01-01'); assert.equal(s.getSeasons().length, 1);
  burn('2025-07-01'); assert.equal(s.getSeasons().length, 2);
});
test('split repeat is detected, explicit different work can still be added', () => {
  const entry = { date: '2026-01-01', volumeM3: 0.2 };
  s.saveSplitRecord(entry); assert.equal(s.saveSplitRecord(entry).duplicate, true);
  s.saveSplitRecord(entry, { allowDuplicate: true }); assert.equal(s.getSplitLogs().length, 2);
});
test('unknown-volume split repeats also need an explicit decision and keep shelf unchanged', () => {
  const shelf = s.addShelf({ usableVolumeM3: 1, totalVolumeM3: 2, remainingPercent: 50 });
  s.saveSplitRecord({ date: '2026-01-01', volumeM3: null });
  assert.equal(s.saveSplitRecord({ date: '2026-01-01', volumeM3: null }).duplicate, true);
  assert.equal(s.getShelf(shelf.id).usableVolumeM3, 1);
});
test('future/empty/impossible dates and invalid split volumes do not save', () => {
  for (const date of ['', 'bad', '2026-02-30', '2099-01-01']) {
    assert.throws(() => burn(date)); assert.throws(() => s.saveSplitRecord({ date, volumeM3: 0.2 }));
  }
  for (const volumeM3 of [0, -1, Infinity, NaN]) assert.throws(() => s.saveSplitRecord({ date: '2026-01-01', volumeM3 }));
  assert.equal(s.getBurnLogs().length, 0); assert.equal(s.getSplitLogs().length, 0);
  assert.equal(requireRecordDate('2024-02-29'), '2024-02-29');
});
test('burn and first-burn season roll back together when storage fails', () => {
  const before = s.exportAllData(); localStorage.fail = s.KEYS.seasons;
  assert.throws(() => burn('2024-12-31')); assert.deepEqual(s.exportAllData(), before);
});
test('cross-year weekly totals and photo-compatible backup use the same records', () => {
  burn('2024-12-31'); burn('2025-01-01'); s.saveSplitRecord({ date: '2025-01-01', volumeM3: 0.2 });
  const data = s.exportAllData();
  const stats = weeklyStats({ start: '2024-12-29', end: '2025-01-04' }, { burnLogs: s.getBurnLogs(), splitLogs: s.getSplitLogs(), woodAdditions: [], anshinHistory: [], checks: [] });
  assert.equal(stats.burnCount, 2); assert.equal(stats.splitCount, 1); assert.equal(stats.splitVolumeM3, 0.2);
  s.importAllData(data); assert.deepEqual(s.exportAllData(), data);
});
