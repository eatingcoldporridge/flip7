# Flip 7 Realtime Table

Node.js + WebSocket 기반의 실시간 카드/보드 게임 뼈대입니다.

## 로컬 실행

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3007`을 엽니다.

## 배포 방식

### 가장 쉬운 방식: Render에 전체 배포

이 프로젝트는 `server.js`가 `public/` 정적 파일과 WebSocket 서버를 함께 제공합니다.
그래서 Render에 전체 프로젝트를 올리면 한 주소에서 바로 플레이할 수 있습니다.

- Root Directory: `mmsis/flip7`
- Build Command: `npm install`
- Start Command: `npm start`

Render는 배포 시 `PORT` 환경변수를 자동으로 주고, `server.js`는 이 값을 사용합니다.

### Netlify + Render 분리 배포

Netlify는 프론트엔드만 담당하고, Render는 WebSocket 서버를 담당합니다.

1. Render에 이 프로젝트 전체를 Web Service로 배포합니다.
2. Render 주소를 확인합니다. 예: `https://flip7-realtime-server.onrender.com`
3. `public/config.js`를 수정합니다.

```js
window.FLIP7_WS_URL = "wss://flip7-realtime-server.onrender.com";
```

4. Netlify에는 `public/` 폴더를 배포합니다.

`netlify.toml`은 Git 연동 배포에서 Netlify가 `public/`을 publish directory로 보도록 설정합니다.

## 현재 구현

- 방 만들기
- 방 코드로 참가
- 플레이어 목록 동기화
- 서버 권위 덱 셔플
- 턴 검증
- 카드 뽑기
- 스톱
- 라운드 점수와 총점 계산
- 200점 이상 승리 처리
- 모든 접속자에게 상태 브로드캐스트

## MVP 룰

- 숫자 카드는 `0` 1장, `1` 1장, `2` 2장 ... `12` 12장입니다.
- 같은 숫자를 다시 뽑으면 버스트합니다.
- 서로 다른 숫자 카드 7장을 모으면 Flip 7 보너스 15점과 함께 라운드가 종료됩니다.
- `+2`, `+4`, `+6`, `+8`, `+10`, `x2` 보정 카드를 포함합니다.
- `Second Chance`, `Freeze`, `Flip 3` 액션 카드를 포함합니다.
- 현재 MVP에서는 액션 카드가 뽑힌 플레이어에게 자동 적용됩니다.
