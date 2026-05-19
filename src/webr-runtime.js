import { WebR } from "webr";

/** @type {WebR | null} */
let webR = null;
/** @type {Promise<WebR> | null} */
let initPromise = null;

let status = "idle"; // idle | loading | ready | error
let statusDetail = "";
/** @type {Error | null} */
let lastError = null;

const listeners = new Set();

const SEED_R = `
df <- data.frame(
  educ = c(10, 12, 14, 16),
  exper = c(1, 3, 5, 8),
  wage = c(30, 45, 55, 70),
  female = c(0, 1, 0, 1)
)
wages <- c(30000, 45000, 52000)
scores <- c(7, 8, 9)
mydata <- df
dat <- df
sales <- data.frame(price = c(10, 12, 9), income = c(20, 25, 18))
consumption <- c(100, 120, 115)
income <- c(20, 25, 22)
`;

function setStatus(next, detail = "") {
  status = next;
  statusDetail = detail;
  for (const fn of listeners) fn(getWebRStatus());
}

export function getWebRStatus() {
  return {
    status,
    detail: statusDetail,
    error: lastError?.message ?? null,
    ready: status === "ready",
    loading: status === "loading",
  };
}

export function onWebRStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function ensureWebRInit() {
  if (status === "ready" && webR) return initPromise;
  if (initPromise) return initPromise;

  setStatus("loading", "Загрузка R (WebAssembly)…");
  initPromise = (async () => {
    try {
      const instance = new WebR();
      await instance.init();
      setStatus("loading", "Подготовка учебных данных…");
      await instance.globalShelter.captureR(SEED_R);
      webR = instance;
      setStatus("ready", "R в браузере готов");
      return instance;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      setStatus("error", lastError.message);
      initPromise = null;
      throw lastError;
    }
  })();

  return initPromise;
}

/**
 * @param {{ type: string; data: unknown }[]} output
 */
function formatCapturedOutput(output) {
  let stdout = "";
  let stderr = "";
  const messages = [];

  for (const chunk of output ?? []) {
    const text =
      typeof chunk.data === "string"
        ? chunk.data
        : chunk.data != null
          ? String(chunk.data)
          : "";
    switch (chunk.type) {
      case "stdout":
        stdout += text;
        break;
      case "stderr":
        stderr += text;
        break;
      case "warning":
      case "message":
        messages.push(text);
        break;
      default:
        if (text) messages.push(`[${chunk.type}] ${text}`);
    }
  }

  if (messages.length) {
    stderr += (stderr ? "\n" : "") + messages.join("\n");
  }

  return { stdout, stderr };
}

export async function runRCode(code) {
  const trimmed = code.trim();
  if (!trimmed) {
    return { stdout: "", stderr: "", resultText: "", images: [], ok: true };
  }

  await ensureWebRInit();
  if (!webR) throw new Error("WebR не инициализирован");

  try {
    const captured = await webR.globalShelter.captureR(trimmed);
    const { stdout, stderr } = formatCapturedOutput(captured.output);

    let resultText = "";
    try {
      resultText = await captured.result.toString();
      if (resultText && resultText !== "NULL" && !stdout.includes(resultText)) {
        if (!stdout) resultText = resultText.trimEnd();
      } else {
        resultText = "";
      }
    } catch {
      resultText = "";
    }

    const combined = [stdout, resultText].filter(Boolean).join(stdout && resultText ? "\n" : "");

    return {
      stdout: combined,
      stderr: stderr.trimEnd(),
      resultText,
      images: captured.images ?? [],
      ok: !stderr.toLowerCase().includes("error"),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      stdout: "",
      stderr: msg,
      resultText: "",
      images: [],
      ok: false,
    };
  }
}

export async function resetRWorkspace() {
  await ensureWebRInit();
  if (!webR) return;
  await webR.globalShelter.captureR(SEED_R);
}
