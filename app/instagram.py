"""인스타 댓글 → DM → 팔로우 확인 → 놀이터 코드 퍼널 (Instagram API with Instagram Login).

인스타그램은 "A가 B를 팔로우하는지"를 제3자에게 알려 주지 않는다 — 단 하나의 예외가 **메시징 API의 사용자 프로필**
(`is_user_follow_business`)이고, 이 값은 그 사용자가 우리 계정에 **DM을 보낸 뒤**에만 조회된다. 그래서 흐름이 이렇다:

  게시물 댓글(키워드) → 비공개 답장 DM("팔로우 후 「완료」 답장") → 사용자가 답장 → 프로필 조회 →
  팔로우 O: 1회용 코드 + 놀이터 링크 DM → 놀이터 로그인 시 코드 소진 → follow_ig 크레딧
  팔로우 X: "팔로우 후 다시 답장" DM

제약(공식 문서 2026-09-01): 비공개 답장은 댓글 후 7일 내 1회, 이후 DM은 사용자의 마지막 메시지 후 24시간 내.
토큰은 장기 토큰 60일 — 만료 7일 전부터 refresh. 모든 외부 호출 실패는 로그만 남기고 삼킨다(웹훅 응답은 항상 200).
"""

import hashlib
import hmac
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone

import httpx

from app.models import InstagramDmCode, InstagramToken
from app.settings import settings

logger = logging.getLogger(__name__)

GRAPH = "https://graph.instagram.com/v23.0"
REFRESH_MARGIN = timedelta(days=7)
CODE_TTL = timedelta(days=30)
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 0/O, 1/I 혼동 제거
CODE_LENGTH = 8

REPLY_TO_COMMENT = (
    "안녕하세요, 누띠예요 🐾 @nutti_official 팔로우 후 이 대화에 「완료」라고 답장해 주시면 "
    "놀이터 링크와 크레딧 코드를 보내드릴게요!"
)
NOT_FOLLOWING = "아직 팔로우가 확인되지 않아요 🥲 @nutti_official 팔로우 후 「완료」라고 다시 답장해 주세요."
FOLLOW_OK = (
    "팔로우 감사해요! 🎁 아래 링크로 들어와 로그인하면 팔로우 크레딧이 자동으로 들어가요.\n{link}\n(코드: {code})"
)


def verify_signature(raw_body: bytes, header: str | None) -> bool:
    """`X-Hub-Signature-256: sha256=<hmac>` — 앱 시크릿으로 원문 HMAC. 시크릿 미설정이면 전부 거부."""
    if not settings.instagram_app_secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(settings.instagram_app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), header[len("sha256=") :].encode())  # str 비교는 non-ASCII에서 TypeError


def keyword_matches(text: str) -> bool:
    keywords = [k.strip().lower() for k in settings.instagram_comment_keywords.split(",") if k.strip()]
    lowered = (text or "").lower()
    return not keywords or any(k in lowered for k in keywords)


def landing_link(code: str) -> str:
    return f"{settings.instagram_landing_url.rstrip('/')}/?ig={code}"


# ---------------------------------------------------------------- 토큰


async def exchange_code(code: str) -> InstagramToken:
    """운영자 1회: authorize code → 단기 토큰 → 장기 토큰(60일) → 저장 (scripts/instagram_token.py)."""
    async with httpx.AsyncClient(timeout=20) as client:
        short = await client.post(
            "https://api.instagram.com/oauth/access_token",
            data={
                "client_id": settings.instagram_app_id,
                "client_secret": settings.instagram_app_secret,
                "grant_type": "authorization_code",
                "redirect_uri": settings.instagram_redirect_uri,
                "code": code,
            },
        )
        short.raise_for_status()
        short_token = short.json()["access_token"]
        long = await client.get(
            f"{GRAPH}/access_token",
            params={
                "grant_type": "ig_exchange_token",
                "client_secret": settings.instagram_app_secret,
                "access_token": short_token,
            },
        )
        long.raise_for_status()
        data = long.json()
        me = await client.get(f"{GRAPH}/me", params={"fields": "user_id,username", "access_token": data["access_token"]})
        me.raise_for_status()
        profile = me.json()
    fields = {
        "username": profile.get("username"),
        "access_token": data["access_token"],
        "expires_at": datetime.now(timezone.utc) + timedelta(seconds=int(data.get("expires_in", 60 * 86400))),
        "last_refresh_error": None,
    }
    ig_user_id = str(profile.get("user_id") or profile.get("id"))
    token = await InstagramToken.get_or_none(ig_user_id=ig_user_id)
    if token is None:
        return await InstagramToken.create(ig_user_id=ig_user_id, **fields)
    await token.update_from_dict(fields).save()
    return token


async def get_token(now: datetime | None = None) -> InstagramToken:
    now = now or datetime.now(timezone.utc)
    token = await InstagramToken.first()
    if token is None:
        raise RuntimeError("instagram token missing — run scripts/instagram_token.py first")
    if token.expires_at - REFRESH_MARGIN > now:
        return token
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{GRAPH}/refresh_access_token",
                params={"grant_type": "ig_refresh_token"},
                headers=_auth(token),
            )
            response.raise_for_status()
            data = response.json()
        token.access_token = data["access_token"]
        token.expires_at = now + timedelta(seconds=int(data.get("expires_in", 60 * 86400)))
        token.last_refresh_error = None
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        token.last_refresh_error = _describe(exc)
        logger.warning("instagram token refresh failed: %s", token.last_refresh_error)
    await token.save(update_fields=["access_token", "expires_at", "last_refresh_error"])
    return token


# ---------------------------------------------------------------- Graph 호출


def _auth(token: InstagramToken) -> dict[str, str]:
    """토큰은 **헤더로만** — 쿼리스트링에 실으면 httpx 오류 메시지(URL 포함)를 타고 로그·DB로 샌다(보안 리뷰 블로커)."""
    return {"Authorization": f"Bearer {token.access_token}"}


def _describe(exc: BaseException) -> str:
    """로그용 오류 요약 — URL을 담지 않는다(str(HTTPStatusError)에는 요청 URL이 들어간다)."""
    response = getattr(exc, "response", None)
    if response is not None:
        return f"{type(exc).__name__}: HTTP {response.status_code} {response.text[:200]}"
    return f"{type(exc).__name__}: {exc}"[:300]


def _is_graph_id(value: object) -> bool:
    """IGSID·댓글 id는 숫자 문자열 — URL 경로에 그대로 들어가므로 그 외는 버린다(경로 주입·SSRF 차단)."""
    return isinstance(value, str) and value.isdigit() and len(value) <= 64


async def _send(payload: dict) -> None:
    token = await get_token()
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(f"{GRAPH}/{token.ig_user_id}/messages", headers=_auth(token), json=payload)
        response.raise_for_status()


async def send_private_reply(comment_id: str, text: str) -> None:
    """댓글 작성자에게 비공개 답장 — 댓글 후 7일 내 1회."""
    await _send({"recipient": {"comment_id": comment_id}, "message": {"text": text}})


async def send_message(igsid: str, text: str) -> None:
    """DM — 사용자의 마지막 메시지 후 24시간 내."""
    await _send({"recipient": {"id": igsid}, "message": {"text": text}})


async def get_user_profile(igsid: str) -> dict:
    """DM을 보낸 사용자만 조회 가능. 핵심은 `is_user_follow_business`."""
    token = await get_token()
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            f"{GRAPH}/{igsid}", params={"fields": "username,is_user_follow_business"}, headers=_auth(token)
        )
        response.raise_for_status()
        return response.json()


# ---------------------------------------------------------------- 웹훅 처리


async def issue_code(igsid: str, username: str | None) -> InstagramDmCode:
    """같은 사용자가 여러 번 답장해도(웹훅 중복 포함) 미사용 코드는 하나만 — 있으면 재사용."""
    existing = await InstagramDmCode.filter(
        igsid=igsid, redeemed_at__isnull=True, created_at__gte=datetime.now(timezone.utc) - CODE_TTL
    ).first()
    now = datetime.now(timezone.utc)
    if existing is not None:
        existing.follow_verified_at = now
        if username:
            existing.ig_username = username
        await existing.save(update_fields=["follow_verified_at", "ig_username"])
        return existing
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
    return await InstagramDmCode.create(code=code, igsid=igsid, ig_username=username, follow_verified_at=now)


async def handle_comment(value: dict) -> None:
    """`comments` 웹훅 — 키워드 댓글에 비공개 답장으로 안내. 실패는 로그(웹훅은 이미 200 응답)."""
    comment_id = value.get("id")
    author = (value.get("from") or {}).get("id")
    if not _is_graph_id(comment_id) or not _is_graph_id(author) or not keyword_matches(value.get("text", "")):
        return
    try:
        token = await get_token()
        if author == token.ig_user_id:  # 우리 계정이 단 댓글(답글)
            return
        await send_private_reply(comment_id, REPLY_TO_COMMENT)
    except (httpx.HTTPError, RuntimeError, KeyError, ValueError) as exc:
        logger.warning("instagram comment reply failed comment=%s: %s", comment_id, _describe(exc))


async def handle_message(event: dict) -> None:
    """`messages` 웹훅 — 답장한 사용자의 팔로우 여부를 조회해 코드 또는 재안내를 보낸다."""
    message = event.get("message") or {}
    if message.get("is_echo"):  # 우리가 보낸 메시지의 메아리
        return
    igsid = (event.get("sender") or {}).get("id")
    if not _is_graph_id(igsid) or _throttled(igsid):
        return
    try:
        profile = await get_user_profile(igsid)
        if not profile.get("is_user_follow_business"):
            await send_message(igsid, NOT_FOLLOWING)
            return
        code = await issue_code(igsid, profile.get("username"))
        await send_message(igsid, FOLLOW_OK.format(link=landing_link(code.code), code=code.code))
    except (httpx.HTTPError, RuntimeError, KeyError, ValueError) as exc:
        logger.warning("instagram dm handling failed igsid=%s: %s", igsid, _describe(exc))


DM_THROTTLE = timedelta(seconds=20)
_last_dm_at: dict[str, float] = {}  # ponytail: 프로세스 로컬 — 워커를 늘리면 Redis


def _throttled(igsid: str) -> bool:
    """같은 사용자에게 20초에 1번만 응답 — 웹훅 재전송·연타·DM 폭탄이 프로필 조회+DM(Graph 쿼터)로 번지지 않게.
    팔로우하고 바로 다시 답장하는 정상 흐름은 20초면 충분히 지나 있다."""
    now = time.monotonic()
    last = _last_dm_at.get(igsid)
    if last is not None and now - last < DM_THROTTLE.total_seconds():
        return True
    _last_dm_at[igsid] = now
    if len(_last_dm_at) > 10_000:  # 메모리 상한 — 오래된 항목부터 버린다
        for key in sorted(_last_dm_at, key=_last_dm_at.get)[:5_000]:
            _last_dm_at.pop(key, None)
    return False
