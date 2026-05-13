"""ComfyUI custom nodes for the MVNT Motion API."""

import os
import re
import math
import json
import tempfile
import uuid
import folder_paths
import numpy as np
import torch
from comfy.utils import ProgressBar

from . import mvnt_client

try:
    from comfy_api.latest import IO, UI, Types, InputImpl
except Exception:
    IO = None
    UI = None
    Types = None
    InputImpl = None

MVNTPreviewBase = IO.ComfyNode if IO is not None else object

MAX_AUDIO_SECONDS = 40.0


def _progress_bar(total=100):
    return ProgressBar(total)


def _set_progress(progress, value):
    try:
        current = int(max(0, min(100, round(float(value)))))
    except (TypeError, ValueError):
        return
    progress.update_absolute(current)


def _progress_mapper(progress, start=0, end=100):
    span = max(0, end - start)

    def on_progress(value):
        try:
            server_progress = float(str(value).strip().rstrip("%"))
        except (TypeError, ValueError):
            return
        if server_progress <= 1:
            server_progress *= 100
        _set_progress(progress, start + server_progress * span / 100.0)

    return on_progress


MVNT_STYLE_CHOICES = [
    "#K-Pop / All",
    "#K-Pop / Boy",
    "#K-Pop / Girl",
    "#Challenge",
    "#Poppin",
    "#Hip-hop",
    "#Krump",
    "#Jazz",
]

MVNT_STYLE_TOKEN_MAP = {
    "#K-Pop / All": "All",
    "#K-Pop / Boy": "Male",
    "#K-Pop / Girl": "Female",
    "#Challenge": "gCHL",
    "#Poppin": "gPO",
    "#Hip-hop": "gLH",
    "#Krump": "gKR",
    "#Jazz": "gJZ",
    # Backwards compatibility for older saved workflows.
    "All": "All",
    "Male": "Male",
    "Female": "Female",
    "gKP": "All",
    "gCHL": "gCHL",
    "gPO": "gPO",
    "gLH": "gLH",
    "gKR": "gKR",
    "gJZ": "gJZ",
}


def _mvnt_style_token(style: str) -> str:
    return MVNT_STYLE_TOKEN_MAP.get(str(style or "").strip(), "All")


# ---------------------------------------------------------------------------
# Audio Segment
# ---------------------------------------------------------------------------

class MVNTAudioSegment:
    """Trim audio to a MVNT-ready segment with a 40 second maximum."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO", {
                    "tooltip": "Input audio to trim before sending to MVNT."
                }),
                "start_sec": ("FLOAT", {
                    "default": 0.0,
                    "min": 0.0,
                    "max": 3600.0,
                    "step": 0.1,
                    "tooltip": "Start time, in seconds, where the MVNT-ready audio segment begins.",
                }),
                "duration_sec": ("FLOAT", {
                    "default": 20.0,
                    "min": 0.1,
                    "max": MAX_AUDIO_SECONDS,
                    "step": 0.1,
                    "tooltip": "Length, in seconds, of the audio segment to keep; values are clamped to the MVNT maximum.",
                }),
            },
        }

    RETURN_TYPES = ("AUDIO", "STRING")
    RETURN_NAMES = ("audio", "segment_info")
    OUTPUT_TOOLTIPS = (
        "Trimmed audio segment ready to use as MVNT generation input.",
        "JSON metadata describing the selected segment timing and duration.",
    )
    FUNCTION = "trim"
    CATEGORY = "MVNT"
    DESCRIPTION = "Choose the audio segment MVNT should use. Duration is clamped to 40 seconds."

    def trim(self, audio, start_sec=0.0, duration_sec=20.0):
        import torch

        progress = _progress_bar()
        _set_progress(progress, 10)
        waveform = audio["waveform"]
        sample_rate = int(audio["sample_rate"])
        total_samples = _audio_sample_count(waveform)
        total_sec = total_samples / float(sample_rate) if sample_rate > 0 else 0.0

        start = max(0.0, min(float(start_sec), total_sec))
        duration = max(0.1, min(float(duration_sec), MAX_AUDIO_SECONDS))
        end = min(start + duration, total_sec)
        if end <= start:
            start = max(0.0, total_sec - min(MAX_AUDIO_SECONDS, total_sec))
            end = total_sec

        start_sample = int(round(start * sample_rate))
        end_sample = max(start_sample + 1, int(round(end * sample_rate)))

        if isinstance(waveform, torch.Tensor):
            trimmed = waveform[..., start_sample:end_sample].clone()
        else:
            trimmed = waveform[..., start_sample:end_sample]
        _set_progress(progress, 80)

        info = {
            "total_sec": round(total_sec, 3),
            "start_sec": round(start, 3),
            "end_sec": round(end, 3),
            "duration_sec": round(end - start, 3),
            "max_duration_sec": MAX_AUDIO_SECONDS,
        }
        _set_progress(progress, 100)
        return ({"waveform": trimmed, "sample_rate": sample_rate}, json.dumps(info, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Image to T-Pose
# ---------------------------------------------------------------------------

class MVNTImageToTPose:
    """Convert a character image into a T-pose image using Tripo's image regeneration."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "source_image": ("IMAGE", {
                    "tooltip": "Character image to regenerate into a front-facing T-pose."
                }),
            },
            "optional": {
                "prompt": (
                    "STRING",
                    {
                        "default": "full body, front view",
                        "multiline": True,
                        "tooltip": "Optional text guidance for the T-pose regeneration, such as pose or framing hints.",
                    },
                ),
                "tripo_api_key": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "Optional Tripo API key; leave blank to use the configured environment or server default.",
                }),
                "tripo_api_base": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "Optional Tripo API base URL for custom or proxy deployments; leave blank for the default endpoint.",
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("tpose_image", "tpose_image_file", "tpose_job_id")
    FUNCTION = "generate"
    CATEGORY = "MVNT"
    DESCRIPTION = "Source character image -> T-pose character image. The T-pose regeneration is handled internally."

    def generate(
        self,
        source_image,
        prompt="",
        tripo_api_key="",
        tripo_api_base="",
    ):
        progress = _progress_bar()
        _set_progress(progress, 5)
        source_path = _save_image_to_temp(source_image)
        try:
            _set_progress(progress, 12)
            task_id = mvnt_client.create_tripo_tpose_image(
                source_path,
                api_key=tripo_api_key or None,
                api_base=tripo_api_base or None,
                prompt=prompt,
            )
            _set_progress(progress, 25)
            completed = mvnt_client.poll_tripo_task(
                task_id,
                api_key=tripo_api_key or None,
                api_base=tripo_api_base or None,
                on_progress=_progress_mapper(progress, 25, 80),
            )
            output_url = _first_tpose_output_url(completed)

            if not output_url:
                raise RuntimeError(f"Tripo T-pose image task did not include an output image URL: {completed}")

            out_dir = folder_paths.get_output_directory()
            file_id = task_id or "result"
            tpose_image_file = os.path.join(out_dir, f"mvnt_tpose_{file_id}.png")
            _set_progress(progress, 88)
            mvnt_client.download_file_url(
                output_url,
                tpose_image_file,
            )

            _set_progress(progress, 100)
            return (_load_image_file(tpose_image_file), tpose_image_file, task_id)
        finally:
            if source_path and os.path.exists(source_path):
                os.remove(source_path)


# ---------------------------------------------------------------------------
# Generate Dance Motion
# ---------------------------------------------------------------------------

class MVNTGenerateDance:
    """Generate MVNT dance output from music, with optional Tripo-style character input."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO", {
                    "tooltip": "Audio clip that drives the generated dance motion and preview video."
                }),
                "style": (MVNT_STYLE_CHOICES, {
                    "default": "#K-Pop / All",
                    "tooltip": "Dance style preset to request from MVNT for the generated motion.",
                }),
            },
            "optional": {
                "character_glb": ("*", {
                    "tooltip": "Optional character GLB/model to retarget the generated dance motion onto."
                }),
                "video_profile": (["pretty", "kling"], {
                    "default": "pretty",
                    "tooltip": "Rendering profile used when downloading the generated MP4 dance preview.",
                }),
                "api_key": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "Optional MVNT API key; leave blank to use the configured environment or server default.",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "VIDEO")
    RETURN_NAMES = (
        "dance_3d",
        "dance_video",
    )
    OUTPUT_TOOLTIPS = (
        "Local path to the generated or retargeted dance GLB for 3D preview and downstream use.",
        "Generated MP4 dance preview loaded as a ComfyUI video output.",
    )
    FUNCTION = "generate"
    CATEGORY = "MVNT"
    DESCRIPTION = (
        "Generate dance from audio. If a compatible Tripo GLB is connected, MVNT will try to retarget the dance to that character."
    )

    def generate(
        self,
        audio,
        style="All",
        character_glb=None,
        video_profile="pretty",
        api_key="",
    ):
        progress = _progress_bar()
        _set_progress(progress, 1)
        audio_path = _save_audio_to_temp(audio)
        print(f"[MVNT Generate Dance] raw character_glb={character_glb!r}")
        character_path = _coerce_optional_file_path(character_glb)
        print(f"[MVNT Generate Dance] resolved character_path={character_path!r}")
        if character_glb and not character_path:
            raise RuntimeError(f"character_glb was connected, but MVNT could not resolve it to a local file path: {character_glb!r}")
        if character_path:
            print(f"[MVNT Generate Dance] character_glb resolved: {character_path}")

        try:
            _set_progress(progress, 5)
            result = mvnt_client.create_generation(
                audio_path,
                api_key=api_key or None,
                api_base=None,
                character_path=None,
                style=_mvnt_style_token(style),
                output_format="glb",
                output_mode="both",
                preview_style="mannequin",
                seed=-1,
                guidance=2.0,
                temperature=1.2,
                mode="standard",
                save_hard_yaw_lock_variant=True,
                trim_start=0.0,
                trim_end=0.0,
            )
            gen_id = mvnt_client.generation_id_from_response(result)
            _set_progress(progress, 10)

            mvnt_client.poll_generation(
                gen_id,
                api_key=api_key or None,
                api_base=None,
                on_progress=_progress_mapper(progress, 10, 80),
            )
            _set_progress(progress, 80)

            out_dir = folder_paths.get_output_directory()
            motion_glb_path = os.path.join(out_dir, f"mvnt_{gen_id}.motion.glb")

            motion_glb = _download_glb_output(
                gen_id,
                motion_glb_path,
                api_key=api_key or None,
                api_base=None,
            )
            _set_progress(progress, 88)

            if not motion_glb:
                raise RuntimeError(
                    "MVNT did not return a GLB output for this generation. "
                    "The Comfy 3D preview expects GLB, so FBX/BVH fallback is not returned as dance_3d."
                )

            dance_3d = motion_glb
            if character_path:
                retargeted_glb_path = os.path.join(out_dir, f"mvnt_{gen_id}.tripo_retargeted.glb")
                print(
                    f"[MVNT Generate Dance] retargeting motion_glb={motion_glb} "
                    f"character_glb={character_path} -> {retargeted_glb_path}"
                )
                dance_3d = mvnt_client.retarget_tripo_glb(
                    motion_glb,
                    character_path,
                    retargeted_glb_path,
                    api_key=api_key or None,
                    api_base=None,
                )
                _set_progress(progress, 94)

            dance_video_path = os.path.join(out_dir, f"mvnt_{gen_id}.dance.mp4")
            dance_video_path = _download_video_output(
                gen_id,
                dance_video_path,
                api_key=api_key or None,
                api_base=None,
                video_profile=video_profile,
            )
            _set_progress(progress, 98)

            if not dance_video_path:
                raise RuntimeError(
                    "MVNT did not return an MP4 dance_video output. "
                    "The backend must expose /render-mp4-lda or a v1 render output for Comfy video export."
                )
            if InputImpl is None:
                raise RuntimeError("Comfy Video API is unavailable in this ComfyUI build.")
            dance_video = InputImpl.VideoFromFile(dance_video_path)

            _set_progress(progress, 100)
            return (
                dance_3d,
                dance_video,
            )
        finally:
            if os.path.exists(audio_path):
                os.remove(audio_path)


# ---------------------------------------------------------------------------
# Preview Dance 3D + Audio
# ---------------------------------------------------------------------------

class MVNTPreviewDance3D(MVNTPreviewBase):
    """Preview an animated GLB with the source audio using Comfy's built-in preview UIs."""

    @classmethod
    def define_schema(cls):
        if IO is None:
            raise RuntimeError("Comfy IO API is unavailable in this ComfyUI build.")
        return IO.Schema(
            node_id="MVNTPreviewDance3D",
            display_name="MVNT Preview Dance 3D",
            category="MVNT",
            is_output_node=True,
            inputs=[
                IO.MultiType.Input(
                    IO.String.Input("model_file", default="", multiline=False),
                    types=[
                        IO.File3DGLB,
                        IO.File3DGLTF,
                        IO.File3DFBX,
                        IO.File3DAny,
                    ],
                    tooltip="Animated GLB or model file to display, usually the dance_3d output from MVNT Generate Dance.",
                ),
                IO.Audio.Input(
                    "audio",
                    optional=True,
                    tooltip="Optional source audio to play alongside the 3D dance preview.",
                ),
                IO.Load3DCamera.Input(
                    "camera_info",
                    optional=True,
                    advanced=True,
                    tooltip="Optional saved 3D camera settings used to initialize the preview view.",
                ),
                IO.Image.Input(
                    "bg_image",
                    optional=True,
                    advanced=True,
                    tooltip="Optional background image displayed behind the 3D preview.",
                ),
            ],
            outputs=[],
            description="Show MVNT animated GLB and audio together using Comfy's existing 3D and audio preview UI.",
        )

    @classmethod
    def execute(cls, model_file: str, audio=None, **kwargs):
        if UI is None or Types is None:
            raise RuntimeError("Comfy PreviewUI3D/PreviewAudio API is unavailable in this ComfyUI build.")
        if isinstance(model_file, Types.File3D):
            filename = f"mvnt_preview3d_{uuid.uuid4().hex}.{model_file.format or 'glb'}"
            model_path = model_file.save_to(os.path.join(folder_paths.get_output_directory(), filename))
        else:
            model_path = _coerce_optional_file_path(model_file)
        if not model_path:
            raise FileNotFoundError(f"model_file GLB path was not found: {model_file!r}")

        camera_info = kwargs.get("camera_info", None)
        bg_image = kwargs.get("bg_image", None)
        audio_ui = UI.PreviewAudio(audio, cls=cls).as_dict().get("audio", []) if audio is not None else []
        ui = {}
        ui.update(UI.PreviewUI3D(model_path, camera_info, bg_image=bg_image).as_dict())
        ui["mvnt_preview"] = [{
            "model_file": model_path,
            "audio": audio_ui,
        }]
        return IO.NodeOutput(ui=ui)

    process = execute


# ---------------------------------------------------------------------------
# List Dance Styles
# ---------------------------------------------------------------------------

class MVNTListStyles:
    """Fetch available dance styles from the MVNT API."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "api_key": ("STRING", {"default": "", "multiline": False}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("styles_json",)
    FUNCTION = "list_styles"
    CATEGORY = "MVNT"
    DESCRIPTION = "List all available dance styles from the MVNT API."

    def list_styles(self, api_key=""):
        import json
        progress = _progress_bar()
        _set_progress(progress, 10)
        styles = mvnt_client.list_styles(api_key=api_key or None)
        _set_progress(progress, 100)
        return (json.dumps(styles, indent=2),)


# ---------------------------------------------------------------------------
# Estimate Cost
# ---------------------------------------------------------------------------

class MVNTEstimateCost:
    """Estimate the cost/time for a motion generation."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio_duration": ("FLOAT", {"default": 30.0, "min": 1.0, "max": 180.0, "step": 0.1}),
            },
            "optional": {
                "api_key": ("STRING", {"default": "", "multiline": False}),
                "api_base": ("STRING", {"default": "", "multiline": False}),
                "output_format": (["bvh", "fbx"], {"default": "bvh"}),
                "output_mode": (["both", "3d", "video", "motion_only"], {"default": "both"}),
                "has_character": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("estimate_json",)
    FUNCTION = "estimate"
    CATEGORY = "MVNT"
    DESCRIPTION = "Estimate the cost and generation time for a given audio duration."

    def estimate(self, audio_duration, api_key="", api_base="", output_format="bvh", output_mode="both", has_character=False):
        progress = _progress_bar()
        _set_progress(progress, 10)
        result = mvnt_client.estimate_cost(
            audio_duration,
            api_key=api_key or None,
            api_base=api_base or None,
            output_format=output_format,
            output_mode=output_mode,
            has_character=has_character,
        )
        _set_progress(progress, 100)
        return (json.dumps(result, indent=2, ensure_ascii=False),)


# ---------------------------------------------------------------------------
# Generate 3D Character
# ---------------------------------------------------------------------------

class MVNTGenerateCharacter:
    """Generate a T-pose rigged 3D character (GLB) from an image or text prompt."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "image": ("IMAGE",),
                "prompt": ("STRING", {"default": "", "multiline": True}),
                "negative_prompt": ("STRING", {"default": "", "multiline": True}),
                "api_key": ("STRING", {"default": "", "multiline": False}),
                "t_pose": ("BOOLEAN", {"default": True}),
                "model_version": (["v3.0-20250812", "Turbo-v1.0-20250506"], {"default": "v3.0-20250812"}),
                "rigging": ("BOOLEAN", {"default": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("character_glb", "character_file_url", "character_id")
    OUTPUT_TOOLTIPS = (
        "Local path to the generated rigged character GLB for preview or dance retargeting.",
        "Remote MVNT output URL used to download the generated character file.",
        "MVNT character generation job identifier for tracking or debugging.",
    )
    FUNCTION = "generate"
    CATEGORY = "MVNT"
    DESCRIPTION = "Generate a T-pose rigged character GLB from an image or prompt. The local GLB output can feed MVNT Generate Dance."

    def generate(
        self,
        image=None,
        prompt="",
        negative_prompt="",
        api_key="",
        t_pose=True,
        model_version="v3.0-20250812",
        rigging=True,
    ):
        progress = _progress_bar()
        _set_progress(progress, 5)
        image_path = None
        if image is not None:
            image_path = _save_image_to_temp(image)

        if not image_path and not prompt:
            raise ValueError("Provide either an image or a text prompt.")

        try:
            _set_progress(progress, 15)
            result = mvnt_client.create_character(
                api_key=api_key or None,
                image_path=image_path,
                prompt=prompt or None,
                negative_prompt=negative_prompt,
                t_pose=t_pose,
                model_version=model_version,
                rigging=rigging,
            )
            char_id = result["id"]
            _set_progress(progress, 25)

            completed = mvnt_client.poll_character(
                char_id,
                api_key=api_key or None,
                on_progress=_progress_mapper(progress, 25, 82),
            )
            output_url = _first_character_output_url(completed)
            character_glb = ""
            if output_url:
                out_dir = folder_paths.get_output_directory()
                character_glb = os.path.join(out_dir, f"mvnt_character_{char_id}.glb")
                _set_progress(progress, 90)
                mvnt_client.download_file_url(
                    output_url,
                    character_glb,
                    api_key=api_key or None,
                )
            _set_progress(progress, 100)
            return (character_glb, output_url, char_id)
        finally:
            if image_path and os.path.exists(image_path):
                os.remove(image_path)


# ---------------------------------------------------------------------------
# Export AI Video (Motion Transfer)
# ---------------------------------------------------------------------------

class MVNTExportVideo:
    """Create a photorealistic motion-transfer video via MVNT + Kling AI."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_url": ("STRING", {"default": "", "multiline": False}),
                "video_url": ("STRING", {"default": "", "multiline": False}),
            },
            "optional": {
                "api_key": ("STRING", {"default": "", "multiline": False}),
                "prompt": ("STRING", {"default": "", "multiline": True}),
                "character_orientation": (["video", "image"], {"default": "video"}),
                "keep_original_sound": ("BOOLEAN", {"default": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("video_urls_json", "video_id")
    FUNCTION = "export"
    CATEGORY = "MVNT"
    DESCRIPTION = "Transfer dance motion onto a character image, producing a photorealistic AI video."

    def export(
        self,
        image_url,
        video_url,
        api_key="",
        prompt="",
        character_orientation="video",
        keep_original_sound=True,
    ):
        import json
        progress = _progress_bar()
        _set_progress(progress, 10)
        result = mvnt_client.create_video(
            api_key=api_key or None,
            image_url=image_url,
            video_url=video_url,
            prompt=prompt,
            character_orientation=character_orientation,
            keep_original_sound=keep_original_sound,
        )
        vid_id = result["id"]
        _set_progress(progress, 25)

        completed = mvnt_client.poll_video(
            vid_id,
            api_key=api_key or None,
            on_progress=_progress_mapper(progress, 25, 95),
        )
        urls = completed.get("output_urls", [])
        _set_progress(progress, 100)
        return (json.dumps(urls), vid_id)


# ---------------------------------------------------------------------------
# Load Motion File (utility node)
# ---------------------------------------------------------------------------

class MVNTLoadMotion:
    """Load a motion file (BVH/FBX/JSON) from disk as a string path.
    Useful for chaining with downstream 3D/animation nodes."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "file_path": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("motion_data",)
    FUNCTION = "load"
    CATEGORY = "MVNT"
    DESCRIPTION = "Read a motion file from disk and return its contents as a string."

    def load(self, file_path):
        progress = _progress_bar()
        _set_progress(progress, 20)
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Motion file not found: {file_path}")
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            data = f.read()
        _set_progress(progress, 100)
        return (data,)


# ---------------------------------------------------------------------------
# BVH Preview (stick-figure render → IMAGE tensor)
# ---------------------------------------------------------------------------

class MVNTPreviewBVH:
    """
    Render stick-figure frames from BVH motion data as IMAGE tensors.
    Pipe output into PreviewImage, SaveImage, or video nodes.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "motion_data": ("STRING",),
            },
            "optional": {
                "width": ("INT", {"default": 512, "min": 128, "max": 2048, "step": 64}),
                "height": ("INT", {"default": 512, "min": 128, "max": 2048, "step": 64}),
                "fps_divisor": ("INT", {"default": 2, "min": 1, "max": 30}),
                "line_width": ("INT", {"default": 3, "min": 1, "max": 10}),
                "bg_color": (["black", "white"], {"default": "black"}),
                "skeleton_color": (["cyan", "white", "green", "magenta", "yellow"], {"default": "cyan"}),
                "joint_color": (["white", "red", "yellow", "orange"], {"default": "white"}),
                "max_frames": ("INT", {"default": 300, "min": 1, "max": 9999}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("frames",)
    FUNCTION = "render"
    CATEGORY = "MVNT"
    DESCRIPTION = (
        "Render a stick-figure animation preview from BVH motion data. "
        "Outputs IMAGE frames for PreviewImage, video compositing, or thumbnails."
    )

    _PALETTE = {
        "black": (0.0, 0.0, 0.0), "white": (1.0, 1.0, 1.0),
        "cyan": (0.0, 0.9, 1.0), "green": (0.2, 1.0, 0.4),
        "magenta": (1.0, 0.2, 0.8), "yellow": (1.0, 0.95, 0.2),
        "red": (1.0, 0.2, 0.2), "orange": (1.0, 0.6, 0.1),
    }

    def render(
        self, motion_data, width=512, height=512, fps_divisor=2,
        line_width=3, bg_color="black", skeleton_color="cyan",
        joint_color="white", max_frames=300,
    ):
        progress = _progress_bar()
        _set_progress(progress, 5)
        joints, hierarchy, frames_raw = _parse_bvh(motion_data)
        parent_map = _build_parent_map(joints, hierarchy)
        _set_progress(progress, 15)

        indices = list(range(0, len(frames_raw), fps_divisor))[:max_frames] or [0]

        bg = np.array(self._PALETTE.get(bg_color, (0, 0, 0)), dtype=np.float32)
        sk = np.array(self._PALETTE.get(skeleton_color, (0, 0.9, 1)), dtype=np.float32)
        jc = np.array(self._PALETTE.get(joint_color, (1, 1, 1)), dtype=np.float32)

        all_pos = [_forward_kinematics(joints, hierarchy, frames_raw[i]) for i in indices]
        flat = np.concatenate(all_pos, axis=0)
        center = flat.mean(axis=0)
        span = max(flat.max(axis=0) - flat.min(axis=0)) * 0.6
        if span < 1e-6:
            span = 100.0

        images = []
        total = max(1, len(all_pos))
        for idx, pos in enumerate(all_pos):
            img = np.tile(bg, (height, width, 1))
            proj = _project(pos, center, span, width, height)
            for i, pi in enumerate(parent_map):
                if pi >= 0:
                    _draw_line(img, proj[pi], proj[i], sk, line_width)
            r = max(line_width, 2)
            for pt in proj:
                _draw_circle(img, pt, r, jc)
            images.append(img)
            if idx == 0 or idx == total - 1 or idx % 10 == 0:
                _set_progress(progress, 20 + (idx + 1) * 75 / total)

        _set_progress(progress, 100)
        return (torch.from_numpy(np.stack(images, axis=0)),)


# ---------------------------------------------------------------------------
# BVH parsing helpers
# ---------------------------------------------------------------------------

def _parse_bvh(text):
    lines = text.strip().split("\n")
    joints, hierarchy, stack, channels_order = [], {}, [], []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("ROOT") or line.startswith("JOINT"):
            name = line.split()[-1]
            joints.append(name)
            hierarchy[name] = {
                "parent": stack[-1] if stack else None,
                "offset": (0.0, 0.0, 0.0), "channels": [],
            }
            stack.append(name)
        elif line.startswith("End Site"):
            tag = f"__end_{len(joints)}"
            stack.append(tag)
            i += 1
            while i < len(lines) and "}" not in lines[i]:
                i += 1
            stack.pop()
            i += 1
            continue
        elif line.startswith("OFFSET"):
            vals = [float(x) for x in re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", line)]
            if stack and stack[-1] in hierarchy:
                hierarchy[stack[-1]]["offset"] = tuple(vals[:3]) if len(vals) >= 3 else (0, 0, 0)
        elif line.startswith("CHANNELS"):
            parts = line.split()
            n = int(parts[1])
            ch = parts[2:2 + n]
            if stack and stack[-1] in hierarchy:
                hierarchy[stack[-1]]["channels"] = ch
                channels_order.append((stack[-1], ch))
        elif line == "}":
            if stack:
                stack.pop()
        elif line.startswith("Frame Time:"):
            i += 1
            break
        i += 1
    frames = []
    while i < len(lines):
        line = lines[i].strip()
        if line:
            vals = [float(x) for x in re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", line)]
            if vals:
                frames.append(vals)
        i += 1
    return joints, hierarchy, frames


def _build_parent_map(joints, hierarchy):
    idx = {n: i for i, n in enumerate(joints)}
    return [idx.get(hierarchy[n]["parent"], -1) for n in joints]


def _rot_matrix(deg, axis):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    if axis in "Xx":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis in "Yy":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def _forward_kinematics(joints, hierarchy, frame_vals):
    n = len(joints)
    positions = np.zeros((n, 3))
    rotations = [np.eye(3)] * n
    idx_map = {name: i for i, name in enumerate(joints)}
    vi = 0
    for jname in joints:
        info = hierarchy[jname]
        ch = info["channels"]
        vals = frame_vals[vi:vi + len(ch)]
        vi += len(ch)
        offset = np.array(info["offset"])
        lr = np.eye(3)
        trans = np.zeros(3)
        for c, v in zip(ch, vals):
            cl = c.lower()
            if cl == "xposition": trans[0] = v
            elif cl == "yposition": trans[1] = v
            elif cl == "zposition": trans[2] = v
            elif cl == "xrotation": lr = lr @ _rot_matrix(v, "X")
            elif cl == "yrotation": lr = lr @ _rot_matrix(v, "Y")
            elif cl == "zrotation": lr = lr @ _rot_matrix(v, "Z")
        ji = idx_map[jname]
        p = info["parent"]
        if p and p in idx_map:
            pi = idx_map[p]
            positions[ji] = positions[pi] + rotations[pi] @ (offset + trans)
            rotations[ji] = rotations[pi] @ lr
        else:
            positions[ji] = offset + trans
            rotations[ji] = lr
    return positions


def _project(positions, center, span, w, h):
    proj = np.zeros((len(positions), 2), dtype=np.int32)
    for i, p in enumerate(positions):
        nx = (p[0] - center[0]) / span
        ny = -(p[1] - center[1]) / span
        proj[i] = [int(w * 0.5 + nx * w * 0.4), int(h * 0.5 + ny * h * 0.4)]
    return proj


def _draw_line(img, p0, p1, color, width):
    h, w = img.shape[:2]
    x0, y0, x1, y1 = int(p0[0]), int(p0[1]), int(p1[0]), int(p1[1])
    steps = max(abs(x1 - x0), abs(y1 - y0), 1)
    hw = width // 2
    for s in range(steps + 1):
        t = s / steps
        x, y = int(x0 + t * (x1 - x0)), int(y0 + t * (y1 - y0))
        for ox in range(-hw, hw + 1):
            for oy in range(-hw, hw + 1):
                px, py = x + ox, y + oy
                if 0 <= px < w and 0 <= py < h:
                    img[py, px] = color


def _draw_circle(img, c, r, color):
    h, w = img.shape[:2]
    cx, cy = int(c[0]), int(c[1])
    for ox in range(-r, r + 1):
        for oy in range(-r, r + 1):
            if ox * ox + oy * oy <= r * r:
                px, py = cx + ox, cy + oy
                if 0 <= px < w and 0 <= py < h:
                    img[py, px] = color


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _save_audio_to_temp(audio) -> str:
    """Persist a ComfyUI AUDIO tensor dict to a temporary WAV file.

    MVNT generation is capped to the first 40 seconds. Use ComfyUI's
    TrimAudioDuration node before MVNT Generate Dance to choose a later segment.
    """
    import soundfile as sf
    import torch

    waveform = audio["waveform"]
    sample_rate = audio["sample_rate"]
    max_samples = int(float(sample_rate) * MAX_AUDIO_SECONDS)

    if isinstance(waveform, torch.Tensor):
        waveform = waveform[..., :max_samples]
        if waveform.dim() == 3:
            waveform = waveform.squeeze(0)
        arr = waveform.cpu().numpy().T
    else:
        arr = waveform[:max_samples]

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    sf.write(tmp.name, arr, sample_rate)
    tmp.close()
    return tmp.name


def _audio_sample_count(waveform) -> int:
    if isinstance(waveform, torch.Tensor):
        return int(waveform.shape[-1])
    return int(np.asarray(waveform).shape[-1])


def _save_image_to_temp(image) -> str:
    """Persist a ComfyUI IMAGE tensor to a temporary PNG file."""
    from PIL import Image as PILImage
    import torch

    if isinstance(image, torch.Tensor):
        arr = image.squeeze(0).detach().cpu().numpy()
        arr = np.clip(arr * 255.0, 0, 255).astype(np.uint8)
        pil_img = PILImage.fromarray(arr)
    else:
        pil_img = image

    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    pil_img.save(tmp.name)
    tmp.close()
    return tmp.name


def _load_image_file(path: str):
    """Load an image file as a ComfyUI IMAGE tensor."""
    from PIL import Image as PILImage

    img = PILImage.open(path).convert("RGB")
    arr = np.asarray(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None, ...]


def _coerce_optional_file_path(value) -> str:
    """Best-effort extraction of a file path from Comfy node outputs."""
    if not value:
        return ""
    if hasattr(value, "save_to") and hasattr(value, "format"):
        ext = (getattr(value, "format", "") or "glb").lstrip(".") or "glb"
        out_path = os.path.join(
            folder_paths.get_output_directory(),
            f"mvnt_character_input_{uuid.uuid4().hex}.{ext}",
        )
        return value.save_to(out_path)
    if isinstance(value, str):
        return _resolve_existing_file_path(value)
    if isinstance(value, (list, tuple)):
        for item in value:
            path = _coerce_optional_file_path(item)
            if path:
                return path
        return ""
    if isinstance(value, dict):
        if value.get("filename"):
            filename = value.get("filename")
            subfolder = value.get("subfolder") or ""
            for root in _known_comfy_roots():
                path = os.path.join(root, subfolder, filename)
                if os.path.exists(path):
                    return path
        for key in ("path", "file", "filename", "model_file", "glb", "GLB"):
            path = _coerce_optional_file_path(value.get(key))
            if path:
                return path
    return ""


def _known_comfy_roots():
    roots = []
    for getter in (
        folder_paths.get_output_directory,
        folder_paths.get_input_directory,
        folder_paths.get_temp_directory,
    ):
        try:
            root = getter()
        except Exception:
            continue
        if root and root not in roots:
            roots.append(root)
    return roots


def _resolve_existing_file_path(value: str) -> str:
    if not value:
        return ""
    candidates = [value]
    if not os.path.isabs(value):
        for root in _known_comfy_roots():
            candidates.append(os.path.join(root, value))
            candidates.append(os.path.join(root, os.path.basename(value)))
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return ""


def _looks_like_glb_url(value: str) -> bool:
    """Tripo generate_image 성공 output에 GLB URL이 섞이면 T-pose 래스터로 쓰면 안 된다."""
    if not value or not isinstance(value, str):
        return False
    return value.lower().split("?", 1)[0].endswith(".glb")


def _first_tpose_output_url(data) -> str:
    """Accept common output URL shapes from the T-pose image API."""
    if not isinstance(data, dict):
        return ""
    for key in ("output_url", "image_url", "tpose_image_url", "file_url", "url"):
        value = data.get(key)
        if isinstance(value, str) and value and not _looks_like_glb_url(value):
            return value

    outputs = data.get("outputs") or data.get("output")
    if isinstance(outputs, str) and outputs and not _looks_like_glb_url(outputs):
        return outputs
    if isinstance(outputs, dict):
        for key in (
            "generated_image",
            "image",
            "rendered_image",
            "result_image",
            "tpose_image",
            "png",
            "file",
            "url",
        ):
            value = outputs.get(key)
            if isinstance(value, str) and value and not _looks_like_glb_url(value):
                return value
    if isinstance(outputs, list):
        for item in outputs:
            if isinstance(item, str) and item:
                return item
            if isinstance(item, dict):
                value = _first_tpose_output_url(item)
                if value:
                    return value
    return ""


def _first_character_output_url(data) -> str:
    """Accept a few backend response shapes while the character API stabilizes."""
    if not isinstance(data, dict):
        return ""
    for key in ("output_url", "character_url", "glb_url", "file_url", "url"):
        value = data.get(key)
        if isinstance(value, str) and value:
            return value

    outputs = data.get("outputs")
    if isinstance(outputs, dict):
        for key in ("glb", "character", "model", "file", "url"):
            value = outputs.get(key)
            if isinstance(value, str) and value:
                return value
    if isinstance(outputs, list):
        for item in outputs:
            if isinstance(item, str) and item:
                return item
            if isinstance(item, dict):
                value = _first_character_output_url(item)
                if value:
                    return value
    return ""


def _download_glb_output(gen_id, dest, *, api_key, api_base):
    """Download the previewable motion GLB, trying the API shapes used across MVNT deployments."""
    attempts = (
        {"kind": "3d", "format": "glb", "variant": "hard_yaw_lock"},
        {"kind": "motion", "format": "glb", "variant": "hard_yaw_lock"},
        {"kind": "animated", "format": "glb", "variant": "hard_yaw_lock"},
        {"format": "glb", "variant": "hard_yaw_lock"},
        {"kind": "3d", "format": "glb"},
        {"kind": "motion", "format": "glb"},
        {"kind": "animated", "format": "glb"},
        {"format": "glb"},
    )
    for params in attempts:
        result = mvnt_client.download_generation_output(
            gen_id,
            dest,
            api_key=api_key,
            api_base=api_base,
            allow_missing=True,
            **params,
        )
        if result:
            return result
    return ""


def _download_video_output(gen_id, dest, *, api_key, api_base, video_profile="pretty"):
    """Download the server-rendered MP4 video for the dance output slot."""
    profile = video_profile if video_profile in {"pretty", "kling"} else "pretty"
    attempts = (
        {"kind": "render", "format": "mp4", "render_profile": profile},
        {"kind": "video", "format": "mp4", "render_profile": profile},
        {"kind": "preview", "format": "mp4", "render_profile": profile},
        {"format": "mp4", "render_profile": profile},
    )
    for params in attempts:
        result = mvnt_client.download_generation_output(
            gen_id,
            dest,
            api_key=api_key,
            api_base=api_base,
            allow_missing=True,
            **params,
        )
        if result:
            return result
    return ""


def _download_motion_output(gen_id, dest, *, api_key, api_base, output_format):
    """Try the new output contract first, then fall back to the legacy default route."""
    result = mvnt_client.download_generation_output(
        gen_id,
        dest,
        api_key=api_key,
        api_base=api_base,
        kind="motion",
        format=output_format,
        allow_missing=True,
    )
    if result:
        return result
    if output_format.lower() != "bvh":
        return ""
    return mvnt_client.download_generation_output(
        gen_id,
        dest,
        api_key=api_key,
        api_base=api_base,
    )
