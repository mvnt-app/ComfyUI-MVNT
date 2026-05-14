# assets 폴더 메모

2026-05-12에 MVNT 기본 마네킹 후보 자산을 보관하기 위해 정리한 폴더입니다.

- `mumu.glb`: 서버 Blender 렌더/GLB export의 기본 마네킹 후보로 보관한 파일입니다.
- 목적: Windows 다운로드 폴더에 있던 mumu 자산을 프로젝트 안에서 추적 가능한 위치에 보관하고, 서버 기본 마네킹 교체 시 원본을 명확히 알 수 있게 하기 위함입니다.
- 주의: 이 파일은 Tripo rig가 아니므로 `MVNT Generate Dance`의 `character_glb` 기본 retarget 입력으로 쓰면 안 됩니다. `character_glb`가 비어 있으면 Comfy 노드는 retarget하지 않고 서버가 생성한 motion GLB를 그대로 반환합니다.
- 주의: Windows 다운로드 폴더의 원본 경로를 workflow나 코드에 직접 박지 않습니다. node pack 내부의 이 파일을 기준으로 사용합니다.
