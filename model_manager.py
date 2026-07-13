import asyncio
import base64
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from aiohttp import ClientError, ClientSession, ClientTimeout, web

import folder_paths
from server import PromptServer


MODEL_EXTENSIONS = {
    ".safetensors",
    ".ckpt",
    ".pt",
    ".pth",
    ".bin",
    ".gguf",
    ".onnx",
    ".engine",
    ".sft",
}

PREVIEW_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
INFO_TEXT_LIMIT = 64 * 1024
CIVITAI_BASE_URL = "https://civitai.com"
CIVITAI_API_MIRRORS = (
    "https://civitai.com",
    "https://civitai.work",
    "https://civitai.top",
    "https://civitai.red",
)
CIVITAI_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    "Referer": "https://civitai.com/",
}
CIVITAI_TIMEOUT_SECONDS = 60
CIVITAI_IMAGE_LIMIT = 32 * 1024 * 1024
MAIN_MODEL_TYPES = {"checkpoints", "diffusion_models", "unet"}
LORA_MODEL_TYPES = {"loras"}
MAIN_MODEL_DIR_NAMES = {"checkpoints", "clip", "clip_vision", "diffusers", "diffusion_models", "unet"}
LORA_MODEL_DIR_NAMES = {"loras", "lora", "locon", "lycoris"}
MODEL_TYPE_DIR_ALIASES = {
    "checkpoints": {"checkpoints", "checkpoint", "stable_diffusion"},
    "unet": {"unet"},
    "diffusion_models": {"diffusion_models", "diffusion_model"},
    "loras": LORA_MODEL_DIR_NAMES,
    "vae": {"vae"},
    "vae_approx": {"vae_approx"},
    "clip": {"clip"},
    "clip_vision": {"clip_vision"},
    "text_encoders": {"text_encoders", "text_encoder"},
    "controlnet": {"controlnet", "controlnets"},
    "embeddings": {"embeddings", "embedding"},
    "hypernetworks": {"hypernetworks", "hypernetwork"},
    "upscale_models": {"upscale_models", "upscale_model"},
    "style_models": {"style_models", "style_model"},
    "gligen": {"gligen"},
    "sams": {"sams", "sam", "sam3"},
    "sam3": {"sam3", "sams", "sam"},
    "ultralytics": {"ultralytics", "yolo", "detection"},
    "yolo": {"yolo", "detection", "ultralytics"},
    "detection": {"detection", "yolo", "ultralytics"},
    "photomaker": {"photomaker"},
    "diffusers": {"diffusers"},
    "rembg": {"rembg", "rmbg", "background_removal"},
    "RMBG": {"rembg", "rmbg", "background_removal"},
    "LLM": {"llm"},
    "llm": {"llm"},
    "audio_encoders": {"audio_encoders", "audio_encoder"},
    "frame_interpolation": {"frame_interpolation"},
    "geometry_estimation": {"geometry_estimation"},
    "latent_upscale_models": {"latent_upscale_models", "latent_upscale_model"},
    "model_patches": {"model_patches", "model_patch"},
    "optical_flow": {"optical_flow"},
}
MODEL_TYPE_PRIORITY = {
    "checkpoints": 0,
    "loras": 1,
    "unet": 2,
    "diffusion_models": 3,
}
MODEL_TYPE_LABELS = {
    "checkpoints": "Checkpoints",
    "diffusion_models": "Diffusion Models",
    "unet": "UNet",
    "loras": "LoRA",
}

_ROUTES_REGISTERED = False


def _safe_realpath(path):
    try:
        return os.path.realpath(path)
    except (OSError, TypeError):
        return ""


def _is_inside(path, roots):
    real_path = _safe_realpath(path)
    if not real_path:
        return False

    for root in roots:
        real_root = _safe_realpath(root)
        if not real_root:
            continue
        try:
            if os.path.commonpath([real_path, real_root]) == real_root:
                return True
        except ValueError:
            continue
    return False


def _is_custom_nodes_path(path):
    return "custom_nodes" in _path_parts(path)


def _dedupe_paths(paths):
    result = []
    seen = set()
    for path in paths:
        real_path = _safe_realpath(path)
        if not real_path or not os.path.isdir(real_path):
            continue
        key = os.path.normcase(real_path)
        if key in seen or _is_custom_nodes_path(real_path):
            continue
        seen.add(key)
        result.append(real_path)
    return result


def _models_root_from_path(path):
    parts = list(Path(path).parts)
    normalized = [_normalized_name(part) for part in parts]
    models_index = -1
    for index, part in enumerate(normalized):
        if part == "models":
            models_index = index
    if models_index < 0:
        return ""
    return str(Path(*parts[:models_index + 1]))


def _model_roots():
    roots = []
    models_dir = getattr(folder_paths, "models_dir", None)
    if models_dir:
        roots.append(models_dir)

    registered = getattr(folder_paths, "folder_names_and_paths", {})
    for value in registered.values():
        paths = value[0] if isinstance(value, (list, tuple)) and value else []
        for path in paths:
            models_root = _models_root_from_path(path)
            if models_root:
                roots.append(models_root)

    return _dedupe_paths(roots)


def _model_types():
    registered = getattr(folder_paths, "folder_names_and_paths", {})
    names = set(registered.keys())
    names.update(MAIN_MODEL_TYPES)
    names.update(LORA_MODEL_TYPES)
    return sorted(names, key=lambda name: (MODEL_TYPE_PRIORITY.get(name, 100), name))


def _normalized_name(value):
    return (value or "").lower().replace("-", "_").replace(" ", "_")


def _path_parts(path):
    return [_normalized_name(part) for part in Path(path or "").parts]


def _model_category(model_type, root=None, path=None):
    top_dir = _normalized_name(model_type)
    if top_dir in MAIN_MODEL_DIR_NAMES:
        return "main"
    if top_dir in LORA_MODEL_DIR_NAMES:
        return "lora"
    return "other"


def _model_type_label(model_type):
    return MODEL_TYPE_LABELS.get(model_type, model_type.replace("_", " ").title())


def _path_matches_model_type(model_type, root, path):
    parts = _path_parts(root or "") + _path_parts(path or "")
    aliases = MODEL_TYPE_DIR_ALIASES.get(model_type)
    if aliases:
        return any(part in aliases for part in parts)

    root_name = _normalized_name(os.path.basename(os.path.normpath(root)))
    if root_name in {"models", "model"}:
        return _normalized_name(model_type) in parts
    return True


def _relative_path(path, root):
    try:
        return os.path.relpath(path, root).replace(os.sep, "/")
    except ValueError:
        return os.path.basename(path)


def _actual_directory_info(model_type, root, path):
    category = _model_category(model_type, root, path)
    parent_parts = list(Path(path).parent.parts)
    normalized_parts = [_normalized_name(part) for part in parent_parts]
    models_index = -1
    for index, part in enumerate(normalized_parts):
        if part == "models":
            models_index = index

    if models_index >= 0 and models_index + 1 < len(parent_parts):
        root_name = parent_parts[models_index + 1]
        directory = "/".join(parent_parts[models_index + 2:])
        return root_name, directory

    if category == "main":
        anchor_names = MAIN_MODEL_DIR_NAMES
    elif category == "lora":
        anchor_names = LORA_MODEL_DIR_NAMES
    else:
        anchor_names = {_normalized_name(model_type), _normalized_name(os.path.basename(os.path.normpath(root)))}

    anchor_index = -1
    for index, part in enumerate(normalized_parts):
        if part in anchor_names:
            anchor_index = index

    if anchor_index >= 0:
        root_name = parent_parts[anchor_index]
        directory = "/".join(parent_parts[anchor_index + 1:])
        return root_name, directory

    root_name = os.path.basename(os.path.normpath(root)) or _model_type_label(model_type)
    relative_path = _relative_path(path, root)
    directory = os.path.dirname(relative_path).replace("\\", "/")
    return root_name, directory


def _preview_token(path):
    raw = _safe_realpath(path).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_preview_token(token):
    try:
        padding = "=" * (-len(token) % 4)
        return base64.urlsafe_b64decode(f"{token}{padding}").decode("utf-8")
    except Exception:
        return ""


def _find_preview(model_path):
    base = os.path.splitext(model_path)[0]
    folder = os.path.dirname(model_path)
    stem = Path(model_path).stem

    candidates = []
    for ext in PREVIEW_EXTENSIONS:
        candidates.append(f"{base}{ext}")
        candidates.append(f"{base}.preview{ext}")

    for preview_folder in ("preview", "previews", ".preview", ".previews"):
        for ext in PREVIEW_EXTENSIONS:
            candidates.append(os.path.join(folder, preview_folder, f"{stem}{ext}"))
            candidates.append(os.path.join(folder, preview_folder, f"{stem}.preview{ext}"))

    for candidate in candidates:
        if os.path.isfile(candidate):
            return _safe_realpath(candidate)
    return None


def _find_model_info(model_path):
    candidate = f"{os.path.splitext(model_path)[0]}.txt"
    if os.path.isfile(candidate):
        return _safe_realpath(candidate)
    return None


def _iter_model_files(model_type):
    try:
        roots = folder_paths.get_folder_paths(model_type)
    except Exception:
        return

    seen = set()
    for root in roots:
        if not os.path.isdir(root):
            continue

        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [name for name in dirnames if not name.startswith(".")]
            for filename in filenames:
                suffix = Path(filename).suffix.lower()
                if suffix not in MODEL_EXTENSIONS:
                    continue

                path = _safe_realpath(os.path.join(dirpath, filename))
                if not path or path in seen:
                    continue
                if not _path_matches_model_type(model_type, root, path):
                    continue

                seen.add(path)
                yield root, path


def _iter_library_model_files():
    seen = set()
    for models_root in _model_roots():
        for top_name in sorted(os.listdir(models_root), key=str.lower):
            top_path = os.path.join(models_root, top_name)
            if not os.path.isdir(top_path) or _is_custom_nodes_path(top_path):
                continue

            for dirpath, dirnames, filenames in os.walk(top_path):
                dirnames[:] = [name for name in dirnames if not name.startswith(".") and _normalized_name(name) != "custom_nodes"]
                for filename in filenames:
                    suffix = Path(filename).suffix.lower()
                    if suffix not in MODEL_EXTENSIONS:
                        continue

                    path = _safe_realpath(os.path.join(dirpath, filename))
                    if not path or _is_custom_nodes_path(path):
                        continue

                    seen_key = os.path.normcase(path)
                    if seen_key in seen:
                        continue

                    seen.add(seen_key)
                    yield top_name, models_root, path


def _model_info(model_type, root, path):
    stat = os.stat(path)
    preview = _find_preview(path)
    info_text = _find_model_info(path)
    model_id = hashlib.sha256(f"{model_type}\0{path}".encode("utf-8")).hexdigest()[:16]
    relative_path = _relative_path(path, root)
    root_name, directory = _actual_directory_info(model_type, root, path)

    return {
        "id": model_id,
        "name": Path(path).stem,
        "file": os.path.basename(path),
        "full_path": path,
        "relative_path": relative_path,
        "directory": directory,
        "root_name": root_name,
        "model_type": model_type,
        "model_type_label": _model_type_label(model_type),
        "category": _model_category(model_type, root, path),
        "size": stat.st_size,
        "modified": int(stat.st_mtime),
        "preview_url": f"/mk-theme/model-manager/preview/{_preview_token(preview)}" if preview else None,
        "info_url": f"/mk-theme/model-manager/info/{_preview_token(info_text)}" if info_text else None,
        "save_info_url": f"/mk-theme/model-manager/save-info/{_preview_token(path)}",
        "upload_preview_url": f"/mk-theme/model-manager/upload-preview/{_preview_token(path)}",
        "civitai_url": f"/mk-theme/model-manager/civitai/{_preview_token(path)}",
    }


def _list_models():
    models = []
    for model_type, root, path in _iter_library_model_files():
        try:
            models.append(_model_info(model_type, root, path))
        except OSError:
            continue

    category_order = {"main": 0, "lora": 1, "other": 2}
    models.sort(key=lambda item: (category_order[item["category"]], item["model_type_label"], item["name"].lower()))
    return models


async def _models_route(_request):
    models = await asyncio.to_thread(_list_models)
    return web.json_response({"models": models})


async def _preview_route(request):
    path = _decode_preview_token(request.match_info.get("token", ""))
    if Path(path).suffix.lower() not in PREVIEW_EXTENSIONS:
        raise web.HTTPNotFound()

    roots = _model_roots()
    if not os.path.isfile(path) or not _is_inside(path, roots):
        raise web.HTTPNotFound()

    return web.FileResponse(path)


def _read_info_text(path):
    with open(path, "rb") as file:
        data = file.read(INFO_TEXT_LIMIT + 1)

    truncated = len(data) > INFO_TEXT_LIMIT
    data = data[:INFO_TEXT_LIMIT]
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return data.decode(encoding), truncated
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace"), truncated


async def _info_route(request):
    path = _decode_preview_token(request.match_info.get("token", ""))
    if Path(path).suffix.lower() != ".txt":
        raise web.HTTPNotFound()

    roots = _model_roots()
    if not os.path.isfile(path) or not _is_inside(path, roots):
        raise web.HTTPNotFound()

    text, truncated = _read_info_text(path)
    return web.json_response({"text": text, "truncated": truncated})


def _validate_model_path(path):
    if Path(path).suffix.lower() not in MODEL_EXTENSIONS:
        raise web.HTTPNotFound()

    roots = _model_roots()
    if not os.path.isfile(path) or not _is_inside(path, roots):
        raise web.HTTPNotFound()


async def _save_info_route(request):
    model_path = _decode_preview_token(request.match_info.get("token", ""))
    _validate_model_path(model_path)

    try:
        payload = await request.json()
    except Exception as error:
        raise web.HTTPBadRequest(text="保存信息失败：请求内容不是 JSON") from error

    text = payload.get("text")
    if not isinstance(text, str):
        raise web.HTTPBadRequest(text="保存信息失败：text 必须是字符串")

    info_path = f"{os.path.splitext(model_path)[0]}.txt"
    with open(info_path, "w", encoding="utf-8") as file:
        file.write(text)

    return web.json_response({
        "text": text,
        "info_url": f"/mk-theme/model-manager/info/{_preview_token(info_path)}",
        "saved_info": os.path.basename(info_path),
    })


def _content_type_extension(content_type, fallback):
    content_type = (content_type or "").lower()
    if "jpeg" in content_type or "jpg" in content_type:
        return ".jpg"
    if "png" in content_type:
        return ".png"
    if "webp" in content_type:
        return ".webp"
    return fallback if fallback in PREVIEW_EXTENSIONS else ".png"


def _remove_existing_previews(model_path):
    base = os.path.splitext(model_path)[0]
    for ext in PREVIEW_EXTENSIONS:
        for candidate in (f"{base}{ext}", f"{base}.preview{ext}"):
            try:
                if os.path.isfile(candidate):
                    os.remove(candidate)
            except OSError:
                continue


async def _upload_preview_route(request):
    model_path = _decode_preview_token(request.match_info.get("token", ""))
    _validate_model_path(model_path)

    reader = await request.multipart()
    field = await reader.next()
    if field is None or field.name != "image":
        raise web.HTTPBadRequest(text="上传图片失败：缺少 image 字段")

    filename = field.filename or ""
    fallback_ext = Path(filename).suffix.lower()
    ext = _content_type_extension(field.headers.get("Content-Type"), fallback_ext)
    target = f"{os.path.splitext(model_path)[0]}{ext}"
    temp_target = f"{target}.tmp"
    uploaded = 0

    try:
        with open(temp_target, "wb") as file:
            while True:
                chunk = await field.read_chunk(size=1024 * 256)
                if not chunk:
                    break
                uploaded += len(chunk)
                if uploaded > CIVITAI_IMAGE_LIMIT:
                    raise web.HTTPBadRequest(text="上传图片失败：图片过大")
                file.write(chunk)

        _remove_existing_previews(model_path)
        os.replace(temp_target, target)
    except Exception:
        try:
            if os.path.exists(temp_target):
                os.remove(temp_target)
        finally:
            raise

    preview_path = _safe_realpath(target)
    return web.json_response({
        "preview_url": f"/mk-theme/model-manager/preview/{_preview_token(preview_path)}",
        "saved_image": os.path.basename(preview_path),
    })


def _file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def _old_auto_v1_hash(path):
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        file.seek(0x100000)
        chunk = file.read(0x10000)
        if not chunk:
            return ""
        digest.update(chunk)
    return digest.hexdigest()[:8].upper()


def _safetensors_metadata_hashes(path):
    if Path(path).suffix.lower() != ".safetensors":
        return []

    try:
        with open(path, "rb") as file:
            header_size = int.from_bytes(file.read(8), "little")
            if header_size <= 0 or header_size > 16 * 1024 * 1024:
                return []
            header = json.loads(file.read(header_size).decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return []

    metadata = header.get("__metadata__") or {}
    keys = ("sshs_model_hash", "sshs_legacy_hash", "modelspec.hash_sha256")
    return [str(metadata[key]).strip().upper() for key in keys if metadata.get(key)]


def _hash_candidates(path):
    sha256 = _file_sha256(path)
    candidates = []
    for value in [sha256, *_safetensors_metadata_hashes(path), sha256[:10], _old_auto_v1_hash(path)]:
        value = (value or "").strip().upper()
        if value and value not in candidates:
            candidates.append(value)
    return sha256, candidates


def _image_extension(url, content_type):
    content_type = (content_type or "").lower()
    if "jpeg" in content_type or "jpg" in content_type:
        return ".jpg"
    if "png" in content_type:
        return ".png"
    if "webp" in content_type:
        return ".webp"

    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix in PREVIEW_EXTENSIONS:
        return suffix
    return ".png"


def _first_civitai_image(payload):
    for image in payload.get("images") or []:
        if image.get("url"):
            return image
    return None


def _format_meta_value(value):
    if isinstance(value, (list, tuple)):
        return ", ".join(str(item) for item in value)
    if isinstance(value, dict):
        return ", ".join(f"{key}: {item}" for key, item in value.items())
    return str(value)


def _format_civitai_info(model_path, sha256, payload, image):
    model = payload.get("model") or {}
    trained_words = payload.get("trainedWords") or []
    meta = (image or {}).get("meta") or {}
    prompt = meta.get("prompt")
    negative_prompt = meta.get("negativePrompt")

    lines = [
        "来源: Civitai",
        f"站点: {CIVITAI_BASE_URL}",
        f"模型文件: {os.path.basename(model_path)}",
        f"SHA256: {sha256}",
    ]

    if model.get("name"):
        lines.append(f"模型名称: {model.get('name')}")
    if payload.get("name"):
        lines.append(f"版本名称: {payload.get('name')}")
    if payload.get("baseModel"):
        lines.append(f"基础模型: {payload.get('baseModel')}")
    if payload.get("modelId"):
        lines.append(f"模型ID: {payload.get('modelId')}")
    if payload.get("id"):
        lines.append(f"版本ID: {payload.get('id')}")
    if trained_words:
        lines.append(f"触发词: {', '.join(str(word) for word in trained_words)}")
    if image and image.get("url"):
        lines.append(f"预览图: {image.get('url')}")

    if prompt:
        lines.extend(["", "Prompt:", str(prompt)])
    if negative_prompt:
        lines.extend(["", "Negative Prompt:", str(negative_prompt)])

    excluded = {"prompt", "negativePrompt"}
    extra_items = [(key, value) for key, value in meta.items() if key not in excluded and value not in (None, "")]
    if extra_items:
        lines.append("")
        lines.append("生成参数:")
        for key, value in extra_items:
            lines.append(f"{key}: {_format_meta_value(value)}")

    description = payload.get("description")
    if description:
        lines.extend(["", "版本说明:", str(description)])

    return "\n".join(lines).strip() + "\n"


async def _civitai_get_json(session, path):
    errors = []
    connection_failed = False
    not_found_seen = False
    transient_statuses = {403, 408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527}
    for mirror in CIVITAI_API_MIRRORS:
        url = f"{mirror}{path}"
        try:
            async with session.get(url) as response:
                if response.status == 200:
                    return await response.json()

                message = await response.text()
                errors.append(f"{mirror}: HTTP {response.status}")
                if response.status == 404:
                    not_found_seen = True
                    continue
                if response.status in transient_statuses:
                    connection_failed = True
                    continue
                raise web.HTTPBadGateway(text=f"Civitai 请求失败: HTTP {response.status} {message[:240]}")
        except (ClientError, TimeoutError, asyncio.TimeoutError) as error:
            connection_failed = True
            errors.append(f"{mirror}: {error}")
            continue

    if not_found_seen:
        raise web.HTTPNotFound(text="Civitai 未找到匹配信息。部分镜像可能不可用，但可用镜像返回的是未收录/未匹配；可以填入 Civitai URL/ID 手动绑定。")
    if connection_failed:
        raise web.HTTPBadGateway(text=f"Civitai API 镜像连接失败。已尝试: {', '.join(errors)}")
    raise web.HTTPNotFound(text=f"Civitai 未找到匹配信息。已尝试: {', '.join(errors)}")


async def _fetch_civitai_version_by_hash(session, hash_values):
    attempted = []
    for hash_value in hash_values:
        for variant in (hash_value, hash_value.lower()):
            if variant in attempted:
                continue
            attempted.append(variant)
            try:
                return await _civitai_get_json(session, f"/api/v1/model-versions/by-hash/{variant}")
            except web.HTTPNotFound:
                continue

    raise web.HTTPNotFound(text=f"Civitai 未找到相同模型。已尝试 {len(attempted)} 个常见 hash；如果 C 站文件 hash 记录不一致，请填入 Civitai URL/ID 手动绑定。")


def _parse_civitai_input(value):
    value = (value or "").strip()
    if not value:
        return None, ""
    if value.isdigit():
        return "model", value

    parsed = urlparse(value)
    query = parse_qs(parsed.query)
    version_id = (query.get("modelVersionId") or [""])[0]
    if version_id.isdigit():
        return "version", version_id

    parts = [part for part in parsed.path.split("/") if part]
    for index, part in enumerate(parts):
        if part == "models" and index + 1 < len(parts) and parts[index + 1].isdigit():
            return "model", parts[index + 1]
        if part == "model-versions" and index + 1 < len(parts) and parts[index + 1].isdigit():
            return "version", parts[index + 1]

    return None, ""


async def _fetch_civitai_version_by_input(session, value):
    kind, item_id = _parse_civitai_input(value)
    if not kind or not item_id:
        raise web.HTTPBadRequest(text="Civitai URL/ID 无效")

    if kind == "version":
        return await _civitai_get_json(session, f"/api/v1/model-versions/{item_id}")

    model_info = await _civitai_get_json(session, f"/api/v1/models/{item_id}")
    versions = model_info.get("modelVersions") or []
    if not versions:
        raise web.HTTPNotFound(text="Civitai 模型没有可用版本信息")

    version_info = versions[0]
    version_info["model"] = {
        "id": model_info.get("id"),
        "name": model_info.get("name"),
        "type": model_info.get("type"),
        "creator": model_info.get("creator"),
        "tags": model_info.get("tags"),
    }
    return version_info


async def _download_civitai_image(session, image, model_path):
    if not image or not image.get("url"):
        return None

    urls = [image["url"]]
    if "/original=true/" in image["url"]:
        urls.append(re.sub(r"/original=true/", "/width=1024/", image["url"]))
        urls.append(re.sub(r"/original=true/", "/width=450/", image["url"]))

    last_error = ""
    for image_url in dict.fromkeys(urls):
        try:
            async with session.get(image_url) as response:
                if response.status >= 400:
                    last_error = f"HTTP {response.status}"
                    continue

                ext = _image_extension(image_url, response.headers.get("Content-Type"))
                target = f"{os.path.splitext(model_path)[0]}{ext}"
                temp_target = f"{target}.tmp"
                downloaded = 0

                try:
                    with open(temp_target, "wb") as file:
                        async for chunk in response.content.iter_chunked(1024 * 256):
                            downloaded += len(chunk)
                            if downloaded > CIVITAI_IMAGE_LIMIT:
                                raise web.HTTPBadGateway(text="Civitai 图片过大，已取消下载")
                            file.write(chunk)

                    os.replace(temp_target, target)
                except Exception:
                    try:
                        if os.path.exists(temp_target):
                            os.remove(temp_target)
                    finally:
                        raise
                return _safe_realpath(target)
        except (ClientError, TimeoutError, asyncio.TimeoutError) as error:
            last_error = str(error)
            continue

    raise web.HTTPBadGateway(text=f"Civitai 图片下载失败: {last_error or '所有图片地址均不可用'}")


async def _civitai_route(request):
    model_path = _decode_preview_token(request.match_info.get("token", ""))
    if Path(model_path).suffix.lower() not in MODEL_EXTENSIONS:
        raise web.HTTPNotFound()

    roots = _model_roots()
    if not os.path.isfile(model_path) or not _is_inside(model_path, roots):
        raise web.HTTPNotFound()

    try:
        try:
            body = await request.json()
        except Exception:
            body = {}

        civitai_input = str(body.get("model_url_or_id") or "").strip()
        sha256 = ""
        timeout = ClientTimeout(total=CIVITAI_TIMEOUT_SECONDS, connect=12, sock_connect=12, sock_read=30)
        async with ClientSession(timeout=timeout, headers=CIVITAI_HEADERS, trust_env=True) as session:
            if civitai_input:
                payload = await _fetch_civitai_version_by_input(session, civitai_input)
                sha256, _hash_values = await asyncio.to_thread(_hash_candidates, model_path)
            else:
                sha256, hash_values = await asyncio.to_thread(_hash_candidates, model_path)
                payload = await _fetch_civitai_version_by_hash(session, hash_values)
            image = _first_civitai_image(payload)
            image_error = ""
            try:
                image_path = await _download_civitai_image(session, image, model_path)
            except web.HTTPException as error:
                image_path = None
                image_error = getattr(error, "text", str(error))
                print(f"[Comfyui-MK-Theme] Civitai image download failed for {os.path.basename(model_path)}: {image_error}")

        info_text = _format_civitai_info(model_path, sha256, payload, image)
        info_path = f"{os.path.splitext(model_path)[0]}.txt"
        with open(info_path, "w", encoding="utf-8") as file:
            file.write(info_text)
    except web.HTTPException as error:
        print(f"[Comfyui-MK-Theme] Civitai download failed for {os.path.basename(model_path)}: {getattr(error, 'text', error)}")
        raise
    except (ClientError, OSError, TimeoutError) as error:
        print(f"[Comfyui-MK-Theme] Civitai download failed for {os.path.basename(model_path)}: {error}")
        raise web.HTTPBadGateway(text=f"Civitai 信息下载失败: {error}") from error

    return web.json_response({
        "text": info_text,
        "info_url": f"/mk-theme/model-manager/info/{_preview_token(info_path)}",
        "preview_url": f"/mk-theme/model-manager/preview/{_preview_token(image_path)}" if image_path else None,
        "saved_image": os.path.basename(image_path) if image_path else "",
        "saved_info": os.path.basename(info_path),
        "image_error": image_error,
    })


def register_model_manager_routes():
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED:
        return

    routes = PromptServer.instance.routes
    routes.get("/mk-theme/model-manager/models")(_models_route)
    routes.get("/mk-theme/model-manager/preview/{token}")(_preview_route)
    routes.get("/mk-theme/model-manager/info/{token}")(_info_route)
    routes.post("/mk-theme/model-manager/save-info/{token}")(_save_info_route)
    routes.post("/mk-theme/model-manager/upload-preview/{token}")(_upload_preview_route)
    routes.post("/mk-theme/model-manager/civitai/{token}")(_civitai_route)
    _ROUTES_REGISTERED = True
    print("[Comfyui-MK-Theme] Model manager routes registered")
