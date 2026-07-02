import { app } from "../../scripts/app.js";

const EXTENSION_NAME = "MKTheme.FloatingIcon";
const POSITION_STORAGE_KEY = "MKTheme.FloatingIcon.Position";
const SIZE_STORAGE_KEY = "MKTheme.FloatingIcon.NodeSize";
const COLOR_STORAGE_KEY = "MKTheme.FloatingIcon.NodeColor";
const ROOT_ID = "mk-theme-floating-icon";
const STYLE_ID = "mk-theme-floating-icon-css";
const DEFAULT_OFFSET = 24;
const ICON_SIZE = 48;
const PANEL_WIDTH = 224;
const PANEL_GAP = 10;
const DEFAULT_TITLE_COLOR = "#333333";
const DEFAULT_BODY_COLOR = "#353535";

const state = {
  root: null,
  handle: null,
  copySizeBtn: null,
  pasteSizeBtn: null,
  copyColorBtn: null,
  pasteColorBtn: null,
  titleColorInput: null,
  bodyColorInput: null,
  status: null,
  drag: null,
  copiedSize: null,
  copiedColor: null,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function viewportBounds() {
  return {
    maxX: Math.max(DEFAULT_OFFSET, window.innerWidth - ICON_SIZE - PANEL_WIDTH - PANEL_GAP - DEFAULT_OFFSET),
    maxY: Math.max(DEFAULT_OFFSET, window.innerHeight - ICON_SIZE - DEFAULT_OFFSET),
  };
}

function defaultPosition() {
  const { maxX, maxY } = viewportBounds();
  return { x: maxX, y: Math.max(DEFAULT_OFFSET, maxY - 120) };
}

function normalizeSize(size) {
  if (!size || !Number.isFinite(size[0]) || !Number.isFinite(size[1])) return null;
  return {
    w: Math.max(1, Math.round(size[0])),
    h: Math.max(1, Math.round(size[1])),
  };
}

function normalizeColorValue(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizePickerColor(value, fallback = "#f66744") {
  if (typeof value !== "string") return fallback;
  const color = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toLowerCase();
  }
  return fallback;
}

function normalizeColor(color) {
  if (!color || typeof color !== "object") return null;
  return {
    color: normalizeColorValue(color.color),
    bgcolor: normalizeColorValue(color.bgcolor),
  };
}

function readPosition() {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return defaultPosition();
    const pos = JSON.parse(raw);
    if (!Number.isFinite(pos?.x) || !Number.isFinite(pos?.y)) return defaultPosition();
    const { maxX, maxY } = viewportBounds();
    return {
      x: clamp(pos.x, DEFAULT_OFFSET, maxX),
      y: clamp(pos.y, DEFAULT_OFFSET, maxY),
    };
  } catch {
    return defaultPosition();
  }
}

function savePosition(x, y) {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ x, y }));
  } catch {
    // Non-critical: private mode or storage policy may block persistence.
  }
}

function readCopiedSize() {
  try {
    return normalizeSize(JSON.parse(localStorage.getItem(SIZE_STORAGE_KEY)));
  } catch {
    return null;
  }
}

function saveCopiedSize(size) {
  try {
    localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size));
  } catch {
    // The in-memory copy still works even when storage is blocked.
  }
}

function readCopiedColor() {
  try {
    return normalizeColor(JSON.parse(localStorage.getItem(COLOR_STORAGE_KEY)));
  } catch {
    return null;
  }
}

function saveCopiedColor(color) {
  try {
    localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(color));
  } catch {
    // The in-memory copy still works even when storage is blocked.
  }
}

function applyPosition(x, y) {
  if (!state.root) return;
  const { maxX, maxY } = viewportBounds();
  const nextX = clamp(x, DEFAULT_OFFSET, maxX);
  const nextY = clamp(y, DEFAULT_OFFSET, maxY);
  state.root.style.left = `${nextX}px`;
  state.root.style.top = `${nextY}px`;
  state.root.style.right = "auto";
  state.root.style.bottom = "auto";
}

function currentPosition() {
  if (!state.root) return defaultPosition();
  const rect = state.root.getBoundingClientRect();
  return { x: rect.left, y: rect.top };
}

function selectedNodes() {
  const selected = app.canvas?.selected_nodes;
  if (!selected) return [];
  return Object.values(selected).filter((node) => node && normalizeSize(node.size));
}

function sizeLabel(size) {
  if (!size) return "";
  return `${size.w} x ${size.h}`;
}

function colorLabel(color) {
  if (!color) return "";
  if (color.color && color.bgcolor) return `${color.color} / ${color.bgcolor}`;
  return color.color || color.bgcolor || "\u9ed8\u8ba4\u989c\u8272";
}

function setStatus(text) {
  if (state.status) state.status.textContent = text;
}

function updateActionState() {
  const nodes = selectedNodes();
  const firstNode = nodes[0];
  const hasSelection = nodes.length > 0;
  const hasCopiedSize = !!state.copiedSize;
  const hasCopiedColor = !!state.copiedColor;

  if (state.copySizeBtn) state.copySizeBtn.disabled = !hasSelection;
  if (state.pasteSizeBtn) state.pasteSizeBtn.disabled = !hasSelection || !hasCopiedSize;
  if (state.copyColorBtn) state.copyColorBtn.disabled = !hasSelection;
  if (state.pasteColorBtn) state.pasteColorBtn.disabled = !hasSelection || !hasCopiedColor;
  if (state.titleColorInput) state.titleColorInput.disabled = !hasSelection;
  if (state.bodyColorInput) state.bodyColorInput.disabled = !hasSelection;

  if (firstNode && state.titleColorInput && state.bodyColorInput) {
    state.titleColorInput.value = normalizePickerColor(firstNode.color, DEFAULT_TITLE_COLOR);
    state.bodyColorInput.value = normalizePickerColor(firstNode.bgcolor, DEFAULT_BODY_COLOR);
  }

  if (!hasSelection) {
    setStatus("\u5148\u9009\u4e2d\u8282\u70b9");
  } else if (hasCopiedSize && hasCopiedColor) {
    setStatus(`${sizeLabel(state.copiedSize)} | ${colorLabel(state.copiedColor)}`);
  } else if (hasCopiedSize) {
    setStatus(sizeLabel(state.copiedSize));
  } else if (hasCopiedColor) {
    setStatus(colorLabel(state.copiedColor));
  } else {
    setStatus("\u53ef\u590d\u5236\u5c3a\u5bf8\u6216\u989c\u8272");
  }
}

function markCanvasDirty() {
  const canvas = app.canvas;
  if (typeof canvas?.setDirty === "function") {
    canvas.setDirty(true, true);
  } else if (typeof canvas?.setDirtyCanvas === "function") {
    canvas.setDirtyCanvas(true, true);
  } else if (typeof app.graph?.setDirtyCanvas === "function") {
    app.graph.setDirtyCanvas(true, true);
  }
}

function copySelectedNodeSize(event) {
  event.preventDefault();
  event.stopPropagation();

  const node = selectedNodes()[0];
  const size = normalizeSize(node?.size);
  if (!size) {
    updateActionState();
    return;
  }

  state.copiedSize = size;
  saveCopiedSize(size);
  setStatus(sizeLabel(size));
  updateActionState();
}

function applySizeToNode(node, size) {
  if (typeof node.setSize === "function") {
    node.setSize([size.w, size.h]);
  } else if (Array.isArray(node.size)) {
    node.size[0] = size.w;
    node.size[1] = size.h;
  } else {
    node.size = [size.w, size.h];
  }
}

function pasteCopiedNodeSize(event) {
  event.preventDefault();
  event.stopPropagation();

  const size = state.copiedSize;
  const nodes = selectedNodes();
  if (!size || nodes.length === 0) {
    updateActionState();
    return;
  }

  for (const node of nodes) applySizeToNode(node, size);
  markCanvasDirty();
  setStatus(sizeLabel(size));
  updateActionState();
}

function copySelectedNodeColor(event) {
  event.preventDefault();
  event.stopPropagation();

  const node = selectedNodes()[0];
  if (!node) {
    updateActionState();
    return;
  }

  const color = {
    color: normalizeColorValue(node.color),
    bgcolor: normalizeColorValue(node.bgcolor),
  };
  state.copiedColor = color;
  saveCopiedColor(color);
  setStatus(colorLabel(color));
  updateActionState();
}

function setColorProperty(node, key, value) {
  if (value) {
    node[key] = value;
  } else {
    delete node[key];
  }
}

function applyColorToNode(node, color) {
  setColorProperty(node, "color", color.color);
  setColorProperty(node, "bgcolor", color.bgcolor);
}

function applyPickerColor(key, value) {
  const nodes = selectedNodes();
  if (nodes.length === 0) {
    updateActionState();
    return;
  }

  const color = normalizePickerColor(value);
  for (const node of nodes) node[key] = color;
  markCanvasDirty();
  setStatus(key === "color" ? `\u83dc\u5355\u680f ${color}` : `\u8282\u70b9 ${color}`);
}

function setSelectedTitleColor(event) {
  applyPickerColor("color", event.currentTarget.value);
}

function setSelectedBodyColor(event) {
  applyPickerColor("bgcolor", event.currentTarget.value);
}

function pasteCopiedNodeColor(event) {
  event.preventDefault();
  event.stopPropagation();

  const color = state.copiedColor;
  const nodes = selectedNodes();
  if (!color || nodes.length === 0) {
    updateActionState();
    return;
  }

  for (const node of nodes) applyColorToNode(node, color);
  markCanvasDirty();
  setStatus(colorLabel(color));
  updateActionState();
}

function stopToolPointerEvent(event) {
  event.stopPropagation();
}

function injectCSS() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} {
      position: fixed;
      z-index: 10010;
      width: ${ICON_SIZE}px;
      height: ${ICON_SIZE}px;
      color: #fff;
      font: 600 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
      user-select: none;
      touch-action: none;
    }

    #${ROOT_ID} .mk-theme-floating-handle {
      width: ${ICON_SIZE}px;
      height: ${ICON_SIZE}px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 50%;
      background: #f66744;
      color: #fff;
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.24);
      cursor: grab;
      font: 700 14px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
      padding: 0;
    }

    #${ROOT_ID} .mk-theme-floating-handle:hover {
      filter: brightness(1.06);
    }

    #${ROOT_ID}.mk-theme-floating-dragging .mk-theme-floating-handle {
      cursor: grabbing;
      filter: brightness(1.1);
    }

    #${ROOT_ID} .mk-theme-floating-mark {
      pointer-events: none;
      transform: translateY(-1px);
    }

    #${ROOT_ID} .mk-theme-floating-panel {
      position: absolute;
      left: calc(100% + ${PANEL_GAP}px);
      top: 50%;
      width: ${PANEL_WIDTH}px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      align-items: center;
      padding: 8px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      background: rgba(28, 30, 34, 0.96);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.34);
      opacity: 0;
      pointer-events: none;
      transform: translate(-6px, -50%) scale(0.98);
      transform-origin: left center;
      transition: opacity 120ms ease, transform 120ms ease;
    }

    #${ROOT_ID} .mk-theme-floating-panel::before {
      content: "";
      position: absolute;
      left: -12px;
      top: 0;
      width: 12px;
      height: 100%;
    }

    #${ROOT_ID}:hover .mk-theme-floating-panel,
    #${ROOT_ID}:focus-within .mk-theme-floating-panel {
      opacity: 1;
      pointer-events: auto;
      transform: translate(0, -50%) scale(1);
    }

    #${ROOT_ID}.mk-theme-floating-dragging .mk-theme-floating-panel {
      opacity: 0;
      pointer-events: none;
    }

    #${ROOT_ID} .mk-theme-floating-action {
      min-width: 0;
      height: 30px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 6px;
      background: #2b2e33;
      color: #f7f7f7;
      cursor: pointer;
      font: 600 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
      padding: 0 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #${ROOT_ID} .mk-theme-floating-action:hover:not(:disabled) {
      background: #383c43;
      border-color: rgba(246, 103, 68, 0.72);
    }

    #${ROOT_ID} .mk-theme-floating-action:disabled {
      cursor: default;
      opacity: 0.48;
    }

    #${ROOT_ID} .mk-theme-floating-status {
      grid-column: 1 / -1;
      min-height: 14px;
      color: rgba(255, 255, 255, 0.68);
      font-size: 11px;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #${ROOT_ID} .mk-theme-floating-color-row {
      grid-column: 1 / -1;
      height: 32px;
      display: grid;
      grid-template-columns: 64px 1fr;
      gap: 8px;
      align-items: center;
      color: rgba(255, 255, 255, 0.78);
      font-size: 12px;
    }

    #${ROOT_ID} .mk-theme-floating-color-input {
      width: 100%;
      height: 28px;
      min-width: 0;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 6px;
      background: #2b2e33;
      cursor: pointer;
      padding: 2px;
    }

    #${ROOT_ID} .mk-theme-floating-color-input:disabled {
      cursor: default;
      opacity: 0.48;
    }
  `;
  document.head.appendChild(style);
}

function onPointerMove(event) {
  if (!state.drag) return;
  const x = event.clientX - state.drag.offsetX;
  const y = event.clientY - state.drag.offsetY;
  applyPosition(x, y);
  event.preventDefault();
  event.stopPropagation();
}

function endDrag(event) {
  if (!state.drag) return;
  state.root?.classList.remove("mk-theme-floating-dragging");
  state.drag.handle?.releasePointerCapture?.(event.pointerId);
  const { x, y } = currentPosition();
  savePosition(x, y);
  state.drag = null;
  window.removeEventListener("pointermove", onPointerMove, true);
  window.removeEventListener("pointerup", endDrag, true);
  window.removeEventListener("pointercancel", endDrag, true);
  event.preventDefault();
  event.stopPropagation();
}

function startDrag(event) {
  if (event.button !== 0) return;
  const rect = state.root.getBoundingClientRect();
  state.drag = {
    handle: event.currentTarget,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  };
  state.root.classList.add("mk-theme-floating-dragging");
  event.currentTarget.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", endDrag, true);
  window.addEventListener("pointercancel", endDrag, true);
  event.preventDefault();
  event.stopPropagation();
}

function createRoot(existing) {
  if (existing?.tagName === "DIV") return existing;

  const root = document.createElement("div");
  if (existing) {
    existing.replaceWith(root);
  } else {
    document.body.appendChild(root);
  }
  return root;
}

function mountFloatingIcon() {
  if (!document.body) {
    requestAnimationFrame(mountFloatingIcon);
    return;
  }
  if (state.root?.isConnected) {
    updateActionState();
    return;
  }

  injectCSS();

  const root = createRoot(document.getElementById(ROOT_ID));
  root.id = ROOT_ID;
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "MK Theme floating tools");
  root.innerHTML = `
    <button class="mk-theme-floating-handle" type="button" title="MK Theme" aria-label="MK Theme">
      <span class="mk-theme-floating-mark">MK</span>
    </button>
    <div class="mk-theme-floating-panel">
      <button class="mk-theme-floating-action mk-theme-floating-copy-size" type="button">\u590d\u5236\u5927\u5c0f</button>
      <button class="mk-theme-floating-action mk-theme-floating-paste-size" type="button">\u7c98\u8d34\u5927\u5c0f</button>
      <button class="mk-theme-floating-action mk-theme-floating-copy-color" type="button">\u590d\u5236\u989c\u8272</button>
      <button class="mk-theme-floating-action mk-theme-floating-paste-color" type="button">\u7c98\u8d34\u989c\u8272</button>
      <label class="mk-theme-floating-color-row">
        <span>\u83dc\u5355\u680f</span>
        <input class="mk-theme-floating-color-input mk-theme-floating-title-color" type="color" value="#f66744" title="\u8bbe\u7f6e\u8282\u70b9\u83dc\u5355\u680f\u989c\u8272">
      </label>
      <label class="mk-theme-floating-color-row">
        <span>\u8282\u70b9</span>
        <input class="mk-theme-floating-color-input mk-theme-floating-body-color" type="color" value="#353535" title="\u8bbe\u7f6e\u8282\u70b9\u80cc\u666f\u989c\u8272">
      </label>
      <div class="mk-theme-floating-status" aria-live="polite"></div>
    </div>
  `;

  state.root = root;
  state.handle = root.querySelector(".mk-theme-floating-handle");
  state.copySizeBtn = root.querySelector(".mk-theme-floating-copy-size");
  state.pasteSizeBtn = root.querySelector(".mk-theme-floating-paste-size");
  state.copyColorBtn = root.querySelector(".mk-theme-floating-copy-color");
  state.pasteColorBtn = root.querySelector(".mk-theme-floating-paste-color");
  state.titleColorInput = root.querySelector(".mk-theme-floating-title-color");
  state.bodyColorInput = root.querySelector(".mk-theme-floating-body-color");
  state.status = root.querySelector(".mk-theme-floating-status");
  state.copiedSize = readCopiedSize();
  state.copiedColor = readCopiedColor();

  state.handle.addEventListener("pointerdown", startDrag, true);
  state.copySizeBtn.addEventListener("click", copySelectedNodeSize);
  state.pasteSizeBtn.addEventListener("click", pasteCopiedNodeSize);
  state.copyColorBtn.addEventListener("click", copySelectedNodeColor);
  state.pasteColorBtn.addEventListener("click", pasteCopiedNodeColor);
  state.titleColorInput.addEventListener("input", setSelectedTitleColor);
  state.titleColorInput.addEventListener("change", setSelectedTitleColor);
  state.bodyColorInput.addEventListener("input", setSelectedBodyColor);
  state.bodyColorInput.addEventListener("change", setSelectedBodyColor);
  root.querySelector(".mk-theme-floating-panel").addEventListener("pointerdown", stopToolPointerEvent, true);
  root.querySelector(".mk-theme-floating-panel").addEventListener("pointerup", stopToolPointerEvent, true);
  root.addEventListener("mouseenter", updateActionState);
  root.addEventListener("focusin", updateActionState);

  const pos = readPosition();
  applyPosition(pos.x, pos.y);
  updateActionState();
}

function handleViewportChange() {
  const { x, y } = currentPosition();
  applyPosition(x, y);
}

app.registerExtension({
  name: EXTENSION_NAME,
  setup() {
    mountFloatingIcon();
    window.addEventListener("resize", handleViewportChange);
  },
});
