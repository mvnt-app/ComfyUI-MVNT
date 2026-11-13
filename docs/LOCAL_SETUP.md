# Local Comfy setup (Windows) — `feature/compact-v1`

Recorded: 2026-11-13

## Paths used on this machine

| Role | Path |
| --- | --- |
| **ComfyUI root** (Comfy Desktop install) | `C:\Users\tjckd\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI` |
| **custom_nodes junction** | `...\custom_nodes\comfyui-mvnt` → `C:\Users\tjckd\Documents\GitHub\mS\ComfyUI-MVNT` |
| **Git repo / branch** | `feature/compact-v1` @ `5e60a1c` (`docs: compact v1 Comfy node pack design`) |
| **Alternate Comfy tree** (Electron bundled, not wired) | `C:\Users\tjckd\AppData\Local\Programs\ComfyUI\resources\ComfyUI` |

Comfy Desktop did not expose a separate `python.exe` under `.launcher` or `ComfyUI-Shared` in this session. Dependencies were installed with **Miniconda** default Python (`C:\Users\tjckd\miniconda3\python.exe`, 3.13.5). If node import fails inside Comfy Desktop, install the same packages into whatever interpreter the Desktop app uses (ComfyUI Manager → “Install missing custom nodes” / pip from Desktop logs).

## Junction (re-run)

```powershell
.\scripts\local-comfy-setup.ps1 -ComfyRoot "C:\Users\tjckd\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI"
```

Manual equivalent:

```powershell
cmd /c mklink /J "C:\Users\tjckd\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\custom_nodes\comfyui-mvnt" "C:\Users\tjckd\Documents\GitHub\mS\ComfyUI-MVNT"
```

## Environment variables

| Variable | Value |
| --- | --- |
| `MVNT_API_BASE` | `https://api.mvnt.studio/v1` (compact v1 only; see `docs/COMPACT_V1_DESIGN.md`) |
| `MVNT_API_KEY` | `mvnt_live_…` from [MVNT API Platform](https://mvnt.studio/platform) — **not** the app JWT |

**Before each Comfy session** (PowerShell):

```powershell
$env:MVNT_API_BASE = "https://api.mvnt.studio/v1"
$env:MVNT_API_KEY = "mvnt_live_<paste-your-key>"
```

Optional persistent base URL (safe; does not set a key):

```powershell
[Environment]::SetEnvironmentVariable("MVNT_API_BASE", "https://api.mvnt.studio/v1", "User")
```

Restart ComfyUI Desktop after changing user-level variables.

## Python dependencies

From the repo (junction target):

```powershell
cd C:\Users\tjckd\Documents\GitHub\mS\ComfyUI-MVNT
python -m pip install -r requirements.txt
```

Packages: `requests`, `numpy`, `soundfile`, `Pillow`.

## Restart ComfyUI

1. Quit **ComfyUI Desktop** completely (tray icon → exit).
2. Set env vars (above) in the shell you use to launch Desktop, or rely on user-level `MVNT_API_BASE`.
3. Start ComfyUI Desktop again so it rescans `custom_nodes\comfyui-mvnt`.
4. In the node menu, confirm MVNT nodes load (today’s branch still exports the **legacy** 5-node set until compact implementation lands — see design doc).

## What to test on `feature/compact-v1`

Design checklist: `docs/COMPACT_V1_DESIGN.md` (workflow `workflows/compact_v1_api.json` is **not** on the branch yet).

## Related docs

- Compact v1 design: `docs/COMPACT_V1_DESIGN.md`
- API contract (frontend repo): `mvnt-mS/docs/api/compact-v1-2026-11-10/API_COMPACT_CONTRACT.md`
