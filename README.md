# X Drone Log Viewer (Ardupilot ver)

ArduPilot DataFlash 로그(`.bin` / `.log`)를 여러 개 한꺼번에 열어 이착륙·비행시간 자동 추출, 텔레메트리 차트, 매뉴얼 기반 진단을 보여주는 **Windows 단일 실행파일(`X_Drone_Log_Viewer.exe`)** 입니다.

- 원본 HTML/JS 뷰어(`app/index.html`)를 Windows 내장 Edge WebView2 창에 띄우는 방식이라 화면과 분석 로직은 웹 버전과 같습니다.
- Tailwind, Chart.js, 폰트를 모두 exe 안에 넣어서 **인터넷 없이도** 동작합니다.
- 실행할 때마다 이 저장소의 GitHub 릴리즈를 확인해서 **새 버전이 있으면 자동으로 업데이트**합니다.

## 사용법

1. [Releases](https://github.com/ymjo66/xdrone/releases)에서 `logviewer-v...` 릴리즈의 `X_Drone_Log_Viewer.exe`를 받습니다.
2. 설치 없이 더블클릭해서 실행합니다.
3. 로그 여는 방법
   - 상단 **.bin / .log 다중 파일 열기** 버튼
   - 프로그램 창으로 드래그 앤 드롭
   - 탐색기에서 로그 파일을 `X_Drone_Log_Viewer.exe` 아이콘 위로 끌어다 놓기 (실행과 동시에 분석)

> exe는 쓰기 권한이 있는 폴더(바탕화면, 문서 등)에 두세요. `C:\Program Files`처럼 쓰기 권한이 없는 곳에서는 자동 교체가 안 되고, 릴리즈 페이지에서 직접 받으라는 안내가 뜹니다.

## 새 버전 배포하기 (릴리즈)

버전 번호는 **릴리즈 태그 하나로만** 관리합니다. 빌드할 때 GitHub Actions가 태그의 버전을 `version.py`에 새겨 넣으므로, 코드에서 버전을 따로 올릴 필요가 없습니다.

첫 릴리즈는 `1.0.0`으로 발행하고, 이후 `1.0.1`, `1.1.0`처럼 올립니다. 자동 업데이트는 두 번째 릴리즈부터 동작합니다(첫 릴리즈 exe는 사용자가 한 번 직접 받아야 합니다).

### 방법 A — Actions에서 실행 (권장)

1. 변경 사항을 `main`에 머지합니다.
2. 저장소 **Actions** 탭 → **Build & Release** → **Run workflow**
3. 입력
   - **version**: 새 버전 (예: `1.0.1`). 지금 버전보다 높아야 사용자 앱이 업데이트로 인식합니다.
   - **notes**: 업데이트 내용. 앱의 업데이트 안내 창에 그대로 표시됩니다. 비워 두면 변경 내역이 자동으로 작성됩니다.
4. 몇 분 뒤 `logviewer-v1.0.1` 릴리즈가 만들어지고 `X_Drone_Log_Viewer.exe`가 첨부됩니다.

### 방법 B — Releases 화면에서 직접 만들기

1. **Releases** → **Draft a new release**
2. 태그: `logviewer-v1.0.1` 형식으로 새로 만듭니다. (**`logviewer-v` 접두사 필수**)
3. 본문에 업데이트 내용을 적습니다. (앱 안내 창에 표시됨)
4. **Set as the latest release** 체크를 **해제**합니다. (아래 "태그 규칙" 참고)
5. **Publish release** → Actions가 exe를 빌드해 이 릴리즈에 자동으로 첨부합니다. (exe를 직접 올릴 필요 없음)

## 자동 업데이트 동작

- 앱이 시작되면 이 저장소의 릴리즈 목록에서 `logviewer-vX.Y.Z` 태그이면서 `X_Drone_Log_Viewer.exe`가 첨부된 가장 높은 버전을 찾습니다. (Draft·Pre-release는 제외)
- 현재 버전보다 높으면 **업데이트 안내 창**이 뜹니다: 현재/최신 버전, 업데이트 내용, **지금 업데이트** / **나중에**
- **지금 업데이트**를 누르면:
  1. 새 exe를 기존 exe 옆에 `X_Drone_Log_Viewer.exe.new`로 받습니다. (진행률 표시)
  2. 릴리즈 정보의 파일 크기와 SHA-256 해시로 검증합니다.
  3. 앱이 종료되면 백그라운드 도우미가 기존 exe를 새 exe로 교체하고 다시 실행합니다.
- 언제든 **윈도우 프로그램 가이드** 창의 **업데이트 확인** 버튼으로 수동 확인할 수 있습니다. 현재 버전은 창 제목과 가이드 창에 표시됩니다.
- 인터넷이 안 되거나 릴리즈가 없으면 아무 창도 뜨지 않습니다.

## 태그 규칙: 왜 `logviewer-v` 인가

이 저장소의 릴리즈는 **XDroneGCS**도 함께 씁니다. XDroneGCS 업데이터는 `releases/latest`(Latest 표시된 릴리즈)에 첨부된 **아무 `.exe`나 설치파일로 받아 실행**하고, 태그 `v1.0.1` 같은 숫자로 버전을 비교합니다.

그래서 로그 뷰어 릴리즈는:

- 태그를 `logviewer-vX.Y.Z`로 붙입니다 → XDroneGCS는 이 태그를 버전 0으로 읽어서 업데이트로 보지 않습니다.
- **Latest 표시를 하지 않습니다** → XDroneGCS의 `releases/latest`가 계속 GCS 릴리즈를 가리킵니다. (방법 A는 자동으로 처리)

로그 뷰어 업데이터도 `logviewer-v` 태그만 보므로 GCS 릴리즈(`v1.0.1` 등)와 섞이지 않습니다.

## 개발 / 로컬 빌드

필요: Windows 10/11, Python 3.12

```bat
build.bat
```

→ `dist\X_Drone_Log_Viewer.exe` 생성 (빌드용 가상환경은 `%TEMP%\xdlv_build`에 만듭니다)

빌드 없이 바로 실행:

```bat
pip install -r requirements.txt
python x_drone_log_viewer.py
```

화면/분석 코드를 고칠 때는 `app/index.html`만 수정하면 됩니다.

### 파일 구성

| 경로 | 내용 |
|------|------|
| `app/index.html` | 뷰어 화면·분석 로직 (원본 HTML 기반) |
| `app/updater.js` | 업데이트 안내 창 동작 |
| `app/vendor/`, `app/fonts/` | 오프라인용 Tailwind, Chart.js, 폰트 |
| `x_drone_log_viewer.py` | 데스크톱 창, 로컬 파일 서빙, 명령줄 로그 자동 로드 |
| `updater.py` | GitHub 릴리즈 확인·다운로드·검증·exe 교체 |
| `version.py` | 현재 버전, 업데이트를 확인할 저장소 (릴리즈 빌드 시 자동 생성) |
| `X_Drone_Log_Viewer.spec` | PyInstaller 빌드 설정 (exe 속성에 버전 표시) |
| `.github/workflows/release.yml` | PR 빌드 확인, 릴리즈 빌드·배포 |

### 업데이트 흐름 테스트 (릴리즈 없이)

환경변수 `XDLV_UPDATE_API_BASE`를 지정하면 `https://api.github.com` 대신 그 주소에서 릴리즈 목록(`/repos/ymjo66/xdrone/releases`)을 읽습니다. GitHub API와 같은 형식의 JSON을 돌려주는 로컬 서버를 띄우고 낮은 버전으로 빌드한 exe를 실행하면, 실제 릴리즈를 만들지 않고 업데이트 과정을 확인할 수 있습니다.
