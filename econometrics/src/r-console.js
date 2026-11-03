import { ensureWebRInit, getWebRStatus, onWebRStatus, resetRWorkspace, runRCode } from "./webr-runtime.js";

function node(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "className") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "disabled") el.disabled = Boolean(v);
    else if (k === "hidden") el.hidden = Boolean(v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for (const c of children) {
    if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else if (c) el.appendChild(c);
  }
  return el;
}

function syncStatusPill(pill, detailEl) {
  const s = getWebRStatus();
  pill.className = `r-console__status r-console__status--${s.status}`;
  const labels = {
    idle: "R: ожидание",
    loading: "R: загрузка…",
    ready: "R: готов",
    error: "R: ошибка",
  };
  pill.textContent = labels[s.status] ?? s.status;
  const msg = s.detail || s.error || "";
  detailEl.textContent = msg;
  detailEl.hidden = !msg;
}

function showPlots(container, images) {
  container.replaceChildren();
  if (!images?.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  for (const img of images) {
    const canvas = node("canvas", { className: "r-console__plot" });
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d")?.drawImage(img, 0, 0);
    container.appendChild(canvas);
  }
}

/**
 * @param {{
 *   initialCode?: string,
 *   getCode?: () => string,
 *   readOnly?: boolean,
 *   compact?: boolean,
 *   saved?: { stdout?: string; stderr?: string },
 *   onSave?: (data: { stdout: string; stderr: string }) => void,
 * }} options
 */
export function createRConsole(options) {
  const { initialCode = "", getCode, readOnly = false, compact = false, saved, onSave } = options;

  const pill = node("span", { className: "r-console__status r-console__status--idle", text: "R: …" });
  const detailEl = node("p", { className: "r-console__status-detail", hidden: true });

  const editor = node("textarea", {
    className: "r-console__editor",
    rows: String(compact ? 4 : 6),
    spellcheck: "false",
    "aria-label": "Код R для выполнения в браузере",
  });
  editor.value = initialCode;
  if (readOnly) editor.readOnly = true;

  const outPre = node("pre", { className: "r-console__out", tabIndex: "0" });
  const errPre = node("pre", { className: "r-console__err", hidden: true, tabIndex: "0" });
  const plots = node("div", { className: "r-console__plots", hidden: true });

  if (saved?.stdout) outPre.textContent = saved.stdout;
  if (saved?.stderr) {
    errPre.textContent = saved.stderr;
    errPre.hidden = false;
  }

  let running = false;

  const runBtn = node("button", {
    type: "button",
    className: "btn btn--primary btn--sm",
    text: "▶ Выполнить",
  });

  const resetBtn = node("button", {
    type: "button",
    className: "btn btn--ghost btn--sm",
    text: "Сбросить данные",
    title: "Восстановить учебные таблицы df, wages, …",
  });

  async function execute() {
    const code = (getCode ? getCode() : editor.value).trim();
    if (!code || running) return;

    running = true;
    runBtn.disabled = true;
    runBtn.textContent = "Выполняется…";
    outPre.textContent = "";
    errPre.hidden = true;
    errPre.textContent = "";
    plots.hidden = true;

    try {
      await ensureWebRInit();
      const result = await runRCode(code);
      outPre.textContent = result.stdout || (result.ok ? "" : "(нет вывода)");
      if (result.stderr) {
        errPre.textContent = result.stderr;
        errPre.hidden = false;
      }
      showPlots(plots, result.images);
      onSave?.({ stdout: result.stdout, stderr: result.stderr });
    } finally {
      running = false;
      runBtn.disabled = false;
      runBtn.textContent = "▶ Выполнить";
    }
  }

  runBtn.addEventListener("click", () => execute());
  resetBtn.addEventListener("click", async () => {
    resetBtn.disabled = true;
    try {
      await resetRWorkspace();
      outPre.textContent = "Учебные объекты (df, wages, dat, …) восстановлены.";
      errPre.hidden = true;
    } catch (e) {
      errPre.textContent = e instanceof Error ? e.message : String(e);
      errPre.hidden = false;
    } finally {
      resetBtn.disabled = false;
    }
  });

  editor.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      execute();
    }
  });

  syncStatusPill(pill, detailEl);
  onWebRStatus(() => syncStatusPill(pill, detailEl));
  ensureWebRInit().catch(() => syncStatusPill(pill, detailEl));

  return node("section", { className: `r-console${compact ? " r-console--compact" : ""}` }, [
    node("div", { className: "r-console__head" }, [
      node("div", { className: "r-console__head-text" }, [
        node("h3", { className: "r-console__title", text: "R в браузере" }),
        node("p", {
          className: "r-console__sub",
          text: "WebR — дополнение. На паре и в отчёте по-прежнему используйте RStudio.",
        }),
      ]),
      pill,
    ]),
    detailEl,
    node("div", { className: "r-console__editor-wrap" }, [editor]),
    node("div", { className: "r-console__toolbar" }, [runBtn, resetBtn]),
    node("div", { className: "r-console__output" }, [
      node("span", { className: "r-console__out-label", text: "Вывод" }),
      outPre,
      errPre,
      plots,
    ]),
  ]);
}

export function renderWebRHeaderChip() {
  const s = getWebRStatus();
  const chip = node("span", {
    className: `header__webr r-console__status r-console__status--${s.status}`,
    title: s.detail || s.error || "R в браузере",
  });
  chip.textContent = s.ready ? "WebR ✓" : s.loading ? "WebR …" : s.status === "error" ? "WebR !" : "";
  chip.hidden = s.status === "idle";
  return chip;
}
