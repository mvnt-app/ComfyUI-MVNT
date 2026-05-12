import { app } from "../../scripts/app.js";

const NODE = "MVNTPreviewDance3D";
const SERVICE_MODULES = [
  "/assets/load3dService-DPBHfjWF.js",
  "/assets/load3dService-Bgd80_fq.js",
  "/assets/load3dService-B9rS34_t.js",
];
const VIEW_H = 420;
const BAR_H = 42;
const TRACK_YAW_LERP = 0.018;
const TRACK_POS_LERP = 0.06;
const TRACK_TURN_IGNORE_RAD = (100 * Math.PI) / 180;
const TRACK_SPIN_VEL_MAX = Math.PI * 1.5;
let load3dPromise = null;

async function importFirst(files) {
  let lastError;
  for (const file of files) {
    try { return await import(file); } catch (error) { lastError = error; }
  }
  throw lastError || new Error("No module candidates");
}

function getLoad3dClass() {
  load3dPromise ||= importFirst(SERVICE_MODULES).then((m) => m.n || m.Load3d || m.default);
  return load3dPromise;
}

function showViewerError(state, title, error, modelUrl = "") {
  const message = error?.message || String(error || "Unknown error");
  state.viewer.innerHTML = `
    <div style="padding:18px;color:#111827;background:#fef2f2;height:100%;box-sizing:border-box;overflow:auto;font-size:12px;line-height:1.5">
      <div style="font-weight:700;margin-bottom:8px">${title}</div>
      <div style="margin-bottom:8px">${message}</div>
      ${modelUrl ? `<code style="word-break:break-all">${modelUrl}</code>` : ""}
    </div>
  `;
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
  return model ? { model_file: model, audio: [] } : null;
}

function payloadFromExecution(message) {
  const payload =
    message?.mvnt_preview ??
    message?.ui?.mvnt_preview ??
    message?.output?.mvnt_preview ??
    message?.data?.mvnt_preview;
  return Array.isArray(payload) ? payload[0] || null : payload || null;
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
    viewerHover: false, windowWheelHandler: null, cameraTracking: true, trackingBone: null, trackingModel: null,
    smoothYaw: 0, smoothX: 0, smoothZ: 0, prevFaceYaw: 0, prevTrackingTime: -1,
    trackDistance: 0, trackTargetY: 0, trackCameraY: 0, modelYawCorrection: 0,
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

function normalizeAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function findTrackingBone(model) {
  let best = null;
  const names = ["Hips", "Hip", "Pelvis", "mixamorigHips", "Armature_Hips"];
  model?.traverse?.((object) => {
    if (best || !object.isBone) return;
    if (names.includes(object.name)) best = object;
  });
  if (best) return best;
  model?.traverse?.((object) => {
    if (!best && object.isBone && /hips?|pelvis/i.test(object.name || "")) best = object;
  });
  if (best) return best;
  model?.traverse?.((object) => {
    if (!best && object.isBone && /^root$/i.test(object.name || "")) best = object;
  });
  return best;
}

function getBoneWorldPosition(bone, camera) {
  if (!bone || !camera?.position?.clone) return null;
  const v = camera.position.clone();
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

function resetCameraTracking(state, keepCurrentCamera = false) {
  const camera = state.viewer3d?.getActiveCamera?.() || state.viewer3d?.cameraManager?.activeCamera;
  const controls = state.viewer3d?.getControls?.() || state.viewer3d?.controlsManager?.controls;
  const target = controls?.target;
  if (!camera || !target) return;
  state.trackingModel?.updateMatrixWorld?.(true);
  const bonePos = getBoneWorldPosition(state.trackingBone, camera);
  if (!bonePos) return;
  state.prevFaceYaw = getBoneFaceYaw(state.trackingBone, camera);
  state.smoothYaw = normalizeAngle(state.prevFaceYaw + state.modelYawCorrection);
  state.smoothX = bonePos.x;
  state.smoothZ = bonePos.z;
  state.prevTrackingTime = -1;
  state.trackDistance = Math.max(state.trackDistance || cameraDistance(camera, target), 1);
  state.trackTargetY = target.y ?? bonePos.y;
  state.trackCameraY = camera.position?.y ?? (bonePos.y + 1);
}

function updateCameraTracking(state, now) {
  if (!state.cameraTracking || !state.trackingBone || !state.viewer3d) return;
  const camera = state.viewer3d.getActiveCamera?.() || state.viewer3d.cameraManager?.activeCamera;
  const controls = state.viewer3d.getControls?.() || state.viewer3d.controlsManager?.controls;
  const target = controls?.target;
  if (!camera || !target) return;
  state.trackingModel?.updateMatrixWorld?.(true);
  const bonePos = getBoneWorldPosition(state.trackingBone, camera);
  if (!bonePos) return;

  const faceYaw = getBoneFaceYaw(state.trackingBone, camera);
  const timeJump = state.prevTrackingTime >= 0 && Math.abs(now - state.prevTrackingTime) > 0.2;
  state.prevTrackingTime = now;
  if (state.trackDistance <= 0) state.trackDistance = Math.max(cameraDistance(camera, target), 1);

  if (timeJump) {
    state.smoothX = bonePos.x;
    state.smoothZ = bonePos.z;
    state.prevFaceYaw = faceYaw;
    state.smoothYaw = normalizeAngle(faceYaw + state.modelYawCorrection);
  } else {
    const rawDelta = normalizeAngle(faceYaw - state.prevFaceYaw);
    const angularVel = Math.abs(rawDelta) / Math.max(1 / 60, 0.001);
    const targetYaw = normalizeAngle(faceYaw + state.modelYawCorrection);
    const deltaYaw = normalizeAngle(targetYaw - state.smoothYaw);
    if (angularVel < TRACK_SPIN_VEL_MAX && Math.abs(deltaYaw) < TRACK_TURN_IGNORE_RAD) {
      state.smoothYaw = normalizeAngle(state.smoothYaw + deltaYaw * TRACK_YAW_LERP);
    }
    state.smoothX += (bonePos.x - state.smoothX) * TRACK_POS_LERP;
    state.smoothZ += (bonePos.z - state.smoothZ) * TRACK_POS_LERP;
    state.prevFaceYaw = faceYaw;
  }

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
  resetCameraTracking(state, true);
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
  const audioPayload = payload?.audio;
  const audioUrl = viewUrl(Array.isArray(audioPayload) ? audioPayload[0] : audioPayload, "temp");
  if (audioUrl) state.audio.src = audioUrl;
  else state.audio.removeAttribute("src");
  if (!modelUrl || (modelUrl === state.model && state.viewer3d)) return;

  state.model = modelUrl;
  state.modelYawCorrection = /tripo|retarget/i.test(String(payload?.model_file || modelUrl)) ? Math.PI / 2 : 0;
  stopSyncLoop(state);
  state.viewer3d?.dispose?.();
  state.viewer.innerHTML = "";
  let Load3d;
  try {
    Load3d = await getLoad3dClass();
  } catch (error) {
    showViewerError(state, "Comfy Load3d viewer module could not be loaded.", error, modelUrl);
    console.error("[MVNT Preview Dance 3D] Load3d import failed", error);
    return;
  }
  try {
    state.viewer3d = new Load3d(state.viewer, { width: 800, height: 600, isViewerMode: true });
    await state.viewer3d.loadModel(modelUrl);
  } catch (error) {
    showViewerError(state, "GLB model could not be loaded in the 3D viewer.", error, modelUrl);
    console.error("[MVNT Preview Dance 3D] model load failed", error);
    return;
  }
  state.viewer3d.updateStatusMouseOnViewer?.(true);
  state.trackingModel = state.viewer3d.modelManager?.currentModel || null;
  state.trackingBone = findTrackingBone(state.trackingModel);
  installWheelFallback(state);
  applyMvntSceneLook(state);
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
        const payload = payloadFromWidgets(this);
        if (payload) mount(this, payload);
      }, 300);
    };

    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      executed?.apply(this, arguments);
      const payload = payloadFromExecution(message);
      if (payload) mount(this, payload);
    };

    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configured?.apply(this, arguments);
      setTimeout(() => {
        const payload = payloadFromWidgets(this);
        if (payload) mount(this, payload);
      }, 300);
      return result;
    };
  },
});