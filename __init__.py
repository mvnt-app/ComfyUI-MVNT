"""ComfyUI-MVNT: AI dance choreography from music."""

from .nodes import (
    MVNTAudioSegment,
    MVNTImageToTPose,
    MVNTGenerateDance,
    MVNTPreviewDance3D,
)

NODE_CLASS_MAPPINGS = {
    "MVNT Audio Segment": MVNTAudioSegment,
    "MVNT Image to T-Pose": MVNTImageToTPose,
    "MVNT Generate Dance": MVNTGenerateDance,
    "MVNTPreviewDance3D": MVNTPreviewDance3D,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MVNT Audio Segment": "MVNT Audio Segment",
    "MVNT Image to T-Pose": "MVNT Image to T-Pose",
    "MVNT Generate Dance": "MVNT Generate Dance",
    "MVNTPreviewDance3D": "MVNT Preview Dance 3D",
}

WEB_DIRECTORY = "./js"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
