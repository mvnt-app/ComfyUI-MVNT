"""Lightweight wrapper around the MVNT Motion API (api.mvnt.world/v1)."""

import os
import time
import requests

DEFAULT_BASE_URL = "https://api.mvnt.world/v1"
DEFAULT_POLL_INTERVAL = 3
DEFAULT_TIMEOUT = 600

_USER_AGENT = "comfyui-mvnt/1.0.0"


def _get_api_key(api_key: str | None = None) -> str:
    key = api_key or os.environ.get("MVNT_API_KEY", "")
    if not key:
        raise ValueError(
            "MVNT API key is required. "
            "Set the MVNT_API_KEY environment variable or pass it to the node."
        )
    return key


def _headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": _USER_AGENT,
    }


def _raise_for_error(resp: requests.Response):
    if resp.status_code >= 400:
        try:
            body = resp.json()
            msg = body.get("error", {}).get("message", resp.text)
        except Exception:
            msg = resp.text
        raise RuntimeError(f"MVNT API error ({resp.status_code}): {msg}")


def _poll_until_done(
    url: str,
    headers: dict,
    timeout: float,
    poll_interval: float,
    on_progress=None,
) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = requests.get(url, headers=headers, timeout=30)
        _raise_for_error(resp)
        data = resp.json()

        status = data.get("status", "")
        if on_progress and "progress" in data:
            on_progress(data["progress"])

        if status == "completed":
            return data
        if status == "failed":
            raise RuntimeError(f"Generation failed: {data.get('error', 'unknown')}")
        if status == "cancelled":
            raise RuntimeError("Generation was cancelled")

        time.sleep(poll_interval)

    raise TimeoutError(f"Generation timed out after {timeout}s")


# ---------- Motion Generation ---------- #

def create_generation(
    audio_path: str,
    *,
    api_key: str | None = None,
    style: str = "All",
    output_format: str = "bvh",
    seed: int = -1,
    guidance: float = 2.0,
    temperature: float = 1.0,
    trim_start: float = 0,
    trim_end: float = 0,
) -> dict:
    key = _get_api_key(api_key)
    with open(audio_path, "rb") as f:
        resp = requests.post(
            f"{DEFAULT_BASE_URL}/generations",
            headers=_headers(key),
            files={"audio": f},
            data={
                "style": style,
                "output_format": output_format,
                "seed": seed,
                "guidance": guidance,
                "temperature": temperature,
                "trim_start": trim_start,
                "trim_end": trim_end,
            },
            timeout=60,
        )
    _raise_for_error(resp)
    return resp.json()


def poll_generation(generation_id: str, *, api_key: str | None = None, **kw) -> dict:
    key = _get_api_key(api_key)
    return _poll_until_done(
        f"{DEFAULT_BASE_URL}/generations/{generation_id}",
        _headers(key),
        timeout=kw.get("timeout", DEFAULT_TIMEOUT),
        poll_interval=kw.get("poll_interval", DEFAULT_POLL_INTERVAL),
    )


def download_generation_output(
    generation_id: str, dest_path: str, *, api_key: str | None = None
) -> str:
    key = _get_api_key(api_key)
    resp = requests.get(
        f"{DEFAULT_BASE_URL}/generations/{generation_id}/output",
        headers=_headers(key),
        timeout=120,
    )
    _raise_for_error(resp)
    with open(dest_path, "wb") as f:
        f.write(resp.content)
    return dest_path


# ---------- Styles ---------- #

def list_styles(*, api_key: str | None = None) -> list[dict]:
    key = _get_api_key(api_key)
    resp = requests.get(
        f"{DEFAULT_BASE_URL}/styles",
        headers=_headers(key),
        timeout=15,
    )
    _raise_for_error(resp)
    return resp.json().get("styles", [])


# ---------- Cost Estimation ---------- #

def estimate_cost(
    audio_duration: float,
    *,
    api_key: str | None = None,
    output_format: str = "bvh",
) -> dict:
    key = _get_api_key(api_key)
    resp = requests.post(
        f"{DEFAULT_BASE_URL}/estimate",
        headers=_headers(key),
        json={"audio_duration": audio_duration, "output_format": output_format},
        timeout=15,
    )
    _raise_for_error(resp)
    return resp.json()


# ---------- Character Generation ---------- #

def create_character(
    *,
    api_key: str | None = None,
    image_path: str | None = None,
    prompt: str | None = None,
    negative_prompt: str = "",
    t_pose: bool = True,
    model_version: str = "v3.0-20250812",
    rigging: bool = True,
) -> dict:
    key = _get_api_key(api_key)
    files = {}
    data = {
        "t_pose": str(t_pose).lower(),
        "model_version": model_version,
        "rigging": str(rigging).lower(),
    }
    if image_path:
        files["image"] = open(image_path, "rb")
    if prompt:
        data["prompt"] = prompt
    if negative_prompt:
        data["negative_prompt"] = negative_prompt

    try:
        resp = requests.post(
            f"{DEFAULT_BASE_URL}/characters",
            headers=_headers(key),
            files=files if files else None,
            data=data,
            timeout=60,
        )
    finally:
        for fh in files.values():
            fh.close()

    _raise_for_error(resp)
    return resp.json()


def poll_character(character_id: str, *, api_key: str | None = None, **kw) -> dict:
    key = _get_api_key(api_key)
    return _poll_until_done(
        f"{DEFAULT_BASE_URL}/characters/{character_id}",
        _headers(key),
        timeout=kw.get("timeout", DEFAULT_TIMEOUT),
        poll_interval=kw.get("poll_interval", DEFAULT_POLL_INTERVAL),
    )


# ---------- Video Export ---------- #

def create_video(
    *,
    api_key: str | None = None,
    image_url: str,
    video_url: str,
    prompt: str = "",
    character_orientation: str = "video",
    keep_original_sound: bool = True,
) -> dict:
    key = _get_api_key(api_key)
    payload = {
        "image_url": image_url,
        "video_url": video_url,
        "character_orientation": character_orientation,
        "keep_original_sound": keep_original_sound,
    }
    if prompt:
        payload["prompt"] = prompt

    resp = requests.post(
        f"{DEFAULT_BASE_URL}/videos",
        headers=_headers(key),
        json=payload,
        timeout=60,
    )
    _raise_for_error(resp)
    return resp.json()


def poll_video(video_id: str, *, api_key: str | None = None, **kw) -> dict:
    key = _get_api_key(api_key)
    return _poll_until_done(
        f"{DEFAULT_BASE_URL}/videos/{video_id}",
        _headers(key),
        timeout=kw.get("timeout", DEFAULT_TIMEOUT),
        poll_interval=kw.get("poll_interval", DEFAULT_POLL_INTERVAL),
    )
