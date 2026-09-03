import base64
import io
import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile
from openai import AsyncOpenAI
from PIL import Image, ImageFilter, ImageOps, ImageStat, UnidentifiedImageError
from pydantic import BaseModel

from app.auth import get_current_member
from app.common import not_found, unauthorized, validation_error
from app.models import AppSetting, Member, MemberKind, PetProfile, SourceImage
from app.settings import settings
from app.storage import load_bytes, public_url, save_bytes

router = APIRouter(tags=["uploads"])

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_FILE_SIZE = 10 * 1024 * 1024
_MAX_IMAGE_SIDE = 2048
# ponytail: 파일럿 운영 데이터로 튜닝 예정인 임의 초기 추정치(8-bit 밝기 평균 60).
_DARK_THRESHOLD = 60
# ponytail: OpenCV 없이 FIND_EDGES 분산으로 Laplacian 분산을 근사한다. 선명/흐림 개발
# 샘플 수 장을 눈대중 비교해 100을 초기 경계로 잡았고, 파일럿 오탐 데이터가 쌓이면 조정한다.
_BLUR_VARIANCE_THRESHOLD = 100.0
# 두 키 모두 block/warn/allow. no_dog 기본값이 block 인 이유: 강아지 없는 사진은 헛생성($0.05)만 낳고,
# 경고로 두면 실서버에서 아무도 안 읽었다(2026-09-03 PO 결정, FR-EDGE-08 개정).
_POLICY_DEFAULTS = {"human_face_policy": "warn", "no_dog_policy": "block"}


class BlockingIssue(BaseModel):
    code: str
    message: str


class Warning(BaseModel):
    code: str
    message: str
    detail: dict | None = None


class UploadResponse(BaseModel):
    upload_id: str | None = None
    image_url: str | None = None
    blocking_issue: BlockingIssue | None = None
    warnings: list[Warning]


class _VisionResult(BaseModel):
    is_dog: bool
    is_cat: bool
    multi_subject: bool
    human_face: bool


def _vision_fields(vision: _VisionResult | None) -> dict[str, bool]:
    # 비전이 꺼져 있거나 실패하면 전부 False + vision_checked=False — 판정 안 함을 남긴다.
    return {
        "multi_subject": bool(vision and vision.multi_subject),
        "no_dog": bool(vision and not vision.is_dog),
        "cat": bool(vision and vision.is_cat),
        "human_face": bool(vision and vision.human_face),
        "vision_checked": vision is not None,
    }


def _blocking_issue(check: dict, policies: dict[str, str]) -> dict | None:
    """quality_check 값 + 정책 → 차단 사유. 업로드와 재생성(POST /v1/jobs)이 같은 판정을 쓴다."""
    if check.get("cat"):
        return {"code": "CAT_DETECTED", "message": "누띠는 강아지 전용이에요. 다른 사진을 골라주세요."}
    if check.get("human_face") and policies["human_face_policy"] == "block":
        return {"code": "HUMAN_FACE_DETECTED", "message": "사람 얼굴이 포함된 사진은 사용할 수 없어요."}
    if check.get("no_dog") and policies["no_dog_policy"] == "block":
        return {
            "code": "NOT_A_DOG",
            "message": "강아지를 찾지 못했어요. 강아지가 잘 보이는 사진을 골라주세요.",
        }
    return None


async def source_blocking_issue(source: SourceImage) -> dict | None:
    """보관함 「다시 만들기」도 업로드와 같은 차단을 받는다.

    비전을 켜기 전에 올라간 사진(`vision_checked` 없음)은 여기서 한 번 검사해 적어 둔다 —
    그 시절 quality_check 는 전부 False 라 「검사 안 함」과 「강아지 맞음」을 구분할 수 없다.
    """
    check = source.quality_check or {}
    if not check.get("vision_checked") and settings.openai_api_key:
        try:
            vision = await _analyze_vision(await load_bytes(source.storage_key))
        except Exception:
            vision = None
        if vision is None:
            return None
        check = {**check, **_vision_fields(vision)}
        source.quality_check = check
        await source.save(update_fields=["quality_check"])
    if not check.get("vision_checked"):
        return None
    return _blocking_issue(check, await _policies())


def _process_image(data: bytes) -> tuple[Image.Image, bytes]:
    with Image.open(io.BytesIO(data)) as source:
        image = ImageOps.exif_transpose(source)
        image.thumbnail((_MAX_IMAGE_SIDE, _MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
        if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
            rgba = image.convert("RGBA")
            processed = Image.new("RGB", rgba.size, "white")
            processed.paste(rgba, mask=rgba.getchannel("A"))
        else:
            processed = image.convert("RGB")

    output = io.BytesIO()
    # 기본값(quality 75 · 크로마 4:2:0)은 폰 화면에서 털·경계가 뭉개져 보였고(라이브 신고),
    # 이 파일이 미리보기·원본 슬라이더·생성 입력에 전부 쓰인다. 육안 무손실급으로 저장.
    processed.save(output, format="JPEG", quality=92, subsampling=0, optimize=True)
    return processed, output.getvalue()


def _quality_check(image: Image.Image) -> dict[str, bool]:
    gray = image.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES)
    if edges.width > 2 and edges.height > 2:
        edges = edges.crop((1, 1, edges.width - 1, edges.height - 1))
    return {
        "blur": ImageStat.Stat(edges).var[0] < _BLUR_VARIANCE_THRESHOLD,
        "dark": ImageStat.Stat(gray).mean[0] < _DARK_THRESHOLD,
    }


async def _analyze_vision(jpeg_bytes: bytes) -> _VisionResult | None:
    # ponytail: 로컬 개발은 키 없이 업로드 흐름만 검증하고, 키를 채우면 비전 검사가 켜진다.
    if not settings.openai_api_key:
        return None

    prompt = """이미지를 검사해 다음 JSON만 반환하세요.
{"is_dog": bool, "is_cat": bool, "multi_subject": bool, "human_face": bool}
is_dog/is_cat은 해당 동물이 명확히 보이는지, multi_subject는 동물이 여러 마리인지 판정하세요."""
    try:
        response = await AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
        ).chat.completions.create(
            model=settings.openai_vision_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": "data:image/jpeg;base64,"
                                + base64.b64encode(jpeg_bytes).decode()
                            },
                        },
                    ],
                }
            ],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        if content is None:
            return None
        return _VisionResult.model_validate_json(content)
    except Exception:
        # Vision failure must never prevent the upload itself.
        return None


async def _policies() -> dict[str, str]:
    rows = await AppSetting.filter(key__in=_POLICY_DEFAULTS).all()
    stored = {row.key: row.value for row in rows}
    return {
        key: stored[key] if stored.get(key) in {"block", "warn", "allow"} else default
        for key, default in _POLICY_DEFAULTS.items()
    }


@router.post("/uploads", response_model=UploadResponse)
async def upload_photo(
    file: UploadFile = File(...),
    pet_id: str | None = Form(None),
    member: Member = Depends(get_current_member),
):
    if file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise validation_error("지원하지 않는 이미지 형식입니다")
    data = await file.read()
    if len(data) > _MAX_FILE_SIZE:
        raise validation_error("파일 크기는 10MB 이하여야 합니다")

    pet = None
    if pet_id is not None:
        try:
            pet_uuid = uuid.UUID(pet_id)
        except ValueError as exc:
            raise validation_error("pet_id 형식이 올바르지 않습니다") from exc
        pet = await PetProfile.filter(id=pet_uuid, member_id=member.id).first()
        if pet is None:
            raise not_found("Pet not found")

    try:
        image, jpeg_bytes = _process_image(data)
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
        raise validation_error("올바른 이미지 파일이 아닙니다") from exc

    quality = _quality_check(image)
    quality_check = {**quality, **_vision_fields(await _analyze_vision(jpeg_bytes))}
    policies = await _policies()

    blocked = _blocking_issue(quality_check, policies)
    if blocked is not None:
        return {"upload_id": None, "image_url": None, "blocking_issue": blocked, "warnings": []}

    warnings = []
    if quality_check["human_face"] and policies["human_face_policy"] == "warn":
        warnings.append(
            {
                "code": "HUMAN_FACE_DETECTED",
                "message": "사람 얼굴이 함께 보여요",
                "detail": None,
            }
        )
    if quality_check["no_dog"] and policies["no_dog_policy"] == "warn":
        warnings.append(
            {
                "code": "NOT_A_DOG",
                "message": "강아지가 잘 보이지 않아요",
                "detail": None,
            }
        )
    if quality_check["multi_subject"]:
        warnings.append(
            {
                "code": "MULTI_SUBJECT",
                "message": "여러 마리가 함께 보여요",
                "detail": None,
            }
        )
    issues = [issue for issue in ("dark", "blur") if quality[issue]]
    if issues:
        if issues == ["dark"]:
            message = "얼굴이 조금 어두워요"
        elif issues == ["blur"]:
            message = "사진이 조금 흐려요"
        else:
            message = "사진이 조금 어둡고 흐려요"
        warnings.append(
            {
                "code": "QUALITY_WARNING",
                "message": message,
                "detail": {"issues": issues},
            }
        )

    # 비전 분석 왕복 사이에 탈퇴가 커밋됐으면 저장하지 않는다(#22 in-flight 창)
    if await Member.filter(id=member.id, withdrawn_at__isnull=False).exists():
        raise unauthorized()
    key = f"uploads/{uuid.uuid4()}.jpg"
    await save_bytes(key, jpeg_bytes, "image/jpeg")
    source = await SourceImage.create(
        member=member,
        pet_profile=pet,
        storage_key=key,
        width=image.width,
        height=image.height,
        quality_check=quality_check,
        expires_at=member.guest_expires_at if member.kind == MemberKind.GUEST else None,
    )
    return {
        "upload_id": str(source.id),
        "image_url": public_url(key),
        "blocking_issue": None,
        "warnings": warnings,
    }
