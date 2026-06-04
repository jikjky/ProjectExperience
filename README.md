# Project Experience Portal

프로젝트별 최신 상태, 문서 링크, 섹션별 이력을 캔버스에서 노드 그래프로 관리하는 내부용 웹 포털입니다.

## 실행

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:4173
- 기본 편집 비밀번호는 `.env.example` 기준 `admin`입니다.

## 설정

`.env`에 서버 설정을 둡니다.

```text
PORT=4173
EDIT_PASSWORD=admin
NOTION_API_KEY=
NOTION_VERSION=2026-03-11
```

Notion API 키는 `.env`에만 저장하고, `data/projects.json`에는 저장하지 않습니다.

## 섹션 타입

- `nodeHistory`: 로컬 JSON 이력 또는 Notion Data Source를 수동 동기화해 캐시한 이력 노드입니다. 최신 노드는 기본으로 펼쳐지고 과거 노드는 접어서 볼 수 있습니다.
- `table`: 로컬 JSON 또는 Notion Data Source를 원본으로 쓰는 테이블입니다.
- `linkBoard`: Notion, 구성도, 검수시트, 파일, 저장소 링크를 모아두는 링크 섹션입니다.

## 캔버스

- 프로젝트와 섹션은 React Flow 기반 노드로 표시됩니다.
- 노드는 드래그하고 크기를 조절할 수 있으며, 캔버스는 팬/줌/미니맵으로 탐색할 수 있습니다.
- 노드 위치, 크기, 캔버스 팬/줌 상태는 `data/canvas-layout.json`에 저장되어 서버/프로그램을 다시 켜도 유지됩니다.
- 좌측 검색창에 입력하면 일치하는 프로젝트/섹션 노드가 강조됩니다.
- 노드를 클릭하면 오른쪽 인스펙터에서 해당 섹션의 테이블, 이력, 링크를 바로 확인하고 편집할 수 있습니다.

## Notion 연결

1. Notion Integration을 만들고 대상 Data Source를 해당 Integration에 공유합니다.
2. `.env`의 `NOTION_API_KEY`를 설정합니다.
3. 웹 관리 화면에서 테이블 또는 노드 이력 섹션의 원본을 `notion`으로 선택합니다.
4. Data Source ID와 컬럼별 Notion 속성명/속성 타입 또는 노드 이력 속성 매핑을 입력합니다.

Notion 테이블 행 조회, 추가, 수정은 `data_sources` API와 `pages` API를 통해 처리합니다.
Notion 노드 이력은 포털에서 직접 수정하지 않고, `Notion 이력 캐시 동기화` 버튼을 눌렀을 때 Data Source에서 읽어 `data/projects.json`에 캐시합니다.
