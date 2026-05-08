import { app } from "../../scripts/app.js";

const NODE = "MVNTPreviewDance3D";
const VIEW_H = 420;
const BAR_H = 42;

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
  viewer.style.cssText = "flex:1;min-height:320px;display:flex;align-items:center;justify-content:center;position:relative;pointer-events:auto;background:#f6f1e8;color:#374151;text-align:center;padding:24px;box-sizing:border-box";
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
    model: "", duration: 0, animationFrameId: 0, playing: false,
  };
  play.addEventListener("click", () => toggle(state));
  tracking.addEventListener("click", () => {
    alert("Use ComfyUI's native 3D preview above this panel for camera controls.");
  });
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
  const now = current ?? state.audio.currentTime ?? 0;
  const end = state.duration || state.audio.duration || 0;
  state.label.textContent = `${Number(now).toFixed(1)}s / ${Number(end).toFixed(1)}s`;
  state.range.value = end > 0 ? String(Math.max(0, Math.min(100, (now / end) * 100))) : "0";
  state.play.textContent = state.playing ? "Pause" : "Play";
}

function updateTrackingButton(state) {
  if (!state.tracking) return;
  state.tracking.textContent = "Native 3D Preview";
  state.tracking.style.background = "#263241";
}

function toggle(state) {
  state.playing = !state.playing;
  if (state.audio.src) state.playing ? state.audio.play().catch(() => {}) : state.audio.pause();
  updateBar(state);
}

function seek(state) {
  const end = state.duration || state.audio.duration || 0;
  if (!end) return;
  const seconds = end * (Number(state.range.value || 0) / 100);
  if (state.audio.src) state.audio.currentTime = seconds;
  updateBar(state, seconds);
}

function sync(state) {
  const now = state.audio.currentTime || 0;
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
  state.audio.addEventListener("loadedmetadata", () => {
    state.duration = state.audio.duration || 0;
    updateBar(state);
  }, { once: true });
  if (!modelUrl || modelUrl === state.model) return;

  state.model = modelUrl;
  stopSyncLoop(state);
  state.viewer.innerHTML = `
    <div>
      <div style="font-weight:600;margin-bottom:8px">MVNT 3D preview is available in ComfyUI's native preview output.</div>
      <div style="font-size:12px;line-height:1.5;max-width:520px">
        This panel keeps audio playback controls without importing private ComfyUI build assets.
        Open the native 3D preview above, or use the generated model path:
        <br><code style="word-break:break-all">${modelUrl}</code>
      </div>
    </div>
  `;
  state.duration = state.audio.duration || 0;
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