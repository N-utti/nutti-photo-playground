"""Tortoise ORM 모델 — docs/04-erd.md의 13개 테이블 전건.

ponytail: ERD §5 노트를 그대로 따릅니다 — CharEnumField(=varchar)로 enum 표현,
unique_together로 복합 유니크, JSONField로 jsonb. 부분(partial) 유니크 인덱스는
Tortoise가 지원하지 않으므로 만들지 않고(§5), NULL이 흔한 컬럼은 표준 UNIQUE로 둡니다.

Tortoise 주의: `TextField`는 unique/pk/index 대상이 될 수 없습니다(indexable=False).
UNIQUE·PK·복합 인덱스에 들어가는 "TEXT" 타입 컬럼은 ERD 의도(가변 길이 텍스트)를
유지하되 `CharField(max_length=...)`로 선언합니다. 그 외 평범한 TEXT 컬럼은 TextField.
"""

import enum
import uuid

from tortoise import fields
from tortoise.models import Model


class MemberKind(str, enum.Enum):
    GUEST = "guest"
    MEMBER = "member"


class StyleStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLIC = "public"
    AB = "ab"
    RETIRED = "retired"


class PromptVersionStatus(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    RETIRED = "retired"


class JobStatus(str, enum.Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class CreditReason(str, enum.Enum):
    GENERATION_CHARGE = "generation_charge"
    GENERATION_REFUND = "generation_refund"
    SAFETY_BLOCK_REFUND = "safety_block_refund"
    GUEST_TRIAL = "guest_trial"
    LINK_ACCOUNT = "link_account"
    FOLLOW_IG = "follow_ig"
    DAILY_FREE = "daily_free"
    ORDER_REWARD = "order_reward"
    ORDER_CLAWBACK = "order_clawback"
    CS_ADJUSTMENT = "cs_adjustment"


class Member(Model):
    id = fields.UUIDField(primary_key=True, default=uuid.uuid4)
    kind = fields.CharEnumField(MemberKind)
    cafe24_member_id = fields.CharField(max_length=255, unique=True, null=True)
    kakao_id = fields.CharField(max_length=255, unique=True, null=True)
    naver_id = fields.CharField(max_length=191, unique=True, null=True)
    email = fields.CharField(max_length=254, unique=True, null=True)
    password_hash = fields.CharField(max_length=256, null=True)
    credit_balance = fields.IntField(default=0)
    merged_into = fields.ForeignKeyField(
        "models.Member", related_name="merged_members", null=True, on_delete=fields.SET_NULL
    )
    guest_expires_at = fields.DatetimeField(null=True)
    oauth_state_nonce = fields.CharField(max_length=64, null=True)
    oauth_state_expires_at = fields.DatetimeField(null=True)
    order_reward_cutoff = fields.DatetimeField(null=True)
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "member"


class PetProfile(Model):
    id = fields.UUIDField(primary_key=True, default=uuid.uuid4)
    member = fields.ForeignKeyField(
        "models.Member", related_name="pet_profiles", on_delete=fields.CASCADE, db_index=True
    )
    name = fields.TextField()
    breed_code = fields.TextField(null=True)
    breed_label = fields.TextField(null=True)
    size = fields.TextField(null=True)
    thumbnail_key = fields.TextField(null=True)
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "pet_profile"


class Style(Model):
    id = fields.BigIntField(primary_key=True)
    code = fields.CharField(max_length=100, unique=True)
    section = fields.CharField(max_length=50)
    name = fields.TextField()
    credit_cost = fields.IntField(default=1)
    status = fields.CharEnumField(StyleStatus, default=StyleStatus.DRAFT)
    sort_order = fields.IntField(default=0)
    output_count = fields.IntField(default=4)
    avg_seconds = fields.IntField(default=24)
    progress_message = fields.TextField(null=True)
    fit_tags = fields.JSONField(default=list)
    example_keys = fields.JSONField(default=list)
    created_at = fields.DatetimeField(auto_now_add=True)
    updated_at = fields.DatetimeField(auto_now=True)

    class Meta:
        table = "style"
        indexes = (("section", "status", "sort_order"),)


class StylePromptVersion(Model):
    id = fields.BigIntField(primary_key=True)
    style = fields.ForeignKeyField("models.Style", related_name="prompt_versions", on_delete=fields.CASCADE)
    version = fields.IntField()
    prompt_text = fields.TextField()
    model_config = fields.JSONField()
    traffic_weight = fields.IntField(default=100)
    status = fields.CharEnumField(PromptVersionStatus)
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "style_prompt_version"
        unique_together = (("style", "version"),)


class SourceImage(Model):
    id = fields.UUIDField(primary_key=True, default=uuid.uuid4)
    member = fields.ForeignKeyField(
        "models.Member", related_name="source_images", on_delete=fields.CASCADE, db_index=True
    )
    pet_profile = fields.ForeignKeyField(
        "models.PetProfile", related_name="source_images", null=True, on_delete=fields.SET_NULL
    )
    storage_key = fields.CharField(max_length=255, unique=True)
    width = fields.IntField(null=True)
    height = fields.IntField(null=True)
    quality_check = fields.JSONField()
    breed_estimate = fields.JSONField(null=True)
    expires_at = fields.DatetimeField(null=True)
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "source_image"


class GenerationJob(Model):
    id = fields.UUIDField(primary_key=True, default=uuid.uuid4)
    member = fields.ForeignKeyField("models.Member", related_name="jobs", on_delete=fields.CASCADE)
    source_image = fields.ForeignKeyField("models.SourceImage", related_name="jobs", on_delete=fields.CASCADE)
    style = fields.ForeignKeyField("models.Style", related_name="jobs", null=True, on_delete=fields.SET_NULL)
    prompt_version = fields.ForeignKeyField(
        "models.StylePromptVersion", related_name="jobs", null=True, on_delete=fields.SET_NULL
    )
    # ponytail: generation_job.custom_prompt_id <-> custom_prompt_log.job forms a mutual
    # reference (ERD §1 draws both directions). Tortoise's schema generator can't order
    # table creation when both sides are real ForeignKeyFields (cyclic FK error), even
    # with db_constraint=False (it still counts as a graph edge for ordering — only the
    # SQL constraint clause is suppressed). So this side is a plain UUID column, matching
    # the ERD column name/type exactly but without an ORM-level relation; the enforced,
    # traversable FK lives on custom_prompt_log.job instead.
    custom_prompt_id = fields.UUIDField(null=True)
    idempotency_key = fields.UUIDField()
    status = fields.CharEnumField(JobStatus, default=JobStatus.QUEUED)
    credit_cost = fields.IntField()
    provider_job_id = fields.TextField(null=True)
    error_code = fields.TextField(null=True)
    lease_expires_at = fields.DatetimeField(null=True)
    attempt_count = fields.IntField(default=0)
    queued_at = fields.DatetimeField(auto_now_add=True)
    started_at = fields.DatetimeField(null=True)
    finished_at = fields.DatetimeField(null=True)

    class Meta:
        table = "generation_job"
        unique_together = (("member", "idempotency_key"),)
        # docs/06-architecture-deployment.md §2.1 SKIP LOCKED 폴링 쿼리가 스캔하는 인덱스.
        indexes = (("status", "lease_expires_at"),)


class GenerationResult(Model):
    id = fields.UUIDField(primary_key=True, default=uuid.uuid4)
    job = fields.ForeignKeyField("models.GenerationJob", related_name="results", on_delete=fields.CASCADE)
    seq = fields.IntField()
    storage_key = fields.CharField(max_length=255, unique=True)
    signature_variant = fields.TextField(null=True)
    is_selected = fields.BooleanField(default=False)
    deleted_at = fields.DatetimeField(null=True)
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "generation_result"
        unique_together = (("job", "seq"),)


class CreditLedger(Model):
    id = fields.BigIntField(primary_key=True)
    member = fields.ForeignKeyField("models.Member", related_name="ledger_entries", on_delete=fields.CASCADE)
    dedupe_key = fields.CharField(max_length=255)
    reason = fields.CharEnumField(CreditReason)
    ref_id = fields.TextField(null=True)
    amount = fields.IntField()
    balance_after = fields.IntField()
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "credit_ledger"
        # 원장 유일 안전장치(중복 지급/차감 방지) — docs/04-erd.md §2.8, §3.
        unique_together = (("member", "dedupe_key"),)
        # ERD는 created_at DESC를 명시하지만 Tortoise composite index는 정렬 방향을 지정하지 않음.
        indexes = (("member", "created_at"),)


class CustomPromptLog(Model):
    id = fields.UUIDField(primary_key=True, default=uuid.uuid4)
    member = fields.ForeignKeyField("models.Member", related_name="custom_prompts", on_delete=fields.CASCADE)
    raw_text = fields.TextField()
    normalized_text = fields.TextField()
    moderation = fields.JSONField()
    job = fields.ForeignKeyField(
        "models.GenerationJob", related_name="custom_prompt_logs", null=True, on_delete=fields.SET_NULL
    )
    promoted_style = fields.ForeignKeyField(
        "models.Style", related_name="promoted_from_prompts", null=True, on_delete=fields.SET_NULL
    )
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "custom_prompt_log"


class MetricEvent(Model):
    id = fields.BigIntField(primary_key=True)
    event_type = fields.CharField(max_length=100)
    member = fields.ForeignKeyField("models.Member", related_name="metric_events", on_delete=fields.CASCADE)
    style = fields.ForeignKeyField("models.Style", related_name="metric_events", null=True, on_delete=fields.SET_NULL)
    job = fields.ForeignKeyField(
        "models.GenerationJob", related_name="metric_events", null=True, on_delete=fields.SET_NULL
    )
    meta = fields.JSONField(default=dict)
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "metric_event"
        indexes = (("style", "created_at"), ("event_type", "created_at"))


class Cafe24OauthToken(Model):
    id = fields.BigIntField(primary_key=True)
    mall_id = fields.CharField(max_length=100, unique=True)
    access_token = fields.TextField()
    refresh_token = fields.TextField()
    expires_at = fields.DatetimeField()
    last_synced_at = fields.DatetimeField(null=True)
    last_refresh_error = fields.TextField(null=True)
    updated_at = fields.DatetimeField(auto_now=True)

    class Meta:
        table = "cafe24_oauth_token"


class AdminUser(Model):
    id = fields.BigIntField(primary_key=True)
    email = fields.CharField(max_length=255, unique=True)
    password_hash = fields.TextField()
    role = fields.TextField(default="admin")
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "admin_user"


class AppSetting(Model):
    key = fields.CharField(max_length=100, primary_key=True)
    value = fields.JSONField()
    updated_at = fields.DatetimeField(auto_now=True)

    class Meta:
        table = "app_setting"
