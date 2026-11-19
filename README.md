# 수험생 핫딜

2027학년도 수능 수험생 할인 정보를 목록과 Google 지도에서 확인하는 정적 사이트입니다. 지역, 카테고리 및 검색어를 조합할 수 있고, 각 혜택에 할인 기간, 인증 서류 및 행사 출처를 표시합니다. 검색 폼, 목록 테이블, 버튼에는 [Pure.css](https://pure-css.github.io/start/)를 사용합니다.

## 로컬에서 열기

```sh
python -m http.server 8000 --bind 127.0.0.1
```

브라우저에서 [http://localhost:8000](http://localhost:8000)을 엽니다. 별도 패키지 설치나 빌드가 필요하지 않습니다.

처음 받은 저장소에서 지도나 게시판을 로컬로 시험하려면 `assets/config.example.js`를 `assets/config.js`로 복사해 설정합니다. `assets/config.js`는 Git에서 제외됩니다.

## GitHub Pages에 배포하기

1. 무료 GitHub Pages를 사용하려면 공개 저장소에서 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 선택합니다.
2. `main`에 푸시하거나 **Actions → Deploy to GitHub Pages → Run workflow**를 실행합니다.
3. 배포가 끝나면 **Settings → Pages**에서 사이트 주소를 확인합니다. 현재 원격 저장소의 기본 주소는 `https://heneriq.github.io/student-hotdeal/`입니다.

`index.html`, 사이트의 JavaScript·CSS, Actions에서 생성한 브라우저 설정 파일이 배포됩니다. 사이트 파일은 상대 경로로 참조합니다.

## 푸시 전 확인

- `git add -A` 후 `git diff --cached --name-only`를 확인합니다. `assets/config.js`, `.env`, `.dev.vars`, `worker/.wrangler/`가 커밋 목록에 들어갔다면 스테이징에서 제외합니다.
- Pages 워크플로는 **Actions Variables**로 브라우저용 설정 파일을 생성합니다. Google Maps 운영 키는 실제 사이트 도메인과 **Maps JavaScript API**, **Geocoding API**로 제한하고, 로컬 테스트에는 별도 키를 사용합니다. Cloudflare API 토큰이나 서버용 키는 브라우저 설정과 Actions Variables에 넣지 않습니다. [Google Maps API 키 보호](https://developers.google.com/maps/api-security-best-practices)
- 운영 게시판 주소에는 HTTPS를 사용합니다. Worker의 `ALLOWED_ORIGINS`에는 실제 Pages 도메인의 출처를 등록합니다. 예를 들어 프로젝트 주소가 `https://heneriq.github.io/student-hotdeal/`이면 출처는 `https://heneriq.github.io`입니다.
- 등록은 방문자에게 공개되어 있으며 Worker는 IP별 요청 제한과 입력 검증을 적용합니다. 운영 중 게시판을 확인하고 부적절한 등록은 D1에서 삭제할 수 있습니다.

## 할인 데이터 관리

[`assets/deals.js`](assets/deals.js)에서 장소와 행사를 갱신합니다. 장소별로 고유한 `id`, 카테고리, 주소, `[위도, 경도]`, 시작일·종료일, 인증 방법과 출처 링크를 입력합니다. 날짜는 `YYYY-MM-DD` 형식을 사용하며 한국 시간으로 진행 상태를 표시합니다.

## Google 지도 연결

1. Google Cloud 프로젝트에 결제 계정을 연결하고 [Maps JavaScript API](https://developers.google.com/maps/documentation/javascript/get-api-key?hl=ko)를 사용 설정합니다.
2. 브라우저용 **API 키**를 만듭니다. API 제한은 **Maps JavaScript API**와 **Geocoding API**로, 웹사이트 제한은 `https://heneriq.github.io/*` 또는 실제 배포 도메인으로 설정합니다. 로컬에서 시험할 때는 실제 접속 주소에 맞춰 `http://localhost:8000/*` 등을 등록합니다.
3. 같은 프로젝트에서 유형이 **JavaScript**인 [지도 ID](https://developers.google.com/maps/documentation/javascript/advanced-markers/start?hl=ko)를 만듭니다.
4. GitHub 저장소의 **Settings → Secrets and variables → Actions → Variables**에 `GOOGLE_MAPS_API_KEY`와 `GOOGLE_MAPS_MAP_ID`를 설정하고 배포 워크플로를 다시 실행합니다. 브라우저용 API 키와 지도 ID는 배포된 자바스크립트에서 확인할 수 있습니다.

로컬에서는 [`assets/config.js`](assets/config.js)의 `googleMapsApiKey`와 `googleMapsMapId`에 값을 입력합니다. 지도 설정이 비어 있거나 연결이 실패하면 장소별 Google 지도 링크를 표시합니다.

사이트에서 **지도**를 열거나 할인 등록 중 위치를 찾을 때 지도 SDK를 불러옵니다. 주소로 핀을 자동 지정하려면 같은 Google Cloud 프로젝트에서 **Geocoding API**를 사용 설정하고 기존 브라우저 API 키의 API 제한 목록에도 추가합니다. 주소 검색 화면은 [카카오 우편번호 서비스](https://postcode.map.kakao.com/guide)를 이용합니다. [Geocoding 설정](https://developers.google.com/maps/documentation/javascript/geocoding#GetStarted), [Google 지도 요금표](https://developers.google.com/maps/billing-and-pricing/pricing)

## 방문자 할인 등록

방문자는 로그인 없이 **할인 등록**을 쓸 수 있습니다. 장소명, 지역, 혜택과 행사 출처 링크를 입력하고, 수험생 인증 방법과 카테고리를 각각 하나 이상 선택합니다. 주소를 검색해 선택하거나 직접 입력하면 지역과 지도 핀을 채웁니다. 주소를 찾지 못한 경우 지도에서 위치를 직접 선택할 수 있습니다. 장소 주소와 할인 종료일은 생략할 수 있습니다.

주소로 지정한 핀은 Google 장소 ID를 저장하고 지도를 볼 때 좌표를 확인합니다. 방문자가 지도에서 직접 고른 위치는 좌표로 저장합니다.

사이트는 GitHub Pages에 배포하고, 게시글 조회와 등록은 Cloudflare Worker와 D1이 처리합니다.

1. Cloudflare에 로그인한 뒤 로컬에서 DB를 생성합니다.

   ```sh
   cd worker
   npx wrangler@4 login
   npx wrangler@4 d1 create student-hotdeal
   ```

2. [`worker/wrangler.toml`](worker/wrangler.toml)의 `database_id`를 생성 결과의 ID로 바꿉니다. 기본 GitHub Pages 호스트 외에 커스텀 도메인을 쓴다면 `ALLOWED_ORIGINS`에 스킴을 포함한 사이트 출처를 추가합니다.
3. `worker/`에서 마이그레이션을 적용하고 Worker를 배포합니다.

   ```sh
   npx wrangler@4 d1 migrations apply student-hotdeal --remote
   npx wrangler@4 deploy
   ```

4. 배포된 Worker의 기본 URL을 GitHub 저장소 **Settings → Secrets and variables → Actions → Variables**의 `BOARD_API_URL`에 넣고 Pages 워크플로를 다시 실행합니다.

기존 배포를 업데이트할 때는 3번의 D1 마이그레이션과 Worker 배포를 먼저 실행한 뒤 Pages를 재배포합니다.

로컬에서 시험하려면 `worker/.dev.vars.example`을 같은 폴더의 `.dev.vars`로 복사합니다. `worker/`에서 `npx wrangler@4 d1 migrations apply student-hotdeal --local`과 `npx wrangler@4 dev`를 실행합니다. 로컬 `assets/config.js`의 `boardApiUrl`을 `http://localhost:8787`로 설정하고 미리보기를 엽니다.

종료일은 한국 시간 기준입니다. 종료일 당일까지 공개하고, 다음 날 0시부터 목록·지도·게시글 조회 API에서 숨깁니다. 종료일을 비우면 계속 표시됩니다.

## 관리자 데이터 삭제

방문자 등록 글은 **Cloudflare 대시보드 → D1 SQL database → student-hotdeal → Console**에서 관리합니다. 조회 결과에서 삭제할 글의 `id`를 복사하고, 아래 두 번째 쿼리의 값을 바꿔 실행하세요. [Cloudflare D1 콘솔 안내](https://developers.cloudflare.com/d1/get-started/)

```sql
SELECT id, name, ends, hidden FROM deals ORDER BY created_at DESC;
DELETE FROM deals WHERE id = '삭제할 게시글 ID';
```

로컬 미리보기의 등록 글은 `worker/`에서 `npx wrangler@4 d1 execute student-hotdeal --local --command "<위의 SQL 쿼리>"`로 관리합니다. 기본 할인 목록은 [`assets/deals.js`](assets/deals.js)에서 해당 항목을 지우고 Pages를 재배포합니다.
