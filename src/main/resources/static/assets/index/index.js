/**
 * Mini Postman - index.js
 * ---------------------------------------------------------
 * Este archivo implementa:
 * - Tabs (Params / Authentication / Body FormData / Body JSON / Headers)
 * - Tablas clave-valor (N filas) para Params, Headers y FormData
 * - Construcción real de la request con fetch()
 * - Pintado de respuesta (status, time, size, body) + mensaje de error
 * ---------------------------------------------------------
 * Nota:
 * - Username/Password: “login” a la app (lo enviamos como X-App-Auth Basic ...)
 * - API KEY: si empieza por "Bearer " => Authorization; si no => X-API-KEY
 */

//////////////////////////////
// Helpers
//////////////////////////////

/** Tiempo actual en ms (para medir latencia) */
function nowMs() {
  return Math.floor(performance.now());
}

/** Tamaño del texto en bytes (aprox real) */
function bytesOf(str) {
  return new Blob([str]).size;
}

/** Verifica si un string parece URL válida */
function isLikelyUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Construye query string "?a=1&b=2" desde un array de {key,value}
 * (Ignora keys vacías)
 */
function buildQuery(params) {
  const qp = params
    .filter((p) => p.key.trim() !== "")
    .map((p) => [p.key.trim(), p.value ?? ""]);

  const usp = new URLSearchParams(qp);
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Si el response es JSON, lo formatea bonito. Si no, devuelve el texto tal cual.
 */
function tryPretty(text) {
  try {
    const obj = JSON.parse(text);
    return JSON.stringify(obj, null, 2);
  } catch {
    return text;
  }
}

/** Base64 con soporte utf-8 (acentos) */
function base64EncodeUtf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

//////////////////////////////
// UI refs (IDs del HTML corregido)
//////////////////////////////

const methodSelect = document.getElementById("methodSelect");
const urlInput = document.getElementById("urlInput");
const sendBtn = document.getElementById("sendBtn");

// Tabs
const tabs = Array.from(document.querySelectorAll(".tab"));
const panels = {
  params: document.getElementById("panel-params"),
  auth: document.getElementById("panel-auth"),
  formdata: document.getElementById("panel-formdata"),
  json: document.getElementById("panel-json"),
  headers: document.getElementById("panel-headers"),
};

// KV Containers
const paramsRows = document.getElementById("paramsRows");
const headersRows = document.getElementById("headersRows");
const formDataRows = document.getElementById("formDataRows");

// KV Buttons
const addParamBtn = document.getElementById("addParamBtn");
const clearParamsBtn = document.getElementById("clearParamsBtn");
const addHeaderBtn = document.getElementById("addHeaderBtn");
const clearHeadersBtn = document.getElementById("clearHeadersBtn");
const addFormDataBtn = document.getElementById("addFormDataBtn");
const clearFormDataBtn = document.getElementById("clearFormDataBtn");

// Auth fields (3 campos exactos)
const appUsername = document.getElementById("appUsername");
const appPassword = document.getElementById("appPassword");
const apiKey = document.getElementById("apiKey");

// Body JSON
const jsonBody = document.getElementById("jsonBody");

// Response UI
const statusPill = document.getElementById("statusPill");
const timePill = document.getElementById("timePill");
const sizePill = document.getElementById("sizePill");
const responsePre = document.getElementById("responsePre");
const errorMsg = document.getElementById("errorMsg");

//////////////////////////////
// State (N pares key-value)
//////////////////////////////

let paramsState = [
  { key: "", value: "", desc: "" },
  { key: "", value: "", desc: "" },
];

let headersState = [
  { key: "Accept", value: "application/json", desc: "" },
  { key: "", value: "", desc: "" },
];

let formDataState = [
  { key: "", value: "", desc: "" },
];

//////////////////////////////
// Render de filas clave-valor
//////////////////////////////

/**
 * Crea una fila con 3 inputs (key/value/desc) + botón eliminar
 * onChange: actualiza el item del estado
 * onRemove: elimina la fila
 */
function makeRow(item, onChange, onRemove) {
  const row = document.createElement("div");
  row.className = "kv-row";

  const key = document.createElement("input");
  key.placeholder = "Key";
  key.value = item.key;

  const value = document.createElement("input");
  value.placeholder = "Value";
  value.value = item.value;

  const desc = document.createElement("input");
  desc.placeholder = "Description";
  desc.value = item.desc;

  const actions = document.createElement("div");
  actions.className = "kv-actions";

  const del = document.createElement("button");
  del.className = "icon-btn";
  del.title = "Remove";
  del.type = "button";
  del.textContent = "✕";
  del.addEventListener("click", onRemove);

  actions.appendChild(del);

  // Cada vez que cambie un input, actualizamos el item (inmutable)
  key.addEventListener("input", () => onChange({ ...item, key: key.value }));
  value.addEventListener("input", () => onChange({ ...item, value: value.value }));
  desc.addEventListener("input", () => onChange({ ...item, desc: desc.value }));

  row.appendChild(key);
  row.appendChild(value);
  row.appendChild(desc);
  row.appendChild(actions);

  return row;
}

/** Renderiza Params */
function renderParams() {
  paramsRows.innerHTML = "";
  paramsState.forEach((item, idx) => {
    paramsRows.appendChild(
      makeRow(
        item,
        (next) => { paramsState[idx] = next; },
        () => { paramsState.splice(idx, 1); renderParams(); }
      )
    );
  });
}

/** Renderiza Headers */
function renderHeaders() {
  headersRows.innerHTML = "";
  headersState.forEach((item, idx) => {
    headersRows.appendChild(
      makeRow(
        item,
        (next) => { headersState[idx] = next; },
        () => { headersState.splice(idx, 1); renderHeaders(); }
      )
    );
  });
}

/** Renderiza Body FormData */
function renderFormData() {
  formDataRows.innerHTML = "";
  formDataState.forEach((item, idx) => {
    formDataRows.appendChild(
      makeRow(
        item,
        (next) => { formDataState[idx] = next; },
        () => { formDataState.splice(idx, 1); renderFormData(); }
      )
    );
  });
}

//////////////////////////////
// Tabs (mostrar/ocultar panels)
//////////////////////////////

tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    // Activar tab
    tabs.forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");

    // Mostrar panel asociado
    const tab = btn.dataset.tab;
    Object.values(panels).forEach((p) => p.classList.remove("active"));
    panels[tab].classList.add("active");
  });
});

//////////////////////////////
// UI Response (status/time/size/body + error)
//////////////////////////////

/** Muestra o limpia el mensaje de error */
function setError(text) {
  if (!errorMsg) return;

  if (!text) {
    errorMsg.classList.add("muted");
    errorMsg.textContent = "";
    return;
  }

  errorMsg.classList.remove("muted");
  errorMsg.textContent = text;
}

/**
 * Actualiza las pills y el response body
 */
function setResponse({ status, statusText, ms, rawText }) {
  const pretty = tryPretty(rawText ?? "");

  // Pill de status: color según rango
  statusPill.className = "pill";
  if (status >= 200 && status < 300) statusPill.classList.add("ok");
  else if (status >= 400 && status < 500) statusPill.classList.add("warn");
  else if (status === 0) statusPill.classList.add("bad");
  else statusPill.classList.add("bad");

  statusPill.textContent = status === 0 ? "—" : `${status} ${statusText || ""}`.trim();

  timePill.className = "pill muted";
  timePill.textContent = `${ms} ms`;

  sizePill.className = "pill muted";
  sizePill.textContent = `${bytesOf(pretty)} bytes`;

  responsePre.classList.remove("muted");
  responsePre.textContent = pretty;
}

//////////////////////////////
// Construcción de request
//////////////////////////////

/**
 * Une la URL base + paramsState (query params).
 * Respeta params existentes en la URL y agrega los nuevos.
 */
function buildFinalUrl(baseUrl) {
  const qp = buildQuery(paramsState);
  if (!qp) return baseUrl;

  const u = new URL(baseUrl);

  const existing = u.search ? u.search.slice(1) : "";
  const extra = qp.slice(1);

  const merged = [existing, extra].filter(Boolean).join("&");
  u.search = merged ? `?${merged}` : "";
  return u.toString();
}

/**
 * Construye headers finales:
 * - headersState (manuales)
 * - apiKey -> Authorization Bearer o X-API-KEY
 * - username/password -> X-App-Auth (Basic ...)
 */
function buildHeaders() {
  const h = new Headers();

  // Headers manuales de la tabla
  headersState
    .filter((x) => x.key.trim() !== "")
    .forEach((x) => h.set(x.key.trim(), x.value ?? ""));

  // API KEY
  const apiKeyVal = (apiKey?.value ?? "").trim();
  if (apiKeyVal) {
    // Si el user escribe "Bearer xxx", lo usamos tal cual como Authorization
    if (apiKeyVal.toLowerCase().startsWith("bearer ")) {
      h.set("Authorization", apiKeyVal);
    } else {
      // Caso típico de API Key
      h.set("X-API-KEY", apiKeyVal);
    }
  }

  // Login a la app (requisito)
  const u = (appUsername?.value ?? "").trim();
  const p = (appPassword?.value ?? "").trim();
  if (u && p) {
    const token = base64EncodeUtf8(`${u}:${p}`);
    h.set("X-App-Auth", `Basic ${token}`);
  }

  return h;
}

/**
 * Decide qué body enviar según método + contenido.
 * - GET/DELETE: sin body
 * - Si hay JSON en textarea: Content-Type application/json
 * - Si no hay JSON pero hay form-data: FormData()
 * - Si no hay nada: null
 */
function buildBody(method, headers) {
  const m = method.toUpperCase();

  // GET/DELETE (normalmente) no body
  if (m === "GET" || m === "DELETE") return null;

  // 1) JSON si el textarea tiene contenido
  const jsonText = (jsonBody?.value ?? "").trim();
  if (jsonText) {
    // Validar que sea JSON
    JSON.parse(jsonText);

    // Si el user no puso Content-Type, lo ponemos nosotros
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    return jsonText; // string
  }

  // 2) FormData si hay campos
  const hasForm = formDataState.some((x) => x.key.trim() !== "");
  if (hasForm) {
    const fd = new FormData();
    formDataState
      .filter((x) => x.key.trim() !== "")
      .forEach((x) => fd.append(x.key.trim(), x.value ?? ""));

    // IMPORTANTE: no seteamos Content-Type con FormData (boundary lo pone el navegador)
    if (headers.has("Content-Type")) headers.delete("Content-Type");

    return fd;
  }

  // 3) Nada
  return null;
}

//////////////////////////////
// SEND (fetch real)
//////////////////////////////

sendBtn.addEventListener("click", async () => {
  setError("");

  const t0 = nowMs();
  const method = methodSelect.value;
  const baseUrl = urlInput.value.trim();

  // Validación de URL
  if (!isLikelyUrl(baseUrl)) {
    setError("URL inválida. Debe incluir protocolo (http:// o https://).");
    setResponse({
      status: 400,
      statusText: "Bad Request",
      ms: 0,
      rawText: JSON.stringify({ error: "Invalid URL" }, null, 2),
    });
    return;
  }

  // Construir URL final con params
  let finalUrl;
  try {
    finalUrl = buildFinalUrl(baseUrl);
  } catch (e) {
    setError("No pude construir la URL con Params.");
    return;
  }

  // Headers + Body
  const headers = buildHeaders();

  let body = null;
  try {
    body = buildBody(method, headers);
  } catch (e) {
    setError(`JSON inválido: ${e.message}`);
    return;
  }

  // Timeout de seguridad (15s)
  const controller = new AbortController();
  const timeoutMs = 15000;
  const to = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(finalUrl, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    // Leemos como texto (sirve para JSON y texto plano)
    const text = await res.text();
    const t1 = nowMs();

    setResponse({
      status: res.status,
      statusText: res.statusText || "",
      ms: t1 - t0,
      rawText: text || "",
    });

    // Si HTTP error, mostramos mensaje
    if (!res.ok) {
      setError(`Error HTTP ${res.status}. Revisa endpoint, auth, headers o body.`);
    }
  } catch (e) {
    const t1 = nowMs();

    // Errores típicos:
    // - AbortError: timeout
    // - TypeError: suele ser CORS / red
    const msg =
      e.name === "AbortError"
        ? `Timeout: la request tardó más de ${timeoutMs} ms.`
        : `Network/CORS error: ${e.message}`;

    setError(msg);

    // status 0 para indicar que no hubo respuesta HTTP
    setResponse({
      status: 0,
      statusText: "FETCH_ERROR",
      ms: t1 - t0,
      rawText: JSON.stringify({ error: msg }, null, 2),
    });
  } finally {
    clearTimeout(to);
  }
});

//////////////////////////////
// Botones + Add/Clear (Params / Headers / FormData)
//////////////////////////////

addParamBtn.addEventListener("click", () => {
  paramsState.push({ key: "", value: "", desc: "" });
  renderParams();
});

clearParamsBtn.addEventListener("click", () => {
  paramsState = [{ key: "", value: "", desc: "" }];
  renderParams();
});

addHeaderBtn.addEventListener("click", () => {
  headersState.push({ key: "", value: "", desc: "" });
  renderHeaders();
});

clearHeadersBtn.addEventListener("click", () => {
  headersState = [{ key: "Accept", value: "application/json", desc: "" }];
  renderHeaders();
});

addFormDataBtn.addEventListener("click", () => {
  formDataState.push({ key: "", value: "", desc: "" });
  renderFormData();
});

clearFormDataBtn.addEventListener("click", () => {
  formDataState = [{ key: "", value: "", desc: "" }];
  renderFormData();
});

//////////////////////////////
// Init
//////////////////////////////

renderParams();
renderHeaders();
renderFormData();

// Enter en URL => Send
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.click();
});