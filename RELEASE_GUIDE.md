# X DRONE GCS 배포(릴리스) 가이드

이 문서는 **새 버전을 빌드해서 GitHub 릴리스로 배포**하고, 사용자 앱이 **자동 업데이트**되게 하는 절차입니다.

- 릴리스 저장소: **https://github.com/ymjo66/xdrone** (공개)
- 자동 업데이트: 앱 실행 시 이 저장소의 `releases/latest` 를 확인 → 현재 버전보다 새 버전이면 패치 UI를 띄우고, 설치파일(asset `.exe`)을 내려받아 실행합니다.
- 설치파일: `XDroneGCS-Setup-v<버전>.exe` (NSIS, 경로 선택·바탕화면 바로가기·제거 프로그램 포함)

---

## 버전 규칙

버전은 **세 곳을 항상 같이** 맞춥니다 (예: `1.0.1`):

| 위치 | 내용 |
|------|------|
| `custom/CMakeLists.txt` | `set(XDRONE_VERSION "1.0.1")` — 앱에 내장되는 현재 버전 |
| `build_installer.bat` | `set "VER=1.0.1"` — 설치파일 이름/버전 |
| GitHub 릴리스 태그 | `v1.0.1` — 앱이 이 태그와 비교 |

> 자동 업데이트는 **릴리스 태그 > 앱 내장 버전** 일 때만 뜹니다.
> 그래서 새 버전을 내려면 위 세 값을 올리고 → 빌드 → 릴리스해야 합니다.

---

## 새 버전 배포 절차

### 1) 버전 올리기
- `custom/CMakeLists.txt` 의 `XDRONE_VERSION`
- `build_installer.bat` 의 `VER`
을 새 버전(예 `1.0.1`)으로 수정.

### 2) 앱 빌드
```bat
build_qgc.bat          :: XDRONE_VERSION 이 바뀌었으므로 재구성 필요
```
(또는 `build_only.bat` — CMake 옵션은 안 바뀌지만 재구성 안전을 위해 build_qgc.bat 권장)

### 3) 독립 실행 배포 폴더(dist-xdrone) 갱신
```bat
"C:\Qt\6.10.1\msvc2022_64\bin\windeployqt.exe" --release --compiler-runtime --qmldir "C:\Users\USER\qgroundcontrol" dist-xdrone\XDroneGCS.exe
```
그리고 새로 빌드한 exe 를 복사:
```bat
copy /Y build\Release\XDroneGCS.exe dist-xdrone\XDroneGCS.exe
```
(VC++ 런타임 `vcruntime140*.dll`, `msvcp140*.dll` 는 이미 dist-xdrone 에 있으면 유지)

### 4) 설치파일 만들기
```bat
build_installer.bat
```
→ `XDroneGCS-Setup-v1.0.1.exe` 생성.

### 5) GitHub 릴리스 올리기

**방법 A — 웹 UI (가장 쉬움)**
1. https://github.com/ymjo66/xdrone/releases → **"Draft a new release"**
2. **Choose a tag** → `v1.0.1` 입력 → *Create new tag on publish*
3. **Release title**: `v1.0.1` (또는 원하는 제목)
4. **Describe this release**: 업데이트 내용을 적습니다. → 이 내용이 앱 **패치 UI에 그대로 표시**됩니다.
5. **Attach binaries**: `XDroneGCS-Setup-v1.0.1.exe` 를 끌어다 첨부 (앱은 `.exe` asset 을 자동으로 찾습니다)
6. **Publish release**

**방법 B — gh CLI (설치돼 있으면 한 줄)**
```bat
gh release create v1.0.1 "XDroneGCS-Setup-v1.0.1.exe" --repo ymjo66/xdrone --title "v1.0.1" --notes "업데이트 내용..."
```
> gh 설치: `winget install --id GitHub.cli` → 최초 1회 `gh auth login` (본인 GitHub 계정 로그인).

---

## 자동 업데이트 동작

- 앱은 실행 후 잠깐 뒤 `releases/latest` 를 확인합니다.
- 최신 릴리스 태그가 앱 내장 버전보다 높으면 **패치 UI**가 뜹니다:
  - 현재/최신 버전, 릴리스 노트(업데이트 내용) 표시
  - **[지금 업데이트]** → 설치파일 다운로드(진행률 표시) → 실행 → 앱 종료 → 설치파일이 기존 위치에 덮어써서 업데이트
  - **[나중에]** → 닫기
- 릴리스가 하나도 없거나 최신이면 아무것도 뜨지 않습니다(정상).

---

## 첫 릴리스 (v1.0.0)

1. 이미 만들어진 `XDroneGCS-Setup-v1.0.0.exe` 를 사용.
2. 위 **5) 웹 UI** 로 태그 `v1.0.0` 릴리스 생성 + 설치파일 첨부.
3. 이후 사용자에게는 이 릴리스의 **설치파일 링크**만 주면 됩니다.
   (또는 릴리스 페이지: https://github.com/ymjo66/xdrone/releases/latest )
4. 다음 버전부터는 위 "새 버전 배포 절차" 대로 올리면, 사용자 앱이 자동으로 감지·업데이트합니다.

> 참고: 자동 업데이트가 실제로 "뜨는" 건 **두 번째 릴리스부터**입니다(첫 릴리스 v1.0.0 는 앱 내장 버전과 같아서 안 뜸). 테스트하려면 버전을 1.0.1 로 올려 한 번 더 릴리스해 보세요.
