from tortoise import BaseDBAsyncClient

RUN_IN_TRANSACTION = True


async def upgrade(db: BaseDBAsyncClient) -> str:
    return """
        CREATE TABLE IF NOT EXISTS "instagram_token" (
    "id" BIGSERIAL NOT NULL PRIMARY KEY,
    "ig_user_id" VARCHAR(64) NOT NULL UNIQUE,
    "username" VARCHAR(64),
    "access_token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_refresh_error" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL
);
COMMENT ON TABLE "instagram_token" IS '@nutti_official 프로페셔널 계정의 장기 토큰(60일, 갱신은 app.instagram.get_access_token) — 단일 행.';
        CREATE TABLE IF NOT EXISTS "instagram_dm_code" (
    "id" BIGSERIAL NOT NULL PRIMARY KEY,
    "code" VARCHAR(16) NOT NULL UNIQUE,
    "igsid" VARCHAR(64) NOT NULL,
    "ig_username" VARCHAR(64),
    "follow_verified_at" TIMESTAMPTZ,
    "redeemed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL,
    "redeemed_member_id" UUID REFERENCES "member" ("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "idx_instagram_d_igsid_33928e" ON "instagram_dm_code" ("igsid");
COMMENT ON TABLE "instagram_dm_code" IS '댓글→DM 퍼널에서 팔로우가 확인된 인스타 사용자에게 보낸 1회용 코드 — 놀이터에서 소진하면 follow_ig +N.';"""


async def downgrade(db: BaseDBAsyncClient) -> str:
    return """
        DROP TABLE IF EXISTS "instagram_dm_code";
        DROP TABLE IF EXISTS "instagram_token";"""


MODELS_STATE = (
    "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"
)
