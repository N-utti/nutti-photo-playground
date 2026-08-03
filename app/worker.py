"""asyncio 워커 뼈대 — docs/06-architecture-deployment.md §2.

Postgres `generation_job` 테이블 자체를 큐로 쓴다(Redis/arq 없음). §2.4의 승격 조건
(재처리율 1%↑, 폴링 지연 P95 10초↑, 워커 스케일아웃 필요) 중 하나라도 충족하기 전까지는
이 폴링 루프 그대로 유지한다(YAGNI).

ponytail: lease/처리 함수는 스텁. 실제 구현 시 채울 것 —
  - lease_job: status='processing', lease_expires_at=now()+90s, attempt_count+=1 커밋
  - process_job: asyncio.gather로 4장 동시 생성(§2.3) → Pillow 서명 합성(§4) →
    R2 업로드 → generation_result 4행 INSERT → status 갱신, 실패 시 크레딧 refund
  - attempt_count가 임계(3회) 초과 시 status='failed', error_code='MAX_RETRIES_EXCEEDED'
"""

import asyncio

from tortoise import Tortoise

from app.settings import settings

POLL_INTERVAL_SECONDS = 2
LEASE_SECONDS = 90
MAX_ATTEMPTS = 3

# 코드베이스에서 raw SQL을 쓰는 유일한 지점(docs/06 §2.1) — 그 외 전 코드는 Tortoise
# 쿼리셋을 사용한다. Tortoise의 `.select_for_update()`가 SKIP LOCKED를 지원하는지는
# 도입 시점 버전에 따라 다르므로, 지원 확인되면 이 raw SQL을 ORM 호출로 대체할 것.
#
# ponytail: docs/06 §2.1 원문 쿼리는 `ORDER BY created_at`이지만 04-erd.md의
# generation_job 테이블에는 created_at 컬럼이 없다(queued_at만 존재) — 문서 오기로
# 판단해 실제 스키마에 맞춰 queued_at으로 정정했다.
FETCH_NEXT_JOB_SQL = """
SELECT * FROM generation_job
WHERE status = 'queued'
   OR (status = 'processing' AND lease_expires_at < now())
ORDER BY queued_at
FOR UPDATE SKIP LOCKED
LIMIT 1;
"""


async def fetch_next_job() -> dict | None:
    conn = Tortoise.get_connection("default")
    rows = await conn.execute_query_dict(FETCH_NEXT_JOB_SQL)
    return rows[0] if rows else None


async def lease_job(job_id: str) -> None:
    """job을 'processing'으로 표시하고 lease를 연장한다. ponytail: 스텁."""


async def process_job(job: dict) -> None:
    """4장 생성 → 서명 합성 → R2 업로드 → 상태 갱신. ponytail: 스텁."""


async def run_worker_loop() -> None:
    while True:
        job = await fetch_next_job()
        if job is not None:
            await process_job(job)
        else:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def main() -> None:
    await Tortoise.init(db_url=settings.database_url, modules={"models": ["app.models"]})
    try:
        await run_worker_loop()
    finally:
        await Tortoise.close_connections()


if __name__ == "__main__":
    asyncio.run(main())
