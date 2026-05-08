"""ComfyUI-MVNT: AI dance choreography from music."""

from .nodes import (
    MVNTAudioSegment,
    MVNTImageToTPose,
    MVNTGenerateDance,
    MVNTPreviewDance3D,
    MVNTListStyles,
    MVNTEstimateCost,
    MVNTGenerateCharacter,
    MVNTExportVideo,
    MVNTLoadMotion,
    MVNTPreviewBVH,
)

NODE_CLASS_MAPPINGS = {
    "MVNT Audio Segment": MVNTAudioSegment,
    "MVNT Image to T-Pose": MVNTImageToTPose,
    "MVNT Generate Dance": MVNTGenerateDance,
    "MVNTPreviewDance3D": MVNTPreviewDance3D,
    "MVNT List Styles": MVNTListStyles,
    "MVNT Estimate Cost": MVNTEstimateCost,
    "MVNT Generate Character": MVNTGenerateCharacter,
    "MVNT Export Video": MVNTExportVideo,
    "MVNT Load Motion": MVNTLoadMotion,
    "MVNT Preview BVH": MVNTPreviewBVH,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MVNT Audio Segment": "MVNT Audio Segment",
    "MVNT Image to T-Pose": "MVNT Image to T-Pose",
    "MVNT Generate Dance": "MVNT Generate Dance",
    "MVNTPreviewDance3D": "MVNT Preview Dance 3D",
    "MVNT List Styles": "MVNT List Styles",
    "MVNT Estimate Cost": "MVNT Estimate Cost",
    "MVNT Generate Character": "MVNT Generate Character",
    "MVNT Export Video": "MVNT Export Video",
    "MVNT Load Motion": "MVNT Load Motion",
    "MVNT Preview BVH": "MVNT Preview BVH",
}

WEB_DIRECTORY = "./js"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
