"""R2 버킷 CORS 설정 — 이슈 #77.

CDN(크로스 오리진)에서 서빙되는 결과 이미지를 프론트가 fetch→blob→download 로
저장할 수 있으려면 이미지 응답에 Access-Control-Allow-Origin 이 필요하다.
R2 프로비저닝 후(.env 에 r2_* 채운 뒤) 한 번 실행:

    uv run python scripts/setup_r2_cors.py --origins https://photo.nutti.co.kr
    (--origins 생략 시 CORS_ALLOWED_ORIGINS 사용, --dry-run 은 규칙만 출력)
"""

import argparse
import json

import boto3

from app.settings import settings


def build_rules(origins: list[str]) -> list[dict]:
    # 이미지 읽기 전용이므로 GET/HEAD 면 충분. 쓰기는 전부 앱 서버 경유.
    return [
        {
            "AllowedOrigins": origins,
            "AllowedMethods": ["GET", "HEAD"],
            "AllowedHeaders": ["*"],
            "MaxAgeSeconds": 86400,
        }
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--origins", help="쉼표 구분 오리진 목록 (기본: CORS_ALLOWED_ORIGINS)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    raw = args.origins or settings.cors_allowed_origins
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    if not origins:
        raise SystemExit("error: no origins (--origins 또는 CORS_ALLOWED_ORIGINS 필요)")
    rules = build_rules(origins)
    print(json.dumps(rules, ensure_ascii=False, indent=2))

    if args.dry_run:
        return
    if not settings.r2_endpoint_url:
        raise SystemExit("error: r2_endpoint_url 미설정 — R2 프로비저닝 후 실행하세요")
    boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
    ).put_bucket_cors(
        Bucket=settings.r2_bucket_name,
        CORSConfiguration={"CORSRules": rules},
    )
    print(f"applied to bucket: {settings.r2_bucket_name}")


if __name__ == "__main__":
    main()
