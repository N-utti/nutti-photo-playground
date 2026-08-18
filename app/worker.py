"""asyncio 워커 뼈대 — docs/06-architecture-deployment.md §2.

Postgres `generation_job` 테이블 자체를 큐로 쓴다(Redis/arq 없음). §2.4의 승격 조건
(재처리율 1%↑, 폴링 지연 P95 10초↑, 워커 스케일아웃 필요) 중 하나라도 충족하기 전까지는
이 폴링 루프 그대로 유지한다(YAGNI).

ponytail: lease/처리 함수는 스텁. 실제 구현 시 채울 것 —
  - lease_job: status='processing', lease_expires_at=now()+90s, attempt_count+=1 커밋
  - process_job: job당 프로바이더 요청 1건 발행(§2.3, Q4 확정 — 1요청 1장) →
    Pillow 서명 합성(§4) → R2 업로드 → generation_result 1행 INSERT → status 갱신,
    실패 시 크레딧 refund. 산출 수 상향 시 asyncio.gather 동시 발행으로 확장(§2.3)
  - attempt_count가 임계(3회) 초과 시 status='failed', error_code='MAX_RETRIES_EXCEEDED'
"""

import asyncio
import base64
import io
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from openai import AsyncOpenAI, BadRequestError
from PIL import Image, ImageDraw, ImageFont, ImageOps
from tortoise import Tortoise
from tortoise.exceptions import DoesNotExist
from tortoise.transactions import in_transaction

from app.credits import grant_credits
from app.models import (
    CustomPromptLog,
    GenerationJob,
    GenerationResult,
    JobStatus,
    PetProfile,
    StylePromptVersion,
)
from app.settings import settings
from app.storage import load_bytes, save_bytes

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


class _MissingPromptError(RuntimeError):
    pass


_SAFETY_BLOCK_CODES = {"moderation_blocked", "content_policy_violation"}


def _is_safety_block(exc: Exception) -> bool:
    return (
        isinstance(exc, BadRequestError)
        and isinstance(exc.code, str)
        and exc.code in _SAFETY_BLOCK_CODES
    )


async def _generate_image(
    original: bytes,
    prompt: str,
    style_name: str,
    model_config: dict | None = None,
) -> bytes:
    if settings.fal_key:
        config = model_config or {}
        endpoint = config.get("fal_endpoint") or settings.fal_image_endpoint
        payload = {
            "prompt": prompt,
            "image_urls": [f"data:image/jpeg;base64,{base64.b64encode(original).decode()}"],
            "output_format": "jpeg",
        }
        if endpoint.startswith("openai/"):
            payload.update(quality=settings.openai_image_quality, image_size="auto")
        else:
            payload["resolution"] = "1K"
        payload.update(config.get("fal_args", {}))
        auth_headers = {"Authorization": f"Key {settings.fal_key}"}

        async with asyncio.timeout(300):
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"https://queue.fal.run/{endpoint}",
                    headers=auth_headers,
                    json=payload,
                )
                response.raise_for_status()
                status_url = response.json()["status_url"]
                while True:
                    response = await client.get(status_url, headers=auth_headers)
                    response.raise_for_status()
                    status_data = response.json()
                    status = status_data.get("status")
                    if status == "COMPLETED":
                        break
                    if status not in {"IN_QUEUE", "IN_PROGRESS"}:
                        raise RuntimeError(f"fal image generation failed: {status}")
                    await asyncio.sleep(3)
                response = await client.get(
                    status_data["response_url"], headers=auth_headers
                )
                response.raise_for_status()
                response = await client.get(response.json()["images"][0]["url"])
                response.raise_for_status()
                return response.content

    elif settings.openai_api_key:
        response = await AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
        ).images.edit(
            model=settings.openai_image_model,
            image=("source.jpg", original, "image/jpeg"),
            prompt=prompt,
            size="1024x1024",
            quality=settings.openai_image_quality,
            n=1,
        )
        if not response.data or not response.data[0].b64_json:
            raise ValueError("OpenAI image response did not contain image data")
        return base64.b64decode(response.data[0].b64_json)

    # ponytail: dev-only visual fallback; an API key switches generation to OpenAI.
    with Image.open(io.BytesIO(original)) as source:
        image = ImageOps.posterize(ImageOps.exif_transpose(source).convert("RGB"), 3).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    ImageDraw.Draw(overlay).text(
        (12, 12), style_name, fill=(255, 255, 255, 190), font=ImageFont.load_default()
    )
    image.alpha_composite(overlay)
    output = io.BytesIO()
    image.convert("RGB").save(output, format="PNG")
    return output.getvalue()


def _sign_and_encode_jpeg(image_bytes: bytes) -> bytes:
    with Image.open(io.BytesIO(image_bytes)) as source:
        image = ImageOps.exif_transpose(source).convert("RGBA")
    font = ImageFont.load_default()
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    left, top, right, bottom = draw.textbbox((0, 0), "Nutti", font=font)
    position = (image.width - (right - left) - 12, image.height - (bottom - top) - 12)
    draw.text((position[0] + 1, position[1] + 1), "Nutti", fill=(0, 0, 0, 160), font=font)
    draw.text(position, "Nutti", fill=(255, 255, 255, 200), font=font)
    image.alpha_composite(overlay)
    output = io.BytesIO()
    image.convert("RGB").save(output, format="JPEG")
    return output.getvalue()


async def _refund(
    generation_job: GenerationJob, reason: str = "generation_refund"
) -> None:
    await grant_credits(
        generation_job.member_id,
        generation_job.credit_cost,
        reason,
        f"refund:{generation_job.id}",
        ref_id=str(generation_job.id),
    )


async def fetch_next_job() -> dict | None:
    # ponytail: 락 공백 제거 — 멀티 워커 스케일아웃 대비(06-arch §2.4)
    async with in_transaction() as connection:
        rows = await connection.execute_query_dict(FETCH_NEXT_JOB_SQL)
        if not rows:
            return None
        await lease_job(rows[0]["id"], connection=connection)
        return rows[0]


async def lease_job(job_id: str, connection=None) -> None:
    query = GenerationJob.get(id=job_id)
    generation_job = await (query.using_db(connection) if connection is not None else query)
    now = datetime.now(timezone.utc)
    generation_job.status = JobStatus.PROCESSING
    generation_job.lease_expires_at = now + timedelta(seconds=LEASE_SECONDS)
    generation_job.attempt_count += 1
    update_fields = ["status", "lease_expires_at", "attempt_count"]
    if generation_job.started_at is None:
        # ponytail: 재시도에도 최초 시작 시각 유지 — 이슈 #41.
        generation_job.started_at = now
        update_fields.append("started_at")
    await generation_job.save(update_fields=update_fields, using_db=connection)


async def process_job(job: dict, *, lease: bool = True) -> None:
    job_id = job["id"]
    if lease:
        await lease_job(job_id)
    generation_job = await GenerationJob.get(id=job_id)
    await generation_job.fetch_related("style", "source_image")

    try:
        if generation_job.style_id is not None:
            if generation_job.prompt_version_id is None:
                raise _MissingPromptError("preset job has no prompt version")
            prompt_version = await StylePromptVersion.get(id=generation_job.prompt_version_id)
            prompt = prompt_version.prompt_text
            model_config = prompt_version.model_config
            pet_profile = None
            if (
                "[pet name]" in prompt or "[breed]" in prompt
            ) and generation_job.source_image.pet_profile_id is not None:
                pet_profile = await PetProfile.get(
                    id=generation_job.source_image.pet_profile_id
                )
            if "[pet name]" in prompt:
                # ponytail: 프로필이나 이름이 없으면 별도 정책 없이 고정 호칭을 쓴다.
                pet_name = (pet_profile.name if pet_profile is not None else None) or "우리 아이"
                prompt = prompt.replace("[pet name]", pet_name)
            if "[breed]" in prompt:
                breed = (
                    pet_profile.breed_label if pet_profile is not None else None
                ) or "강아지"
                prompt = prompt.replace("[breed]", breed)
            style_name = generation_job.style.name
        else:
            if generation_job.custom_prompt_id is None:
                raise _MissingPromptError("custom job has no prompt log")
            try:
                prompt_log = await CustomPromptLog.get(id=generation_job.custom_prompt_id)
            except DoesNotExist as exc:
                raise _MissingPromptError("custom prompt log does not exist") from exc
            prompt = (
                f"강아지 사진을 다음 지시로 변환: {prompt_log.raw_text}. "
                "품종·털색·무늬는 원본 유지."
            )
            style_name = "커스텀"
            model_config = None

        original = await load_bytes(generation_job.source_image.storage_key)
        generated = await _generate_image(
            original, prompt, style_name, model_config=model_config
        )
        jpeg_bytes = _sign_and_encode_jpeg(generated)
        key = f"results/{uuid.uuid4()}.jpg"
        await save_bytes(key, jpeg_bytes, "image/jpeg")
        await GenerationResult.create(job=generation_job, seq=1, storage_key=key)
        generation_job.status = JobStatus.SUCCEEDED
        generation_job.finished_at = datetime.now(timezone.utc)
        await generation_job.save(update_fields=["status", "finished_at"])
    except _MissingPromptError:
        generation_job.status = JobStatus.FAILED
        generation_job.error_code = "GENERATION_FAILED"
        generation_job.finished_at = datetime.now(timezone.utc)
        await generation_job.save(update_fields=["status", "error_code", "finished_at"])
        await _refund(generation_job)
    except Exception as exc:
        if _is_safety_block(exc):
            # ponytail: moderation 거부는 재시도해도 같은 결과 — 즉시 종결(FR-EDGE-13)
            generation_job.status = JobStatus.FAILED
            generation_job.error_code = "SAFETY_BLOCKED"
            generation_job.finished_at = datetime.now(timezone.utc)
            await generation_job.save(update_fields=["status", "error_code", "finished_at"])
            await _refund(generation_job, reason="safety_block_refund")
        elif generation_job.attempt_count >= MAX_ATTEMPTS:
            generation_job.status = JobStatus.FAILED
            generation_job.error_code = "MAX_RETRIES_EXCEEDED"
            generation_job.finished_at = datetime.now(timezone.utc)
            await generation_job.save(update_fields=["status", "error_code", "finished_at"])
            await _refund(generation_job)
        else:
            generation_job.status = JobStatus.QUEUED
            await generation_job.save(update_fields=["status"])


async def run_worker_loop() -> None:
    while True:
        job = await fetch_next_job()
        if job is not None:
            await process_job(job, lease=False)
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
