/*
 * app.js —— 界面与交互
 */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const SLOTS = 5;
  const pad2 = (n) => String(n).padStart(2, '0');

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const monthOf = (dateStr) => dateStr.slice(0, 7);
  const fmt = (n, d) => (Number.isFinite(n) ? String(Number(n.toFixed(d))) : '');
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  let currentMonth = monthOf(todayKey());
  let skipTableRender = false;
  let toastTimer = null;

  /* ---------------- 通用 ---------------- */

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  /** 简易对话框：bodyHTML + 按钮数组 */
  function dialog({ title, bodyHTML, actions = [], onMount }) {
    const modal = $('#modal2');
    $('#modal2-title').textContent = title;
    const body = $('#modal2-body');
    body.innerHTML = bodyHTML || '';
    const box = $('#modal2-actions');
    box.innerHTML = '';
    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.className = 'btn' + (a.primary ? ' btn-primary' : '') + (a.danger ? ' danger' : '');
      btn.textContent = a.label;
      btn.onclick = () => a.onClick && a.onClick();
      box.appendChild(btn);
    });
    modal.hidden = false;
    if (onMount) onMount(body);
    return {
      close: () => { modal.hidden = true; },
      body,
    };
  }

  function closeDialog() { $('#modal2').hidden = true; }

  /* ---------------- 渲染：台账列表 ---------------- */

  function renderSheetList() {
    const ul = $('#sheet-list');
    const sheets = Store.getSheets();
    const active = Store.getActiveSheet();
    if (!sheets.length) {
      ul.innerHTML = '<li style="padding:10px;color:var(--faint);font-size:12px">暂无台账</li>';
      return;
    }
    ul.innerHTML = sheets.map((s) => `
      <li class="sheet-item ${active && s.id === active.id ? 'active' : ''}" data-id="${s.id}">
        <span class="dot"></span>
        <span class="txt">
          <span class="nm">${esc(s.name)}</span>
          ${s.plate ? `<span class="sub">${esc(s.plate)}</span>` : ''}
        </span>
      </li>`).join('');
  }

  /* ---------------- 渲染：台账信息栏 ---------------- */

  function renderSheetHeader() {
    const s = Store.getActiveSheet();
    $('#sheet-name').textContent = s ? s.name : '—';
    const plate = $('#sheet-plate');
    const price = $('#sheet-price');
    if (document.activeElement !== plate) plate.value = s ? s.plate || '' : '';
    if (document.activeElement !== price) price.value = s ? s.price : '';
    plate.disabled = !s;
    price.disabled = !s;
    $('#btn-rename').disabled = !s;
    $('#btn-del-sheet').disabled = !s;
  }

  /* ---------------- 渲染：表格 ---------------- */

  function renderTable() {
    const table = $('#ledger');
    const sheet = Store.getActiveSheet();
    if (!sheet) { table.innerHTML = ''; return; }

    const [y, m] = currentMonth.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const today = todayKey();

    const head1 = ['<th class="day" rowspan="2">日期</th>'];
    for (let i = 1; i <= SLOTS; i++) head1.push(`<th colspan="2">第${i}次</th>`);
    head1.push('<th colspan="2">当日合计</th>');
    const head2 = [];
    for (let i = 0; i < SLOTS + 1; i++) head2.push('<th>电量</th><th>金额</th>');

    let html = `<thead><tr>${head1.join('')}</tr><tr>${head2.join('')}</tr></thead><tbody>`;

    for (let d = 1; d <= days; d++) {
      const date = `${currentMonth}-${pad2(d)}`;
      const slots = Store.getSessions(sheet.id, date);
      html += `<tr class="${date === today ? 'today' : ''}"><td class="day">${d}</td>`;
      for (let i = 0; i < SLOTS; i++) {
        const s = slots[i];
        const kwh = s && s.kwh != null ? s.kwh : '';
        const amt = s && s.amount != null ? s.amount : '';
        const filled = s ? 'filled' : '';
        const tip = s && s.note ? ` title="${esc(s.note)}"` : '';
        html += `<td class="cell ${filled}"><input type="number" step="0.001" inputmode="decimal"
                    data-date="${date}" data-slot="${i + 1}" data-field="kwh"
                    value="${kwh}" placeholder="—"${tip}></td>`;
        html += `<td class="cell ${filled}"><input type="number" step="0.01" inputmode="decimal"
                    data-date="${date}" data-slot="${i + 1}" data-field="amount"
                    value="${amt}" placeholder="—"${tip}></td>`;
      }
      const t = Store.dayTotals(sheet.id, date);
      html += `<td class="total ${t.kwh ? 'has' : ''}" data-total="kwh" data-date="${date}">${t.kwh ? fmt(t.kwh, 3) : ''}</td>`;
      html += `<td class="total ${t.amount ? 'has' : ''}" data-total="amount" data-date="${date}">${t.amount ? fmt(t.amount, 2) : ''}</td>`;
      html += '</tr>';
    }
    html += '</tbody>';
    table.innerHTML = html;
  }

  /* ---------------- 统计 ---------------- */

  function updateRowTotal(tr) {
    const kEl = tr.querySelector('[data-total="kwh"]');
    const aEl = tr.querySelector('[data-total="amount"]');
    if (!kEl || !aEl) return;
    let k = 0, a = 0;
    tr.querySelectorAll('input[data-field="kwh"]').forEach((i) => {
      const v = parseFloat(i.value); if (Number.isFinite(v)) k += v;
    });
    tr.querySelectorAll('input[data-field="amount"]').forEach((i) => {
      const v = parseFloat(i.value); if (Number.isFinite(v)) a += v;
    });
    kEl.textContent = k ? fmt(k, 3) : '';
    aEl.textContent = a ? fmt(a, 2) : '';
    kEl.classList.toggle('has', k > 0);
    aEl.classList.toggle('has', a > 0);
  }

  function updateDayTotals() {
    $$('#ledger tbody tr').forEach(updateRowTotal);
  }

  function updateStats() {
    const table = $('#ledger');
    const inputs = table.querySelectorAll('input[data-field]');
    let kwh = 0, amount = 0;
    const slots = new Set();

    if (inputs.length) {
      inputs.forEach((i) => {
        if (i.value !== '') slots.add(i.dataset.date + '#' + i.dataset.slot);
        const v = parseFloat(i.value);
        if (!Number.isFinite(v)) return;
        if (i.dataset.field === 'kwh') kwh += v; else amount += v;
      });
    } else {
      const sheet = Store.getActiveSheet();
      if (sheet) {
        const st = Store.monthStats(sheet.id, currentMonth);
        kwh = st.kwh; amount = st.amount;
        $('#stat-kwh').textContent = fmt(kwh, 3);
        $('#stat-amount').textContent = fmt(amount, 2);
        $('#stat-count').textContent = st.count;
        return;
      }
    }
    $('#stat-kwh').textContent = fmt(kwh, 3);
    $('#stat-amount').textContent = fmt(amount, 2);
    $('#stat-count').textContent = slots.size;
  }

  /* ---------------- 总渲染 ---------------- */

  function render() {
    renderSheetList();
    renderSheetHeader();
    $('#month-input').value = currentMonth;
    if (!skipTableRender) renderTable();
    skipTableRender = false;
    updateDayTotals();
    updateStats();
  }

  /* ---------------- 单元格编辑 ---------------- */

  function onCellInput(inp) {
    const tr = inp.closest('tr');
    if (tr) updateRowTotal(tr);
    updateStats();
  }

  function onCellChange(inp) {
    const sheet = Store.getActiveSheet();
    if (!sheet) return;
    const tr = inp.closest('tr');
    const date = inp.dataset.date;
    const slot = Number(inp.dataset.slot);
    const field = inp.dataset.field;
    const kwhInput = tr.querySelector(`input[data-slot="${slot}"][data-field="kwh"]`);
    const amtInput = tr.querySelector(`input[data-slot="${slot}"][data-field="amount"]`);
    let kwh = kwhInput.value;
    let amount = amtInput.value;

    // 输入电量后未填金额 → 按电价自动计算
    if (field === 'kwh' && kwh !== '' && amount === '' && Number(sheet.price) > 0) {
      const calc = Number(kwh) * Number(sheet.price);
      if (Number.isFinite(calc)) {
        amount = calc.toFixed(2);
        amtInput.value = amount;
      }
    }

    const td = inp.closest('td');
    const willFill = kwh !== '' || amount !== '';
    if (td) td.classList.toggle('filled', willFill);

    skipTableRender = true;
    Store.setSession(sheet.id, date, slot, { kwh, amount, note: inp.title || '' });
  }

  /* ---------------- 台账切换 / 管理 ---------------- */

  function bindSidebar() {
    $('#sheet-list').addEventListener('click', (e) => {
      const li = e.target.closest('.sheet-item');
      if (li) Store.setActive(li.dataset.id);
    });

    $('#btn-new-sheet').onclick = () => {
      dialog({
        title: '新建台账',
        bodyHTML: `
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--muted)">名称
            <input id="dlg-name" type="text" placeholder="如：老鼎 / 聚源" style="height:36px;padding:0 10px;border:1px solid var(--line-strong);border-radius:8px">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--muted)">车牌 / 单位（可选）
            <input id="dlg-plate" type="text" placeholder="如：化州市聚源运输有限公司" style="height:36px;padding:0 10px;border:1px solid var(--line-strong);border-radius:8px">
          </label>`,
        actions: [
          { label: '取消', onClick: closeDialog },
          { label: '创建', primary: true, onClick: () => {
            const name = $('#dlg-name').value.trim();
            const plate = $('#dlg-plate').value.trim();
            if (!name) { $('#dlg-name').focus(); return; }
            Store.addSheet(name, plate);
            closeDialog();
            toast('台账已创建');
          }},
        ],
        onMount: (body) => {
          body.style.gap = '12px';
          const n = $('#dlg-name');
          n.focus();
          n.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#modal2-actions .btn-primary').click(); });
        },
      });
    };

    $('#btn-rename').onclick = () => {
      const s = Store.getActiveSheet();
      if (!s) return;
      dialog({
        title: '重命名台账',
        bodyHTML: `<input id="dlg-name" type="text" value="${esc(s.name)}" style="height:36px;padding:0 10px;border:1px solid var(--line-strong);border-radius:8px;width:100%">`,
        actions: [
          { label: '取消', onClick: closeDialog },
          { label: '保存', primary: true, onClick: () => {
            const name = $('#dlg-name').value.trim();
            if (!name) return;
            Store.updateSheet(s.id, { name });
            closeDialog();
          }},
        ],
        onMount: (body) => {
          const n = $('#dlg-name'); n.focus(); n.select();
          n.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#modal2-actions .btn-primary').click(); });
        },
      });
    };

    $('#btn-del-sheet').onclick = () => {
      const s = Store.getActiveSheet();
      if (!s) return;
      dialog({
        title: '删除台账',
        bodyHTML: `<p class="help-body">确定删除「${esc(s.name)}」及其全部记录？此操作不可撤销。</p>`,
        actions: [
          { label: '取消', onClick: closeDialog },
          { label: '删除', danger: true, onClick: () => { Store.deleteSheet(s.id); closeDialog(); toast('已删除'); } },
        ],
      });
    };

    const plate = $('#sheet-plate');
    plate.addEventListener('change', () => {
      const s = Store.getActiveSheet();
      if (s) { skipTableRender = true; Store.updateSheet(s.id, { plate: plate.value.trim() }); }
    });

    const price = $('#sheet-price');
    price.addEventListener('change', () => {
      const s = Store.getActiveSheet();
      const v = parseFloat(price.value);
      if (s && Number.isFinite(v)) { skipTableRender = true; Store.updateSheet(s.id, { price: v }); }
    });
  }

  /* ---------------- 月份切换 ---------------- */

  function shiftMonth(delta) {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    currentMonth = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    render();
  }

  function bindMonthBar() {
    $('#btn-prev-month').onclick = () => shiftMonth(-1);
    $('#btn-next-month').onclick = () => shiftMonth(1);
    const mi = $('#month-input');
    mi.onchange = () => { if (mi.value) { currentMonth = mi.value; render(); } };
    const now = new Date();
    mi.max = `${now.getFullYear() + 5}-12`;
  }

  /* ---------------- 记录弹窗（识别 / 手动） ---------------- */

  let entryMode = 'manual';

  function fillSheetSelect(selectEl, value) {
    selectEl.innerHTML = Store.getSheets()
      .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    if (value) selectEl.value = value;
  }

  function openEntry(mode) {
    entryMode = mode;
    const modal = $('#modal');
    const isOcr = mode === 'ocr';

    $('#modal-title').textContent = isOcr ? '上传截图识别' : '手动记一笔';
    $('#modal-msg').textContent = '';
    $('#modal-msg').classList.remove('err');

    const active = Store.getActiveSheet();
    fillSheetSelect($('#f-sheet'), active ? active.id : null);
    $('#f-date').value = todayKey();
    $('#f-slot').value = 'auto';
    $('#f-kwh').value = '';
    $('#f-amount').value = '';
    $('#f-note').value = '';

    $('#dropzone').hidden = !isOcr;
    $('#btn-pick').hidden = !isOcr;
    $('#preview-wrap').hidden = true;
    $('#ocr-progress').hidden = true;
    $('#ocr-bar').style.width = '0';
    $('#ocr-raw-wrap').hidden = true;
    $('#ocr-raw').textContent = '';
    $('#file-image').value = '';
    $('#modal-save').disabled = false;
    $('#f-kwh').placeholder = isOcr ? '识别后自动填入' : '';
    $('#f-amount').placeholder = isOcr ? '识别后自动填入' : '';

    modal.hidden = false;
  }

  function closeEntry() { $('#modal').hidden = true; }

  async function handleImage(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMsg('请选择图片文件', true); return; }

    const url = URL.createObjectURL(file);
    $('#preview-img').src = url;
    $('#preview-wrap').hidden = false;
    $('#ocr-progress').hidden = false;
    $('#ocr-bar').style.width = '3%';
    $('#modal-save').disabled = true;
    setMsg('正在识别，首次使用需下载中文识别模型，请稍候…');

    try {
      const text = await OCR.recognize(file, (p) => {
        $('#ocr-bar').style.width = Math.max(3, Math.round(p * 100)) + '%';
      });
      const r = OCR.parse(text);

      if (r.kwh != null) $('#f-kwh').value = r.kwh;
      if (r.amount != null) $('#f-amount').value = r.amount;
      if (r.date) $('#f-date').value = r.date;
      if (r.note) $('#f-note').value = r.note;

      $('#ocr-raw').textContent = text.trim();
      $('#ocr-raw-wrap').hidden = false;

      if (r.ok) {
        let msg = '识别完成，请核对后保存';
        let err = false;
        const sheet = Store.getSheet($('#f-sheet').value);
        const price = sheet ? Number(sheet.price) : 0;
        const kwh = parseFloat($('#f-kwh').value);
        const amt = parseFloat($('#f-amount').value);
        if (Number.isFinite(kwh) && Number.isFinite(amt) && price > 0) {
          const expect = kwh * price;
          if (Math.abs(expect - amt) / Math.max(amt, 0.01) > 0.05) {
            msg = `提示：金额与「电量 × 电价」（约 ${expect.toFixed(2)} 元）不一致，请重点核对`;
            err = true;
          }
        }
        setMsg(msg, err);
      } else {
        setMsg('未能自动识别出电量/金额，请对照图片手动补充', true);
      }
    } catch (err) {
      console.error(err);
      setMsg('识别失败：' + (err && err.message ? err.message : '未知错误'), true);
    } finally {
      $('#ocr-progress').hidden = true;
      $('#modal-save').disabled = false;
    }
  }

  function setMsg(text, isErr) {
    const el = $('#modal-msg');
    el.textContent = text || '';
    el.classList.toggle('err', !!isErr);
  }

  function saveEntry() {
    const sheetId = $('#f-sheet').value;
    const sheet = Store.getSheet(sheetId);
    const date = $('#f-date').value;
    const slotSel = $('#f-slot').value;
    const kwh = $('#f-kwh').value;
    const amount = $('#f-amount').value;
    const note = $('#f-note').value;

    if (!sheet) { setMsg('请先创建台账', true); return; }
    if (!date) { setMsg('请选择日期', true); return; }
    if (kwh === '' && amount === '') { setMsg('请至少填写电量或金额', true); return; }

    let slot;
    if (slotSel === 'auto') {
      slot = Store.nextFreeSlot(sheetId, date);
      if (slot == null) { setMsg('该日期已记录 5 次，请手动选择要覆盖的第几次', true); return; }
    } else {
      slot = Number(slotSel);
    }

    Store.setSession(sheetId, date, slot, { kwh, amount, note });
    closeEntry();

    Store.setActive(sheetId);
    currentMonth = monthOf(date);
    render();
    toast(`已记录：${date} 第${slot}次`);
  }

  function bindEntryModal() {
    $('#btn-ocr').onclick = () => openEntry('ocr');
    $('#btn-manual').onclick = () => openEntry('manual');
    $('#modal-close').onclick = closeEntry;
    $('#modal-cancel').onclick = closeEntry;
    $('#modal-save').onclick = saveEntry;
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeEntry(); });

    const dz = $('#dropzone');
    const fi = $('#file-image');
    // dropzone 是绑定到 #file-image 的 label，点击由浏览器原生触发，无需 JS
    // 这个按钮作为备用入口（部分内置浏览器对 label 支持不佳）
    $('#btn-pick').onclick = () => { fi.value = ''; fi.click(); };
    fi.onchange = () => handleImage(fi.files[0]);
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); dz.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); dz.classList.remove('over');
    }));
    dz.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleImage(f);
    });

    // 弹窗内输入电量 → 自动算金额
    $('#f-kwh').addEventListener('change', () => {
      const sheet = Store.getSheet($('#f-sheet').value);
      const kwh = parseFloat($('#f-kwh').value);
      if (sheet && Number.isFinite(kwh) && $('#f-amount').value === '' && Number(sheet.price) > 0) {
        $('#f-amount').value = (kwh * Number(sheet.price)).toFixed(2);
      }
    });
  }

  /* ---------------- 菜单 ---------------- */

  function bindMenu() {
    const btn = $('#btn-menu');
    const menu = $('#menu');
    btn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) menu.hidden = true;
    });

    menu.addEventListener('click', async (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      menu.hidden = true;
      const sheet = Store.getActiveSheet();

      if (act === 'export-xlsx') {
        if (!Store.getSheets().length) { toast('暂无数据可导出'); return; }
        try { Exporter.exportXlsx(Store.getSheets(), currentMonth); toast('已导出 Excel'); }
        catch (err) { toast(err.message); }
      } else if (act === 'export-csv') {
        if (!sheet) { toast('暂无数据可导出'); return; }
        Exporter.exportCsv(sheet, currentMonth);
        toast('已导出 CSV');
      } else if (act === 'backup') {
        Exporter.downloadJSON(Store.exportAll());
        toast('已导出备份文件');
      } else if (act === 'restore') {
        $('#file-restore').click();
      } else if (act === 'help') {
        showHelp();
      } else if (act === 'reset') {
        dialog({
          title: '清空全部数据',
          bodyHTML: '<p class="help-body">将删除本机保存的所有台账与记录，且无法恢复。建议先「备份数据」。</p>',
          actions: [
            { label: '取消', onClick: closeDialog },
            { label: '确认清空', danger: true, onClick: () => {
              Store.reset();
              closeDialog();
              toast('已清空');
            }},
          ],
        });
      }
    });

    $('#file-restore').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = await Exporter.readJSONFile(file);
        dialog({
          title: '恢复数据',
          bodyHTML: '<p class="help-body">导入将覆盖当前全部数据，确定继续？</p>',
          actions: [
            { label: '取消', onClick: closeDialog },
            { label: '覆盖导入', primary: true, onClick: () => {
              try {
                Store.importAll(data);
                closeDialog();
                currentMonth = monthOf(todayKey());
                render();
                toast('数据已恢复');
              } catch (err) { toast(err.message); closeDialog(); }
            }},
          ],
        });
      } catch (err) {
        toast('文件格式不正确');
      }
    });
  }

  function showHelp() {
    dialog({
      title: '使用说明',
      bodyHTML: `
        <div class="help-body">
          <h4>日常使用</h4>
          <ol>
            <li>左侧选择台账（公司 / 车牌），中间按日期填写当天每次充电的「电量 / 金额」。</li>
            <li>点「上传截图识别」，选择充电桩账单截图，自动识别电量与金额，核对后保存。</li>
            <li>输入电量后未填金额时，会按台账设置的电价自动计算金额。</li>
            <li>右上角 <code>⋮</code> 可导出 Excel / CSV、备份与恢复数据。</li>
          </ol>
          <h4>数据存在哪</h4>
          <p>数据保存在当前浏览器（localStorage），不上传服务器。换电脑、换手机或清理浏览器缓存会看不到旧数据，请定期用「备份数据」导出 JSON 文件。</p>
          <h4>发布到 GitHub Pages</h4>
          <ol>
            <li>在 GitHub 新建一个仓库（Public）。</li>
            <li>把本项目全部文件推送到仓库的 <code>main</code> 分支。</li>
            <li>仓库 Settings → Pages → Source 选 <code>Deploy from a branch</code>，分支选 <code>main</code> / <code>/ (root)</code>，保存。</li>
            <li>约 1 分钟后访问 <code>https://你的用户名.github.io/仓库名/</code>，把网址发给同事即可使用。</li>
          </ol>
          <pre>git init
git add .
git commit -m "feat: 充电台账"
git branch -M main
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main</pre>
        </div>`,
      actions: [{ label: '知道了', primary: true, onClick: closeDialog }],
    });
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    Store.init();
    bindSidebar();
    bindMonthBar();
    bindEntryModal();
    bindMenu();

    const table = $('#ledger');
    table.addEventListener('input', (e) => {
      const inp = e.target.closest('input[data-field]');
      if (inp) onCellInput(inp);
    });
    table.addEventListener('change', (e) => {
      const inp = e.target.closest('input[data-field]');
      if (inp) onCellChange(inp);
    });

    const m2 = $('#modal2');
    $('#modal2-close').onclick = closeDialog;
    m2.addEventListener('click', (e) => { if (e.target === m2) closeDialog(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#modal2').hidden) closeDialog();
      else if (!$('#modal').hidden) closeEntry();
    });

    Store.subscribe(() => render());
    render();

    // 同一浏览器多标签页同步
    window.addEventListener('storage', (e) => {
      if (e.key === 'charging_ledger_v1') {
        Store.reload();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();