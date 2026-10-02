/*
 * store.js —— 数据层
 * 目前使用 localStorage 持久化；所有读写都经过这里的接口，
 * 后续接入云端（如 Supabase）时，只需替换 load/save 与几个方法，UI 不用改。
 *
 * 数据结构：
 * {
 *   version: 1,
 *   activeSheetId: "sheet_xxx",
 *   sheets: [
 *     {
 *       id, name, plate, price,
 *       entries: {
 *         "2026-09-30": [ null, {kwh, amount, note, at}, null, null, null ]  // 下标 0-4 对应第1-5次
 *       }
 *     }
 *   ]
 * }
 */
const Store = (() => {
  const KEY = 'charging_ledger_v1';
  const SCHEMA_VERSION = 1;
  const SLOTS = 5;

  let state = null;
  const listeners = new Set();
  let saveTimer = null;

  /* ---------------- 基础 ---------------- */

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function seed() {
    const now = new Date();
    const mk = (name, plate) => ({
      id: uid('sheet'),
      name,
      plate,
      price: 0.673,
      entries: {},
    });
    const sheets = [mk('老鼎', '老鼎充电桩车辆'), mk('聚源', '化州市聚源运输有限公司')];
    return { version: SCHEMA_VERSION, activeSheetId: sheets[0].id, sheets };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return seed();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.sheets)) return seed();
      return migrate(parsed);
    } catch (e) {
      console.warn('读取本地数据失败，使用初始数据', e);
      return seed();
    }
  }

  function migrate(data) {
    data.version = data.version || 1;
    data.sheets.forEach((s) => {
      s.entries = s.entries || {};
      if (s.price == null) s.price = 0.673;
      if (s.plate == null) s.plate = '';
    });
    if (!data.sheets.some((s) => s.id === data.activeSheetId)) {
      data.activeSheetId = data.sheets[0] ? data.sheets[0].id : null;
    }
    return data;
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
        console.error('保存失败（可能存储空间已满）', e);
        emit({ error: e });
      }
    }, 120);
  }

  function commit() {
    save();
    emit();
  }

  function emit(extra) {
    listeners.forEach((fn) => {
      try { fn(state, extra); } catch (e) { console.error(e); }
    });
  }

  /* ---------------- 工具 ---------------- */

  const pad2 = (n) => String(n).padStart(2, '0');
  const dateKey = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

  function blankSlots() {
    return new Array(SLOTS).fill(null);
  }

  function num(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /* ---------------- 对外接口 ---------------- */

  function init() {
    if (!state) state = load();
    return state;
  }

  /** 重新从本地存储读取（用于多标签页同步） */
  function reload() {
    state = load();
    emit();
    return state;
  }

  const getState = () => state;
  const getSheets = () => state.sheets;
  const getSheet = (id) => state.sheets.find((s) => s.id === id) || null;
  const getActiveSheet = () => getSheet(state.activeSheetId) || state.sheets[0] || null;

  function setActive(id) {
    if (getSheet(id)) {
      state.activeSheetId = id;
      commit();
    }
  }

  function addSheet(name, plate) {
    const sheet = {
      id: uid('sheet'),
      name: name || `台账 ${state.sheets.length + 1}`,
      plate: plate || '',
      price: 0.673,
      entries: {},
    };
    state.sheets.push(sheet);
    state.activeSheetId = sheet.id;
    commit();
    return sheet;
  }

  function updateSheet(id, patch) {
    const s = getSheet(id);
    if (!s) return;
    Object.assign(s, patch);
    commit();
  }

  function deleteSheet(id) {
    const idx = state.sheets.findIndex((s) => s.id === id);
    if (idx < 0) return;
    state.sheets.splice(idx, 1);
    if (state.activeSheetId === id) {
      state.activeSheetId = state.sheets[0] ? state.sheets[0].id : null;
    }
    commit();
  }

  function getSessions(sheetId, date) {
    const s = getSheet(sheetId);
    if (!s) return blankSlots();
    const row = s.entries[date];
    if (!row) return blankSlots();
    const out = blankSlots();
    for (let i = 0; i < SLOTS; i++) out[i] = row[i] || null;
    return out;
  }

  /** slot: 1-5 */
  function setSession(sheetId, date, slot, data) {
    const s = getSheet(sheetId);
    if (!s || slot < 1 || slot > SLOTS) return;
    const kwh = num(data.kwh);
    const amount = num(data.amount);
    const note = (data.note || '').trim();
    if (kwh == null && amount == null && !note) {
      removeSession(sheetId, date, slot);
      return;
    }
    if (!s.entries[date]) s.entries[date] = blankSlots();
    s.entries[date][slot - 1] = { kwh, amount, note, at: Date.now() };
    commit();
  }

  function removeSession(sheetId, date, slot) {
    const s = getSheet(sheetId);
    if (!s || !s.entries[date]) return;
    s.entries[date][slot - 1] = null;
    if (s.entries[date].every((x) => !x)) delete s.entries[date];
    commit();
  }

  const hasContent = (v) => v && (v.kwh != null || v.amount != null);

  function nextFreeSlot(sheetId, date) {
    const slots = getSessions(sheetId, date);
    for (let i = 0; i < SLOTS; i++) {
      if (!hasContent(slots[i])) return i + 1;
    }
    return null; // 已满 5 次
  }

  function filledSlots(sheetId, date) {
    return getSessions(sheetId, date).filter(hasContent).length;
  }

  function dayTotals(sheetId, date) {
    const slots = getSessions(sheetId, date);
    let kwh = 0, amount = 0;
    slots.forEach((s) => {
      if (s) { kwh += s.kwh || 0; amount += s.amount || 0; }
    });
    return { kwh, amount };
  }

  /** month: "YYYY-MM" */
  function monthStats(sheetId, month) {
    const s = getSheet(sheetId);
    if (!s) return { kwh: 0, amount: 0, count: 0 };
    let kwh = 0, amount = 0, count = 0;
    Object.keys(s.entries).forEach((date) => {
      if (!date.startsWith(month)) return;
      s.entries[date].forEach((slot) => {
        if (hasContent(slot)) {
          kwh += slot.kwh || 0;
          amount += slot.amount || 0;
          count += 1;
        }
      });
    });
    return { kwh, amount, count };
  }

  function monthCount(sheetId, month) {
    const s = getSheet(sheetId);
    if (!s) return 0;
    return Object.keys(s.entries).filter((d) => d.startsWith(month)).length;
  }

  function exportAll() {
    return JSON.parse(JSON.stringify(state));
  }

  function importAll(data) {
    if (!data || !Array.isArray(data.sheets)) throw new Error('文件格式不正确');
    state = migrate({
      version: data.version || SCHEMA_VERSION,
      activeSheetId: data.activeSheetId || (data.sheets[0] && data.sheets[0].id),
      sheets: data.sheets,
    });
    commit();
  }

  function reset() {
    state = { version: SCHEMA_VERSION, activeSheetId: null, sheets: [] };
    const s = addSheet('我的台账', '');
    state.activeSheetId = s.id;
    commit();
  }

  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  return {
    init, reload, subscribe,
    getState, getSheets, getSheet, getActiveSheet, setActive,
    addSheet, updateSheet, deleteSheet,
    getSessions, setSession, removeSession, nextFreeSlot, filledSlots,
    dayTotals, monthStats, monthCount,
    exportAll, importAll, reset,
    SLOTS, dateKey, hasContent,
  };
})();