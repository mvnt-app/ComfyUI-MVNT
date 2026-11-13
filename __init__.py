"""ComfyUI-MVNT: AI dance choreography from music (compact v1)."""

from .nodes import (
    MVNTAudioSegment,
    MVNTListStyles,
    MVNTGenerateDance,
    MVNTRenderDanceVideo,
    MVNTPreviewDance3D,
)

NODE_CLASS_MAPPINGS = {
    "MVNT Audio Segment": MVNTAudioSegment,
    "MVNT List Styles": MVNTListStyles,
    "MVNT Generate Dance": MVNTGenerateDance,
    "MVNT Render Dance Video": MVNTRenderDanceVideo,
    "MVNTPreviewDance3D": MVNTPreviewDance3D,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MVNT Audio Segment": "MVNT Audio Segment",
    "MVNT List Styles": "MVNT List Styles",
    "MVNT Generate Dance": "MVNT Generate Dance",
    "MVNT Render Dance Video": "MVNT Render Dance Video",
    "MVNTPreviewDance3D": "MVNT Preview Dance 3D",
}

WEB_DIRECTORY = "./js"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
