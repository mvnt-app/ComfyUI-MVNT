import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE = "MVNTPreviewDance3D";
// Comfy frontend asset hashes change per release; never hard-code them. Names are discovered at runtime.
const VIEW_H = 420;
const BAR_H = 42;
const LAYOUT_STYLE_ID = "mvnt-preview-dance3d-layout";
const ROOT_CLASS = "mvnt-preview-dance3d-root";
const VIEWER_CLASS = "mvnt-preview-dance3d-viewer";
const TRACK_YAW_LERP = 0.055;
const TRACK_POS_LERP = 0.78;
const TRACK_DISTANCE_FACTOR = 1.0;
// Camera distance only: slightly farther than 2.45 (closer preview), still nearer than the old 2.65 default.
const PREVIEW_DIST_FACTOR = 2.52;
const PREVIEW_EYE_FACTOR = 1.08;
const PREVIEW_TARGET_FACTOR = 0.82;
const TRACK_SCREEN_Y_FACTOR = 0.34;
const TRACK_TURN_IGNORE_RAD = (100 * Math.PI) / 180;
const TRACK_SPIN_VEL_MAX = Math.PI * 1.5;
// Verbose diagnostics: run localStorage.setItem("mvntPreviewDebug", "1") in the browser console to enable.
const DEBUG = (() => {
  try {
    return localStorage.getItem("mvntPreviewDebug") === "1";
  } catch {
    return false;
  }
})();
let load3dPromise = null;

const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_READERS = {
  5120: "getInt8",
  5121: "getUint8",
  5122: "getInt16",
  5123: "getUint16",
  5125: "getUint32",
  5126: "getFloat32",
};

function dbg(...args) {
  if (DEBUG) console.info("[MVNT Preview Dance 3D][dbg]", ...args);
}

function dbgw(...args) {
  if (DEBUG) console.warn("[MVNT Preview Dance 3D][dbg]", ...args);
}

function ensureLayoutStyles() {
  if (document.getElementById(LAYOUT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = LAYOUT_STYLE_ID;
  style.textContent = `
.${ROOT_CLASS} {
  box-sizing: border-box;
  align-self: stretch;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}
.${VIEWER_CLASS} {
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0;
  overflow: hidden;
  box-sizing: border-box;
  position: relative;
}
.${VIEWER_CLASS} > * {
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box;
}
.${VIEWER_CLASS} canvas {
  display: block;
  max-width: 100% !important;
  box-sizing: border-box;
}`;
  document.head.appendChild(style);
}

function nodeInnerWidth(node, fallback = 680) {
  const sizeW = Array.isArray(node?.size) ? Number(node.size[0]) : 0;
  const inner = sizeW > 0 ? sizeW - 20 : fallback;
  return Math.max(320, inner);
}

/** Widest measured clientWidth on the DOM chain above the widget root (Comfy DOM widget slot). */
function widgetHostWidth(state) {
  let el = state?.root?.parentElement;
  let best = 0;
  for (let depth = 0; depth < 12 && el; depth += 1) {
    const w = el.clientWidth;
    if (w > 0) best = Math.max(best, w);
    if (el.classList?.contains("litegraph") || el.classList?.contains("graphdialog")) break;
    el = el.parentElement;
  }
  return best;
}

function capToHost(size, hostWidth) {
  if (!hostWidth || hostWidth <= 0) return size;
  return Math.max(64, Math.min(size, hostWidth));
}

function measureViewerSize(state, node, contentRect = null) {
  const hostW = widgetHostWidth(state);
  const ceiling = hostW > 0 ? hostW : nodeInnerWidth(node);
  let width =
    contentRect?.width > 0
      ? contentRect.width
      : state.viewer?.clientWidth || state.root?.clientWidth || ceiling;
  let height =
    contentRect?.height > 0
      ? contentRect.height
      : state.viewer?.clientHeight || VIEW_H;
  width = Math.floor(capToHost(width, ceiling));
  height = Math.max(64, Math.floor(height));
  return { width, height, hostW: ceiling };
}

function stretchDomWidgetAncestors(el) {
  let parent = el?.parentElement;
  for (let depth = 0; depth < 10 && parent; depth += 1) {
    if (parent.classList?.contains("litegraph")) break;
    parent.style.width = "100%";
    parent.style.maxWidth = "100%";
    parent.style.boxSizing = "border-box";
    parent.style.minWidth = "0";
    parent.style.overflow = "hidden";
    parent = parent.parentElement;
  }
}

function clampLoad3dDom(viewer) {
  if (!viewer) return;
  for (const child of viewer.children) {
    child.style.width = "100%";
    child.style.maxWidth = "100%";
    child.style.height = "100%";
    child.style.boxSizing = "border-box";
    child.style.overflow = "hidden";
    const canvas = child.querySelector?.("canvas") || (child.tagName === "CANVAS" ? child : null);
    if (canvas) {
      canvas.style.maxWidth = "100%";
      canvas.style.display = "block";
    }
  }
}

function syncWidgetLayout(node, state, reason = "layout", contentRect = null) {
  if (!state?.root) return;
  ensureLayoutStyles();
  state.root.style.width = "100%";
  state.root.style.maxWidth = "100%";
  state.root.style.minWidth = "0";
  state.root.style.boxSizing = "border-box";
  state.root.style.overflow = "hidden";
  state.viewer.style.width = "100%";
  state.viewer.style.maxWidth = "100%";
  state.viewer.style.flex = "1 1 auto";
  state.viewer.style.minWidth = "0";
  state.viewer.style.overflow = "hidden";
  stretchDomWidgetAncestors(state.root);
  clampLoad3dDom(state.viewer);
  hardRefreshViewer(state, reason, contentRect);
  const { width, hostW } = measureViewerSize(state, node, contentRect);
  dbg("syncWidgetLayout", { reason, hostW, width, viewerW: state.viewer?.clientWidth });
}

function installLayoutObservers(node, state) {
  if (state.layoutObserversInstalled) return;
  state.layoutObserversInstalled = true;

  const onResize = node.onResize;
  node.onResize = function onMvntPreviewResize(size) {
    onResize?.apply(this, arguments);
    syncWidgetLayout(this, state, "node-onResize");
    this.setDirtyCanvas?.(true, true);
    return size;
  };

  if (typeof ResizeObserver !== "undefined") {
    state.layoutObserver = new ResizeObserver((entries) => {
      let rect = null;
      for (const entry of entries) {
        const { width, height } = entry.contentRect || {};
        if (width > 0 || height > 0) {
          rect = {
            width: width > 0 ? width : rect?.width,
            height: height > 0 ? height : rect?.height,
          };
        }
      }
      syncWidgetLayout(node, state, "resize-observer", rect);
      node.setDirtyCanvas?.(true, true);
    });
    const host = state.root?.parentElement;
    if (host) state.layoutObserver.observe(host);
    state.layoutObserver.observe(state.viewer);
  }
}

function hardRefreshViewer(state, reason = "manual", contentRect = null) {
  if (!state?.viewer3d) {
    dbgw("hardRefreshViewer skipped (no viewer3d)", { reason });
    return;
  }
  try {
    const { width, height } = measureViewerSize(state, state.node, contentRect);
    state.viewer3d.setTargetSize?.(width, height);
    state.viewer3d.renderer?.setSize?.(width, height, false);
    state.viewer3d.refreshViewport?.();
    state.viewer3d.forceRender?.();
    state.viewer3d.updateStatusMouseOnViewer?.(state.viewerHover || false);
    dbgw("hardRefreshViewer applied", { reason, width, height });
  } catch (error) {
    dbgw("hardRefreshViewer failed", { reason, error });
  }
}

function waitForLayoutFrames(frames = 2) {
  return new Promise((resolve) => {
    const step = (left) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(frames);
  });
}

function resumeAfterVisibility(state, reason) {
  if (!state?.viewer3d) return;
  dbgw("resumeAfterVisibility", {
    reason,
    playing: state.playing,
    hidden: typeof document !== "undefined" ? document.hidden : false,
  });
  hardRefreshViewer(state, reason);
  if (!state.animationFrameId) startSyncLoop(state);
  if (state.playing && state.audio?.src && state.audio?.paused) {
    state.audio.play().catch((error) => dbgw("audio resume failed", { reason, error }));
  }
  updateBar(state);
}

function normalizePath(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value), window.location.origin);
    return `${url.pathname}${url.search || ""}`;
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Load3d discovery
//
// ComfyUI frontend chunks are hashed and their API changes between releases:
//   * <= ~1.4x : `new Load3d(container, options)` exported from load3d*/useLoad3d* chunks.
//   * ~1.59    : `Load3d` class is NOT exported any more. Chunk `createLoad3d-<hash>.js` exports the
//                factory `createLoad3d(container, host, options)`, where `host` is the object exported
//                by `load3dHost-<hash>.js` (also published as window.comfyAPI.load3dHost.load3dHost).
// Neither chunk is guaranteed to be loaded (they are lazy: only after a Load3D/Preview3D node exists),
// so we scan the JS assets the page already loaded for the real hashed file names.
// ---------------------------------------------------------------------------

const ASSET_NAME_RE = /(createLoad3d|load3dHost|load3dService|useLoad3d|Load3D|load3d)-[A-Za-z0-9_-]+\.js/g;
const MAX_SCAN_FILES = 140;
const SCAN_CONCURRENCY = 6;
let assetNamesPromise = null;

function loadedAssetScriptUrls() {
  const urls = new Set();
  const add = (value) => {
    if (!value) return;
    try {
      const url = new URL(String(value), document.baseURI);
      if (/\/assets\/[^?#]+\.js$/i.test(url.pathname)) urls.add(url.href);
    } catch {
      // ignore malformed URLs
    }
  };
  for (const script of document.querySelectorAll("script[src]")) add(script.src);
  for (const link of document.querySelectorAll('link[rel="modulepreload"][href], link[as="script"][href]')) add(link.href);
  if (typeof performance !== "undefined" && performance.getEntriesByType) {
    for (const entry of performance.getEntriesByType("resource")) add(entry?.name);
  }
  // GraphView / core / entry chunks reference the Load3d chunks most directly; scan them first.
  const priority = (href) => (/GraphView|\/core-|\/index-|useLoad3d|load3d|Load3D/i.test(href) ? 0 : 1);
  return [...urls].sort((a, b) => priority(a) - priority(b)).slice(0, MAX_SCAN_FILES);
}

function classifyAssetName(name) {
  if (/^createLoad3d-/i.test(name)) return "factory";
  if (/^load3dHost-/i.test(name)) return "host";
  return "legacy";
}

async function discoverLoad3dAssets() {
  const found = { factory: new Map(), host: new Map(), legacy: new Map(), scanned: 0 };
  const record = (name, baseUrl) => {
    const bucket = found[classifyAssetName(name)];
    const href = new URL(name, baseUrl).href;
    if (!bucket.has(href)) bucket.set(href, name);
  };

  const scripts = loadedAssetScriptUrls();
  // Already-loaded chunk URLs may be Load3d chunks themselves.
  for (const href of scripts) {
    const name = href.split("/").pop().split("?")[0];
    if (/^(createLoad3d|load3dHost|load3dService|useLoad3d|Load3D|load3d)-/i.test(name)) record(name, href);
  }

  const queue = [...scripts];
  const haveEnough = () => found.factory.size > 0 && found.host.size > 0;
  const worker = async () => {
    while (queue.length && !haveEnough()) {
      const url = queue.shift();
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const text = await resp.text();
        found.scanned += 1;
        for (const hit of text.matchAll(ASSET_NAME_RE)) record(hit[0], url);
      } catch {
        // one unreadable chunk must not abort discovery
      }
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));

  dbg("load3d asset discovery", {
    scannedFiles: found.scanned,
    factory: [...found.factory.keys()],
    host: [...found.host.keys()],
    legacy: [...found.legacy.keys()],
  });
  return found;
}

function discoverLoad3dAssetsOnce() {
  assetNamesPromise ||= discoverLoad3dAssets().catch((error) => {
    assetNamesPromise = null;
    throw error;
  });
  return assetNamesPromise;
}

function findCreateLoad3d(mod) {
  if (!mod) return null;
  if (typeof mod.createLoad3d === "function") return mod.createLoad3d;
  for (const value of Object.values(mod)) {
    if (typeof value === "function" && value.name === "createLoad3d") return value;
  }
  return null;
}

function fallbackLoad3dHost() {
  return {
    fetchApi: (route, options) => api.fetchApi(route, options),
    getPLYEngine: () => {
      try {
        return app.extensionManager?.setting?.get?.("Comfy.Load3D.PLYEngine") ?? "threejs";
      } catch {
        return "threejs";
      }
    },
    resolveImageURL: (path) => (String(path).startsWith("/api") ? String(path) : `/api${path}`),
  };
}

async function resolveModernFactory(assets) {
  let create = null;
  let factoryUrl = "";
  for (const url of assets.factory.keys()) {
    try {
      create = findCreateLoad3d(await import(url));
      if (create) {
        factoryUrl = url;
        break;
      }
    } catch (error) {
      dbgw("factory import failed", url, error);
    }
  }
  if (!create) return null;

  let host = window.comfyAPI?.load3dHost?.load3dHost || null;
  if (!host) {
    for (const url of assets.host.keys()) {
      try {
        const mod = await import(url);
        host = window.comfyAPI?.load3dHost?.load3dHost || mod.t || mod.load3dHost || null;
        if (host) break;
      } catch (error) {
        dbgw("host import failed", url, error);
      }
    }
  }
  host ||= fallbackLoad3dHost();
  dbg("resolved modern createLoad3d", { factoryUrl, hostFromComfy: host !== null });
  return { kind: "factory", create: (container, options) => create(container, host, options) };
}

function extractLoad3dClass(mod) {
  if (!mod) return null;
  const direct = mod.n || mod.Load3d || mod.Load3D || mod.default || null;
  if (looksLikeLoad3dCtor(direct)) return direct;
  for (const value of Object.values(mod)) {
    if (looksLikeLoad3dCtor(value)) return value;
  }
  return null;
}

function looksLikeLoad3dCtor(value) {
  if (typeof value !== "function" || !value.prototype) return false;
  const proto = value.prototype;
  const hasLoad = typeof proto.loadModel === "function";
  const hasDispose = typeof proto.dispose === "function";
  const hasAnimTime = typeof proto.getAnimationTime === "function" || typeof proto.getAnimationDuration === "function";
  return hasLoad && (hasDispose || hasAnimTime);
}

async function resolveLegacyClass(assets) {
  for (const url of assets.legacy.keys()) {
    try {
      const klass = extractLoad3dClass(await import(url));
      if (klass) {
        dbg("resolved legacy Load3d class", url);
        return { kind: "class", create: (container, options) => new klass(container, options) };
      }
    } catch (error) {
      dbgw("legacy import failed", url, error);
    }
  }
  return null;
}

async function resolveLoad3dFactory() {
  const assets = await discoverLoad3dAssetsOnce();
  const modern = await resolveModernFactory(assets);
  if (modern) return modern;
  const legacy = await resolveLegacyClass(assets);
  if (legacy) return legacy;
  throw new Error(
    `Load3d entry point not found (scanned ${assets.scanned} asset files; ` +
      `factory=${assets.factory.size}, host=${assets.host.size}, legacy=${assets.legacy.size})`,
  );
}

function getLoad3dFactory() {
  load3dPromise ||= resolveLoad3dFactory().catch((error) => {
    load3dPromise = null; // allow retry on next execution instead of caching the failure
    throw error;
  });
  return load3dPromise;
}

// ---------------------------------------------------------------------------
// Fallback panel (shown only when the in-node viewer cannot be mounted)
// ---------------------------------------------------------------------------

function fileUrlFromPath(absPath) {
  if (!absPath) return "";
  const normalized = String(absPath).replaceAll("\\", "/");
  return /^[A-Za-z]:\//.test(normalized) ? `file:///${encodeURI(normalized)}` : `file://${encodeURI(normalized)}`;
}

function parentDir(absPath) {
  const text = String(absPath || "");
  const index = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  return index > 0 ? text.slice(0, index) : "";
}

function showPreviewError(state, error) {
  const detail = String(error?.message || error || "unknown");
  // Keep the console quiet-ish: one warning with the technical reason, no red error banner in the node.
  console.warn("[MVNT Preview Dance 3D] in-node 3D viewer not mounted; showing file panel instead.", error);
  if (state?.label) {
    state.label.textContent = "3D 미리보기 없음";
    state.label.title = detail;
  }
  if (!state?.viewer) return;

  const payload = state.payload || {};
  const absPath = payload.model_abs_path || (/^([A-Za-z]:[\\/]|\/)/.test(String(payload.model_file || "")) ? payload.model_file : "");
  const folder = payload.model_dir || parentDir(absPath);
  const displayPath = absPath || payload.model_file || state.model || "";

  state.viewer.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:16px;background:#f6f1e8;color:#1f2937;font-size:12px;line-height:1.5;overflow:auto;box-sizing:border-box;";

  const title = document.createElement("div");
  title.textContent = "이 ComfyUI 버전에서는 노드 안 3D 미리보기를 쓸 수 없습니다. GLB 파일은 정상적으로 만들어졌습니다.";
  title.style.cssText = "font-size:13px;font-weight:600;";
  box.appendChild(title);

  if (displayPath) {
    const pathRow = document.createElement("div");
    pathRow.style.cssText = "display:flex;gap:6px;align-items:flex-start;";
    const pathText = document.createElement("code");
    pathText.textContent = displayPath;
    pathText.style.cssText = "flex:1;padding:6px 8px;background:#fff;border:1px solid #d6cfc2;border-radius:6px;word-break:break-all;user-select:all;";
    const copy = document.createElement("button");
    copy.textContent = "경로 복사";
    copy.style.cssText = "height:28px;padding:0 10px;border-radius:6px;border:1px solid #4b5563;background:#1f2937;color:#fff;cursor:pointer;flex:none;";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(displayPath);
        copy.textContent = "복사됨";
      } catch {
        copy.textContent = "Ctrl+C로 복사";
      }
      setTimeout(() => { copy.textContent = "경로 복사"; }, 1500);
    });
    pathRow.append(pathText, copy);
    box.appendChild(pathRow);

    const hint = document.createElement("div");
    hint.textContent = "폴더에서 열기: 탐색기 주소창에 위 경로의 폴더를 붙여 넣으세요. Blender/3D 뷰어로 열 수 있습니다.";
    hint.style.cssText = "color:#4b5563;";
    box.appendChild(hint);
    if (folder) {
      const folderText = document.createElement("div");
      folderText.textContent = `폴더: ${folder}`;
      folderText.style.cssText = "color:#4b5563;word-break:break-all;user-select:all;";
      box.appendChild(folderText);
    }
  }

  const links = document.createElement("div");
  links.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;";
  const addLink = (href, text, download = false) => {
    if (!href) return;
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    a.target = "_blank";
    a.rel = "noopener";
    if (download) a.download = "";
    a.style.cssText = "color:#1d4ed8;";
    links.appendChild(a);
  };
  addLink(state.model, "GLB 다운로드", true);
  addLink(fileUrlFromPath(absPath), "file:// 로 열기 (브라우저가 막을 수 있음)");
  if (links.childNodes.length) box.appendChild(links);

  if (state.audio?.src) {
    const player = document.createElement("audio");
    player.controls = true;
    player.src = state.audio.src;
    player.style.cssText = "width:100%;";
    box.appendChild(player);
  }

  const more = document.createElement("details");
  more.style.cssText = "color:#6b7280;";
  const summary = document.createElement("summary");
  summary.textContent = "기술 정보";
  const pre = document.createElement("pre");
  pre.textContent = detail;
  pre.style.cssText = "margin:4px 0 0;white-space:pre-wrap;word-break:break-all;";
  more.append(summary, pre);
  box.appendChild(more);

  state.viewer.appendChild(box);
}

async function safeMount(node, payload) {
  const state = ensureDom(node);
  dbg("safeMount", {
    nodeId: node?.id,
    nodeTitle: node?.title,
    hasPayload: !!payload,
    payloadModel: payload?.model_file || "",
  });
  try {
    await mount(node, payload);
  } catch (error) {
    showPreviewError(state, error);
  }
}

function viewUrl(value, fallbackType = "output") {
  if (!value) return "";
  if (typeof value === "object") {
    const filename = value.filename || "";
    if (!filename) return "";
    const params = new URLSearchParams({ filename, type: value.type || fallbackType });
    if (value.subfolder) params.set("subfolder", value.subfolder);
    return `/view?${params}`;
  }
  const text = String(value).replaceAll("\\", "/");
  const marker = text.match(/ComfyUI\/(output|input|temp)\/(.+)$/i);
  if (marker) {
    const parts = marker[2].split("/");
    const filename = parts.pop() || marker[2];
    const params = new URLSearchParams({ filename, type: marker[1].toLowerCase() });
    if (parts.length) params.set("subfolder", parts.join("/"));
    return `/view?${params}`;
  }
  const parts = text.split("/");
  const filename = parts.pop() || text;
  const params = new URLSearchParams({ filename, type: fallbackType });
  if (parts.length && !text.includes(":")) params.set("subfolder", parts.join("/"));
  return `/view?${params}`;
}

function widgetText(node, name) {
  const value = node.widgets?.find((w) => w.name === name)?.value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((v) => typeof v === "string") || "";
  return "";
}

function payloadFromWidgets(node) {
  const model = widgetText(node, "model_file");
  dbg("payloadFromWidgets", { nodeId: node?.id, model });
  return model ? { model_file: model, audio: [] } : null;
}

function payloadFromStored(node) {
  const payload = node.properties?.mvnt_preview_payload;
  dbg("payloadFromStored", { nodeId: node?.id, hasStored: !!payload?.model_file });
  return payload?.model_file ? payload : null;
}

function payloadFromExecution(message) {
  const payload = message?.mvnt_preview;
  dbg("payloadFromExecution", { hasPayload: !!payload });
  return Array.isArray(payload) ? payload[0] || null : payload || null;
}

function parseGlb(data) {
  const view = new DataView(data);
  if (view.getUint32(0, true) !== 0x46546c67) return null;
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= data.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    const chunk = data.slice(offset, offset + length);
    offset += length;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
  }
  return json && bin ? { json, bin } : null;
}

function readAccessor(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  const view = accessor ? gltf.bufferViews?.[accessor.bufferView] : null;
  if (!accessor || !view) return [];
  const componentSize = COMPONENT_SIZE[accessor.componentType] || 4;
  const components = NUM_COMPONENTS[accessor.type] || 1;
  const stride = view.byteStride || componentSize * components;
  const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const dataView = new DataView(bin, byteOffset, view.byteLength - (accessor.byteOffset || 0));
  const reader = COMPONENT_READERS[accessor.componentType] || "getFloat32";
  const littleEndian = accessor.componentType !== 5120 && accessor.componentType !== 5121;
  const values = [];
  for (let i = 0; i < accessor.count; i++) {
    const row = [];
    const base = i * stride;
    for (let c = 0; c < components; c++) {
      row.push(dataView[reader](base + c * componentSize, littleEndian));
    }
    values.push(row);
  }
  return values;
}

async function loadRootMotionTrack(modelUrl) {
  try {
    const resp = await fetch(modelUrl, { cache: "no-store" });
    const parsed = parseGlb(await resp.arrayBuffer());
    if (!parsed?.json?.animations?.length) return null;
    const { json, bin } = parsed;
    const hipIndex = json.nodes?.findIndex((node) => /^(Hips|Hip|Root|Armature_Hips)$/i.test(node.name || ""));
    if (hipIndex < 0) return null;
    const channel = json.animations[0].channels?.find((ch) => ch.target?.node === hipIndex && ch.target?.path === "translation");
    if (!channel) return null;
    const sampler = json.animations[0].samplers?.[channel.sampler];
    if (!sampler) return null;
    const times = readAccessor(json, bin, sampler.input).map((v) => v[0] || 0);
    const values = readAccessor(json, bin, sampler.output);
    if (!times.length || !values.length) return null;
    const base = values[0];
    return { times, values, base };
  } catch (error) {
    console.warn("[MVNT Preview Dance 3D] root motion track read failed", error);
    return null;
  }
}

function sampleRootMotion(track, time) {
  if (!track?.times?.length || !track?.values?.length) return null;
  const times = track.times;
  const values = track.values;
  if (time <= times[0]) return values[0];
  const last = times.length - 1;
  if (time >= times[last]) return values[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  const span = Math.max(0.0001, times[hi] - times[lo]);
  const t = (time - times[lo]) / span;
  return values[lo].map((v, i) => v + (values[hi][i] - v) * t);
}

function ensureDom(node) {
  if (node.__mvntPreview) return node.__mvntPreview;

  ensureLayoutStyles();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.style.cssText = `width:100%;height:${VIEW_H + BAR_H}px;display:flex;flex-direction:column;background:#f6f1e8;border-radius:8px;overflow:hidden;pointer-events:auto;box-sizing:border-box;min-width:0`;
  const viewer = document.createElement("div");
  viewer.className = VIEWER_CLASS;
  viewer.style.cssText = "flex:1 1 auto;width:100%;min-width:0;min-height:320px;position:relative;pointer-events:auto;background:#f6f1e8;overflow:hidden;box-sizing:border-box";
  const bar = document.createElement("div");
  bar.style.cssText = "height:42px;display:flex;align-items:center;gap:8px;padding:6px 8px;background:#101215;pointer-events:auto";
  const play = document.createElement("button");
  play.textContent = "Play";
  play.style.cssText = "height:28px;border-radius:6px;border:1px solid #4b5563;background:#1f2937;color:white;cursor:pointer";
  const tracking = document.createElement("button");
  tracking.textContent = "Tracking ON";
  tracking.style.cssText = "height:28px;border-radius:6px;border:1px solid #4b5563;background:#263241;color:white;cursor:pointer;font-size:11px";
  const label = document.createElement("span");
  label.textContent = "0.0s / 0.0s";
  label.style.cssText = "font-size:12px;color:#d1d5db;min-width:82px";
  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = "100";
  range.step = "0.1";
  range.value = "0";
  range.style.flex = "1";
  const audio = document.createElement("audio");
  audio.style.display = "none";
  bar.append(play, tracking, label, range, audio);
  root.append(viewer, bar);

  const widget = node.addDOMWidget("mvnt_preview_dance3d", "mvnt_preview_dance3d", root, {
    getMinHeight: () => VIEW_H + BAR_H,
    getHeight: () => VIEW_H + BAR_H,
    hideOnZoom: false,
    serialize: false,
    selectOn: ["click"],
  });
  if (widget) {
    widget.computeSize = function computeMvntPreviewSize(width) {
      const w = width > 0 ? width : nodeInnerWidth(node);
      return [Math.max(320, w), VIEW_H + BAR_H];
    };
  }

  const state = {
    node,
    domWidget: widget,
    root, viewer, play, tracking, label, range, audio,
    viewer3d: null, model: "", duration: 0, animationFrameId: 0, playing: false, lastMotionTime: 0,
    viewerHover: false, windowWheelHandler: null, cameraTracking: true, trackingBone: null, rootMotionTrack: null,
    smoothYaw: 0, smoothX: 0, smoothZ: 0, prevFaceYaw: 0, prevTrackingTime: -1,
    trackDistance: 0, trackTargetY: 0, trackCameraY: 0, trackTargetYOffset: 0, trackCameraYOffset: 0,
    trackBaseBoneX: 0, trackBaseBoneZ: 0, trackBaseTargetX: 0, trackBaseTargetZ: 0, trackBaseCameraX: 0, trackBaseCameraZ: 0,
    visibilityHandlersInstalled: false,
    layoutObserversInstalled: false,
    layoutObserver: null,
  };
  const enterViewer = () => { state.viewerHover = true; state.viewer3d?.updateStatusMouseOnViewer?.(true); };
  const leaveViewer = () => { state.viewerHover = false; state.viewer3d?.updateStatusMouseOnViewer?.(false); };
  root.addEventListener("mouseenter", enterViewer);
  root.addEventListener("mouseleave", leaveViewer);
  viewer.addEventListener("mouseenter", enterViewer);
  viewer.addEventListener("mouseleave", leaveViewer);
  play.addEventListener("click", () => toggle(state));
  tracking.addEventListener("click", () => toggleTracking(state));
  range.addEventListener("input", () => seek(state));
  audio.addEventListener("ended", () => {
    if (state.playing) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  });
  updateTrackingButton(state);
  if (!state.visibilityHandlersInstalled) {
    state.visibilityHandlersInstalled = true;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) resumeAfterVisibility(state, "visibilitychange");
    });
    window.addEventListener("focus", () => resumeAfterVisibility(state, "window-focus"));
    window.addEventListener("pageshow", () => resumeAfterVisibility(state, "pageshow"));
  }
  node.__mvntPreview = state;
  node.size = [Math.max(node.size?.[0] || 680, 680), Math.max(node.size?.[1] || 620, 620)];
  syncWidgetLayout(node, state, "ensureDom");
  installLayoutObservers(node, state);
  return state;
}

function updateBar(state, current = null) {
  const now = current ?? state.viewer3d?.getAnimationTime?.() ?? state.audio.currentTime ?? 0;
  const end = state.duration || state.viewer3d?.getAnimationDuration?.() || state.audio.duration || 0;
  state.label.textContent = `${Number(now).toFixed(1)}s / ${Number(end).toFixed(1)}s`;
  state.range.value = end > 0 ? String(Math.max(0, Math.min(100, (now / end) * 100))) : "0";
  state.play.textContent = state.playing ? "Pause" : "Play";
}

function updateTrackingButton(state) {
  if (!state.tracking) return;
  state.tracking.textContent = state.cameraTracking ? "Tracking ON" : "Tracking OFF";
  state.tracking.style.background = state.cameraTracking ? "#263241" : "#1f2937";
}

function toggleTracking(state) {
  state.cameraTracking = !state.cameraTracking;
  resetCameraTracking(state, true);
  updateTrackingButton(state);
}

function cameraDistance(camera, target) {
  if (!camera?.position || !target) return 0;
  const dx = camera.position.x - target.x;
  const dy = camera.position.y - target.y;
  const dz = camera.position.z - target.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function handleViewerWheel(state, event) {
  if (!state.viewer3d) return;
  event.preventDefault?.();
  event.stopPropagation?.();
  event.stopImmediatePropagation?.();
  state.viewer3d.updateStatusMouseOnViewer?.(true);
  state.prevTrackingTime = -1;

  const camera = state.viewer3d.getActiveCamera?.() || state.viewer3d.cameraManager?.activeCamera;
  const controls = state.viewer3d.getControls?.() || state.viewer3d.controlsManager?.controls;
  const target = controls?.target;
  if (!camera || !target) return;

  const before = cameraDistance(camera, target);
  const zoomIn = event.deltaY < 0;
  if (camera.isOrthographicCamera) {
    camera.zoom = Math.max(0.08, Math.min(18, camera.zoom * (zoomIn ? 1.15 : 0.87)));
    camera.updateProjectionMatrix?.();
  } else if (camera.position?.sub && camera.position?.add) {
    const factor = zoomIn ? 0.86 : 1.16;
    camera.position.sub(target).multiplyScalar(factor).add(target);
    camera.updateProjectionMatrix?.();
  }
  controls.update?.();
  state.trackDistance = Math.max(cameraDistance(camera, target) || state.trackDistance, 1);
  state.trackTargetY = target.y ?? state.trackTargetY;
  state.trackCameraY = camera.position?.y ?? state.trackCameraY;
  state.viewer3d.forceRender?.();
  const after = cameraDistance(camera, target);
  if (Math.abs(after - before) < 0.0001) state.viewer3d.refreshViewport?.();
}

function installWheelFallback(state) {
  const wheel = (event) => handleViewerWheel(state, event);
  state.root.addEventListener("wheel", wheel, { capture: true, passive: false });
  state.viewer.addEventListener("wheel", wheel, { capture: true, passive: false });
  state.viewer3d?.renderer?.domElement?.addEventListener?.("wheel", wheel, { capture: true, passive: false });
  if (state.windowWheelHandler) window.removeEventListener("wheel", state.windowWheelHandler, true);
  state.windowWheelHandler = (event) => {
    if (!state.viewerHover) return;
    handleViewerWheel(state, event);
  };
  window.addEventListener("wheel", state.windowWheelHandler, { capture: true, passive: false });
}

function applyMvntSceneLook(state) {
  const viewer = state.viewer3d;
  if (!viewer) return;
  const model = viewer.modelManager?.currentModel;

  viewer.setBackgroundColor?.("#f6f1e8");
  viewer.setLightIntensity?.(3.45);
  if (viewer.sceneManager?.gridHelper) viewer.sceneManager.gridHelper.visible = true;
  if (viewer.renderer) {
    viewer.renderer.setClearColor?.(0xf6f1e8, 1);
    viewer.renderer.shadowMap && (viewer.renderer.shadowMap.enabled = true);
  }

  model?.traverse?.((object) => {
    object.castShadow = true;
    object.receiveShadow = true;
    const material = object.material;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const mat of materials) {
      if ("roughness" in mat) mat.roughness = Math.min(1, Math.max(0.72, mat.roughness ?? 0.72));
      if ("metalness" in mat) mat.metalness = 0;
      if (mat.color?.multiplyScalar && !mat.__mvntToneBoosted) {
        mat.color.multiplyScalar(1.06);
        mat.__mvntToneBoosted = true;
      }
      mat.needsUpdate = true;
    }
  });

  viewer.forceRender?.();
}

function getModelBounds(state) {
  const model = state.viewer3d?.modelManager?.currentModel;
  const camera = state.viewer3d?.getActiveCamera?.() || state.viewer3d?.cameraManager?.activeCamera;
  if (!model || !camera?.position?.clone) return null;
  const min = camera.position.clone();
  const max = camera.position.clone();
  min.set?.(Infinity, Infinity, Infinity);
  max.set?.(-Infinity, -Infinity, -Infinity);
  const point = camera.position.clone();
  model.updateMatrixWorld?.(true);
  model.traverse?.((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const attr = object.geometry.attributes.position;
    for (let i = 0; i < attr.count; i++) {
      point.fromBufferAttribute?.(attr, i);
      point.applyMatrix4?.(object.matrixWorld);
      min.min?.(point);
      max.max?.(point);
    }
  });
  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) return null;
  return {
    min, max,
    height: Math.max(0.1, max.y - min.y),
    centerX: (min.x + max.x) * 0.5,
    centerY: (min.y + max.y) * 0.5,
    centerZ: (min.z + max.z) * 0.5,
  };
}

function applyInitialPreviewCamera(state) {
  const camera = state.viewer3d?.getActiveCamera?.() || state.viewer3d?.cameraManager?.activeCamera;
  const controls = state.viewer3d?.getControls?.() || state.viewer3d?.controlsManager?.controls;
  const target = controls?.target;
  const bounds = getModelBounds(state);
  if (!camera || !target || !bounds) return;
  const h = bounds.height;
  const targetY = bounds.min.y + h * PREVIEW_TARGET_FACTOR;
  const cameraY = bounds.min.y + h * PREVIEW_EYE_FACTOR;
  const distance = Math.max(1.2, h * PREVIEW_DIST_FACTOR);

  target.set?.(bounds.centerX, targetY, bounds.centerZ);
  camera.position.set?.(bounds.centerX, cameraY, bounds.centerZ + distance);
  camera.lookAt?.(target);
  camera.updateProjectionMatrix?.();
  camera.updateMatrixWorld?.(true);
  controls.update?.();
  state.trackDistance = distance;
  state.trackTargetY = targetY;
  state.trackCameraY = cameraY;
  state.viewer3d?.forceRender?.();
}

function normalizeAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function findTrackingBone(model) {
  let best = null;
  const names = [
    "Hips",
    "Hip",
    "mixamorigHips",
    "mixamorig:Hips",
    "Armature_Hips",
    "Root",
    "CC_Base_BoneRoot",
    "pelvis",
    "Pelvis",
  ];
  model?.traverse?.((object) => {
    if (best || !object.isBone) return;
    if (names.includes(object.name)) best = object;
  });
  model?.traverse?.((object) => {
    if (best || !object.isSkinnedMesh || !object.skeleton?.bones) return;
    best = object.skeleton.bones.find((bone) => names.includes(bone.name)) || null;
  });
  if (best) return best;
  model?.traverse?.((object) => {
    if (!best && object.isBone && /hips?|pelvis/i.test(object.name || "")) best = object;
  });
  model?.traverse?.((object) => {
    if (best || !object.isSkinnedMesh || !object.skeleton?.bones) return;
    best = object.skeleton.bones.find((bone) => /hips?|pelvis/i.test(bone.name || "")) || null;
  });
  return best;
}

function getBoneWorldPosition(state, bone, camera) {
  if (!bone || !camera?.position?.clone) return null;
  const v = camera.position.clone();
  state.viewer3d?.modelManager?.currentModel?.updateMatrixWorld?.(true);
  bone.updateMatrixWorld?.(true);
  bone.updateWorldMatrix?.(true, false);
  bone.getWorldPosition?.(v);
  return v;
}

function getBoneFaceYaw(bone, camera) {
  if (!bone || !camera?.position?.clone || !bone.quaternion?.clone) return 0;
  const q = bone.quaternion.clone();
  const v = camera.position.clone();
  v.set?.(0, 0, 1);
  bone.getWorldQuaternion?.(q);
  v.applyQuaternion?.(q);
  v.y = 0;
  return Math.atan2(v.x || 0, v.z || 1);
}

function resetCameraTracking(state, keepCurrentCamera = false, resetBase = true) {
  const camera = state.viewer3d?.getActiveCamera?.() || state.viewer3d?.cameraManager?.activeCamera;
  const controls = state.viewer3d?.getControls?.() || state.viewer3d?.controlsManager?.controls;
  const target = controls?.target;
  if (!camera || !target) return;
  const bonePos = getBoneWorldPosition(state, state.trackingBone, camera);
  const motionNow = sampleRootMotion(state.rootMotionTrack, state.viewer3d?.getAnimationTime?.() || 0);
  if (!bonePos && !motionNow) return;
  // Preserve the current camera orbit angle. The GLB hip yaw can be noisy after baking,
  // so tracking root-motion delta first is closer to the stable mS viewer feel in Comfy.
  state.smoothYaw = 0;
  if (resetBase) {
    const baseMotion = sampleRootMotion(state.rootMotionTrack, 0);
    state.trackBaseBoneX = baseMotion ? baseMotion[0] : (motionNow ? motionNow[0] : bonePos.x);
    state.trackBaseBoneZ = baseMotion ? baseMotion[2] : (motionNow ? motionNow[2] : bonePos.z);
    state.trackBaseTargetX = state.trackBaseBoneX;
    state.trackBaseTargetZ = state.trackBaseBoneZ;
    state.trackBaseCameraX = camera.position?.x ?? 0;
    state.trackBaseCameraZ = camera.position?.z ?? 0;
  }
  state.smoothX = motionNow ? motionNow[0] : bonePos.x;
  state.smoothZ = motionNow ? motionNow[2] : bonePos.z;
  state.prevFaceYaw = getBoneFaceYaw(state.trackingBone, camera);
  state.prevTrackingTime = -1;
  if (resetBase) {
    state.trackDistance = Math.max((cameraDistance(camera, target) || state.trackDistance || 1) * TRACK_DISTANCE_FACTOR, 0.8);
  } else if (state.trackDistance <= 0) {
    state.trackDistance = Math.max(cameraDistance(camera, target), 1);
  }
  const baseY = motionNow ? motionNow[1] : bonePos.y;
  if (resetBase) {
    const bounds = getModelBounds(state);
    const h = bounds?.height || 1.6;
    state.trackTargetYOffset = Math.max(0.42, h * TRACK_SCREEN_Y_FACTOR);
    state.trackCameraYOffset = Math.max(1.0, h * 0.68);
  }
  state.trackTargetY = baseY + state.trackTargetYOffset;
  state.trackCameraY = baseY + state.trackCameraYOffset;
}

function updateCameraTracking(state, now) {
  if (!state.cameraTracking || !state.trackingBone || !state.viewer3d) return;
  const camera = state.viewer3d.getActiveCamera?.() || state.viewer3d.cameraManager?.activeCamera;
  const controls = state.viewer3d.getControls?.() || state.viewer3d.controlsManager?.controls;
  const target = controls?.target;
  if (!camera || !target) return;
  const bonePos = getBoneWorldPosition(state, state.trackingBone, camera);
  const motionNow = sampleRootMotion(state.rootMotionTrack, now);
  if (!bonePos && !motionNow) return;
  const followX = motionNow ? motionNow[0] : bonePos.x;
  const followY = motionNow ? motionNow[1] : bonePos.y;
  const followZ = motionNow ? motionNow[2] : bonePos.z;

  const timeJump = state.prevTrackingTime >= 0 && Math.abs(now - state.prevTrackingTime) > 0.35;
  state.prevTrackingTime = now;
  if (state.trackDistance <= 0) state.trackDistance = Math.max(cameraDistance(camera, target), 1);

  if (timeJump) {
    state.smoothX = followX;
    state.smoothZ = followZ;
  } else {
    state.smoothX += (followX - state.smoothX) * TRACK_POS_LERP;
    state.smoothZ += (followZ - state.smoothZ) * TRACK_POS_LERP;
  }
  state.trackTargetY = followY + (state.trackTargetYOffset || 0);
  state.trackCameraY = followY + (state.trackCameraYOffset || 0);

  camera.position.set?.(
    state.smoothX + Math.sin(state.smoothYaw) * state.trackDistance,
    state.trackCameraY,
    state.smoothZ + Math.cos(state.smoothYaw) * state.trackDistance,
  );
  target.set?.(state.smoothX, state.trackTargetY, state.smoothZ);
  camera.lookAt?.(target);
  camera.updateProjectionMatrix?.();
  camera.updateMatrixWorld?.(true);
  controls.update?.();

  state.viewer3d.forceRender?.();
}

function toggle(state) {
  if (!state.viewer3d?.hasAnimations?.()) {
    console.warn("[MVNT Preview Dance 3D] loaded viewer has no animations");
  }
  state.playing = !state.playing;
  state.viewer3d?.toggleAnimation?.(state.playing);
  if (state.audio.src) state.playing ? state.audio.play().catch(() => {}) : state.audio.pause();
  resetCameraTracking(state, true);
  updateBar(state);
}

function seek(state) {
  const end = state.duration || state.viewer3d?.getAnimationDuration?.() || state.audio.duration || 0;
  if (!end) return;
  const seconds = end * (Number(state.range.value || 0) / 100);
  state.viewer3d?.setAnimationTime?.(seconds);
  if (state.audio.src) state.audio.currentTime = seconds;
  state.prevTrackingTime = -1;
  updateCameraTracking(state, seconds);
  updateBar(state, seconds);
}

function sync(state) {
  if (!state.viewer3d) return;
  const now = state.viewer3d.getAnimationTime?.() || 0;
  const looped = state.playing && state.duration > 0 && now < state.lastMotionTime - 0.25;
  if (state.audio.src && state.playing) {
    if (looped || state.audio.ended) state.audio.currentTime = 0;
    else if (Math.abs(state.audio.currentTime - now) > 0.35) state.audio.currentTime = now;
    if (state.audio.paused) state.audio.play().catch(() => {});
  }
  updateCameraTracking(state, now);
  state.lastMotionTime = now;
  state.viewer3d.updateStatusMouseOnViewer?.(true);
  updateBar(state, now);
}

function stopSyncLoop(state) {
  if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
  state.animationFrameId = 0;
}

function startSyncLoop(state) {
  stopSyncLoop(state);
  const tick = () => {
    sync(state);
    state.animationFrameId = requestAnimationFrame(tick);
  };
  state.animationFrameId = requestAnimationFrame(tick);
}

async function mount(node, payload) {
  const state = ensureDom(node);
  state.payload = payload;
  const modelUrl = viewUrl(payload?.model_view || payload?.model_file, "output");
  dbg("mount start", {
    nodeId: node?.id,
    modelUrl,
    payload,
  });
  node.properties ||= {};
  node.properties.mvnt_preview_payload = payload;
  const audioPayload = payload?.audio;
  const audioUrl = viewUrl(Array.isArray(audioPayload) ? audioPayload[0] : audioPayload, "temp");
  if (audioUrl) state.audio.src = audioUrl;
  else state.audio.removeAttribute("src");
  if (!modelUrl || (modelUrl === state.model && state.viewer3d)) return;

  state.model = modelUrl;
  const load3d = await getLoad3dFactory();
  dbg("Load3d resolved", { kind: load3d.kind });
  stopSyncLoop(state);
  state.viewer3d?.dispose?.();
  state.viewer3d = null;
  state.viewer.innerHTML = "";
  syncWidgetLayout(node, state, "pre-mount");
  await waitForLayoutFrames(2);
  const { width, height } = measureViewerSize(state, node);
  state.viewer3d = load3d.create(state.viewer, { width, height, isViewerMode: true });
  clampLoad3dDom(state.viewer);
  const loadResult = await state.viewer3d.loadModel(modelUrl);
  // Newer frontends resolve with a status string instead of throwing.
  if (typeof loadResult === "string" && loadResult !== "loaded") {
    state.viewer3d?.dispose?.();
    state.viewer3d = null;
    throw new Error(`Load3d.loadModel returned "${loadResult}" for ${modelUrl}`);
  }
  dbg("model loaded", { modelUrl });
  state.viewer3d.updateStatusMouseOnViewer?.(true);
  state.rootMotionTrack = await loadRootMotionTrack(modelUrl);
  state.trackingBone = findTrackingBone(state.viewer3d.modelManager?.currentModel);
  installWheelFallback(state);
  applyMvntSceneLook(state);
  applyInitialPreviewCamera(state);
  resetCameraTracking(state, false);
  state.duration = state.viewer3d.getAnimationDuration?.() || 0;
  startSyncLoop(state);
  updateBar(state);
  syncWidgetLayout(node, state, "post-mount");
  node.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "mvnt.preview.dance3d",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const nodeName = nodeType.comfyClass || nodeData.name || nodeData.display_name;
    if (nodeName !== NODE && nodeData.name !== NODE && nodeData.display_name !== "MVNT Preview Dance 3D") return;

    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      created?.apply(this, arguments);
      ensureDom(this);
      setTimeout(() => {
        const payload = payloadFromWidgets(this) || payloadFromStored(this);
        if (payload) safeMount(this, payload);
      }, 300);
    };

    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      executed?.apply(this, arguments);
      const payload = payloadFromExecution(message);
      if (payload) safeMount(this, payload);
    };

    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configured?.apply(this, arguments);
      setTimeout(() => {
        const payload = payloadFromWidgets(this) || payloadFromStored(this);
        if (payload) safeMount(this, payload);
      }, 300);
      return result;
    };
  },
});
