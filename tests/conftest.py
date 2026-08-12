from tortoise.backends.base.executor import EXECUTOR_CACHE


def reset_tortoise_executor_cache() -> None:
    EXECUTOR_CACHE.clear()
