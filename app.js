const fileInput = document.getElementById("fileInput");
const mergeBtn = document.getElementById("mergeBtn");
const clearBtn = document.getElementById("clearBtn");
const outNameEl = document.getElementById("outName");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

let items = []; 
// {
//   id, file, size,
//   pageCount, rangeText, selectedIndices, rangeError,
//   bytes, pdfjsTask, pdfjsDoc,
//   open, debounceTimer
// }
let sortable = null;

// pdf.js worker
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";


fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  for (const file of files) {
    const it = {
      id: uid(),
      file,
      size: file.size,
      pageCount: null,
      rangeText: "",           // empty => all pages
      selectedIndices: null,   // null => all pages
      rangeError: "",
	  thumbRenderToken: 0,
      bytesLib: null,
	  bytesJs: null,
      pdfjsTask: null,
      pdfjsDoc: null,
      open: false,
      debounceTimer: null,
    };
    items.push(it);
  }

  await hydrateNewItems();
  render();
  setEnabled(items.length > 0);
  setStatus(`已載入 ${items.length} 份 PDF（可繼續加入），可拖曳排序後合併。`);
  fileInput.value = "";
});

clearBtn.addEventListener("click", () => {
  items = [];
  render();
  setEnabled(false);
  setStatus("已清除。");
  fileInput.value = "";
});

mergeBtn.addEventListener("click", async () => {
  if (!items.length) return;

  // 阻擋：若有格式錯誤
  const hasErr = items.some((it) => it.rangeError);
  if (hasErr) {
    setStatus("有頁碼格式錯誤，請先修正後再合併。");
    return;
  }

  const outName = (outNameEl.value || "merged.pdf").trim();
  setEnabled(false);
  setStatus("開始合併 PDF…");

  try {
    const { PDFDocument } = PDFLib;
    const outPdf = await PDFDocument.create();

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      setStatus(`合併中：${i + 1} / ${items.length}\n${it.file.name}`);

      const bytes = it.bytesLib ?? (await it.file.arrayBuffer());
	  const src = await PDFDocument.load(bytes, { ignoreEncryption: false });

      const indices = getEffectiveIndices(it, src.getPageCount()); // 0-based
      const copied = await outPdf.copyPages(src, indices);
      for (const p of copied) outPdf.addPage(p);
    }

    const outBytes = await outPdf.save();
    downloadBytes(outBytes, outName.endsWith(".pdf") ? outName : `${outName}.pdf`);
    setStatus(`完成！已下載：${outName.endsWith(".pdf") ? outName : `${outName}.pdf`}`);
  } catch (err) {
    console.error(err);
    setStatus(`失敗：${err?.message || err}`);
  } finally {
    setEnabled(items.length > 0);
  }
});

async function hydrateNewItems() {
  // 只補齊 bytes + pageCount（pdf-lib），並初始化 pdf.js doc（lazy）
  const { PDFDocument } = PDFLib;

  for (const it of items) {
    if (it.bytes) continue;
    try {
      const raw = await it.file.arrayBuffer();

	  // 複製兩份，避免 pdf.js detach 後影響 pdf-lib
	  it.bytesLib = raw.slice(0);
	  it.bytesJs  = raw.slice(0);

	  // pdf-lib 用 bytesLib 讀頁數
	  const doc = await PDFDocument.load(it.bytesLib, { ignoreEncryption: false });
	  it.pageCount = doc.getPageCount();


      // 初始：空字串 => 全選
      it.rangeError = "";
      it.selectedIndices = null;
    } catch (e) {
      it.pageCount = "無法讀取";
      it.rangeError = "此 PDF 無法讀取（可能是加密或格式問題）";
    }
  }
}

function render() {
  listEl.innerHTML = "";

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];

    const div = document.createElement("div");
    div.className = "item";
    div.dataset.id = it.id;
    div.dataset.open = it.open ? "1" : "0";

    const selectedCount = getSelectedCountText(it);

    div.innerHTML = `
      <div class="itemHeader">
        <div class="itemLeft">
          <span class="badge">#${idx + 1}</span>
          <span class="name" title="${escapeHtml(it.file.name)}">${escapeHtml(it.file.name)}</span>
        </div>

        <div class="controls">
          <button class="toggleBtn" data-action="toggle" title="展開/收合" aria-label="展開/收合">
            <svg viewBox="0 0 24 24" class="chev" aria-hidden="true">
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <button class="iconBtn danger" data-action="delete" title="移除" aria-label="移除">
            <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
              <path d="M6 7h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M9 7V5h6v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 7l1 14h6l1-14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              <path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="meta">
        <span class="pill">大小：${formatBytes(it.size)}</span>
        <span class="pill">頁數：${it.pageCount ?? "讀取中…"}</span>
        <span class="pill">已選：<span data-role="selectedCount">${selectedCount}</span></span>
        <span class="pill" data-role="rangeErrPill" style="border-color:#fca5a5;color:#b42318;background:#fff;${it.rangeError ? "" : "display:none;"}">
		  格式錯誤
		</span>
      </div>

      <div class="details">
        <div class="rangeRow">
          <div class="rangeField">
            <label class="rangeHint">選擇頁碼（例：1-3,5,7-99；留空＝全部）</label>
            <input data-action="range" type="text" value="${escapeHtml(it.rangeText)}" placeholder="例如：1-3,5,7-99" />
            <div class="${it.rangeError ? "err" : "ok"}" data-role="rangeMsg">
              ${it.rangeError ? escapeHtml(it.rangeError) : `已選 ${selectedCount}`}
            </div>
          </div>
        </div>

        <div class="thumbs" data-role="thumbs"></div>
      </div>
    `;

    // toggle open/close
    div.querySelector("[data-action='toggle']").addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      it.open = !it.open;
      render(); // 簡化：直接重 render
      if (it.open) {
        // 展開後：渲染縮圖（依選擇）
        const el = findItemEl(it.id);
        if (el) await renderThumbsForItem(it, el);
      }
    });

    // delete
    div.querySelector("[data-action='delete']").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeById(it.id);
    });

    // range input (debounce 1s)
    const rangeInput = div.querySelector("[data-action='range']");
    rangeInput.addEventListener("input", () => {
	  it.rangeText = rangeInput.value;

	  if (it.debounceTimer) clearTimeout(it.debounceTimer);
	  it.debounceTimer = setTimeout(async () => {
		applyRangeAndUpdate(it);

		// ✅ 就地更新，不重畫整張卡片（不會失焦）
		const host = findItemEl(it.id);
		if (!host) return;
		updateItemRangeUI(it, host);

		// 若展開，更新縮圖
		if (it.open) {
		  await renderThumbsForItem(it, host);
		}
	  }, 1500);
	});


    listEl.appendChild(div);
  }

  initSortable();
}

function updateItemRangeUI(it, hostEl) {
  const msgEl = hostEl.querySelector('[data-role="rangeMsg"]');
  const countEl = hostEl.querySelector('[data-role="selectedCount"]');
  const errPill = hostEl.querySelector('[data-role="rangeErrPill"]');

  const selectedCount = getSelectedCountText(it);

  if (countEl) countEl.textContent = selectedCount;

  if (msgEl) {
    msgEl.className = it.rangeError ? "err" : "ok";
    msgEl.textContent = it.rangeError ? it.rangeError : `已選 ${selectedCount}`;
  }

  if (errPill) {
    errPill.style.display = it.rangeError ? "" : "none";
  }
}


function initSortable() {
  if (sortable) sortable.destroy();

  sortable = new Sortable(listEl, {
	  animation: 170,
	  easing: "cubic-bezier(0.2, 0, 0, 1)",
	  ghostClass: "sortable-ghost",
	  chosenClass: "sortable-chosen",
	  dragClass: "sortable-drag",
	  forceFallback: true,
	  fallbackOnBody: true,
	  fallbackTolerance: 4,

	  // ✅ 只從 header 拖曳
	  handle: ".itemHeader",

	  // ✅ 只用 filter 當保險，但「不要 prevent」
	  filter: "input, textarea, button, select, label",


	  preventOnFilter: false,

	  // 手機體驗
	  delay: 120,
	  delayOnTouchOnly: true,

	  onEnd: () => {
		const order = Array.from(listEl.children).map((el) => el.dataset.id);
		const map = new Map(items.map((x) => [x.id, x]));
		items = order.map((id) => map.get(id)).filter(Boolean);
		render();
	  },
  });


}

function applyRangeAndUpdate(it) {
  if (typeof it.pageCount !== "number") {
    it.rangeError = "此 PDF 無法讀取頁數";
    it.selectedIndices = null;
    return;
  }

  const text = (it.rangeText || "").trim();
  if (!text) {
    it.rangeError = "";
    it.selectedIndices = null; // null => all pages
    return;
  }

  const parsed = parsePageRanges(text, it.pageCount);
  if (parsed.error) {
    it.rangeError = parsed.error;
    it.selectedIndices = null;
  } else {
    it.rangeError = "";
    it.selectedIndices = parsed.indices; // 0-based
  }
}

function getEffectiveIndices(it, actualCount) {
  // 若 it.selectedIndices=null => all pages
  if (!it.selectedIndices) {
    return Array.from({ length: actualCount }, (_, i) => i);
  }
  // 保底：避免頁數變動時越界（理論上不會）
  return it.selectedIndices.filter((i) => i >= 0 && i < actualCount);
}

function getSelectedCountText(it) {
  if (typeof it.pageCount !== "number") return "—";
  if (!it.selectedIndices) return `${it.pageCount} / ${it.pageCount}`;
  return `${it.selectedIndices.length} / ${it.pageCount}`;
}

function parsePageRanges(text, pageCount) {
  // 允許：1-3,5,7-99（逗號分隔）
  // 回傳 0-based indices（去重、排序）
  const tokens = text.split(",").map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return { indices: null, error: "" };

  const set = new Set();
  for (const tok of tokens) {
    if (/^\d+$/.test(tok)) {
      const n = Number(tok);
      if (!Number.isInteger(n) || n < 1 || n > pageCount) {
        return { indices: null, error: `頁碼超出範圍：${tok}（應為 1 ~ ${pageCount}）` };
      }
      set.add(n - 1);
      continue;
    }

    const m = tok.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (![a, b].every(Number.isInteger)) {
        return { indices: null, error: `格式錯誤：${tok}` };
      }
      if (a < 1 || b < 1 || a > pageCount || b > pageCount) {
        return { indices: null, error: `區間超出範圍：${tok}（應為 1 ~ ${pageCount}）` };
      }
      if (a > b) {
        return { indices: null, error: `區間起訖錯誤：${tok}（起始不可大於結束）` };
      }
      for (let n = a; n <= b; n++) set.add(n - 1);
      continue;
    }

    return { indices: null, error: `格式錯誤：${tok}（例：1-3,5,7-99）` };
  }

  const indices = Array.from(set).sort((x, y) => x - y);
  if (!indices.length) return { indices: null, error: "未選取任何頁面" };
  return { indices, error: "" };
}

async function renderThumbsForItem(it, itemEl) {
  const myToken = ++it.thumbRenderToken;
  const thumbsEl = itemEl.querySelector('[data-role="thumbs"]');
  if (!thumbsEl) return;
  thumbsEl.innerHTML = "";
  
  // 若格式錯誤，不渲染（避免誤導）
  if (it.rangeError) {
    thumbsEl.innerHTML = "";
    return;
  }
  if (typeof it.pageCount !== "number") {
    thumbsEl.innerHTML = "";
    return;
  }

  // 需要渲染的頁（1-based for pdf.js）
  const indices = it.selectedIndices
    ? it.selectedIndices
    : Array.from({ length: it.pageCount }, (_, i) => i);

  // 避免一次渲染太多頁卡死：先設安全上限
  const MAX_THUMBS = 200;
  const slice = indices.slice(0, MAX_THUMBS);

  thumbsEl.innerHTML = "";
  if (indices.length > MAX_THUMBS) {
    const warn = document.createElement("div");
    warn.className = "rangeHint";
    warn.textContent = `已選 ${indices.length} 頁，為避免卡頓目前只預覽前 ${MAX_THUMBS} 頁。`;
    thumbsEl.appendChild(warn);
  }

  // lazy init pdf.js doc
  const pdfDoc = await getPdfJsDoc(it);
  if (!pdfDoc) return;

  // sequential render (穩定；大量頁會較慢但不爆)
  for (const idx0 of slice) {
	if (myToken !== it.thumbRenderToken) return; // ⬅️ 舊渲染中止
    const pageNo = idx0 + 1; // 1-based
    const card = document.createElement("div");
    card.className = "thumbCard";
    card.innerHTML = `
      <canvas class="thumbCanvas"></canvas>
      <div class="thumbLabel"><span class="p">第 ${pageNo} 頁</span></div>
    `;
    thumbsEl.appendChild(card);

    const canvas = card.querySelector("canvas");
    await renderPageToCanvas(pdfDoc, pageNo, canvas, 140);
  }
}

async function getPdfJsDoc(it) {
  try {
    if (it.pdfjsDoc) return it.pdfjsDoc;
    if (!it.bytesJs) {
	  const raw = await it.file.arrayBuffer();
	  it.bytesLib = it.bytesLib ?? raw.slice(0);
	  it.bytesJs  = raw.slice(0);
	}
	if (!it.pdfjsTask) it.pdfjsTask = pdfjsLib.getDocument({ data: it.bytesJs });

    it.pdfjsDoc = await it.pdfjsTask.promise;
    return it.pdfjsDoc;
  } catch (e) {
    console.error(e);
    it.rangeError = "縮圖預覽失敗（可能是加密 PDF）";
    return null;
  }
}

async function renderPageToCanvas(pdfDoc, pageNo, canvas, targetWidthPx) {
  const page = await pdfDoc.getPage(pageNo);
  const viewport1 = page.getViewport({ scale: 1 });

  const scale = targetWidthPx / viewport1.width;
  const viewport = page.getViewport({ scale });

  const ctx = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  // 白底
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
}

function findItemEl(id) {
  return listEl.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
}

function removeById(id) {
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const it = items[idx];
  if (it.debounceTimer) clearTimeout(it.debounceTimer);
  items.splice(idx, 1);
  render();
  setEnabled(items.length > 0);
  setStatus(items.length ? `已移除 1 份 PDF，剩 ${items.length} 份。` : "已清空。");
}

function setEnabled(enabled) {
  mergeBtn.disabled = !enabled;
  clearBtn.disabled = !enabled;
  fileInput.disabled = false;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const v = bytes / Math.pow(k, i);
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${sizes[i]}`;
}
