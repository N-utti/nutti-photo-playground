# 배포 런북 — Vultr 서울 VPS + Docker Compose + Cloudflare (ADR-06)

호스트 3개: `play.nutti.co.kr`(SPA) · `api.nutti.co.kr`(FastAPI) · `img.nutti.co.kr`(R2 CDN).
쇼핑몰 `nutti.co.kr`/`www`/`m`은 카페24 그대로 — DNS만 Cloudflare로 옮기고 레코드는 복제한다.

## 0. Cloudflare — DNS 이전 (쇼핑몰 무중단)

1. Cloudflare 대시보드 → **Add a site** → `nutti.co.kr` → Free 플랜. 자동 스캔된 레코드를 아래 표와 대조해 빠진 것을 채운다(2026-09-01 실측).

| 타입 | 이름 | 값 | 프록시 |
|---|---|---|---|
| A | `@` | `203.245.12.106`, `203.245.12.107`, `183.111.139.231`, `183.111.139.235` | **DNS only** (카페24 SSL 유지) |
| CNAME | `www` | `magneto-ktog-08122728.cafe24edge.kr` | DNS only |
| CNAME | `m` | `magneto-ktog-08122728.cafe24edge.kr` | DNS only |
| CNAME | `*` | `nutti.co.kr` | DNS only (카페24 와일드카드 관행 유지) |
| MX | `@` | `10 kr1-aspmx1.worksmobile.com`, `20 kr1-aspmx2.worksmobile.com` | — |
| TXT | `@` | 카페24 DNS 관리 화면의 SPF/인증 TXT 전부 그대로 (스캔 누락 시 수동) | — |
| A | `play` | VPS IP | DNS only (Caddy가 ACME) |
| A | `api` | VPS IP | DNS only |
| CNAME | `img` | (R2 커스텀 도메인이 자동 생성) | 프록시 |

2. 카페24 → 도메인 관리 → 네임서버를 **`laila.ns.cloudflare.com` / `zac.ns.cloudflare.com`**(2026-09-01 배정)으로 변경, 기존 `ns-*.cafe24.com` 삭제. (zone은 이미 생성돼 9개 레코드 DNS-only로 검수 완료. **네임서버 변경 신청 접수 2026-09-01 — 카페24 안내 24~48시간, 카페24 DNS엔 SPF/TXT 없음 확인.**) 전파 후 `nslookup -type=NS nutti.co.kr`로 확인, 쇼핑몰·계산기(`nutti.co.kr/calculator`)·메일 수신 스모크.

## 1. R2

1. R2 → Create bucket `nutti-media` (APAC) — **생성 완료(2026-09-01)**, S3 endpoint `https://bd5bc80960aa7aebb998c9822fcdb361.r2.cloudflarestorage.com`. **Custom Domains** → `img.nutti.co.kr` 연결은 **zone이 active(네임서버 전환 완료)여야 API가 받아줌**(pending 상태에선 400) — §0-2 뒤에 수행.
   - ⚠️ 버킷 **수명 주기(Lifecycle) 일괄 삭제 규칙을 걸지 말 것** — `uploads/`·`results/` 키에 게스트/회원 구분이 없어 회원 보관함(W-09) 이미지까지 지워진다. 용량 관리는 `scripts/purge_deleted.py`(논리삭제 실파기)와 과금 알림(Notifications → Usage Based Billing)으로.
2. R2 API 토큰(Object Read & Write, 버킷 한정) 발급 → `.env`의 `R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com`, `R2_BUCKET_NAME=nutti-media`, `CDN_BASE_URL=https://img.nutti.co.kr`.
3. CORS(이슈 #77): `uv run python scripts/setup_r2_cors.py --origins https://play.nutti.co.kr` — 안 하면 W-06 "이미지 저장"이 조용히 깨진다.

## 2. Vultr VPS

Cloud Compute · Seoul · Ubuntu 24.04 · 2 vCPU / 2 GB(초기) · 자동 백업(스냅샷) ON · SSH 키 등록.

```bash
ssh root@<VPS_IP>
apt update && apt install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
git clone https://github.com/N-utti/nutti-photo-playground.git /opt/nutti && cd /opt/nutti
cp .env.example .env && nano .env      # 아래 §3 값 채우기
```

## 3. `.env` 프로덕션 값 (06-arch §7)

| 키 | 값 |
|---|---|
| `DATABASE_URL` | `postgres://nutti:<강한비밀번호>@postgres:5432/nutti` |
| `POSTGRES_PASSWORD` | 위와 동일 |
| `JWT_SIGNING_KEY` | `openssl rand -base64 48` |
| `APP_ENV` | `production` |
| `TRUST_PROXY` | `true` (Caddy 뒤) |
| `CORS_ALLOWED_ORIGINS` | `https://play.nutti.co.kr` |
| `CAFE24_REDIRECT_URI` | `https://play.nutti.co.kr/auth/callback/cafe24` (앱 설정에 등록됨 — 운영자 토큰 발급 `scripts/cafe24_token.py` 전용, 고객 콜백 아님) |
| `CAFE24_SMS_SENDER_NO` | 카페24 관리자 → SMS 발신번호로 **인증 등록된** 번호의 **등록 ID**(`GET /admin/sms/senders`의 `sender_no`, 예: `2` — 전화번호를 넣으면 422 "There is no sender"). 쇼핑몰 계정 연동 OTP 발송에 사용 — 미설정/SMS 서비스 미사용/잔액 0이면 `link/request`가 502 |
| `KAKAO_REDIRECT_URI` / `NAVER_REDIRECT_URI` | `https://play.nutti.co.kr/auth/callback/kakao` · `/naver` — 각 콘솔에도 등록 |
| `ACME_EMAIL` | 운영자 메일 |
| `R2_*`, `CDN_BASE_URL` | §1 |
| `ADMIN_ALERT_SLACK_WEBHOOK_URL` | Slack Incoming Webhook |
| `FAL_KEY` 등 이미지 생성 키 | 로컬 `.env`와 동일 |

## 4. 빌드 · 마이그레이션 · 기동

```bash
cd /opt/nutti
# 프론트 빌드(호스트에 node 불필요)
docker run --rm -v "$PWD/web:/w" -w /w -e VITE_API_BASE_URL=https://api.nutti.co.kr/v1 node:22 sh -c "npm ci && npm run build"
# 스키마 — migrations/*.py SQL을 눈으로 확인한 뒤(06-arch §9)
docker compose -f deploy/docker-compose.prod.yml run --rm api aerich upgrade
docker compose -f deploy/docker-compose.prod.yml up -d --build
docker compose -f deploy/docker-compose.prod.yml run --rm api python scripts/create_admin.py <email> <password>
docker compose -f deploy/docker-compose.prod.yml run --rm api python scripts/seed_styles.py
```

`web/.env.production`의 `VITE_API_BASE_URL` 자리표시자는 위 빌드 env로 덮인다(파일 자체도 `https://api.nutti.co.kr/v1`로 갱신할 것).

## 5. 카페24 토큰 + cron

```bash
# 최초 1회: URL 출력 → 대표운영자 승인 → 주소창 code 붙여넣기 (1분 내)
# 스코프 변경(예: mall.write_notification 추가) 후에도 같은 절차로 재발급
docker compose -f deploy/docker-compose.prod.yml run --rm api python scripts/cafe24_token.py
docker compose -f deploy/docker-compose.prod.yml run --rm api python scripts/cafe24_token.py <code>

crontab -e
*/30 * * * * cd /opt/nutti && docker compose -f deploy/docker-compose.prod.yml run --rm -T api python scripts/sync_cafe24_orders.py >> /var/log/nutti-cafe24.log 2>&1
15 4 * * *   cd /opt/nutti && docker compose -f deploy/docker-compose.prod.yml run --rm -T api python scripts/purge_deleted.py >> /var/log/nutti-purge.log 2>&1
30 4 * * *   cd /opt/nutti && docker compose -f deploy/docker-compose.prod.yml exec -T postgres pg_dump -U nutti nutti | gzip > /var/backups/nutti-$(date +\%F).sql.gz && find /var/backups -name 'nutti-*.sql.gz' -mtime +14 -delete
```

연동 오픈 후 **30일 안에** 배치가 돌아야 한다(최초 워터마크 룩백 한계, 06-arch §6.2).

### 5-1. 카페24 주문 웹훅(즉시 +20)

1. 개발자센터 앱 `nutti_a` → 권한: 주문 이벤트는 **상품분류·판매분류·회원·주문·상품·프로모션·공급사 읽기** 권한이 전부 있어야 이벤트 목록에 뜬다(문서 "수신 가능 이벤트 및 필요 권한") → 추가 후 **저장** → 운영자 토큰 **재발급**(§5, 새 scope 동의).
2. 같은 화면 WebHook → 등록: 이벤트 `90023 주문 접수` · `90025 입금상태 변경` · `90026 취소상태 변경`(+`90072`, `90029`, `90073`), 수신 URL `https://api.nutti.co.kr/v1/webhooks/cafe24`, 수신여부 **수신** → 저장. 쇼핑몰 운영자 **실시간 정보 제공 동의**가 한 번 더 뜬다.
3. 화면의 **WebHook 인증정보**(UUID)를 서버 `.env`의 `CAFE24_WEBHOOK_API_KEY`에 → `up -d`. 미설정이면 엔드포인트가 전부 401.
4. 목록의 **[TEST]**로 샘플 전송 → api 로그에 `cafe24 webhook resync` 또는 `accepted: false`(샘플 member_id는 미연동이라 false가 정상). **[로그]**에서 응답코드 202 확인.
5. 발송 서버 IP `203.245.45.182`, `203.245.45.183`(HTTPS 443) — 방화벽을 좁힐 때 허용.

### 5-2. 인스타 댓글→DM 퍼널 (Meta 앱)

배경: 인스타는 팔로우 여부를 제3자에게 안 준다 — 예외는 메시징 API 프로필의 `is_user_follow_business`(DM 보낸 사용자만). 05 §3 `webhooks/instagram` 참고. Threads 봇 앱(`sns-comment-boooot`)은 권한 체계가 달라 재사용 불가 — **같은 비즈니스(비즈니스 인증 승계) 아래 새 앱**을 만든다.

1. developers.facebook.com → 내 앱 → 앱 만들기(비즈니스 포트폴리오: Nutti) → 제품 추가 **Instagram** → "Instagram API setup with Instagram login".
2. Instagram 비즈니스 로그인 설정: 리디렉션 URI `https://play.nutti.co.kr/auth/callback/instagram`. 앱 ID/시크릿 → `.env` `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`.
3. `@nutti_official`이 **프로페셔널 계정**인지 확인 → 앱 역할 › **Instagram 테스터**에 추가(인스타 앱 › 설정 › 앱과 웹사이트 › 테스터 초대 수락). 검수 전엔 테스터 계정의 댓글/DM만 웹훅이 온다.
4. 토큰: `docker compose … run --rm api python scripts/instagram_token.py` → URL을 `@nutti_official` 로그인 상태에서 열어 승인 → 리다이렉트 URL의 `code=…#_`를 `scripts/instagram_token.py <code>`로 교환(장기 60일, 만료 7일 전 자동 갱신).
5. Webhooks: 콜백 URL `https://api.nutti.co.kr/v1/webhooks/instagram`, 확인 토큰 = `.env` `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`(임의 문자열) → 구독 필드 **`comments`, `messages`**. 콘솔 [테스트] 전송으로 api 로그 200 확인.
6. 앱 검수: 이용사례에 `instagram_business_basic` · `instagram_business_manage_comments` · `instagram_business_manage_messages` → 스크린캐스트(댓글 → 비공개 답장 → 「완료」 답장 → 코드 DM → 놀이터 로그인 → 크레딧)와 영어 자막, 개인정보처리방침 URL(`nutti.co.kr/privacy.html`) 재사용. Threads 반려 교훈: **엔드투엔드 한 테이크**.
7. 문구·키워드는 `app/instagram.py` 상수와 `INSTAGRAM_COMMENT_KEYWORDS`. 비공개 답장은 댓글 후 7일 내 1회, 이후 DM은 사용자 마지막 메시지 후 24시간 내.

## 6. 배포 후 스모크

- `curl -I https://api.nutti.co.kr/v1/styles` → 200, `https://play.nutti.co.kr` 로딩
- 게스트 → 업로드 → 생성 → 결과 이미지가 `img.nutti.co.kr`에서 로드되고 "이미지 저장" 동작(CORS)
- 카카오/네이버 콜백이 `play.nutti.co.kr/auth/callback/*`로 돌아옴; 쇼핑몰 계정 연동은 아이디 입력 → 실제 SMS 수신 → 코드 입력까지(카페24 앱 권한에 **알림 쓰기**·SMS 잔액 필요)
- GA4 관리자 → 데이터 스트림 → 도메인 구성에 `play.nutti.co.kr` 추가 → 계산기→놀이터 이동 URL에 `_gl=` 붙는지
- 관리자 로그인 → `/v1/admin/cafe24/status`가 토큰 상태 반환

## 재배포

```bash
cd /opt/nutti && git pull && docker compose -f deploy/docker-compose.prod.yml up -d --build
# 프론트 변경 시 §4 빌드 명령 먼저
```
