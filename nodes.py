"""ComfyUI custom nodes for the MVNT Motion API."""

import os
import tempfile
import folder_paths

from . import mvnt_client


# ---------------------------------------------------------------------------
# Generate Dance Motion
# ---------------------------------------------------------------------------

class MVNTGenerateDance:
    """Submit audio and generate AI dance choreography via MVNT."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO",),
                "style": (["All", "Male", "Female"], {"default": "All"}),
            },
            "optional": {
                "api_key": ("STRING", {"default": "", "multiline": False}),
                "output_format": (["bvh", "fbx", "json"], {"default": "bvh"}),
                "seed": ("INT", {"default": -1, "min": -1, "max": 2**31 - 1}),
                "guidance": ("FLOAT", {"default": 2.0, "min": 0.5, "max": 5.0, "step": 0.1}),
                "temperature": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 2.0, "step": 0.1}),
                "trim_start": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 180.0, "step": 0.1}),
                "trim_end": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 180.0, "step": 0.1}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("motion_file_path", "generation_id")
    FUNCTION = "generate"
    CATEGORY = "MVNT"
    DESCRIPTION = "Generate AI dance choreography from an audio file using MVNT's motion diffusion model."

    def generate(
        self,
        audio,
        style="All",
        api_key="",
        output_format="bvh",
        seed=-1,
        guidance=2.0,
        temperature=1.0,
        trim_start=0.0,
        trim_end=0.0,
    ):
        audio_path = _save_audio_to_temp(audio)

        try:
            result = mvnt_client.create_generation(
                audio_path,
                api_key=api_key or None,
                style=style,
                output_format=output_format,
                seed=seed,
                guidance=guidance,
                temperature=temperature,
                trim_start=trim_start,
                trim_end=trim_end,
            )
            gen_id = result["id"]

            mvnt_client.poll_generation(gen_id, api_key=api_key or None)

            out_dir = folder_paths.get_output_directory()
            dest = os.path.join(out_dir, f"mvnt_{gen_id}.{output_format}")
            mvnt_client.download_generation_output(gen_id, dest, api_key=api_key or None)

            return (dest, gen_id)
        finally:
            if os.path.exists(audio_path):
                os.remove(audio_path)


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
        styles = mvnt_client.list_styles(api_key=api_key or None)
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
                "output_format": (["bvh", "fbx", "json"], {"default": "bvh"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("estimate_json",)
    FUNCTION = "estimate"
    CATEGORY = "MVNT"
    DESCRIPTION = "Estimate the cost and generation time for a given audio duration."

    def estimate(self, audio_duration, api_key="", output_format="bvh"):
        import json
        result = mvnt_client.estimate_cost(
            audio_duration, api_key=api_key or None, output_format=output_format
        )
        return (json.dumps(result, indent=2),)


# ---------------------------------------------------------------------------
# Generate 3D Character
# ---------------------------------------------------------------------------

class MVNTGenerateCharacter:
    """Generate a rigged 3D character (GLB) from an image or text prompt."""

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

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("character_file_url", "character_id")
    FUNCTION = "generate"
    CATEGORY = "MVNT"
    DESCRIPTION = "Generate a rigged 3D character (GLB) from an image or text prompt using MVNT + Tripo AI."

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
        image_path = None
        if image is not None:
            image_path = _save_image_to_temp(image)

        if not image_path and not prompt:
            raise ValueError("Provide either an image or a text prompt.")

        try:
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

            completed = mvnt_client.poll_character(char_id, api_key=api_key or None)
            output_url = completed.get("output_url", "")
            return (output_url, char_id)
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
        result = mvnt_client.create_video(
            api_key=api_key or None,
            image_url=image_url,
            video_url=video_url,
            prompt=prompt,
            character_orientation=character_orientation,
            keep_original_sound=keep_original_sound,
        )
        vid_id = result["id"]

        completed = mvnt_client.poll_video(vid_id, api_key=api_key or None)
        urls = completed.get("output_urls", [])
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
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Motion file not found: {file_path}")
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            data = f.read()
        return (data,)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _save_audio_to_temp(audio) -> str:
    """Persist a ComfyUI AUDIO tensor dict to a temporary WAV file."""
    import soundfile as sf
    import torch

    waveform = audio["waveform"]
    sample_rate = audio["sample_rate"]

    if isinstance(waveform, torch.Tensor):
        if waveform.dim() == 3:
            waveform = waveform.squeeze(0)
        arr = waveform.cpu().numpy().T
    else:
        arr = waveform

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    sf.write(tmp.name, arr, sample_rate)
    tmp.close()
    return tmp.name


def _save_image_to_temp(image) -> str:
    """Persist a ComfyUI IMAGE tensor to a temporary PNG file."""
    from PIL import Image as PILImage
    from torchvision import transforms
    import torch

    if isinstance(image, torch.Tensor):
        img = image.squeeze(0).permute(2, 0, 1)
        pil_img = transforms.ToPILImage()(img)
    else:
        pil_img = image

    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    pil_img.save(tmp.name)
    tmp.close()
    return tmp.name
