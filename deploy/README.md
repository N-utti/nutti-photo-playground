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

2. 카페24 → 도메인 관리 → 네임서버를 **`laila.ns.cloudflare.com` / `zac.ns.cloudflare.com`**(2026-09-01 배정)으로 변경, 기존 `ns-*.cafe24.com` 삭제. (zone은 이미 생성돼 9개 레코드 DNS-only로 검수 완료.) 전파 후 `nslookup -type=NS nutti.co.kr`로 확인, 쇼핑몰·계산기(`nutti.co.kr/calculator`)·메일 수신 스모크.

## 1. R2

1. R2 → Create bucket `nutti-media` (APAC). **Custom Domains** → `img.nutti.co.kr` 연결.
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
| `CAFE24_REDIRECT_URI` | `https://play.nutti.co.kr/auth/callback/cafe24` (앱 설정에 등록됨) |
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
docker compose -f deploy/docker-compose.prod.yml run --rm api python scripts/cafe24_token.py
docker compose -f deploy/docker-compose.prod.yml run --rm api python scripts/cafe24_token.py <code>

crontab -e
*/30 * * * * cd /opt/nutti && docker compose -f deploy/docker-compose.prod.yml run --rm -T api python scripts/sync_cafe24_orders.py >> /var/log/nutti-cafe24.log 2>&1
15 4 * * *   cd /opt/nutti && docker compose -f deploy/docker-compose.prod.yml run --rm -T api python scripts/purge_deleted.py >> /var/log/nutti-purge.log 2>&1
30 4 * * *   cd /opt/nutti && docker compose -f deploy/docker-compose.prod.yml exec -T postgres pg_dump -U nutti nutti | gzip > /var/backups/nutti-$(date +\%F).sql.gz && find /var/backups -name 'nutti-*.sql.gz' -mtime +14 -delete
```

연동 오픈 후 **30일 안에** 배치가 돌아야 한다(최초 워터마크 룩백 한계, 06-arch §6.2).

## 6. 배포 후 스모크

- `curl -I https://api.nutti.co.kr/v1/styles` → 200, `https://play.nutti.co.kr` 로딩
- 게스트 → 업로드 → 생성 → 결과 이미지가 `img.nutti.co.kr`에서 로드되고 "이미지 저장" 동작(CORS)
- 카카오/네이버/카페24 콜백이 `play.nutti.co.kr/auth/callback/*`로 돌아옴
- GA4 관리자 → 데이터 스트림 → 도메인 구성에 `play.nutti.co.kr` 추가 → 계산기→놀이터 이동 URL에 `_gl=` 붙는지
- 관리자 로그인 → `/v1/admin/cafe24/status`가 토큰 상태 반환

## 재배포

```bash
cd /opt/nutti && git pull && docker compose -f deploy/docker-compose.prod.yml up -d --build
# 프론트 변경 시 §4 빌드 명령 먼저
```
