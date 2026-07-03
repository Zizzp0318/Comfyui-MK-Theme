NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./js"

from .model_manager import register_model_manager_routes

register_model_manager_routes()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

print("[Comfyui-MK-Theme] Loaded: align guides, group styling, image hover previews, floating node tools, and model manager")
