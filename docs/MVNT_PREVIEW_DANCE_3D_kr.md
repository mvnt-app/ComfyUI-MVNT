# MVNT Preview Dance 3D 작업 기록

## 2026-05-02 현재 기준

ComfyUI-MVNT의 `MVNT Preview Dance 3D`는 Comfy 기본 `Preview3d` Vue 컴포넌트의 내부 버튼을 누르는 방식에서 벗어나, Comfy 번들 `Load3d` viewer 클래스를 직접 생성해서 사용한다.

현재 핵심 동작:

- `Load3d.loadModel()`로 GLB 로드
- `Load3d.toggleAnimation()`로 애니메이션 재생/정지
- `Load3d.setAnimationTime()`로 타임라인 이동
- 숨겨진 `<audio>` 요소를 GLB animation time에 맞춰 동기화
- 모션이 루프될 때 오디오도 다시 0초부터 재생되도록 보정
- 휠 이벤트가 Comfy 캔버스로 빠질 경우를 대비해 viewer 카메라를 직접 dolly 처리

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
- Comfy 번들 asset hash(`/assets/load3dService-*.js`)가 업데이트마다 바뀔 수 있으므로 fallback 후보를 계속 관리해야 한다.

## 되돌리기 기준

mS 룩 실험 후 뷰포트 표시, 드래그, 재생, 오디오 동기화 중 하나라도 깨지면 `backups/2026-05-02_before_ms_scene_patch/mvnt_preview_dance_3d.before_ms_scene_patch.js`를 `js/mvnt_preview_dance_3d.js`와 설치본 `ComfyUI/custom_nodes/ComfyUI-MVNT/js/mvnt_preview_dance_3d.js`에 복구한다.