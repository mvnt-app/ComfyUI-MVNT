"""Lightweight wrapper around the MVNT API used by the ComfyUI nodes."""

import mimetypes
import os
import time
import uuid
import requests

DEFAULT_BASE_URL = "https://api.mvnt.world/v1"
DEFAULT_LEGACY_BASE_URL = "https://api.mvnt.studio"
DEFAULT_POLL_INTERVAL = 3
DEFAULT_TIMEOUT = 600

_USER_AGENT = "comfyui-mvnt/1.2.0"
_VALID_KEY_PREFIXES = ("mvnt_live_", "mvnt_test_", "mk_live_", "mk_test_")
_GENERATION_BACKENDS: dict[str, str] = {}


def _base_url(api_base: str | None = None) -> str:
    return (api_base or os.environ.get("MVNT_API_BASE") or DEFAULT_BASE_URL).rstrip("/")


def _legacy_base_url() -> str:
    return (os.environ.get("MVNT_LEGACY_API_BASE") or DEFAULT_LEGACY_BASE_URL).rstrip("/")


def _image_api_base_url(api_base: str | None = None) -> str:
    return (api_base or os.environ.get("MVNT_IMAGE_API_BASE") or _legacy_base_url()).rstrip("/")


def _get_api_key(api_key: str | None = None) -> str:
    key = api_key or os.environ.get("MVNT_API_KEY", "")
    if not key:
        raise ValueError(
            "MVNT API key is required. "
            "Set the MVNT_API_KEY environment variable or pass it to the node."
        )
    if not key.startswith(_VALID_KEY_PREFIXES):
        raise ValueError(
            "MVNT API key must start with mvnt_live_, mvnt_test_, mk_live_, or mk_test_."
        )
    return key


def _headers(api_key: str, *, idempotency_key: str | None = None) -> dict:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": _USER_AGENT,
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    return headers


def _json_or_text(resp: requests.Response):
    try:
        return resp.json()
    except Exception:
        return resp.text


def _raise_for_error(resp: requests.Response):
    if resp.status_code < 400:
        return

    body = _json_or_text(resp)
    if isinstance(body, dict):
        if "detail" in body:
            msg = body["detail"]
        else:
            msg = body.get("error", {}).get("message", str(body))
    else:
        msg = body
    raise RuntimeError(f"MVNT API error ({resp.status_code}): {msg}")


def _status_is_done(status: str) -> bool:
    return status in {"completed", "succeeded", "success", "done"}


def _status_is_failed(status: str) -> bool:
    return status in {"failed", "error", "cancelled", "canceled"}


def _detect_status_error(data: dict) -> str:
    return str(data.get("error") or data.get("detail") or data.get("message") or "unknown")


def _open_optional_file(path: str | None):
    if not path:
        return None
    if not os.path.exists(path):
        raise FileNotFoundError(f"Input file not found: {path}")
    return open(path, "rb")


def regenerate_tpose_image(
    source_image_path: str,
    dest_path: str,
    *,
    api_base: str | None = None,
    prompt: str = "",
    model: str = "",
    verify_ssl: bool | None = None,
    timeout: float = 240,
) -> dict:
    """Call MVNT's T-pose image preprocessing endpoint and save the returned image."""
    if not os.path.exists(source_image_path):
        raise FileNotFoundError(f"Input image not found: {source_image_path}")

    base = _image_api_base_url(api_base)
    mime_type = mimetypes.guess_type(source_image_path)[0] or "image/png"
    data = {}
    if prompt and prompt.strip():
        data["prompt"] = prompt.strip()
    if model and model.strip():
        data["model"] = model.strip()
    if verify_ssl is None:
        raw_verify = os.environ.get("MVNT_IMAGE_VERIFY_SSL", "true").strip().lower()
        verify_ssl = raw_verify not in {"0", "false", "no", "off"}

    with open(source_image_path, "rb") as image_file:
        resp = requests.post(
            f"{base}/image/tpose-regenerate",
            headers={"User-Agent": _USER_AGENT},
            files={"file": (os.path.basename(source_image_path), image_file, mime_type)},
            data=data,
            verify=bool(verify_ssl),
            timeout=(10, timeout),
        )

    _raise_for_error(resp)
    content_type = resp.headers.get("content-type", "image/png").split(";", 1)[0].strip()
    if not content_type.startswith("image/"):
        raise RuntimeError(f"MVNT T-pose endpoint returned non-image content-type: {content_type}")

    os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
    with open(dest_path, "wb") as out_file:
        out_file.write(resp.content)

    return {
        "output_path": dest_path,
        "content_type": content_type,
        "bytes": len(resp.content),
        "prompt_version": resp.headers.get("x-mvnt-prompt-version", ""),
    }


def _is_glb_file(path: str) -> bool:
    try:
        with open(path, "rb") as f:
            return f.read(4) == b"glTF"
    except OSError:
        return False


def _is_mp4_file(path: str) -> bool:
    try:
        with open(path, "rb") as f:
            header = f.read(12)
            return len(header) >= 8 and header[4:8] == b"ftyp"
    except OSError:
        return False


def _should_fallback_to_legacy(resp: requests.Response) -> bool:
    if resp.status_code != 404:
        return False
    body = _json_or_text(resp)
    return "Cannot POST /v1/generations" in str(body) or "Cannot POST /generations" in str(body)


def make_idempotency_key(prefix: str = "comfyui") -> str:
    return f"{prefix}-{uuid.uuid4().hex}"


def _poll_until_done(
    url: str,
    headers: dict,
    timeout: float,
    poll_interval: float,
    on_progress=None,
) -> dict:
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            resp = requests.get(url, headers=headers, timeout=(10, 45))
        except (requests.exceptions.ConnectTimeout, requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError) as exc:
            last_error = exc
            time.sleep(min(max(poll_interval, 3), 10))
            continue
        _raise_for_error(resp)
        data = resp.json()

        status = str(data.get("status", "")).lower()
        if on_progress and "progress" in data:
            on_progress(data["progress"])

        if _status_is_done(status):
            return data
        if _status_is_failed(status):
            raise RuntimeError(f"Generation failed: {_detect_status_error(data)}")

        time.sleep(poll_interval)

    if last_error is not None:
        raise TimeoutError(f"Generation polling timed out after {timeout}s. Last network error: {last_error}")
    raise TimeoutError(f"Generation timed out after {timeout}s")


# ---------- Motion Generation ---------- #

def create_generation(
    audio_path: str,
    *,
    api_key: str | None = None,
    api_base: str | None = None,
    character_path: str | None = None,
    style: str = "All",
    output_format: str = "bvh",
    output_mode: str = "both",
    preview_style: str = "mannequin",
    seed: int = -1,
    guidance: float = 2.0,
    temperature: float = 1.0,
    trim_start: float = 0,
    trim_end: float = 0,
    mode: str = "standard",
    n_steps: int | None = None,
    save_hard_yaw_lock_variant: bool = True,
    idempotency_key: str | None = None,
) -> dict:
    key = _get_api_key(api_key)
    base = _base_url(api_base)

    character_file = _open_optional_file(character_path)
    try:
        with open(audio_path, "rb") as audio_file:
            files = {"audio": audio_file}
            if character_file:
                files["character"] = character_file
            resp = requests.post(
                f"{base}/generations",
                headers=_headers(key, idempotency_key=idempotency_key or make_idempotency_key()),
                files=files,
                data={
                    "style": style,
                    "output_format": output_format,
                    "output_mode": output_mode,
                    "preview_style": preview_style,
                    "seed": seed,
                    "guidance": guidance,
                    "temperature": temperature,
                    "trim_start": trim_start,
                    "trim_end": trim_end,
                    "mode": mode,
                    "save_hard_yaw_lock_variant": str(bool(save_hard_yaw_lock_variant)).lower(),
                    **({"n_steps": n_steps} if n_steps else {}),
                },
                timeout=60,
            )
    finally:
        if character_file:
            character_file.close()
    if _should_fallback_to_legacy(resp):
        return create_legacy_generation(
            audio_path,
            api_key=api_key,
            character_path=character_path,
            style=style,
            seed=seed,
            guidance=guidance,
            temperature=temperature,
            trim_start=trim_start,
            trim_end=trim_end,
            mode=mode,
            n_steps=n_steps,
            save_hard_yaw_lock_variant=save_hard_yaw_lock_variant,
        )

    _raise_for_error(resp)
    data = resp.json()
    try:
        _GENERATION_BACKENDS[generation_id_from_response(data)] = "v1"
    except Exception:
        pass
    return data


def create_legacy_generation(
    audio_path: str,
    *,
    api_key: str | None = None,
    character_path: str | None = None,
    style: str = "All",
    seed: int = -1,
    guidance: float = 2.0,
    temperature: float = 1.0,
    trim_start: float = 0,
    trim_end: float = 0,
    mode: str = "standard",
    n_steps: int | None = None,
    save_hard_yaw_lock_variant: bool = True,
) -> dict:
    """Fallback for the current live API while /v1/generations is not deployed."""
    base = _legacy_base_url()
    character_file = _open_optional_file(character_path)
    try:
        with open(audio_path, "rb") as audio_file:
            files = {"file": audio_file}
            if character_file:
                files["character"] = character_file
            data = {
                "model_version": "v11_gender",
                "style": style,
                "seed": str(seed),
                "guidance": str(guidance),
                "temperature": str(temperature),
                "trim_start": str(trim_start),
                "trim_end": str(trim_end),
                "mode": mode,
                "save_hard_yaw_lock_variant": str(bool(save_hard_yaw_lock_variant)).lower(),
            }
            if n_steps:
                data["n_steps"] = str(n_steps)
            headers = {"User-Agent": _USER_AGENT}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            resp = requests.post(
                f"{base}/generate-motion-lda",
                headers=headers,
                files=files,
                data=data,
                timeout=60,
            )
    finally:
        if character_file:
            character_file.close()

    _raise_for_error(resp)
    body = resp.json()
    job_id = str(body.get("job_id") or body.get("id") or body.get("generation_id") or "")
    if job_id:
        _GENERATION_BACKENDS[job_id] = "legacy"
    body.setdefault("id", job_id)
    body.setdefault("generation_id", job_id)
    body["_mvnt_backend"] = "legacy"
    return body


def generation_id_from_response(data: dict) -> str:
    gen_id = data.get("id") or data.get("generation_id") or data.get("job_id")
    if not gen_id:
        raise RuntimeError(f"MVNT API response did not include a generation id: {data}")
    return str(gen_id)


def poll_generation(
    generation_id: str,
    *,
    api_key: str | None = None,
    api_base: str | None = None,
    **kw,
) -> dict:
    key = _get_api_key(api_key)
    if _GENERATION_BACKENDS.get(generation_id) == "legacy":
        return poll_legacy_generation(
            generation_id,
            api_key=api_key,
            timeout=kw.get("timeout", DEFAULT_TIMEOUT),
            poll_interval=kw.get("poll_interval", DEFAULT_POLL_INTERVAL),
            on_progress=kw.get("on_progress"),
        )
    return _poll_until_done(
        f"{_base_url(api_base)}/generations/{generation_id}",
        _headers(key),
        timeout=kw.get("timeout", DEFAULT_TIMEOUT),
        poll_interval=kw.get("poll_interval", DEFAULT_POLL_INTERVAL),
        on_progress=kw.get("on_progress"),
    )


def poll_legacy_generation(
    job_id: str,
    *,
    api_key: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    poll_interval: float = DEFAULT_POLL_INTERVAL,
    on_progress=None,
) -> dict:
    base = _legacy_base_url()
    headers = {"User-Agent": _USER_AGENT}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return _poll_until_done(
        f"{base}/job-lda/{job_id}",
        headers,
        timeout=timeout,
        poll_interval=poll_interval,
        on_progress=on_progress,
    )


def download_generation_output(
    generation_id: str,
    dest_path: str,
    *,
    api_key: str | None = None,
    api_base: str | None = None,
    kind: str | None = None,
    format: str | None = None,
    allow_missing: bool = False,
    **params,
) -> str:
    if _GENERATION_BACKENDS.get(generation_id) == "legacy":
        return download_legacy_generation_output(
            generation_id,
            dest_path,
            api_key=api_key,
            kind=kind,
            format=format,
            allow_missing=allow_missing,
            **params,
        )
    key = _get_api_key(api_key)
    query = {}
    if kind:
        query["kind"] = kind
    if format:
        query["format"] = format
    for name, value in params.items():
        if value is not None:
            query[name] = value
    request_timeout = 600 if (kind == "render" or format == "mp4") else 180

    resp = requests.get(
        f"{_base_url(api_base)}/generations/{generation_id}/output",
        headers=_headers(key),
        params=query or None,
        timeout=request_timeout,
    )
    if allow_missing and resp.status_code in {404, 409, 422}:
        return ""
    _raise_for_error(resp)
    with open(dest_path, "wb") as f:
        f.write(resp.content)
    if str(dest_path).lower().endswith(".glb") and not _is_glb_file(dest_path):
        if allow_missing:
            try:
                os.remove(dest_path)
            except OSError:
                pass
            return ""
        raise RuntimeError(f"Downloaded output is not a valid GLB file: {dest_path}")
    if str(dest_path).lower().endswith(".mp4") and not _is_mp4_file(dest_path):
        if allow_missing:
            try:
                os.remove(dest_path)
            except OSError:
                pass
            return ""
        raise RuntimeError(f"Downloaded output is not a valid MP4 file: {dest_path}")
    return dest_path


def download_file_url(url: str, dest_path: str, *, api_key: str | None = None) -> str:
    key = _get_api_key(api_key) if api_key else None
    headers = {"User-Agent": _USER_AGENT}
    if key:
        headers["Authorization"] = f"Bearer {key}"

    resp = requests.get(url, headers=headers, timeout=180)
    _raise_for_error(resp)
    with open(dest_path, "wb") as f:
        f.write(resp.content)
    return dest_path


def retarget_tripo_glb(
    source_motion_glb_path: str,
    target_character_glb_path: str,
    dest_path: str,
    *,
    api_key: str | None = None,
    api_base: str | None = None,
) -> str:
    """Retarget a generated MVNT motion GLB onto a Tripo T-pose character GLB."""
    if not source_motion_glb_path or not os.path.exists(source_motion_glb_path):
        raise FileNotFoundError(f"Source motion GLB not found: {source_motion_glb_path}")
    if not target_character_glb_path or not os.path.exists(target_character_glb_path):
        raise FileNotFoundError(f"Target character GLB not found: {target_character_glb_path}")

    base = (api_base or os.environ.get("MVNT_RETARGET_API_BASE") or _legacy_base_url()).rstrip("/")
    headers = {"User-Agent": _USER_AGENT}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    with open(source_motion_glb_path, "rb") as source_file, open(target_character_glb_path, "rb") as target_file:
        resp = requests.post(
            f"{base}/retarget-tripo-glb",
            headers=headers,
            files={
                "source_animated_glb": source_file,
                "target_tripo_glb": target_file,
            },
            timeout=900,
        )
    _raise_for_error(resp)
    with open(dest_path, "wb") as f:
        f.write(resp.content)
    if not _is_glb_file(dest_path):
        try:
            os.remove(dest_path)
        except OSError:
            pass
        raise RuntimeError(f"Retargeted output is not a valid GLB file: {dest_path}")
    return dest_path


def _download_legacy_hard_yaw_glb(job_id: str, dest_path: str, headers: dict, *, allow_missing: bool = False) -> str:
    """Build GLB from the hard_yaw_lock BVH because /download-glb-lda currently exports baseline BVH."""
    base = _legacy_base_url()
    bvh_resp = requests.get(
        f"{base}/download-bvh-lda/{job_id}",
        headers=headers,
        params={"variant": "hard_yaw_lock"},
        timeout=180,
    )
    if allow_missing and bvh_resp.status_code in {404, 409, 422, 500}:
        return ""
    _raise_for_error(bvh_resp)

    export_resp = requests.post(
        f"{base}/export-glb-bvh-lda",
        headers=headers,
        files={"bvh_file": (f"{job_id}_hard_yaw_lock.bvh", bvh_resp.content, "text/plain")},
        timeout=600,
    )
    if allow_missing and export_resp.status_code in {404, 409, 422, 500}:
        return ""
    _raise_for_error(export_resp)
    with open(dest_path, "wb") as f:
        f.write(export_resp.content)
    if not _is_glb_file(dest_path):
        if allow_missing:
            try:
                os.remove(dest_path)
            except OSError:
                pass
            return ""
        raise RuntimeError(f"Downloaded hard-yaw output is not a valid GLB file: {dest_path}")
    return dest_path


def download_legacy_generation_output(
    job_id: str,
    dest_path: str,
    *,
    api_key: str | None = None,
    kind: str | None = None,
    format: str | None = None,
    allow_missing: bool = False,
    **params,
) -> str:
    base = _legacy_base_url()
    headers = {"User-Agent": _USER_AGENT}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    normalized_kind = (kind or "motion").lower()
    normalized_format = (format or "bvh").lower()
    request_timeout = 600 if (normalized_kind == "render" or normalized_format == "mp4") else 180

    variant = str(params.pop("variant", "") or "").strip().lower()
    if (normalized_kind == "3d" or normalized_format == "glb") and variant in {"hard_yaw_lock", "hard-yaw-lock", "hard_yaw"}:
        return _download_legacy_hard_yaw_glb(job_id, dest_path, headers, allow_missing=allow_missing)

    if normalized_kind == "3d" or normalized_format == "glb":
        url = f"{base}/download-glb-lda/{job_id}"
    elif normalized_kind in {"render", "video", "preview"} or normalized_format == "mp4":
        url = f"{base}/render-mp4-lda/{job_id}"
    elif normalized_format == "fbx":
        url = f"{base}/download-lda/{job_id}"
    else:
        url = f"{base}/download-bvh-lda/{job_id}"

    resp = requests.get(url, headers=headers, params=params or None, timeout=request_timeout)
    if allow_missing and resp.status_code in {404, 409, 422, 500}:
        return ""
    _raise_for_error(resp)
    with open(dest_path, "wb") as f:
        f.write(resp.content)
    if str(dest_path).lower().endswith(".glb") and not _is_glb_file(dest_path):
        if allow_missing:
            try:
                os.remove(dest_path)
            except OSError:
                pass
            return ""
        raise RuntimeError(f"Downloaded output is not a valid GLB file: {dest_path}")
    if str(dest_path).lower().endswith(".mp4") and not _is_mp4_file(dest_path):
        if allow_missing:
            try:
                os.remove(dest_path)
            except OSError:
                pass
            return ""
        raise RuntimeError(f"Downloaded output is not a valid MP4 file: {dest_path}")
    return dest_path


def list_styles(*, api_key: str | None = None, api_base: str | None = None) -> list[dict]:
    key = _get_api_key(api_key)
    resp = requests.get(
        f"{_base_url(api_base)}/styles",
        headers=_headers(key),
        timeout=15,
    )
    _raise_for_error(resp)
    body = resp.json()
    return body.get("styles", body if isinstance(body, list) else [])


def estimate_cost(
    audio_duration: float,
    *,
    api_key: str | None = None,
    api_base: str | None = None,
    output_format: str = "bvh",
    output_mode: str = "both",
    has_character: bool = False,
) -> dict:
    key = _get_api_key(api_key)
    resp = requests.post(
        f"{_base_url(api_base)}/estimate",
        headers=_headers(key),
        json={
            "audio_duration": audio_duration,
            "output_format": output_format,
            "output_mode": output_mode,
            "has_character": has_character,
        },
        timeout=15,
    )
    _raise_for_error(resp)
    return resp.json()


# ---------- Legacy API helpers retained for older workflows ---------- #

def _legacy_headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": _USER_AGENT,
    }


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
        on_progress=kw.get("on_progress"),
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
        on_progress=kw.get("on_progress"),
    )
