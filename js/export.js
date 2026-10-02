/*
 * export.js —— 导出 / 备份
 *  - 导出 Excel（按原台账模板：每个台账一张工作表，日期 1-31 × 5 次）
 *  - 导出 CSV（当前台账、当前月份）
 *  - 备份 / 恢复 JSON
 */
const Exporter = (() => {

  const SLOTS = 5;

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  const hasContent = (v) => v && (v.kwh != null || v.amount != null);
  const round = (n, d = 2) => (Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d);

  /* ---------------- JSON 备份 / 恢复 ---------------- */

  function downloadJSON(state) {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    download(blob, `充电台账备份_${stamp()}.json`);
  }

  function readJSONFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result))); }
        catch (e) { reject(new Error('JSON 解析失败')); }
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file);
    });
  }

  /* ---------------- CSV ---------------- */

  function exportCsv(sheet, month) {
    const [y, m] = month.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const header = ['日期'];
    for (let i = 1; i <= SLOTS; i++) header.push(`第${i}次电量`, `第${i}次金额`);
    header.push('当日电量', '当日金额');

    const rows = [header];
    let tKwh = 0, tAmt = 0;
    for (let d = 1; d <= days; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const slots = Store.getSessions(sheet.id, date);
      const row = [d];
      let dKwh = 0, dAmt = 0;
      slots.forEach((s) => {
        if (hasContent(s)) {
          row.push(s.kwh != null ? s.kwh : '', s.amount != null ? s.amount : '');
          dKwh += s.kwh || 0; dAmt += s.amount || 0;
        } else row.push('', '');
      });
      row.push(round(dKwh, 3), round(dAmt));
      tKwh += dKwh; tAmt += dAmt;
      rows.push(row);
    }
    rows.push(['合计', ...new Array(SLOTS * 2).fill(''), round(tKwh, 3), round(tAmt)]);

    const csv = rows.map((r) => r.map((c) => {
      const s = String(c == null ? '' : c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\r\n');

    download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }),
      `${sheet.name}_${month}.csv`);
  }

  /* ---------------- Excel ---------------- */

  function safeSheetName(name, used) {
    let base = String(name || '台账').replace(/[\\/?*[\]:]/g, '_').slice(0, 28) || '台账';
    let n = base, i = 2;
    while (used.has(n)) n = `${base}_${i++}`;
    used.add(n);
    return n;
  }

  function buildSheetData(sheet, month) {
    const [y, m] = month.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();

    const aoa = [];
    aoa[0] = ['车牌号码', '', '', '', '', '', '', '', '月份', month];
    aoa[1] = [sheet.name];
    aoa[2] = ['', '第一次', '', '第二次', '', '第三次', '', '第四次', '', '第五次', ''];
    const h = ['日期'];
    for (let i = 0; i < SLOTS; i++) h.push('电量', '金额');
    aoa[3] = h;

    let tKwh = 0, tAmt = 0;
    for (let d = 1; d <= days; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const slots = Store.getSessions(sheet.id, date);
      const row = [d];
      slots.forEach((s) => {
        if (hasContent(s)) {
          row.push(s.kwh != null ? s.kwh : '', s.amount != null ? s.amount : '');
          tKwh += s.kwh || 0; tAmt += s.amount || 0;
        } else row.push('', '');
      });
      aoa.push(row);
    }
    const lastRow = aoa.length; // 1-based index of last day row
    aoa.push([]);
    aoa.push([...new Array(9).fill(''), '总电量', round(tKwh, 3)]);
    aoa.push([...new Array(9).fill(''), '总金额', round(tAmt)]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [
      { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },              // 标题
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },              // 车牌号码
      { s: { r: 2, c: 1 }, e: { r: 2, c: 2 } },
      { s: { r: 2, c: 3 }, e: { r: 2, c: 4 } },
      { s: { r: 2, c: 5 }, e: { r: 2, c: 6 } },
      { s: { r: 2, c: 7 }, e: { r: 2, c: 8 } },
      { s: { r: 2, c: 9 }, e: { r: 2, c: 10 } },
    ];
    ws['!cols'] = [{ wch: 6 }, ...new Array(SLOTS * 2).fill(null).map(() => ({ wch: 11 })), { wch: 11 }, { wch: 12 }];
    ws['!freeze'] = { xSplit: 1, ySplit: 4 };
    ws['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(lastRow + 2, 36), c: 10 },
    });
    return ws;
  }

  function exportXlsx(sheets, month) {
    if (typeof XLSX === 'undefined') throw new Error('Excel 导出库未加载，请检查网络后刷新');
    const target = sheets.length ? sheets : [{ id: null, name: '空台账' }];
    const wb = XLSX.utils.book_new();
    const used = new Set();
    target.forEach((s) => {
      const ws = buildSheetData(s, month);
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(s.name, used));
    });
    XLSX.writeFile(wb, `充电台账_${month}_${stamp()}.xlsx`);
  }

  return { downloadJSON, readJSONFile, exportCsv, exportXlsx, download };
})();