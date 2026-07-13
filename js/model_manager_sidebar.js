import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "MKTheme.ModelManagerSidebar";
const SIDEBAR_TAB_ID = "mk-theme-model-manager";
const STYLE_ID = "mk-theme-model-manager-css";
const MODELS_ENDPOINT = "/mk-theme/model-manager/models";

const FILTERS = [
  { id: "all", label: "\u5168\u90e8\u9884\u89c8" },
  { id: "main", label: "\u4e3b\u6a21\u578b\u9884\u89c8" },
  { id: "lora", label: "LoRA\u9884\u89c8" },
  { id: "other", label: "\u5176\u5b83\u6a21\u578b\u9884\u89c8" },
];

const CATEGORY_LABELS = {
  main: "\u4e3b\u6a21\u578b",
  lora: "LoRA",
  other: "\u5176\u5b83",
};

const LORA_ROOT_NAMES = new Set(["loras", "lora"]);

const state = {
  filter: "all",
  search: "",
  folderPath: [],
  models: [],
  expandedGroups: new Set(),
  expandedModels: new Set(),
  infoCache: new Map(),
  infoEdits: new Map(),
  infoSaveStatus: new Map(),
  uploadStatus: new Map(),
  civitaiStatus: new Map(),
  civitaiInputs: new Map(),
  civitaiConfirming: new Set(),
  loaded: false,
  loading: false,
  error: "",
  root: null,
  listRoot: null,
};

function injectCSS() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .mk-model-manager {
      height: 100%;
      min-height: 0;
      display: grid;
      grid-template-rows: auto auto 1fr;
      gap: 10px;
      padding: 10px;
      color: var(--fg-color, #d7d7d7);
      font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
      box-sizing: border-box;
    }

    .mk-model-manager * {
      box-sizing: border-box;
      letter-spacing: 0;
    }

    .mk-model-manager-search {
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 32px;
      gap: 6px;
    }

    .mk-model-manager-search-input {
      min-width: 0;
      height: 32px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.24);
      color: var(--fg-color, #f2f2f2);
      font: 500 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      outline: none;
      padding: 0 10px;
    }

    .mk-model-manager-search-input:focus {
      border-color: #8fd14f;
      box-shadow: 0 0 0 1px rgba(143, 209, 79, 0.28);
    }

    .mk-model-manager-refresh {
      width: 32px;
      height: 32px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.04);
      color: var(--fg-color, #d7d7d7);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }

    .mk-model-manager-refresh:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.22);
    }

    .mk-model-manager-refresh:disabled {
      cursor: default;
      opacity: 0.54;
    }

    .mk-model-manager-refresh.is-loading .pi {
      animation: mk-model-manager-spin 900ms linear infinite;
    }

    @keyframes mk-model-manager-spin {
      to { transform: rotate(360deg); }
    }

    .mk-model-manager-filters {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .mk-model-manager-filter {
      min-width: 0;
      height: 30px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.04);
      color: var(--fg-color, #d7d7d7);
      cursor: pointer;
      font: 600 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
      padding: 0 8px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mk-model-manager-filter:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.22);
    }

    .mk-model-manager-filter.is-active {
      background: color-mix(in srgb, var(--comfy-menu-bg, #222) 72%, #8fd14f);
      border-color: #8fd14f;
      color: #f7ffe9;
    }

    .mk-model-manager-list {
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-right: 2px;
    }

    .mk-model-manager-card {
      min-width: 0;
      display: grid;
      grid-template-columns: 58px minmax(0, 1fr);
      gap: 8px;
      padding: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.04);
      cursor: pointer;
    }

    .mk-model-manager-card:hover {
      background: rgba(255, 255, 255, 0.07);
      border-color: rgba(255, 255, 255, 0.18);
    }

    .mk-model-manager-card:focus-visible {
      outline: 2px solid #8fd14f;
      outline-offset: 2px;
    }

    .mk-model-manager-entry {
      min-width: 0;
      display: grid;
      gap: 6px;
    }

    .mk-model-manager-detail {
      min-width: 0;
      display: grid;
      grid-template-columns: 124px minmax(0, 1fr);
      gap: 10px;
      padding: 12px 10px;
      border: 1px solid rgba(143, 209, 79, 0.24);
      border-radius: 6px;
      background: rgba(143, 209, 79, 0.055);
    }

    .mk-model-manager-detail-preview {
      width: 124px;
      min-height: 164px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.22);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255, 255, 255, 0.58);
    }

    .mk-model-manager-detail-preview img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
    }

    .mk-model-manager-zoom {
      position: fixed;
      z-index: 10020;
      width: min(520px, 46vw);
      max-height: min(720px, 82vh);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 8px;
      background: rgba(18, 20, 24, 0.98);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
      overflow: hidden;
      pointer-events: none;
      display: none;
    }

    .mk-model-manager-zoom.is-visible {
      display: block;
    }

    .mk-model-manager-zoom img {
      width: 100%;
      max-height: min(720px, 82vh);
      display: block;
      object-fit: contain;
    }

    .mk-model-manager-detail-preview .pi {
      font-size: 32px;
    }

    .mk-model-manager-detail-text {
      min-width: 0;
      max-height: 220px;
      overflow: auto;
      color: rgba(255, 255, 255, 0.78);
      font: 11px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .mk-model-manager-detail-editor {
      width: 100%;
      min-height: 164px;
      max-height: 220px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.18);
      color: rgba(255, 255, 255, 0.82);
      outline: none;
      padding: 8px;
      resize: vertical;
      white-space: pre-wrap;
    }

    .mk-model-manager-detail-editor:focus {
      border-color: #8fd14f;
      box-shadow: 0 0 0 1px rgba(143, 209, 79, 0.28);
    }

    .mk-model-manager-local-actions {
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 6px;
    }

    .mk-model-manager-local-action {
      min-width: 0;
      height: 30px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.055);
      color: var(--fg-color, #f2f2f2);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      font: 700 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
      padding: 0 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mk-model-manager-local-action:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.09);
      border-color: rgba(143, 209, 79, 0.5);
    }

    .mk-model-manager-local-action:disabled {
      cursor: default;
      opacity: 0.58;
    }

    .mk-model-manager-hidden-input {
      display: none;
    }

    .mk-model-manager-action-status {
      grid-column: 1 / -1;
      min-width: 0;
      color: rgba(255, 255, 255, 0.6);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mk-model-manager-detail-empty {
      color: rgba(255, 255, 255, 0.56);
    }

    .mk-model-manager-detail-actions {
      min-width: 0;
      display: grid;
      gap: 6px;
    }

    .mk-model-manager-civitai-input {
      min-width: 0;
      height: 30px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.2);
      color: var(--fg-color, #f2f2f2);
      font: 500 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      outline: none;
      padding: 0 9px;
    }

    .mk-model-manager-civitai-input:focus {
      border-color: #8fd14f;
      box-shadow: 0 0 0 1px rgba(143, 209, 79, 0.28);
    }

    .mk-model-manager-civitai {
      min-width: 0;
      height: 32px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      background: rgba(143, 209, 79, 0.12);
      color: #efffdf;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      font: 700 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 0 10px;
    }

    .mk-model-manager-civitai:hover:not(:disabled) {
      background: rgba(143, 209, 79, 0.18);
      border-color: rgba(143, 209, 79, 0.55);
    }

    .mk-model-manager-civitai:disabled {
      cursor: default;
      opacity: 0.58;
    }

    .mk-model-manager-civitai.is-loading .pi {
      animation: mk-model-manager-spin 900ms linear infinite;
    }

    .mk-model-manager-civitai-confirm {
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 86px;
      gap: 6px;
    }

    .mk-model-manager-civitai-status {
      min-width: 0;
      color: rgba(255, 255, 255, 0.6);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mk-model-manager-group {
      min-width: 0;
      display: grid;
      gap: 6px;
    }

    .mk-model-manager-folder {
      min-width: 0;
      height: 40px;
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      padding: 0 8px;
      border: 1px solid rgba(255, 255, 255, 0.11);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.055);
      color: var(--fg-color, #f2f2f2);
      cursor: pointer;
      font: 600 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .mk-model-manager-folder:hover {
      background: rgba(255, 255, 255, 0.09);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .mk-model-manager-folder.is-selected {
      background: rgba(143, 209, 79, 0.15);
      border-color: rgba(143, 209, 79, 0.6);
    }

    .mk-model-manager-folder-title {
      min-width: 0;
      display: grid;
      gap: 3px;
    }

    .mk-model-manager-folder-name,
    .mk-model-manager-folder-meta {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mk-model-manager-folder-meta {
      color: rgba(255, 255, 255, 0.58);
      font-size: 11px;
      font-weight: 500;
    }

    .mk-model-manager-folder-count {
      color: rgba(255, 255, 255, 0.66);
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }

    .mk-model-manager-breadcrumb {
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      align-items: center;
      padding: 2px 0 4px;
    }

    .mk-model-manager-breadcrumb-button {
      max-width: 100%;
      min-width: 0;
      height: 24px;
      border: 1px solid rgba(255, 255, 255, 0.11);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.04);
      color: rgba(255, 255, 255, 0.72);
      cursor: pointer;
      font: 600 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
      padding: 0 8px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mk-model-manager-breadcrumb-button.is-active {
      background: rgba(143, 209, 79, 0.16);
      border-color: rgba(143, 209, 79, 0.58);
      color: #efffdf;
    }

    .mk-model-manager-group-models {
      display: grid;
      gap: 6px;
      padding-left: 10px;
    }

    .mk-model-manager-preview {
      width: 58px;
      height: 58px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.22);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255, 255, 255, 0.58);
      flex: none;
    }

    .mk-model-manager-preview img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
    }

    .mk-model-manager-preview .pi {
      font-size: 22px;
    }

    .mk-model-manager-info {
      min-width: 0;
      display: grid;
      gap: 4px;
      align-content: center;
    }

    .mk-model-manager-name {
      min-width: 0;
      color: var(--fg-color, #f2f2f2);
      font-size: 12px;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mk-model-manager-meta,
    .mk-model-manager-path {
      min-width: 0;
      color: rgba(255, 255, 255, 0.6);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mk-model-manager-empty {
      margin: 18px 2px 0;
      color: rgba(255, 255, 255, 0.62);
      font-size: 12px;
      text-align: center;
    }
  `;
  document.head.appendChild(style);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function filteredModels() {
  const query = state.search.trim().toLowerCase();
  const categoryModels = state.filter === "all" ? state.models : state.models.filter((model) => model.category === state.filter);
  if (!query) return categoryModels;

  return categoryModels.filter((model) => {
    const haystack = [
      model.name,
      model.file,
      model.relative_path,
      model.directory,
      model.model_type,
      model.model_type_label,
      CATEGORY_LABELS[model.category],
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

function groupModels(models) {
  const groups = new Map();

  for (const model of models) {
    const directory = model.directory || "";
    const rootName = model.root_name || model.model_type_label || model.model_type || "\u6839\u76ee\u5f55";
    const label = directory ? `${rootName} / ${directory}` : rootName;
    const key = `${model.category}|${model.model_type}|${rootName}|${directory}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label,
        directory,
        root_name: rootName,
        category: model.category,
        model_type_label: model.model_type_label || model.model_type || "",
        models: [],
      });
    }

    groups.get(key).models.push(model);
  }

  return [...groups.values()].sort((a, b) => {
    const typeCompare = a.model_type_label.localeCompare(b.model_type_label);
    if (typeCompare !== 0) return typeCompare;
    return a.label.localeCompare(b.label);
  });
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderSearch(root) {
  const search = createElement("div", "mk-model-manager-search");

  const input = createElement("input", "mk-model-manager-search-input");
  input.type = "search";
  input.value = state.search;
  input.placeholder = "\u641c\u7d22\u6a21\u578b";
  input.title = "\u641c\u7d22\u6a21\u578b";
  input.addEventListener("input", () => {
    state.search = input.value;
    renderListOnly();
  });
  search.appendChild(input);

  const refresh = createElement("button", "mk-model-manager-refresh");
  refresh.type = "button";
  refresh.title = "\u5237\u65b0\u6a21\u578b\u9884\u89c8\u5e93";
  refresh.setAttribute("aria-label", "\u5237\u65b0\u6a21\u578b\u9884\u89c8\u5e93");
  refresh.disabled = state.loading;
  refresh.classList.toggle("is-loading", state.loading);
  refresh.addEventListener("click", () => refreshModels());

  const icon = createElement("i", "pi pi-refresh");
  icon.setAttribute("aria-hidden", "true");
  refresh.appendChild(icon);
  search.appendChild(refresh);

  root.appendChild(search);
}

function renderFilters(root) {
  const filters = createElement("div", "mk-model-manager-filters");

  for (const filter of FILTERS) {
    const button = createElement("button", "mk-model-manager-filter", filter.label);
    button.type = "button";
    button.title = filter.label;
    button.classList.toggle("is-active", state.filter === filter.id);
    button.addEventListener("click", () => {
      state.filter = filter.id;
      state.folderPath = defaultFolderPathForFilter(filter.id);
      renderPanel();
    });
    filters.appendChild(button);
  }

  root.appendChild(filters);
}

function renderPreview(card, model) {
  const preview = createElement("div", "mk-model-manager-preview");

  if (model.preview_url) {
    const image = document.createElement("img");
    image.src = typeof api.apiURL === "function" ? api.apiURL(model.preview_url) : model.preview_url;
    image.alt = model.name;
    image.loading = "lazy";
    image.decoding = "async";
    preview.appendChild(image);
  } else {
    const icon = createElement("i", "pi pi-database");
    icon.setAttribute("aria-hidden", "true");
    preview.appendChild(icon);
  }

  card.appendChild(preview);
}

function previewImageSrc(model) {
  if (!model.preview_url) return "";
  return typeof api.apiURL === "function" ? api.apiURL(model.preview_url) : model.preview_url;
}

let _zoomRootEl = null;

function zoomRoot() {
  if (_zoomRootEl) return _zoomRootEl;
  let root = document.querySelector(".mk-model-manager-zoom");
  if (!root) {
    root = createElement("div", "mk-model-manager-zoom");
    root.appendChild(document.createElement("img"));
    document.body.appendChild(root);
  }
  _zoomRootEl = root;
  return root;
}

function positionZoom(event, root) {
  const gap = 14;
  const rect = root.getBoundingClientRect();
  let left = event.clientX + gap;
  let top = event.clientY + gap;

  if (left + rect.width > window.innerWidth - gap) {
    left = Math.max(gap, event.clientX - rect.width - gap);
  }
  if (top + rect.height > window.innerHeight - gap) {
    top = Math.max(gap, window.innerHeight - rect.height - gap);
  }

  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
}

function showPreviewZoom(event, model) {
  const src = previewImageSrc(model);
  if (!src) return;

  const root = zoomRoot();
  const image = root.querySelector("img");
  image.src = src;
  image.alt = model.name;
  root.classList.add("is-visible");
  positionZoom(event, root);
}

function movePreviewZoom(event) {
  const root = document.querySelector(".mk-model-manager-zoom.is-visible");
  if (root) positionZoom(event, root);
}

function hidePreviewZoom() {
  const root = document.querySelector(".mk-model-manager-zoom");
  if (!root) return;
  root.classList.remove("is-visible");
  const image = root.querySelector("img");
  if (image) image.removeAttribute("src");
}

function renderModelCard(model) {
  const card = createElement("article", "mk-model-manager-card");
  const displayPath = model.full_path || model.relative_path || model.file || model.name;
  card.title = displayPath;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-expanded", state.expandedModels.has(model.id) ? "true" : "false");
  card.addEventListener("click", () => toggleModelDetail(model));
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleModelDetail(model);
  });

  renderPreview(card, model);

  const info = createElement("div", "mk-model-manager-info");
  info.appendChild(createElement("div", "mk-model-manager-name", model.name));

  const category = CATEGORY_LABELS[model.category] || CATEGORY_LABELS.other;
  const type = model.model_type_label || model.model_type || category;
  info.appendChild(createElement("div", "mk-model-manager-meta", `${category} · ${type} · ${formatBytes(model.size)}`));
  info.appendChild(createElement("div", "mk-model-manager-path", displayPath));

  card.appendChild(info);
  return card;
}

function renderDetailPreview(detail, model) {
  const preview = createElement("div", "mk-model-manager-detail-preview");

  if (model.preview_url) {
    const image = document.createElement("img");
    image.src = previewImageSrc(model);
    image.alt = model.name;
    image.loading = "lazy";
    image.decoding = "async";
    preview.appendChild(image);
    preview.addEventListener("mouseenter", (event) => showPreviewZoom(event, model));
    preview.addEventListener("mousemove", movePreviewZoom);
    preview.addEventListener("mouseleave", hidePreviewZoom);
  } else {
    const icon = createElement("i", "pi pi-database");
    icon.setAttribute("aria-hidden", "true");
    preview.appendChild(icon);
  }

  detail.appendChild(preview);
}

function renderModelDetail(model) {
  const detail = createElement("div", "mk-model-manager-detail");
  renderDetailPreview(detail, model);

  const text = createElement("textarea", "mk-model-manager-detail-text mk-model-manager-detail-editor");
  const info = state.infoCache.get(model.id);
  const editedText = state.infoEdits.has(model.id) ? state.infoEdits.get(model.id) : info?.text || "";
  text.value = editedText;
  text.placeholder = "\u7f16\u8f91\u6a21\u578b\u4fe1\u606f\uff0c\u4fdd\u5b58\u540e\u5199\u5165\u540c\u540d .txt";
  text.disabled = !!info?.loading;
  text.addEventListener("input", () => {
    state.infoEdits.set(model.id, text.value);
  });

  if (!model.info_url) {
    text.placeholder = "\u672a\u627e\u5230\u540c\u540d .txt\uff0c\u53ef\u76f4\u63a5\u7f16\u8f91\u540e\u4fdd\u5b58";
  } else if (!info || info.loading) {
    text.placeholder = "\u6b63\u5728\u8bfb\u53d6 .txt \u4fe1\u606f...";
  } else if (info.error) {
    text.placeholder = "\u8bfb\u53d6 .txt \u4fe1\u606f\u5931\u8d25\uff0c\u53ef\u91cd\u65b0\u7f16\u8f91\u4fdd\u5b58";
  }

  detail.appendChild(text);
  return detail;
}

function renderLocalActions(model) {
  const actions = createElement("div", "mk-model-manager-local-actions");
  const saveStatus = state.infoSaveStatus.get(model.id);
  const uploadStatus = state.uploadStatus.get(model.id);

  const uploadLabel = createElement("label", "mk-model-manager-local-action");
  uploadLabel.appendChild(createElement("i", uploadStatus?.loading ? "pi pi-refresh" : "pi pi-image"));
  uploadLabel.appendChild(createElement("span", "", uploadStatus?.loading ? "\u6b63\u5728\u4e0a\u4f20" : "\u66ff\u6362\u56fe\u7247"));
  const upload = createElement("input", "mk-model-manager-hidden-input");
  upload.type = "file";
  upload.accept = "image/png,image/jpeg,image/webp";
  upload.disabled = uploadStatus?.loading || !model.upload_preview_url;
  upload.addEventListener("change", () => {
    const file = upload.files?.[0];
    if (file) uploadPreview(model, file);
    upload.value = "";
  });
  uploadLabel.appendChild(upload);
  actions.appendChild(uploadLabel);

  const save = createElement("button", "mk-model-manager-local-action");
  save.type = "button";
  save.disabled = saveStatus?.loading || !model.save_info_url;
  save.addEventListener("click", () => saveModelInfo(model));
  save.appendChild(createElement("i", saveStatus?.loading ? "pi pi-refresh" : "pi pi-save"));
  save.appendChild(createElement("span", "", saveStatus?.loading ? "\u6b63\u5728\u4fdd\u5b58" : "\u4fdd\u5b58\u4fe1\u606f"));
  actions.appendChild(save);

  const messages = [saveStatus?.message, uploadStatus?.message].filter(Boolean).join(" | ");
  if (messages) actions.appendChild(createElement("div", "mk-model-manager-action-status", messages));

  return actions;
}

function renderCivitaiActions(model) {
  const actions = createElement("div", "mk-model-manager-detail-actions");
  const status = state.civitaiStatus.get(model.id);
  const loading = status?.loading;
  const confirming = state.civitaiConfirming.has(model.id);

  const input = createElement("input", "mk-model-manager-civitai-input");
  input.type = "text";
  input.value = state.civitaiInputs.get(model.id) || "";
  input.placeholder = "Civitai URL / ID\uff08\u53ef\u9009\uff09";
  input.title = "\u5982 hash \u67e5\u4e0d\u5230\uff0c\u53ef\u586b Civitai \u6a21\u578b\u9875 URL \u6216 ID";
  input.addEventListener("input", () => {
    state.civitaiInputs.set(model.id, input.value);
  });
  actions.appendChild(input);

  if (confirming && !loading) {
    const confirmRow = createElement("div", "mk-model-manager-civitai-confirm");
    const confirm = createElement("button", "mk-model-manager-civitai");
    confirm.type = "button";
    confirm.appendChild(createElement("i", "pi pi-check"));
    confirm.appendChild(createElement("span", "", "\u786e\u8ba4\u4e0b\u8f7d\u5e76\u8986\u76d6"));
    confirm.addEventListener("click", () => downloadCivitaiInfo(model));
    confirmRow.appendChild(confirm);

    const cancel = createElement("button", "mk-model-manager-local-action", "\u53d6\u6d88");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      state.civitaiConfirming.delete(model.id);
      renderListOnly();
    });
    confirmRow.appendChild(cancel);
    actions.appendChild(confirmRow);
  } else {
    const button = createElement("button", "mk-model-manager-civitai");
    button.type = "button";
    button.disabled = loading || !model.civitai_url;
    button.title = "\u4ece C \u7ad9\u4e0b\u8f7d\u540c\u6a21\u578b\u7684\u56fe\u7247\u548c\u63d0\u793a\u8bcd\u4fe1\u606f";
    button.classList.toggle("is-loading", !!loading);
    button.addEventListener("click", () => {
      state.civitaiConfirming.add(model.id);
      renderListOnly();
    });

    const icon = createElement("i", loading ? "pi pi-refresh" : "pi pi-download");
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.appendChild(createElement("span", "", loading ? "\u6b63\u5728\u4e0b\u8f7d C \u7ad9\u4fe1\u606f" : "\u4ece C \u7ad9\u4e0b\u8f7d\u6a21\u578b\u4fe1\u606f"));
    actions.appendChild(button);
  }

  if (status?.message) {
    actions.appendChild(createElement("div", "mk-model-manager-civitai-status", status.message));
  }

  return actions;
}

function renderModelEntry(model) {
  const entry = createElement("div", "mk-model-manager-entry");
  entry.appendChild(renderModelCard(model));
  if (state.expandedModels.has(model.id)) {
    entry.appendChild(renderModelDetail(model));
    entry.appendChild(renderLocalActions(model));
    entry.appendChild(renderCivitaiActions(model));
  }
  return entry;
}

function renderModelGroup(group) {
  const section = createElement("section", "mk-model-manager-group");
  const expanded = state.expandedGroups.has(group.key);
  const category = CATEGORY_LABELS[group.category] || CATEGORY_LABELS.other;

  const folder = createElement("button", "mk-model-manager-folder");
  folder.type = "button";
  folder.title = group.directory || group.model_type_label || group.label;
  folder.setAttribute("aria-expanded", expanded ? "true" : "false");
  folder.addEventListener("click", () => {
    if (state.expandedGroups.has(group.key)) {
      state.expandedGroups.delete(group.key);
    } else {
      state.expandedGroups.add(group.key);
    }
    renderPanel();
  });

  const icon = createElement("i", expanded ? "pi pi-chevron-down" : "pi pi-chevron-right");
  icon.setAttribute("aria-hidden", "true");
  folder.appendChild(icon);

  const title = createElement("div", "mk-model-manager-folder-title");
  title.appendChild(createElement("div", "mk-model-manager-folder-name", group.label));
  title.appendChild(createElement("div", "mk-model-manager-folder-meta", `${category} · ${group.model_type_label}`));
  folder.appendChild(title);

  folder.appendChild(createElement("div", "mk-model-manager-folder-count", `${group.models.length}`));
  section.appendChild(folder);

  if (expanded) {
    const models = createElement("div", "mk-model-manager-group-models");
    for (const model of group.models) {
      models.appendChild(renderModelEntry(model));
    }
    section.appendChild(models);
  }

  return section;
}

function directoryParts(model) {
  const root = (model.root_name || "").trim();
  const parts = (model.directory || "").split("/").map((part) => part.trim()).filter(Boolean);
  return root ? [root, ...parts] : parts;
}

function defaultFolderPathForFilter(filterId) {
  if (filterId !== "lora") return [];

  const roots = [
    ...new Set(state.models
      .filter((model) => model.category === "lora")
      .map((model) => directoryParts(model)[0])
      .filter(Boolean)),
  ];
  const preferred = roots.find((root) => LORA_ROOT_NAMES.has(root.toLowerCase()));
  return preferred ? [preferred] : roots.length === 1 ? [roots[0]] : [];
}

function hasPathPrefix(parts, prefix) {
  if (parts.length < prefix.length) return false;
  return prefix.every((part, index) => parts[index] === part);
}

function currentLevel(models) {
  const folders = new Map();
  const currentModels = [];

  for (const model of models) {
    const parts = directoryParts(model);
    if (!hasPathPrefix(parts, state.folderPath)) continue;

    if (parts.length > state.folderPath.length) {
      const folderName = parts[state.folderPath.length];
      const entry = folders.get(folderName) || { name: folderName, count: 0 };
      entry.count += 1;
      folders.set(folderName, entry);
    } else {
      currentModels.push(model);
    }
  }

  return {
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    models: currentModels,
  };
}

function renderBreadcrumb(list) {
  const breadcrumb = createElement("div", "mk-model-manager-breadcrumb");

  const root = createElement("button", "mk-model-manager-breadcrumb-button", "\u5168\u90e8\u76ee\u5f55");
  root.type = "button";
  root.classList.toggle("is-active", state.folderPath.length === 0);
  root.addEventListener("click", () => {
    state.folderPath = [];
    renderListOnly();
  });
  breadcrumb.appendChild(root);

  state.folderPath.forEach((part, index) => {
    const button = createElement("button", "mk-model-manager-breadcrumb-button", part);
    button.type = "button";
    button.title = state.folderPath.slice(0, index + 1).join(" / ");
    button.classList.toggle("is-active", index === state.folderPath.length - 1);
    button.addEventListener("click", () => {
      state.folderPath = state.folderPath.slice(0, index + 1);
      renderListOnly();
    });
    breadcrumb.appendChild(button);
  });

  list.appendChild(breadcrumb);
}

function renderDirectory(folder) {
  const button = createElement("button", "mk-model-manager-folder");
  button.type = "button";
  button.title = [...state.folderPath, folder.name].join(" / ");
  button.addEventListener("click", () => {
    state.folderPath = [...state.folderPath, folder.name];
    renderListOnly();
  });

  const icon = createElement("i", "pi pi-folder");
  icon.setAttribute("aria-hidden", "true");
  button.appendChild(icon);

  const title = createElement("div", "mk-model-manager-folder-title");
  title.appendChild(createElement("div", "mk-model-manager-folder-name", folder.name));
  title.appendChild(createElement("div", "mk-model-manager-folder-meta", "\u76ee\u5f55"));
  button.appendChild(title);

  button.appendChild(createElement("div", "mk-model-manager-folder-count", `${folder.count}`));
  return button;
}

function renderListContent(list) {
  if (state.loading) {
    list.appendChild(createElement("div", "mk-model-manager-empty", "\u6b63\u5728\u8bfb\u53d6\u6a21\u578b..."));
  } else if (state.error) {
    list.appendChild(createElement("div", "mk-model-manager-empty", state.error));
  } else {
    const models = filteredModels();
    if (models.length === 0) {
      list.appendChild(createElement("div", "mk-model-manager-empty", "\u672a\u627e\u5230\u53ef\u9884\u89c8\u7684\u6a21\u578b"));
    } else {
      renderBreadcrumb(list);
      const level = currentLevel(models);
      if (level.folders.length === 0 && level.models.length === 0) {
        list.appendChild(createElement("div", "mk-model-manager-empty", "\u5f53\u524d\u76ee\u5f55\u6ca1\u6709\u5339\u914d\u7684\u6a21\u578b"));
      }
      for (const folder of level.folders) {
        list.appendChild(renderDirectory(folder));
      }
      for (const model of level.models) {
        list.appendChild(renderModelEntry(model));
      }
    }
  }
}

function renderList(root) {
  const list = createElement("div", "mk-model-manager-list");
  renderListContent(list);
  root.appendChild(list);
  state.listRoot = list;
}

function renderListOnly() {
  if (!state.listRoot) {
    renderPanel();
    return;
  }

  state.listRoot.replaceChildren();
  renderListContent(state.listRoot);
}

function renderPanel() {
  if (!state.root) return;

  const root = createElement("div", "mk-model-manager");
  renderSearch(root);
  renderFilters(root);
  renderList(root);
  state.root.replaceChildren(root);
}

async function loadModels(force = false) {
  if (state.loading || (state.loaded && !force)) return;

  if (force) {
    state.loaded = false;
    state.folderPath = [];
    state.expandedGroups.clear();
    state.expandedModels.clear();
    state.infoCache.clear();
    state.infoEdits.clear();
    state.infoSaveStatus.clear();
    state.uploadStatus.clear();
    state.civitaiStatus.clear();
    state.civitaiInputs.clear();
    state.civitaiConfirming.clear();
  }
  state.loading = true;
  state.error = "";
  renderPanel();

  try {
    const response = await api.fetchApi(MODELS_ENDPOINT, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    state.models = Array.isArray(payload.models) ? payload.models : [];
    if (state.filter === "lora" && state.folderPath.length === 0) {
      state.folderPath = defaultFolderPathForFilter("lora");
    }
    state.loaded = true;
  } catch (error) {
    state.error = "\u6a21\u578b\u5217\u8868\u8bfb\u53d6\u5931\u8d25";
    console.error("[MKTheme] Failed to load model manager list", error);
  } finally {
    state.loading = false;
    renderPanel();
  }
}

function refreshModels() {
  loadModels(true);
}

async function loadModelInfo(model) {
  if (!model.info_url || state.infoCache.has(model.id)) return;

  state.infoCache.set(model.id, { loading: true, text: "", truncated: false, error: false });
  renderListOnly();

  try {
    const response = await api.fetchApi(model.info_url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    state.infoCache.set(model.id, {
      loading: false,
      text: typeof payload.text === "string" ? payload.text : "",
      truncated: !!payload.truncated,
      error: false,
    });
    if (!state.infoEdits.has(model.id)) {
      state.infoEdits.set(model.id, typeof payload.text === "string" ? payload.text : "");
    }
  } catch (error) {
    state.infoCache.set(model.id, { loading: false, text: "", truncated: false, error: true });
    console.error("[MKTheme] Failed to load model info", error);
  } finally {
    renderListOnly();
  }
}

function toggleModelDetail(model) {
  if (state.expandedModels.has(model.id)) {
    state.expandedModels.delete(model.id);
    renderListOnly();
    return;
  }

  state.expandedModels.clear();
  state.expandedModels.add(model.id);
  renderListOnly();
  loadModelInfo(model);
}

async function downloadCivitaiInfo(model) {
  if (!model.civitai_url || state.civitaiStatus.get(model.id)?.loading) return;

  const manualInput = state.civitaiInputs.get(model.id) || "";
  state.civitaiConfirming.delete(model.id);
  state.civitaiStatus.set(model.id, {
    loading: true,
    message: manualInput.trim() ? "\u6b63\u5728\u6309 Civitai URL/ID \u4e0b\u8f7d\u4fe1\u606f..." : "\u6b63\u5728\u8ba1\u7b97 hash \u5e76\u8bf7\u6c42 C \u7ad9...",
  });
  renderListOnly();

  try {
    const response = await api.fetchApi(model.civitai_url, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_url_or_id: manualInput }),
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }
    if (!response.ok) throw new Error(payload?.error || payload?.message || raw || `HTTP ${response.status}`);

    if (payload.preview_url) {
      model.preview_url = `${payload.preview_url}?v=${Date.now()}`;
    }
    if (payload.info_url) {
      model.info_url = payload.info_url;
    }

    state.infoCache.set(model.id, {
      loading: false,
      text: typeof payload.text === "string" ? payload.text : "",
      truncated: false,
      error: false,
    });
    state.infoEdits.set(model.id, typeof payload.text === "string" ? payload.text : "");

    const saved = [payload.saved_image, payload.saved_info].filter(Boolean).join(" / ");
    const imageError = payload.image_error ? `\uff08\u56fe\u7247\u5931\u8d25: ${payload.image_error}\uff09` : "";
    state.civitaiStatus.set(model.id, {
      loading: false,
      message: saved ? `\u5df2\u4fdd\u5b58: ${saved}${imageError}` : `\u5df2\u4fdd\u5b58 C \u7ad9\u4fe1\u606f${imageError}`,
    });
  } catch (error) {
    state.civitaiStatus.set(model.id, {
      loading: false,
      message: `C \u7ad9\u4fe1\u606f\u4e0b\u8f7d\u5931\u8d25: ${error.message}`,
    });
    console.error("[MKTheme] Failed to download Civitai model info", error);
  } finally {
    renderListOnly();
  }
}

async function saveModelInfo(model) {
  if (!model.save_info_url || state.infoSaveStatus.get(model.id)?.loading) return;

  const text = state.infoEdits.has(model.id) ? state.infoEdits.get(model.id) : state.infoCache.get(model.id)?.text || "";
  state.infoSaveStatus.set(model.id, { loading: true, message: "\u6b63\u5728\u4fdd\u5b58 .txt..." });
  renderListOnly();

  try {
    const response = await api.fetchApi(model.save_info_url, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }
    if (!response.ok) throw new Error(payload?.error || payload?.message || raw || `HTTP ${response.status}`);

    if (payload.info_url) model.info_url = payload.info_url;
    state.infoCache.set(model.id, { loading: false, text, truncated: false, error: false });
    state.infoEdits.set(model.id, text);
    state.infoSaveStatus.set(model.id, { loading: false, message: `\u5df2\u4fdd\u5b58: ${payload.saved_info || ".txt"}` });
  } catch (error) {
    state.infoSaveStatus.set(model.id, { loading: false, message: `\u4fdd\u5b58\u5931\u8d25: ${error.message}` });
    console.error("[MKTheme] Failed to save model info", error);
  } finally {
    renderListOnly();
  }
}

async function uploadPreview(model, file) {
  if (!model.upload_preview_url || state.uploadStatus.get(model.id)?.loading) return;

  state.uploadStatus.set(model.id, { loading: true, message: "\u6b63\u5728\u66ff\u6362\u56fe\u7247..." });
  renderListOnly();

  try {
    const formData = new FormData();
    formData.append("image", file, file.name);
    const response = await api.fetchApi(model.upload_preview_url, {
      method: "POST",
      cache: "no-store",
      body: formData,
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }
    if (!response.ok) throw new Error(payload?.error || payload?.message || raw || `HTTP ${response.status}`);

    if (payload.preview_url) model.preview_url = `${payload.preview_url}?v=${Date.now()}`;
    state.uploadStatus.set(model.id, { loading: false, message: `\u5df2\u66ff\u6362: ${payload.saved_image || "\u56fe\u7247"}` });
  } catch (error) {
    state.uploadStatus.set(model.id, { loading: false, message: `\u66ff\u6362\u5931\u8d25: ${error.message}` });
    console.error("[MKTheme] Failed to upload model preview", error);
  } finally {
    renderListOnly();
  }
}

function renderModelManager(element) {
  injectCSS();
  state.root = element;
  renderPanel();
  loadModels();
}

app.registerExtension({
  name: EXTENSION_NAME,
  setup() {
    app.extensionManager?.registerSidebarTab?.({
      id: SIDEBAR_TAB_ID,
      icon: "pi pi-database",
      title: "\u6a21\u578b\u7ba1\u7406",
      tooltip: "\u6a21\u578b\u7ba1\u7406",
      type: "custom",
      render: renderModelManager,
    });
  },
});
