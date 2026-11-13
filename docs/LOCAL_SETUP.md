# Local Comfy setup (Windows) — `feature/compact-v1`

Recorded: 2026-11-13

## ComfyUI Desktop (새 UI) — 클릭 경로

구형 바로가기(`ComfyUI.exe` 단독) 말고 **Comfy Desktop** 앱을 쓴다.

1. 시작 메뉴 또는 작업 표시줄에서 **Comfy Desktop** 실행.
2. 홈 화면에서 카드 **ComfyUI** 선택 (이름이 `ComfyUI`, `Comfy Cloud` 가 아님).
3. 인스턴스 화면 오른쪽 아래 파란 **Start** 로 서버 기동.
4. (선택) 상단 **Desktop Update Ready** 노란 뱃지 → 업데이트 적용 후 **Comfy를 완전 종료**하고 다시 Start (현재 대기 버전: `settings.json` 의 `pendingDownloadedUpdateVersion`, 예: 1.1.9).
5. 인스턴스 설정에서 **Startup Args**는 `installations.json` 의 `launchArgs` (이 PC: `--port 8000 --enable-manager`). API 키는 여기 넣지 않는다 — Windows 사용자 환경변수 또는 아래 `.env.local`.

인스턴스 메타: `%APPDATA%\Comfy Desktop\installations.json` (id `inst-1788747844490`, install `ComfyUI-Installs\ComfyUI`).

## 실행만 하면 됨 (체크리스트)

코드·junction·의존성·워크플로는 이미 준비돼 있다. 키만 넣고 Comfy를 켜면 된다.

1. **키만 설정** (저장소·워크플로 JSON에 키를 넣지 않는다). 아래 중 하나 (권장 순):
   - **로컬 env 파일 (붙여넣기용):** `C:\Users\tjckd\Documents\GitHub\mS\ComfyUI-MVNT\.env.local` — `.env.local.example` 복사 후 `MVNT_API_KEY=` 에 Platform 키(`mvnt_live_…`, [mvnt.studio/platform](https://mvnt.studio/platform)). 노드 import 시 자동 로드(기존 Windows env는 덮어쓰지 않음). Comfy **완전 종료 → Start** 로 재시작.
   - **Windows 사용자 환경변수 GUI:** `Win+R` → `sysdm.cpl` → 고급 → 환경 변수 → **사용자 변수**에 `MVNT_API_KEY` 추가. 또는 PowerShell: `[Environment]::SetEnvironmentVariable("MVNT_API_KEY", "mvnt_live_<키>", "User")` 후 Comfy 완전 종료 → 재실행.
   - **노드 칸:** `MVNT Generate Dance` / `MVNT List Styles` / `MVNT Render Dance Video` 의 `api_key` (빈 칸 = env).
   - `MVNT_API_BASE=https://api.mvnt.studio/v1` 는 이미 User 환경변수로 설정됨 (없으면 `.env.local` 또는 동일 GUI에 추가).

Comfy Desktop에는 “로컬 .env 열기” 메뉴가 없다. 키는 위 파일 또는 Windows 사용자 변수에만 둔다.
2. **ComfyUI Desktop 실행** (이미 켜져 있었다면 트레이에서 종료 후 다시 실행해야 노드가 다시 로드된다).
3. **워크플로 로드**: `C:\Users\tjckd\Documents\GitHub\mS\ComfyUI-MVNT\workflows\compact_v1_api.json` 을 Comfy 화면에 끌어다 놓거나 Workflow → Open.
4. `Load Audio` 에 `ZankokuCut.wav`(입력 폴더에 복사해 둠, 약 26초) 또는 원하는 WAV 선택 → Queue.
5. 확인: 메뉴 `MVNT` 아래 노드는 **Audio Segment, List Styles, Generate Dance, Preview Dance 3D, Render Dance Video** 5개이고 `Image to T-Pose` 는 없어야 한다.

MP4(`MVNT Render Dance Video`)는 서버 GPU 캡처라 수 분 걸릴 수 있다(클라이언트 timeout 960s). 크레딧은 trim 구간 초당 3 credits.

## Paths used on this machine

| Role | Path |
| --- | --- |
| **ComfyUI root** (Comfy Desktop install) | `C:\Users\tjckd\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI` |
| **custom_nodes junction** | `...\custom_nodes\comfyui-mvnt` → `C:\Users\tjckd\Documents\GitHub\mS\ComfyUI-MVNT` |
| **Git repo / branch** | `feature/compact-v1` |
| **Comfy Python** (Desktop log: `Python executable`) | `C:\Users\tjckd\Documents\ComfyUI\.venv\Scripts\python.exe` (3.12.11, uv venv) |
| **Alternate Comfy tree** (Electron bundled, not wired) | `C:\Users\tjckd\AppData\Local\Programs\ComfyUI\resources\ComfyUI` |
| **Input WAV copies** | `...\ComfyUI-Installs\ComfyUI\ComfyUI\input\ZankokuCut.wav`, `...\ComfyUI-Shared\input\ZankokuCut.wav` |

Dependencies (`requests`, `numpy`, `soundfile`, `Pillow`) are installed in that venv:

```powershell
& "C:\Users\tjckd\Documents\ComfyUI\.venv\Scripts\python.exe" -m pip install -r C:\Users\tjckd\Documents\GitHub\mS\ComfyUI-MVNT\requirements.txt
```

(The earlier Miniconda install, `C:\Users\tjckd\miniconda3\python.exe`, is not what Comfy uses.)

If pip prints `OPENSSL_Uplink(...): no OPENSSL_Applink` in an Avast-monitored shell, clear the shell-only variable first: `Remove-Item Env:SSLKEYLOGFILE`.

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
| `MVNT_API_BASE` | `https://api.mvnt.studio/v1` (compact v1 only) |
| `MVNT_API_KEY` | `mvnt_live_…` from [MVNT API Platform](https://mvnt.studio/platform) — **not** the app JWT |
| `MVNT_COMPACT_V1` | optional; default on. `0` re-enables the old legacy fallback (local A/B only) |

Per-session alternative (PowerShell, before launching Desktop from that shell):

```powershell
$env:MVNT_API_BASE = "https://api.mvnt.studio/v1"
$env:MVNT_API_KEY = "mvnt_live_<paste-your-key>"
```

## What to test on `feature/compact-v1`

Design checklist: `docs/COMPACT_V1_DESIGN.md` §Local Comfy test checklist.
Smoke already run without a key: node import (5 nodes), no-legacy-fallback on 401, MP4 query `preset`/`camera_mode`, 960s timeout.
Not run (needs a real key + credits): live generate / GLB / MP4.

## Related docs

- Compact v1 design: `docs/COMPACT_V1_DESIGN.md`
- API contract (frontend repo): `mvnt-mS/docs/api/compact-v1-2026-11-10/API_COMPACT_CONTRACT.md`
