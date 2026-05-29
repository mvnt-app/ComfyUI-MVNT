import { app } from "../../scripts/app.js";

const NODE = "MVNTPreviewDance3D";
const STATIC_SERVICE_MODULES = ["/assets/load3dService-Bgd80_fq.js", "/assets/load3dService-B9rS34_t.js"];
const VIEW_H = 420;
const BAR_H = 42;
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
const DEBUG = true;
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

function normalizePath(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value), window.location.origin);
    return `${url.pathname}${url.search || ""}`;
  } catch {
    return String(value);
  }
}

function collectRuntimeModuleCandidates() {
  const seen = new Set();
  const candidates = [];
  const push = (value) => {
    const path = normalizePath(value);
    if (!path || seen.has(path)) return;
    seen.add(path);
    candidates.push(path);
  };

  for (const path of STATIC_SERVICE_MODULES) push(path);

  // Discover currently active hashed bundles from loaded script/link/resource URLs.
  const sources = [];
  for (const script of document.querySelectorAll("script[src]")) sources.push(script.src);
  for (const link of document.querySelectorAll("link[href]")) sources.push(link.href);
  if (typeof performance !== "undefined" && performance.getEntriesByType) {
    for (const entry of performance.getEntriesByType("resource")) {
      if (entry?.name) sources.push(entry.name);
    }
  }
  const assetRegex = /(\/assets\/(?:load3dService|load3d|Load3D|useLoad3d)[^"'\s]*\.js(?:\?[^"'\s]*)?)/i;
  for (const source of sources) {
    const hit = String(source || "").match(assetRegex);
    if (hit?.[1]) push(hit[1]);
  }

  dbg("runtime module candidates", candidates);
  return candidates;
}

function extractLoad3dClass(mod) {
  if (!mod) return null;
  const direct = mod.n || mod.Load3d || mod.Load3D || mod.default || null;
  if (looksLikeLoad3dCtor(direct)) return direct;

  // Some Comfy builds export minified symbols with different names.
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

async function tryImportLoad3d(paths) {
  let lastError = null;
  const tried = [];
  for (const path of paths) {
    tried.push(path);
    try {
      dbg("trying dynamic import", path);
      const mod = await import(path);
      const klass = extractLoad3dClass(mod);
      if (klass) {
        dbg("resolved Load3d from", path, {
          exports: Object.keys(mod || {}).slice(0, 20),
        });
        return klass;
      }
      dbgw("module imported but Load3d class not found", path, {
        exports: Object.keys(mod || {}).slice(0, 20),
      });
    } catch (error) {
      lastError = error;
      dbgw("dynamic import failed", path, error);
    }
  }
  const summary = tried.length ? tried.join(", ") : "(none)";
  const detail = lastError ? ` Last error: ${lastError}` : "";
  throw new Error(`Could not resolve Load3d module. Tried: ${summary}.${detail}`);
}

function collectManifestCandidates() {
  const seen = new Set();
  const out = [];
  const push = (value) => {
    const path = normalizePath(value);
    if (!path || seen.has(path)) return;
    seen.add(path);
    out.push(path);
  };
  const manifestRegex = /(\/assets\/manifest-[^"'\s]+\.json(?:\?[^"'\s]*)?)/i;
  const sources = [];
  for (const script of document.querySelectorAll("script[src]")) sources.push(script.src);
  for (const link of document.querySelectorAll("link[href]")) sources.push(link.href);
  if (typeof performance !== "undefined" && performance.getEntriesByType) {
    for (const entry of performance.getEntriesByType("resource")) {
      if (entry?.name) sources.push(entry.name);
    }
  }
  for (const source of sources) {
    const hit = String(source || "").match(manifestRegex);
    if (hit?.[1]) push(hit[1]);
  }
  dbg("manifest candidates", out);
  return out;
}

function flattenManifestValues(value, out) {
  if (!value) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenManifestValues(item, out);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) flattenManifestValues(item, out);
  }
}

async function collectManifestModuleCandidates() {
  const manifests = collectManifestCandidates();
  if (!manifests.length) return [];

  const seen = new Set();
  const out = [];
  const push = (value) => {
    const path = normalizePath(value);
    if (!path || seen.has(path)) return;
    if (!/\/assets\/(?:load3dService|load3d|Load3D|useLoad3d)[^"'\s]*\.js(?:\?[^"'\s]*)?$/i.test(path)) return;
    seen.add(path);
    out.push(path);
  };

  for (const manifestPath of manifests) {
    try {
      dbg("fetching manifest", manifestPath);
      const resp = await fetch(manifestPath, { cache: "no-store" });
      if (!resp.ok) continue;
      const data = await resp.json();
      const values = [];
      flattenManifestValues(data, values);
      for (const value of values) push(value);
    } catch {
      // Ignore manifest parsing errors; runtime candidates are still available.
      dbgw("manifest parse failed", manifestPath);
    }
  }
  dbg("manifest module candidates", out);
  return out;
}

async function resolveLoad3dClass() {
  const runtimeCandidates = collectRuntimeModuleCandidates();
  try {
    return await tryImportLoad3d(runtimeCandidates);
  } catch (runtimeErr) {
    dbgw("runtime candidates failed; trying manifest fallback", runtimeErr);
    const manifestCandidates = await collectManifestModuleCandidates();
    if (manifestCandidates.length) {
      return await tryImportLoad3d([...runtimeCandidates, ...manifestCandidates]);
    }
    dbgw("no manifest candidates available");
    throw runtimeErr;
  }
}

function getLoad3dClass() {
  load3dPromise ||= resolveLoad3dClass();
  return load3dPromise;
}

function showPreviewError(state, error) {
  const text = String(error?.message || error || "Unknown preview error");
  console.error("[MVNT Preview Dance 3D] mount failed", error);
  if (state?.viewer) {
    state.viewer.innerHTML = "";
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:14px;background:#111;color:#ffd5d5;font-size:12px;text-align:left;white-space:pre-wrap;";
    box.textContent = `[MVNT Preview Dance 3D]\n${text}`;
    state.viewer.appendChild(box);
  }
  if (state?.label) {
    state.label.textContent = "Preview error";
    state.label.title = text;
  }
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

  const root = document.createElement("div");
  root.style.cssText = `width:100%;height:${VIEW_H + BAR_H}px;display:flex;flex-direction:column;background:#f6f1e8;border-radius:8px;overflow:hidden;pointer-events:auto`;
  const viewer = document.createElement("div");
  viewer.style.cssText = "flex:1;min-height:320px;position:relative;pointer-events:auto;background:#f6f1e8";
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
  if (widget) widget.computeSize = (width) => [Math.max(420, width || node.size?.[0] || 620), VIEW_H + BAR_H];

  const state = {
    root, viewer, play, tracking, label, range, audio,
    viewer3d: null, model: "", duration: 0, animationFrameId: 0, playing: false, lastMotionTime: 0,
    viewerHover: false, windowWheelHandler: null, cameraTracking: true, trackingBone: null, rootMotionTrack: null,
    smoothYaw: 0, smoothX: 0, smoothZ: 0, prevFaceYaw: 0, prevTrackingTime: -1,
    trackDistance: 0, trackTargetY: 0, trackCameraY: 0, trackTargetYOffset: 0, trackCameraYOffset: 0,
    trackBaseBoneX: 0, trackBaseBoneZ: 0, trackBaseTargetX: 0, trackBaseTargetZ: 0, trackBaseCameraX: 0, trackBaseCameraZ: 0,
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
  node.__mvntPreview = state;
  node.size = [Math.max(node.size?.[0] || 680, 680), Math.max(node.size?.[1] || 620, 620)];
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
  const modelUrl = viewUrl(payload?.model_file, "output");
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
  const Load3d = await getLoad3dClass();
  dbg("Load3d resolved", { ctorName: Load3d?.name || "(anonymous)" });
  stopSyncLoop(state);
  state.viewer3d?.dispose?.();
  state.viewer.innerHTML = "";
  state.viewer3d = new Load3d(state.viewer, { width: 800, height: 600, isViewerMode: true });
  await state.viewer3d.loadModel(modelUrl);
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
