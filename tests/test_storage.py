import os
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

from app import storage
from app.settings import settings


def test_download_url_signs_attachment_disposition(monkeypatch):
    """R2 presigned GET 에 첨부 헤더가 실려야 웹뷰가 «표시» 대신 «저장» 한다 (app/storage.py)."""
    monkeypatch.setattr(settings, "r2_endpoint_url", "https://acct.r2.cloudflarestorage.com")
    monkeypatch.setattr(settings, "r2_access_key_id", "test-key")
    monkeypatch.setattr(settings, "r2_secret_access_key", "test-secret")
    monkeypatch.setattr(settings, "r2_bucket_name", "nutti-media")
    storage._presign_client.cache_clear()
    try:
        url = storage.download_url("results/a.jpg", "nutti-a.jpg")
    finally:
        storage._presign_client.cache_clear()

    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    assert parsed.netloc == "acct.r2.cloudflarestorage.com"
    assert parsed.path == "/nutti-media/results/a.jpg"
    assert query["response-content-disposition"] == ['attachment; filename="nutti-a.jpg"']
    assert query["X-Amz-Expires"] == [str(storage.DOWNLOAD_URL_TTL_SECONDS)]
    assert "X-Amz-Signature" in query


def test_download_url_falls_back_to_public_url_without_r2(monkeypatch):
    monkeypatch.setattr(settings, "r2_endpoint_url", "")
    monkeypatch.setattr(settings, "cdn_base_url", "")
    assert storage.download_url("results/a.jpg", "x.jpg") == "/media/results/a.jpg"
