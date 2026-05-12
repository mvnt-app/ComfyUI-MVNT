import { app } from "../../scripts/app.js";

const SEGMENT_NODE = "MVNT Audio Segment";
const MAX_SEGMENT_SECONDS = 40;
const MIN_SEGMENT_SECONDS = 5;
const PREVIEW_SEEK_THROTTLE_MS = 90;
const AUDITION_SECONDS = 1.25;

function findWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function getAudioInputNode(node) {
  const input = node.inputs?.find((item) => item.name === "audio");
  const linkId = input?.link;
  if (linkId == null) return null;
  const link = node.graph?.links?.[linkId];
  if (!link) return null;
  return node.graph?.getNodeById?.(link.origin_id) || null;
}

function getWidgetStringValue(widget) {
  if (!widget) return "";
  if (typeof widget.value === "string") return widget.value;
  if (Array.isArray(widget.value)) return widget.value.find((item) => typeof item === "string") || "";
  return "";
}

function getLinkedAudioFilename(node) {
  const source = getAudioInputNode(node);
  if (!source) return "";
  for (const widget of source.widgets || []) {
    const value = getWidgetStringValue(widget);
    if (/\.(wav|mp3|m4a|flac|ogg|aac|webm)$/i.test(value)) {
      return value;
    }
  }
  return "";
}

function buildInputAudioUrl(filename) {
  if (!filename) return "";
  const normalized = filename.replaceAll("\\", "/");
  const parts = normalized.split("/");
  const file = parts.pop() || normalized;
  const subfolder = parts.join("/");
  const params = new URLSearchParams({
    filename: file,
    type: "input",
  });
  if (subfolder) params.set("subfolder", subfolder);
  return `/view?${params.toString()}`;
}

function ensureAudio(node) {
  const filename = getLinkedAudioFilename(node);
  if (!filename) return null;
  const url = buildInputAudioUrl(filename);
  if (!url) return null;

  if (!node.__mvntAudio || node.__mvntAudioUrl !== url) {
    if (node.__mvntAudio) {
      node.__mvntAudio.pause();
    }
    node.__mvntAudioUrl = url;
    node.__mvntAudio = new Audio(url);
    node.__mvntAudio.volume = 0.8;
    node.__mvntAudio.addEventListener("loadedmetadata", () => {
      node.__mvntDuration = Number(node.__mvntAudio.duration || 0);
      clampSegment(node);
      node.setDirtyCanvas(true, true);
    });
    node.__mvntAudio.load();
  }
  return node.__mvntAudio;
}

function hideWidget(widget) {
  widget.__mvntHidden = true;
  widget.computeSize = () => [0, -4];
  widget.draw = () => {};
}

function clampSegment(node) {
  const startWidget = findWidget(node, "start_sec");
  const durationWidget = findWidget(node, "duration_sec");
  if (!startWidget || !durationWidget) return;

  const total = Number(node.__mvntDuration || 0);
  const maxSegment = total > 0 ? Math.min(MAX_SEGMENT_SECONDS, total) : MAX_SEGMENT_SECONDS;
  const minSegment = Math.min(MIN_SEGMENT_SECONDS, maxSegment);
  let segment = Number(durationWidget.value || 0);
  let start = Number(startWidget.value || 0);

  if (segment > maxSegment) segment = maxSegment;
  if (segment < minSegment) segment = minSegment;
  if (start < 0) start = 0;
  if (total > 0 && start + segment > total) {
    start = Math.max(0, total - segment);
  }

  startWidget.value = Number(start.toFixed(2));
  durationWidget.value = Number(segment.toFixed(2));
  durationWidget.options = { ...(durationWidget.options || {}), max: maxSegment };
  if (total > 0) {
    startWidget.options = { ...(startWidget.options || {}), max: Math.max(0, total - segment) };
  }
}

function previewAt(node, seconds, { forceSeek = false, auditionSeconds = AUDITION_SECONDS } = {}) {
  const audio = ensureAudio(node);
  if (!audio) return;

  clearTimeout(node.__mvntPreviewTimer);
  const now = performance.now();
  const shouldSeek =
    forceSeek ||
    !node.__mvntLastSeekAt ||
    now - node.__mvntLastSeekAt > PREVIEW_SEEK_THROTTLE_MS ||
    Math.abs(audio.currentTime - seconds) > 0.35;

  if (shouldSeek) {
    audio.currentTime = Math.max(0, seconds);
    node.__mvntLastSeekAt = now;
  }
  if (audio.paused) {
    audio.play().catch(() => {});
  }

  const start = Number(findWidget(node, "start_sec")?.value || 0);
  const duration = Number(findWidget(node, "duration_sec")?.value || 0);
  const segmentEnd = duration > 0 ? start + duration : Number.POSITIVE_INFINITY;
  const stopAfter = Math.max(0.1, Math.min(auditionSeconds, Math.max(0.1, segmentEnd - audio.currentTime)));
  node.__mvntPreviewTimer = setTimeout(() => stopSegmentPreview(node), stopAfter * 1000);
}

function stopSegmentPreview(node) {
  clearTimeout(node.__mvntPreviewTimer);
  if (node.__mvntAudio) node.__mvntAudio.pause();
}

function playSegmentPreview(node) {
  const startWidget = findWidget(node, "start_sec");
  const start = Number(startWidget?.value || 0);
  previewAt(node, start, { forceSeek: true, auditionSeconds: AUDITION_SECONDS });
}

function getBars(node) {
  const width = node.size?.[0] || 620;
  const x = 24;
  const barWidth = width - 48;
  return {
    duration: { x, y: 82, width: barWidth, height: 10 },
    range: { x, y: 148, width: barWidth, height: 12 },
  };
}

function valueFromBar(bar, localX) {
  return Math.max(0, Math.min(1, (localX - bar.x) / bar.width));
}

function setDurationFromBar(node, localX) {
  const durationWidget = findWidget(node, "duration_sec");
  const total = Number(node.__mvntDuration || 0);
  if (!durationWidget) return;

  const maxSegment = total > 0 ? Math.min(MAX_SEGMENT_SECONDS, total) : MAX_SEGMENT_SECONDS;
  const minSegment = Math.min(MIN_SEGMENT_SECONDS, maxSegment);
  const ratio = valueFromBar(getBars(node).duration, localX);
  const raw = minSegment + ratio * (maxSegment - minSegment);
  durationWidget.value = Number(Math.max(minSegment, Math.min(maxSegment, raw)).toFixed(1));
  clampSegment(node);
  const start = Number(findWidget(node, "start_sec")?.value || 0);
  previewAt(node, start);
  node.setDirtyCanvas(true, true);
}

function setRangeFromBar(node, localX, mode) {
  const startWidget = findWidget(node, "start_sec");
  const durationWidget = findWidget(node, "duration_sec");
  const total = Number(node.__mvntDuration || 0);
  if (!startWidget || !durationWidget || total <= 0) return;

  const ratio = valueFromBar(getBars(node).range, localX);
  const seconds = ratio * total;
  let start = Number(startWidget.value || 0);
  const segment = Number(durationWidget.value || 0);
  const end = start + segment;

  if (mode === "start") {
    start = Math.min(seconds, Math.max(0, end - Math.min(MIN_SEGMENT_SECONDS, total)));
    durationWidget.value = Number(Math.max(Math.min(MIN_SEGMENT_SECONDS, total), end - start).toFixed(1));
  } else if (mode === "end") {
    const nextEnd = Math.max(seconds, start + Math.min(MIN_SEGMENT_SECONDS, total));
    durationWidget.value = Number(Math.min(MAX_SEGMENT_SECONDS, nextEnd - start).toFixed(1));
  } else {
    const maxStart = Math.max(0, total - segment);
    start = Math.max(0, Math.min(maxStart, seconds - segment * 0.5));
  }

  startWidget.value = Number(start.toFixed(1));
  clampSegment(node);
  previewAt(node, Number(startWidget.value || 0));
  node.setDirtyCanvas(true, true);
}

function hitTestBar(node, pos) {
  const bars = getBars(node);
  const x = pos?.[0] ?? 0;
  const y = pos?.[1] ?? 0;
  const near = (bar, padY = 12) =>
    x >= bar.x && x <= bar.x + bar.width && y >= bar.y - padY && y <= bar.y + bar.height + padY;
  if (near(bars.duration)) return { type: "duration" };
  if (!near(bars.range, 16)) return null;

  const start = Number(findWidget(node, "start_sec")?.value || 0);
  const duration = Number(findWidget(node, "duration_sec")?.value || 0);
  const total = Number(node.__mvntDuration || 0);
  const startX = bars.range.x + (total > 0 ? (start / total) * bars.range.width : 0);
  const endX = bars.range.x + (total > 0 ? ((start + duration) / total) * bars.range.width : 0);
  if (Math.abs(x - startX) <= 12) return { type: "range", mode: "start" };
  if (Math.abs(x - endX) <= 12) return { type: "range", mode: "end" };
  return { type: "range", mode: "body" };
}

function applyDrag(node, pos) {
  const drag = node.__mvntDrag;
  if (!drag) return;
  if (drag.type === "duration") {
    setDurationFromBar(node, pos[0]);
  } else if (drag.type === "range") {
    setRangeFromBar(node, pos[0], drag.mode);
  }
}

function decorateAudioSegment(node) {
  node.size = [620, 210];
  node.serialize_widgets = true;
  node.__mvntDuration = 0;
  node.__mvntDrag = null;

  const originalOnDrawForeground = node.onDrawForeground;
  node.onDrawForeground = function(ctx) {
    if (originalOnDrawForeground) {
      originalOnDrawForeground.apply(this, arguments);
    }

    const width = this.size?.[0] || 620;
    const startWidget = findWidget(this, "start_sec");
    const durationWidget = findWidget(this, "duration_sec");
    const start = Number(startWidget?.value || 0);
    const duration = Math.min(Number(durationWidget?.value || 0), MAX_SEGMENT_SECONDS);
    const end = start + duration;
    const total = Number(this.__mvntDuration || 0);
    const maxSegment = total > 0 ? Math.min(MAX_SEGMENT_SECONDS, total) : MAX_SEGMENT_SECONDS;
    const minSegment = Math.min(MIN_SEGMENT_SECONDS, maxSegment);
    const bars = getBars(this);

    ctx.save();
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#9CA3AF";
    ctx.fillText(
      total > 0
        ? `Audio ${formatTime(total)}. Drag range to preview.`
        : "Connect Load Audio. Duration will be clamped to the song length.",
      24,
      56
    );

    ctx.fillStyle = "#D1D5DB";
    ctx.fillText(`Length ${duration.toFixed(1)}s`, 24, 76);
    ctx.fillText(`${minSegment.toFixed(0)}s`, 24, 108);
    ctx.fillText(`${maxSegment.toFixed(0)}s`, width - 48, 108);

    ctx.fillStyle = "#2F3338";
    ctx.fillRect(bars.duration.x, bars.duration.y, bars.duration.width, bars.duration.height);
    const durationRatio = maxSegment > minSegment ? (duration - minSegment) / (maxSegment - minSegment) : 1;
    ctx.fillStyle = "#4B5563";
    ctx.fillRect(bars.duration.x, bars.duration.y, bars.duration.width * Math.max(0, Math.min(1, durationRatio)), bars.duration.height);
    ctx.fillStyle = "#FDE68A";
    ctx.beginPath();
    ctx.arc(bars.duration.x + bars.duration.width * Math.max(0, Math.min(1, durationRatio)), bars.duration.y + 5, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#D1D5DB";
    ctx.fillText(`${formatTime(start)} -> ${formatTime(end)}`, 24, 140);
    if (total > 0) {
      ctx.fillText(formatTime(total), width - 58, 176);
    }

    ctx.fillStyle = "#2F3338";
    ctx.fillRect(bars.range.x, bars.range.y, bars.range.width, bars.range.height);

    const startRatio = total > 0 ? Math.min(start / total, 1) : 0;
    const endRatio = total > 0 ? Math.min(end / total, 1) : Math.min(duration / MAX_SEGMENT_SECONDS, 1);
    ctx.fillStyle = "#F59E0B";
    ctx.fillRect(
      bars.range.x + bars.range.width * startRatio,
      bars.range.y,
      bars.range.width * Math.max(0.02, endRatio - startRatio),
      bars.range.height
    );

    ctx.fillStyle = "#FDE68A";
    for (const ratio of [startRatio, endRatio]) {
      ctx.beginPath();
      ctx.arc(bars.range.x + bars.range.width * ratio, bars.range.y + 6, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#9CA3AF";
    ctx.fillText("0:00", 24, 176);
    ctx.restore();
  };

  for (const widget of node.widgets || []) {
    if (widget.name !== "start_sec" && widget.name !== "duration_sec") continue;
    hideWidget(widget);
    const originalCallback = widget.callback;
    widget.callback = function(value) {
      if (originalCallback) originalCallback.apply(this, arguments);
      clampSegment(node);
      const start = Number(findWidget(node, "start_sec")?.value || 0);
      previewAt(node, start);
      node.setDirtyCanvas(true, true);
      return value;
    };
  }

  const originalOnMouseDown = node.onMouseDown;
  node.onMouseDown = function(event, pos) {
    const handled = originalOnMouseDown?.apply(this, arguments);
    if (handled) return handled;
    const hit = hitTestBar(this, pos);
    if (hit) {
      ensureAudio(this);
      this.__mvntDrag = hit;
      applyDrag(this, pos);
      return true;
    }
    return false;
  };

  const originalOnMouseMove = node.onMouseMove;
  node.onMouseMove = function(event, pos) {
    const handled = originalOnMouseMove?.apply(this, arguments);
    if (this.__mvntDrag) {
      applyDrag(this, pos);
      return true;
    }
    return handled;
  };

  const originalOnMouseUp = node.onMouseUp;
  node.onMouseUp = function() {
    this.__mvntDrag = null;
    stopSegmentPreview(this);
    if (originalOnMouseUp) return originalOnMouseUp.apply(this, arguments);
    return false;
  };

  const originalOnConnectionsChange = node.onConnectionsChange;
  node.onConnectionsChange = function() {
    const result = originalOnConnectionsChange?.apply(this, arguments);
    setTimeout(() => {
      ensureAudio(this);
      clampSegment(this);
      this.setDirtyCanvas(true, true);
    }, 100);
    return result;
  };

  setTimeout(() => ensureAudio(node), 300);
}

app.registerExtension({
  name: "mvnt.audio.segment",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== SEGMENT_NODE) return;

    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      if (originalOnNodeCreated) {
        originalOnNodeCreated.apply(this, arguments);
      }
      decorateAudioSegment(this);
    };
  },
});
