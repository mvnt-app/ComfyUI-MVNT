"""ComfyUI custom nodes for the MVNT Motion API."""

import os
import re
import math
import tempfile
import folder_paths
import numpy as np
import torch

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
        joints, hierarchy, frames_raw = _parse_bvh(motion_data)
        parent_map = _build_parent_map(joints, hierarchy)

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
        for pos in all_pos:
            img = np.tile(bg, (height, width, 1))
            proj = _project(pos, center, span, width, height)
            for i, pi in enumerate(parent_map):
                if pi >= 0:
                    _draw_line(img, proj[pi], proj[i], sk, line_width)
            r = max(line_width, 2)
            for pt in proj:
                _draw_circle(img, pt, r, jc)
            images.append(img)

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
