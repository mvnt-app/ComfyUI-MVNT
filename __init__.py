"""ComfyUI-MVNT: AI dance choreography from music."""

from .nodes import (
    MVNTGenerateDance,
    MVNTListStyles,
    MVNTEstimateCost,
    MVNTGenerateCharacter,
    MVNTExportVideo,
    MVNTLoadMotion,
)

NODE_CLASS_MAPPINGS = {
    "MVNT Generate Dance": MVNTGenerateDance,
    "MVNT List Styles": MVNTListStyles,
    "MVNT Estimate Cost": MVNTEstimateCost,
    "MVNT Generate Character": MVNTGenerateCharacter,
    "MVNT Export Video": MVNTExportVideo,
    "MVNT Load Motion": MVNTLoadMotion,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MVNT Generate Dance": "MVNT Generate Dance 💃",
    "MVNT List Styles": "MVNT List Styles",
    "MVNT Estimate Cost": "MVNT Estimate Cost",
    "MVNT Generate Character": "MVNT Generate Character",
    "MVNT Export Video": "MVNT Export Video 🎬",
    "MVNT Load Motion": "MVNT Load Motion",
}

WEB_DIRECTORY = None
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
