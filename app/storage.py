import asyncio
import os
from pathlib import Path

import boto3

from app.settings import settings

MEDIA_ROOT = "var/media"


async def save_bytes(key: str, data: bytes, content_type: str) -> None:
    if settings.r2_endpoint_url:
        client = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint_url,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
        )
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
        client = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint_url,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
        )
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
        client = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint_url,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
        )
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
