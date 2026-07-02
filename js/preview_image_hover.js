/**
 * Preview image on hover for image filename menus.
 * Integrated as an independent MK-Theme frontend extension.
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "MKTheme.PreviewImageHover";
const SETTING_ENABLED = "MKTheme.PreviewImageHover.Enabled";
const PREVIEW_ID = "mk-theme-image-preview";
const PREVIEW_IMG_ID = "mk-theme-preview-img";
const CACHE_MAX_SIZE = 10;
const DEBOUNCE_DELAY = 150;
const MAX_PREVIEW_SIZE = 400;
const DEFAULT_ENABLED = true;

let previewElement = null;
let currentAbortController = null;
let debounceTimer = null;
let listenersInstalled = false;
let closePatchTries = 0;

const imageCache = new Map();
const state = {
  enabled: DEFAULT_ENABLED,
};

function isEnabled() {
  return !!state.enabled;
}

function isImageFilename(filename) {
  return /\.(jpg|jpeg|png|gif|webp|bmp|tiff|svg)$/i.test(filename);
}

function getPreviewElement() {
  if (!previewElement) {
    previewElement = document.createElement("div");
    previewElement.id = PREVIEW_ID;
    previewElement.style.cssText = `
      position: fixed;
      z-index: 99999;
      max-width: ${MAX_PREVIEW_SIZE}px;
      max-height: ${MAX_PREVIEW_SIZE}px;
      border: 2px solid #fff;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      pointer-events: none;
      background: #1a1a1a;
      display: none;
      overflow: hidden;
    `;

    const img = document.createElement("img");
    img.id = PREVIEW_IMG_ID;
    img.style.cssText = `
      display: block;
      max-width: 100%;
      max-height: ${MAX_PREVIEW_SIZE}px;
      width: auto;
      height: auto;
      object-fit: contain;
    `;

    previewElement.appendChild(img);
    document.body.appendChild(previewElement);
  }

  return previewElement;
}

function hidePreview() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }

  if (previewElement) {
    previewElement.style.display = "none";
  }
}

function cleanupCache() {
  if (imageCache.size > CACHE_MAX_SIZE) {
    const firstKey = imageCache.keys().next().value;
    imageCache.delete(firstKey);
  }
}

function showPreviewDebounced(element, filename) {
  if (!isEnabled()) return;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    showPreview(element, filename);
  }, DEBOUNCE_DELAY);
}

async function waitForImage(img, signal) {
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  });
}

async function showPreview(element, filename) {
  if (!isEnabled() || !filename || !isImageFilename(filename)) return;

  if (currentAbortController) {
    currentAbortController.abort();
  }

  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const preview = getPreviewElement();
  const img = preview.querySelector("img");

  try {
    if (imageCache.has(filename)) {
      const cachedData = imageCache.get(filename);
      img.src = cachedData.src;

      imageCache.delete(filename);
      imageCache.set(filename, cachedData);

      if (!img.complete) {
        await waitForImage(img, signal);
      }

      if (signal.aborted || !isEnabled()) return;

      positionPreview(element, img);
      preview.style.display = "block";
      return;
    }

    const imageUrl = api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=input`);
    const loadPromise = waitForImage(img, signal);
    img.src = imageUrl;

    await loadPromise;

    if (signal.aborted || !isEnabled()) return;

    cleanupCache();
    imageCache.set(filename, { src: imageUrl });

    positionPreview(element, img);
    preview.style.display = "block";
  } catch (error) {
    if (error?.message === "Aborted") return;
    console.error("[MKTheme.PreviewImageHover] Failed to load image:", error);
    hidePreview();
  }
}

function positionPreview(element, img) {
  const rect = element.getBoundingClientRect();
  const imgWidth = img.naturalWidth;
  const imgHeight = img.naturalHeight;

  let displayWidth = imgWidth;
  let displayHeight = imgHeight;

  if (imgWidth > MAX_PREVIEW_SIZE || imgHeight > MAX_PREVIEW_SIZE) {
    const ratio = Math.min(MAX_PREVIEW_SIZE / imgWidth, MAX_PREVIEW_SIZE / imgHeight);
    displayWidth = imgWidth * ratio;
    displayHeight = imgHeight * ratio;
  }

  previewElement.style.width = `${displayWidth}px`;
  previewElement.style.height = `${displayHeight}px`;

  let left = rect.right + 10;
  let top = rect.top;

  if (left + displayWidth > window.innerWidth - 20) {
    left = rect.left - displayWidth - 10;
  }
  if (top + displayHeight > window.innerHeight - 20) {
    top = window.innerHeight - displayHeight - 20;
  }
  if (left < 10) left = 10;

  previewElement.style.left = `${left}px`;
  previewElement.style.top = `${top}px`;
}

function getMenuEntryTarget(event) {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  return target.closest?.(".litemenu-entry") || null;
}

function onMouseOver(event) {
  if (!isEnabled()) return;

  const target = getMenuEntryTarget(event);
  if (!target) return;
  if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;

  const filename = target.textContent?.trim();
  showPreviewDebounced(target, filename);
}

function onMouseOut(event) {
  const target = getMenuEntryTarget(event);
  if (target && event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
  if (target) hidePreview();
}

function installContextMenuClosePatch() {
  const proto = window.LiteGraph?.ContextMenu?.prototype;
  if (!proto) {
    if (++closePatchTries <= 20) setTimeout(installContextMenuClosePatch, 250);
    return;
  }
  if (proto.__mkThemePreviewHoverPatched || typeof proto.close !== "function") return;

  const originalClose = proto.close;
  proto.close = function(...args) {
    hidePreview();
    return originalClose.apply(this, args);
  };
  proto.__mkThemePreviewHoverPatched = true;
}

function installListeners() {
  if (listenersInstalled) return;

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);

  installContextMenuClosePatch();

  listenersInstalled = true;
}

app.registerExtension({
  name: EXTENSION_NAME,
  settings: [
    {
      id: SETTING_ENABLED,
      name: "MK 主题：图片菜单悬停预览",
      type: "boolean",
      defaultValue: DEFAULT_ENABLED,
      category: ["MK 主题", "图片预览"],
      tooltip: "在 LoadImage 等图片文件菜单中，将鼠标悬停到图片文件名上时显示预览图。",
      onChange: (value) => {
        state.enabled = !!value;
        if (!state.enabled) hidePreview();
      },
    },
  ],
  setup() {
    const settings = app.ui?.settings;
    if (settings) {
      const value = settings.getSettingValue(SETTING_ENABLED);
      state.enabled = value == null ? DEFAULT_ENABLED : !!value;
    }

    installListeners();
  },
});
