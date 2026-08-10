from tortoise import BaseDBAsyncClient

RUN_IN_TRANSACTION = True


async def upgrade(db: BaseDBAsyncClient) -> str:
    return """
        CREATE TABLE IF NOT EXISTS "admin_user" (
    "id" BIGSERIAL NOT NULL PRIMARY KEY,
    "email" VARCHAR(255) NOT NULL UNIQUE,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS "app_setting" (
    "key" VARCHAR(100) NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS "cafe24_oauth_token" (
    "id" BIGSERIAL NOT NULL PRIMARY KEY,
    "mall_id" VARCHAR(100) NOT NULL UNIQUE,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_synced_at" TIMESTAMPTZ,
    "last_refresh_error" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS "member" (
    "id" UUID NOT NULL PRIMARY KEY,
    "kind" VARCHAR(6) NOT NULL,
    "cafe24_member_id" VARCHAR(255) UNIQUE,
    "kakao_id" VARCHAR(255) UNIQUE,
    "naver_id" VARCHAR(191) UNIQUE,
    "email" VARCHAR(254) UNIQUE,
    "password_hash" VARCHAR(256),
    "refresh_token_hash" VARCHAR(64) UNIQUE,
    "refresh_expires_at" TIMESTAMPTZ,
    "nickname" VARCHAR(100),
    "credit_balance" INT NOT NULL,
    "guest_expires_at" TIMESTAMPTZ,
    "oauth_state_nonce" VARCHAR(64),
    "oauth_state_expires_at" TIMESTAMPTZ,
    "order_reward_cutoff" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL,
    "merged_into_id" UUID REFERENCES "member" ("id") ON DELETE SET NULL
);
COMMENT ON COLUMN "member"."kind" IS 'GUEST: guest\nMEMBER: member';
CREATE TABLE IF NOT EXISTS "credit_ledger" (
    "id" BIGSERIAL NOT NULL PRIMARY KEY,
    "dedupe_key" VARCHAR(255) NOT NULL,
    "reason" VARCHAR(19) NOT NULL,
    "ref_id" TEXT,
    "amount" INT NOT NULL,
    "balance_after" INT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "member_id" UUID NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE,
    CONSTRAINT "uid_credit_ledg_member__6b8f32" UNIQUE ("member_id", "dedupe_key")
);
CREATE INDEX IF NOT EXISTS "idx_credit_ledg_member__35ddb9" ON "credit_ledger" ("member_id", "created_at");
COMMENT ON COLUMN "credit_ledger"."reason" IS 'GENERATION_CHARGE: generation_charge\nGENERATION_REFUND: generation_refund\nSAFETY_BLOCK_REFUND: safety_block_refund\nGUEST_TRIAL: guest_trial\nLINK_ACCOUNT: link_account\nFOLLOW_IG: follow_ig\nDAILY_FREE: daily_free\nORDER_REWARD: order_reward\nORDER_CLAWBACK: order_clawback\nCS_ADJUSTMENT: cs_adjustment';
CREATE TABLE IF NOT EXISTS "pet_profile" (
    "id" UUID NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "breed_code" TEXT,
    "breed_label" TEXT,
    "size" TEXT,
    "thumbnail_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "member_id" UUID NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_pet_profile_member__1920bb" ON "pet_profile" ("member_id");
CREATE TABLE IF NOT EXISTS "source_image" (
    "id" UUID NOT NULL PRIMARY KEY,
    "storage_key" VARCHAR(255) NOT NULL UNIQUE,
    "width" INT,
    "height" INT,
    "quality_check" JSONB NOT NULL,
    "breed_estimate" JSONB,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL,
    "member_id" UUID NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE,
    "pet_profile_id" UUID REFERENCES "pet_profile" ("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "idx_source_imag_member__b4f4f4" ON "source_image" ("member_id");
CREATE TABLE IF NOT EXISTS "style" (
    "id" BIGSERIAL NOT NULL PRIMARY KEY,
    "code" VARCHAR(100) NOT NULL UNIQUE,
    "section" VARCHAR(50) NOT NULL,
    "name" TEXT NOT NULL,
    "credit_cost" INT NOT NULL,
    "status" VARCHAR(7) NOT NULL,
    "sort_order" INT NOT NULL,
    "output_count" INT NOT NULL,
    "avg_seconds" INT NOT NULL,
    "progress_message" TEXT,
    "fit_tags" JSONB NOT NULL,
    "example_keys" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_style_section_e6b5f7" ON "style" ("section", "status", "sort_order");
COMMENT ON COLUMN "style"."status" IS 'DRAFT: draft\nPUBLIC: public\nAB: ab\nRETIRED: retired';
CREATE TABLE IF NOT EXISTS "style_prompt_version" (
    "id" BIGSERIAL NOT NULL PRIMARY KEY,
    "version" INT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "model_config" JSONB NOT NULL,
    "traffic_weight" INT NOT NULL,
    "status" VARCHAR(7) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "style_id" BIGINT NOT NULL REFERENCES "style" ("id") ON DELETE CASCADE,
    CONSTRAINT "uid_style_promp_style_i_db11b2" UNIQUE ("style_id", "version")
);
COMMENT ON COLUMN "style_prompt_version"."status" IS 'DRAFT: draft\nACTIVE: active\nRETIRED: retired';
CREATE TABLE IF NOT EXISTS "generation_job" (
    "id" UUID NOT NULL PRIMARY KEY,
    "custom_prompt_id" UUID,
    "idempotency_key" UUID NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "credit_cost" INT NOT NULL,
    "provider_job_id" TEXT,
    "error_code" TEXT,
    "lease_expires_at" TIMESTAMPTZ,
    "attempt_count" INT NOT NULL,
    "queued_at" TIMESTAMPTZ NOT NULL,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "member_id" UUID NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE,
    "prompt_version_id" BIGINT REFERENCES "style_prompt_version" ("id") ON DELETE SET NULL,
    "source_image_id" UUID NOT NULL REFERENCES "source_image" ("id") ON DELETE CASCADE,
    "style_id" BIGINT REFERENCES "style" ("id") ON DELETE SET NULL,
    CONSTRAINT "uid_generation__member__383b42" UNIQUE ("member_id", "idempotency_key")
);
CREATE INDEX IF NOT EXISTS "idx_generation__status_57b7cb" ON "generation_job" ("status", "lease_expires_at");
COMMENT ON COLUMN "generation_job"."status" IS 'QUEUED: queued\nPROCESSING: processing\nSUCCEEDED: succeeded\nFAILED: failed';
CREATE TABLE IF NOT EXISTS "custom_prompt_log" (
    "id" UUID NOT NULL PRIMARY KEY,
    "raw_text" TEXT NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "moderation" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "job_id" UUID REFERENCES "generation_job" ("id") ON DELETE SET NULL,
    "member_id" UUID NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE,
    "promoted_style_id" BIGINT REFERENCES "style" ("id") ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS "generation_result" (
    "id" UUID NOT NULL PRIMARY KEY,
    "seq" INT NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL UNIQUE,
    "signature_variant" TEXT,
    "is_selected" BOOL NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL,
    "job_id" UUID NOT NULL REFERENCES "generation_job" ("id") ON DELETE CASCADE,
    CONSTRAINT "uid_generation__job_id_ce70bc" UNIQUE ("job_id", "seq")
);
CREATE TABLE IF NOT EXISTS "metric_event" (
    "id" BIGSERIAL NOT NULL PRIMARY KEY,
    "event_type" VARCHAR(100) NOT NULL,
    "meta" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "job_id" UUID REFERENCES "generation_job" ("id") ON DELETE SET NULL,
    "member_id" UUID NOT NULL REFERENCES "member" ("id") ON DELETE CASCADE,
    "style_id" BIGINT REFERENCES "style" ("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "idx_metric_even_style_i_af6f2b" ON "metric_event" ("style_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_metric_even_event_t_41a8d6" ON "metric_event" ("event_type", "created_at");
CREATE TABLE IF NOT EXISTS "aerich" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "version" VARCHAR(255) NOT NULL,
    "app" VARCHAR(100) NOT NULL,
    "content" JSONB NOT NULL
);"""


async def downgrade(db: BaseDBAsyncClient) -> str:
    return """
        """


MODELS_STATE = (
    "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"
    "bIyl"
)
