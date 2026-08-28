import argparse
import asyncio

from tortoise import Tortoise

from app.auth import hash_password
from app.models import AdminUser
from app.settings import settings


async def run(email: str, password: str) -> None:
    await Tortoise.init(
        db_url=settings.database_url,
        modules={"models": ["app.models"]},
    )
    try:
        admin = await AdminUser.get_or_none(email=email)
        password_hash = hash_password(password)
        if admin is None:
            await AdminUser.create(email=email, password_hash=password_hash)
        else:
            admin.password_hash = password_hash
            await admin.save(update_fields=["password_hash"])
    finally:
        await Tortoise.close_connections()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()
    if len(args.password) < 12:
        parser.error("--password must be at least 12 characters")
    asyncio.run(run(args.email, args.password))


if __name__ == "__main__":
    main()
