/*
 * ocr.js —— 图片识别
 * 使用 Tesseract.js 在浏览器本地识别充电桩「账单结算」截图，
 * 再用正则从中提取 电量 / 金额 / 日期 / 时间 / 状态。
 * 全部在本地完成，图片不会上传到服务器。
 */
const OCR = (() => {

  /* 常见 OCR 字符混淆纠正（仅在数字串上使用） */
  function sanitizeNum(str) {
    if (!str) return null;
    let s = String(str)
      .replace(/[OoQ]/g, '0')
      .replace(/[Il|]/g, '1')
      .replace(/[Ss]/g, '5')
      .replace(/B/g, '8')
      .replace(/[，,]/g, '.')
      .replace(/[·•]/g, '.')
      .replace(/[^\d.]/g, '');
    const parts = s.split('.').filter(Boolean);
    if (!parts.length) return null;
    if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function firstMatch(text, patterns) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m && m[1] != null) return m[1];
    }
    return null;
  }

  const toNum = (v) => (v == null ? null : sanitizeNum(v));

  /* 数字/字母的粗匹配片段：允许数字之间被 OCR 插入空格或小数点 */
  const NUM = '[\\dOoQIlSsBb.,· 　]{1,20}';

  /**
   * 从识别文本中解析字段
   * @returns {{kwh:number|null, amount:number|null, date:string|null, time:string|null, note:string, raw:string, ok:boolean}}
   */
  function parse(text) {
    const raw = text || '';
    // 全角/易混标点归一
    const norm = raw
      .replace(/[：]/g, ':')
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')')
      .replace(/[‐‑–—]/g, '-');
    const flat = norm.replace(/[ \t]+/g, ' ');

    const out = { kwh: null, amount: null, date: null, time: null, note: '', raw, ok: false };

    /* ---- 电量：优先「充电电量」，其次带 kwh/度 单位的数字 ---- */
    out.kwh = toNum(firstMatch(flat, [
      new RegExp('电量[^\\d]{0,6}(' + NUM + ')'),
      new RegExp('(' + NUM + '?)\\s*(?:kwh|KWH|Kwh|kW h|度)'),
    ]));

    /* ---- 金额：优先「消费金额」，其次带 元 单位的数字 ---- */
    out.amount = toNum(firstMatch(flat, [
      new RegExp('金额[^\\d]{0,6}(' + NUM + ')'),
      new RegExp('(' + NUM + '?)\\s*元'),
    ]));

    /* ---- 日期：账单顶部形如 2026-09-30 ---- */
    const dm = flat.match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
    if (dm) {
      out.date = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
    }

    /* ---- 时间：开始时间 HH:MM ---- */
    const tm = flat.match(/开始时间[^\d]{0,6}(\d{1,2})\s*[:.．]\s*(\d{2})/);
    if (tm) out.time = `${String(tm[1]).padStart(2, '0')}:${tm[2]}`;

    /* ---- 状态备注：如 [203] 用户主动终止 / 充满 ---- */
    const nm =
      flat.match(/\[(\d{2,4})\]\s*([\u4e00-\u9fa5]{2,12})/) ||
      flat.match(/(用户主动终止|主动终止|充满|达到限制|余额不足|拔枪)/);
    if (nm) out.note = nm[2] || nm[1] || '';

    out.ok = out.kwh != null || out.amount != null;
    return out;
  }

  /**
   * 图像预处理：适度放大（2 倍以内）+ 对比度拉伸，提升屏幕照片的识别率。
   * 注意：必须保持彩色。实测在浏览器中把图片转成灰度后，
   * Tesseract 会静默返回空文本（不报错），因此这里只做放大与对比度处理。
   * 输出 JPEG Blob，任何环节异常都回退为原文件。
   */
  function preprocess(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(2, Math.max(1, 1800 / Math.max(img.width, img.height)));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          contrastStretch(ctx, w, h);
          canvas.toBlob((blob) => done(blob || file), 'image/jpeg', 0.92);
        } catch (e) {
          done(file);
        }
      };
      img.onerror = () => done(file);
      img.src = url;
    });
  }

  /** 对比度拉伸（就地修改像素），仅当整体偏灰时执行 */
  function contrastStretch(ctx, w, h) {
    const data = ctx.getImageData(0, 0, w, h);
    const p = data.data;
    let min = 255, max = 0;
    for (let i = 0; i < p.length; i += 4) {
      const g = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    if (max - min <= 30) return;
    const range = max - min;
    for (let i = 0; i < p.length; i += 4) {
      p[i] = (p[i] - min) * 255 / range;
      p[i + 1] = (p[i + 1] - min) * 255 / range;
      p[i + 2] = (p[i + 2] - min) * 255 / range;
    }
    ctx.putImageData(data, 0, 0);
  }

  /**
   * 裁切图片中的一块区域并放大，输出适合做「单行数字」识别的 JPEG Blob。
   * @param {HTMLImageElement} imgEl 已加载完成的图片元素
   * @param {{left:number,top:number,width:number,height:number}} r 原图坐标
   */
  function cropToBlob(imgEl, r) {
    return new Promise((resolve) => {
      try {
        const sw = Math.max(1, Math.round(r.width));
        const sh = Math.max(1, Math.round(r.height));
        // 放大到高度约 130px，Tesseract 在这个字号下对数字最稳
        const scale = Math.min(8, Math.max(1, 130 / sh));
        const dw = Math.round(sw * scale);
        const dh = Math.round(sh * scale);
        const pad = Math.round(dh * 0.4); // 四周留白，帮助单行切分

        const canvas = document.createElement('canvas');
        canvas.width = dw + pad * 2;
        canvas.height = dh + pad * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgEl, r.left, r.top, sw, sh, pad, pad, dw, dh);
        contrastStretch(ctx, canvas.width, canvas.height);
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.95);
      } catch (e) {
        resolve(null);
      }
    });
  }

  /* 数字识别专用 worker：只认 0-9 和「.」，并按单行切分，准确率比整图高很多 */
  let digitWorker = null;
  let digitProgressCb = null;

  async function getDigitWorker() {
    if (digitWorker) return digitWorker;
    digitWorker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && digitProgressCb) {
          digitProgressCb(m.progress || 0);
        }
      },
    });
    await digitWorker.setParameters({
      tessedit_char_whitelist: '0123456789.',
      tessedit_pageseg_mode: '7', // 7 = 单行文本
    });
    return digitWorker;
  }

  /**
   * 识别「框选出来的数字区域」
   * @param {Blob} blob 由 cropToBlob 产出
   * @param {(p:number)=>void} onProgress
   */
  async function recognizeDigits(blob, onProgress) {
    if (typeof Tesseract === 'undefined') {
      throw new Error('识别库未加载，请检查网络后刷新页面');
    }
    if (!blob) return '';
    const worker = await getDigitWorker();
    digitProgressCb = onProgress;
    try {
      const res = await worker.recognize(blob);
      return res && res.data ? res.data.text || '' : '';
    } finally {
      digitProgressCb = null;
    }
  }

  /**
   * 从单行数字识别结果中取出数值。
   * 白名单已限制字符集，这里只做常见的「字母被认成数字」纠正。
   */
  function extractNumber(text) {
    if (!text) return null;
    const s = String(text)
      .replace(/[，,]/g, '.')
      .replace(/[OoQ]/g, '0')
      .replace(/[Il|!]/g, '1')
      .replace(/[Zz]/g, '2')
      .replace(/[Ss]/g, '5')
      .replace(/[Bb]/g, '8')
      .replace(/[^\d.]/g, '');
    const ms = s.match(/\d+(?:\.\d+)?/g);
    if (!ms || !ms.length) return null;
    // 多段时取最长的，通常就是目标值
    const pick = ms.reduce((a, b) => (b.replace(/\./g, '').length > a.replace(/\./g, '').length ? b : a));
    const n = Number(pick);
    return Number.isFinite(n) ? n : null;
  }

  async function runTesseract(input, onProgress) {
    const result = await Tesseract.recognize(input, 'chi_sim+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && typeof onProgress === 'function') {
          onProgress(m.progress || 0);
        }
      },
    });
    return result && result.data ? result.data.text : '';
  }

  /**
   * 识别图片
   * @param {File|Blob|string} file
   * @param {(p:number)=>void} onProgress 0~1
   */
  async function recognize(file, onProgress) {
    if (typeof Tesseract === 'undefined') {
      throw new Error('识别库未加载，请检查网络后刷新页面');
    }

    let enhanced = null;
    if (file instanceof Blob) {
      try { enhanced = await preprocess(file); } catch (e) { enhanced = null; }
    }

    let text = '';
    if (enhanced && enhanced !== file) {
      text = await runTesseract(enhanced, onProgress);
    }
    // 预处理结果为空时，回退用原图再试一次
    if (!text || !text.trim()) {
      text = await runTesseract(file, onProgress);
    }
    return text || '';
  }

  return { recognize, parse, preprocess, cropToBlob, recognizeDigits, extractNumber };
})();