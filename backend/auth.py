"""
Nhận diện người dùng cho mỗi lần gọi API.

Frontend gửi kèm header "Authorization: Bearer <access token của Supabase>".
Backend hỏi Supabase token đó là của ai, rồi lưu người dùng vào một ContextVar
để mọi câu truy vấn trong lần gọi đó dùng đúng user_id (thay cho DEMO_USER_ID cũ).
"""

import os
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

load_dotenv()

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
# Khoá dự án để gọi Auth API (dùng khoá bí mật của backend; khoá publishable cũng được)
_SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_PUBLISHABLE_KEY") or ""

# Những đường dẫn không cần đăng nhập
PUBLIC_PATHS = {"/", "/health", "/docs", "/redoc", "/openapi.json", "/api/message"}

_current_user: ContextVar[dict | None] = ContextVar("sp_current_user", default=None)
_current_path: ContextVar[str] = ContextVar("sp_current_path", default="")
# Dữ liệu riêng của từng lần gọi API (ví dụ tài liệu đang xử lý, để ghi chi phí AI đúng tài liệu)
_request_state: ContextVar[dict | None] = ContextVar("sp_request_state", default=None)


def request_state() -> dict:
    state = _request_state.get()
    if state is None:
        state = {}
        _request_state.set(state)
    return state

# Bộ nhớ đệm token -> người dùng (5 phút) để không phải hỏi Supabase ở mỗi lần gọi
_CACHE_SECONDS = 300
_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()

UNAUTHORIZED_MESSAGE = "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Hãy đăng nhập lại."


def current_user() -> dict:
    user = _current_user.get()
    if not user:
        raise HTTPException(status_code=401, detail=UNAUTHORIZED_MESSAGE)
    return user


def current_user_id() -> str:
    """user_id của người đang gọi API (thay cho DEMO_USER_ID)."""
    return current_user()["id"]


def current_user_email() -> str:
    user = _current_user.get() or {}
    return user.get("email") or ""


def current_path() -> str:
    return _current_path.get()


@contextmanager
def acting_as(user_id: str, email: str = "", path: str = ""):
    """Chạy một đoạn code dưới danh nghĩa một người dùng (dùng cho bộ hẹn giờ gửi thư)."""
    user_token = _current_user.set({"id": user_id, "email": email})
    path_token = _current_path.set(path)
    state_token = _request_state.set({})
    try:
        yield
    finally:
        _current_user.reset(user_token)
        _current_path.reset(path_token)
        _request_state.reset(state_token)


def verify_access_token(token: str) -> dict | None:
    """Trả về {"id", "email"} nếu token hợp lệ, ngược lại None."""
    if not token or not SUPABASE_URL or not _SUPABASE_KEY:
        return None

    now = time.time()
    with _cache_lock:
        cached = _cache.get(token)
        if cached and cached[0] > now:
            return cached[1]

    try:
        response = httpx.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": _SUPABASE_KEY, "Authorization": f"Bearer {token}"},
            timeout=15,
        )
    except httpx.HTTPError as error:
        print("Không kiểm tra được phiên đăng nhập với Supabase:", str(error))
        return None

    if response.status_code != 200:
        return None

    data = response.json()
    user_id = data.get("id")
    if not user_id:
        return None

    user = {"id": user_id, "email": (data.get("email") or "").lower()}
    with _cache_lock:
        if len(_cache) > 2000:
            _cache.clear()
        _cache[token] = (now + _CACHE_SECONDS, user)
    return user


async def auth_middleware(request: Request, call_next):
    path = request.url.path
    path_token = _current_path.set(f"{request.method} {path}")
    state_token = _request_state.set({})
    try:
        if request.method == "OPTIONS" or path in PUBLIC_PATHS or not path.startswith("/api"):
            return await call_next(request)

        header = request.headers.get("authorization") or ""
        token = header[7:].strip() if header.lower().startswith("bearer ") else ""
        user = await run_in_threadpool(verify_access_token, token)
        if not user:
            return JSONResponse(status_code=401, content={"detail": UNAUTHORIZED_MESSAGE})

        user_token = _current_user.set(user)
        try:
            return await call_next(request)
        finally:
            _current_user.reset(user_token)
    finally:
        _current_path.reset(path_token)
        _request_state.reset(state_token)
