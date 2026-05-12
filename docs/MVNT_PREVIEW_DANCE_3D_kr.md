# MVNT Preview Dance 3D 작업 기록

## 2026-05-12 현재 기준

ComfyUI-MVNT의 `MVNT Preview Dance 3D`는 Python 쪽에서 Comfy 기본 `PreviewUI3D`와 `PreviewAudio` UI 출력을 반환한다. JS 확장은 노드 안에 직접 3D viewer를 붙이기 위해 Comfy desktop app의 `load3dService-*.js` bundle을 불러온다. 이 파일명은 Comfy 업데이트마다 바뀔 수 있어서, 현재 JS에는 최신 파일명과 이전 파일명을 fallback으로 같이 둔다.

현재 핵심 동작:

- Python 노드가 GLB 경로를 `PreviewUI3D`에 전달
- Python 노드가 Comfy audio payload를 `PreviewAudio`에 전달
- JS 확장은 `Load3d` viewer를 노드 내부 DOM에 mount하고, 숨겨진 `<audio>` 요소로 오디오 재생/탐색 컨트롤 제공
- wheel zoom fallback, tracking toggle, mS 계열 배경/조명 보정 적용

## 백업 위치

- 첫 정상 작동본: `backups/2026-05-02_mvnt_preview_dance_3d_working/`
- mS 씬 패치 전 작동본: `backups/2026-05-02_before_ms_scene_patch/`

## mS Three 씬 이식 판단

바로 옮기기 쉬운 것:

- 배경색/그라데이션
- 조명 강도
- 카메라 초기 위치와 target
- grid 표시/숨김
- 캐릭터 머티리얼의 roughness/metalness/color tone 조정

조심해야 하는 것:

- mS 프론트의 진짜 toon outline은 `OutlineEffect`와 material 교체가 필요해서 `Load3d` 내부 렌더 루프와 충돌할 수 있다.
- camera tracking은 매 프레임 bone world transform을 읽어야 하므로, Comfy 완성 GLB preview 위에 바로 얹기보다 별도 renderer나 서버/Blender 렌더 쪽이 안정적이다.
- Comfy 번들 asset hash(`/assets/load3dService-*.js`)는 업데이트마다 바뀌므로, 하얀 화면이 나오면 현재 설치의 최신 asset 이름을 먼저 확인한다.

## 되돌리기 기준

mS 룩 실험 후 뷰포트 표시, 드래그, 재생, 오디오 동기화 중 하나라도 깨지면 먼저 `load3dService-*.js` asset 이름과 브라우저 콘솔 에러를 확인한다. 그래도 안정성이 부족하면 Comfy가 공개하는 stable 3D preview API나 서버/Blender 렌더 쪽으로 구현한다.