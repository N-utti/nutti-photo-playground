import asyncio
import functools
import os
from pathlib import Path

import boto3
from botocore.config import Config

from app.settings import settings

MEDIA_ROOT = "var/media"


def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        # R2 는 SigV4 만 받는다. 헤더 서명(put/get)은 botocore 가 알아서 v4 를 쓰지만
        # presigned **쿼리** 서명은 명시하지 않으면 v2 로 떨어져 R2 가 거절한다(test_storage.py).
        config=Config(signature_version="s3v4", region_name="auto"),
    )


async def save_bytes(key: str, data: bytes, content_type: str) -> None:
    if settings.r2_endpoint_url:
        client = _r2_client()
        await asyncio.to_thread(
            client.put_object,
            Bucket=settings.r2_bucket_name,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        return

    # ponytail: dev-only fallback; filling the R2 credentials in .env switches storage automatically.
    path = os.path.join(MEDIA_ROOT, key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    await asyncio.to_thread(Path(path).write_bytes, data)


async def delete_bytes(key: str) -> None:
    """오브젝트 삭제 — 없는 키는 무시(멱등, 파기 배치 재실행 대비)."""
    if settings.r2_endpoint_url:
        client = _r2_client()
        await asyncio.to_thread(
            client.delete_object,
            Bucket=settings.r2_bucket_name,
            Key=key,
        )
        return
    await asyncio.to_thread(
        Path(os.path.join(MEDIA_ROOT, key)).unlink, missing_ok=True
    )


async def load_bytes(key: str) -> bytes:
    if settings.r2_endpoint_url:
        client = _r2_client()
        response = await asyncio.to_thread(
            client.get_object,
            Bucket=settings.r2_bucket_name,
            Key=key,
        )
        return await asyncio.to_thread(response["Body"].read)

    return await asyncio.to_thread(Path(os.path.join(MEDIA_ROOT, key)).read_bytes)


def public_url(key: str) -> str:
    if settings.cdn_base_url:
        return f"{settings.cdn_base_url}/{key}"
    return f"/media/{key}"


DOWNLOAD_URL_TTL_SECONDS = 3600


@functools.cache
def _presign_client():
    # ponytail: 서명은 네트워크 없는 로컬 연산이지만 boto3 클라이언트 생성은 수십 ms 라
    # 보관함 한 페이지(20장)마다 새로 만들지 않도록 한 번만 만든다.
    return _r2_client()


def download_url(key: str, filename: str) -> str:
    """브라우저가 **표시하지 않고 저장**하는 주소 — `Content-Disposition: attachment` 응답.

    R2 presigned GET 에 `ResponseContentDisposition` 을 실으면 R2 가 그 헤더로 응답한다.
    카카오 인앱 브라우저의 공식 다운로드 경로가 «응답 헤더» 방식이고(iOS·Android 모두),
    `blob:` + `download` 속성은 Android 웹뷰에서 파일을 만들지 않는다(2026-09-03 조사).
    그래서 «이미지 저장» 이 어느 브라우저에서나 같은 결과(기기에 파일)가 되려면 이 주소가
    필요하다. 1시간 만료 — 저장 버튼을 누른 직후 쓰는 주소라 충분하다.
    로컬(R2 없음)은 /media 그대로 — 개발 브라우저에서는 표시된다.
    """
    if not settings.r2_endpoint_url:
        return public_url(key)
    return _presign_client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.r2_bucket_name,
            "Key": key,
            "ResponseContentDisposition": f'attachment; filename="{filename}"',
        },
        ExpiresIn=DOWNLOAD_URL_TTL_SECONDS,
    )
