# DVL Painter Feed

해외 미니어처 페인터들의 최신 콘텐츠를 한 화면에서 모아보는 개인용 GitHub Pages 웹앱입니다.

## 포함 기능
- 페인터별 필터
- 소스별 필터
- 태그 필터
- 검색
- 즐겨찾기(LocalStorage)
- 다크/라이트 테마
- YouTube RSS 자동 수집(GitHub Actions, API Key 불필요)
- 수동 레퍼런스 feed.json 추가

## 1. 로컬 실행
브라우저에서 index.html을 직접 열면 fetch가 막힐 수 있으므로 간단한 웹서버로 실행하세요.

```bash
python -m http.server 8000
```

그 다음 `http://localhost:8000` 접속.

## 2. YouTube 자동 업데이트 설정
`data/painters.json`의 각 페인터에서 `youtubeChannelId`에 실제 채널 ID를 입력하세요.

예:
```json
{
  "id": "sample",
  "name": "Sample Painter",
  "youtubeChannelId": "UCxxxxxxxxxxxxxxxxxxxxxx"
}
```

채널 ID를 넣고 GitHub에 push하면 `.github/workflows/update-feed.yml`이 6시간마다 `scripts/update_youtube.py`를 실행해 최신 영상을 `data/feed.json`에 저장합니다.

> 장점: YouTube Data API Key를 GitHub Pages 프론트엔드에 노출할 필요가 없습니다.

## 3. GitHub Pages 배포
1. 새 GitHub repository 생성
2. 이 폴더의 파일 전체 업로드
3. Settings → Pages
4. Deploy from a branch
5. `main` / `/ (root)` 선택

## 4. 페인터 추가
`data/painters.json`에 객체 하나를 추가하면 됩니다.

지원 필드:
- id
- name
- country
- specialties
- youtubeChannelId
- youtube
- instagram
- patreon
- website

현재 1차 UI에서는 YouTube/피드 중심으로 구성되어 있으며, 다음 버전에서 각 페인터 카드에 SNS 바로가기 버튼을 추가하기 쉽도록 데이터 구조를 준비해 두었습니다.

## 5. 수동 레퍼런스 추가
`data/feed.json`에 다음 형태로 추가합니다.

```json
{
  "id": "manual-unique-id",
  "painterId": "juan-sanz",
  "source": "Reference",
  "title": "작품명 또는 메모",
  "description": "짧은 설명",
  "url": "https://...",
  "thumbnail": "https://...",
  "publishedAt": "2026-08-20T09:00:00Z",
  "tags": ["NMM", "Ork", "Skin"]
}
```

`id`가 `yt:`로 시작하지 않으면 GitHub Action 업데이트 시에도 유지됩니다.
