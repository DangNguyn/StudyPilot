"""
Thông báo học tập qua Gmail cho StudyPilot.

- Gửi thư thật bằng Gmail + Mật khẩu ứng dụng (SMTP), không tốn token AI.
- Người dùng phải xác minh email bằng mã 6 số trước khi bật thông báo,
  nên địa chỉ không tồn tại sẽ không bao giờ được bật.
- Bộ hẹn giờ chạy ngầm trong backend, gửi vào giờ người dùng chọn, 2 loại thông báo:
    * Theo lịch học: bài hôm nay, bài còn nợ, ngày ôn lại đã chọn, đếm ngược ngày thi.
    * Ôn phần còn yếu: khi còn 7/5/3/2/1 ngày tới ngày thi mà vẫn có bài
      dưới 80% (điểm kiểm tra mới nhất), nhắc vào ôn lại.
- Đọc hộp thư của tài khoản gửi (IMAP) để phát hiện thư báo lỗi
  "Address not found" và tự tắt thông báo cho địa chỉ đó.

Cấu hình trong .env:
    GMAIL_ADDRESS=tai.khoan.gui@gmail.com
    GMAIL_APP_PASSWORD=abcdefghijklmnop   (16 ký tự, không có dấu cách)
    APP_URL=http://localhost:3000          (địa chỉ frontend, dùng cho nút trong thư)
"""

from __future__ import annotations

import email
import hashlib
import html
import imaplib
import json
import os
import re
import secrets
import smtplib
import urllib.error
import urllib.request
import ssl
import threading
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from supabase_client import supabase

VIETNAM_TZ = timezone(timedelta(hours=7))
SETTINGS_FILE = Path(__file__).with_name("notification_settings.json")
_LOCK = threading.Lock()

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
COMMON_TYPOS = {
    "gmial.com": "gmail.com",
    "gmai.com": "gmail.com",
    "gamil.com": "gmail.com",
    "gmail.co": "gmail.com",
    "gmail.con": "gmail.com",
    "gmail.vn": "gmail.com",
    "gnail.com": "gmail.com",
    "yahooo.com": "yahoo.com",
    "hotmial.com": "hotmail.com",
    "outlok.com": "outlook.com",
}

CODE_TTL_MINUTES = 10
CODE_MAX_ATTEMPTS = 5
CODE_RESEND_SECONDS = 60

DEFAULT_SETTINGS = {
    "email": None,
    "verified": False,
    "enabled": False,
    "daily_enabled": True,
    "daily_hour": 7,
    "weak_enabled": True,
    "disabled_reason": None,
    "pending": None,
    "last_sent": {},
}


# ============================================================
# Cấu hình & lưu trữ
# ============================================================


def _ssl_context() -> ssl.SSLContext:
    """Python cài từ python.org trên macOS không có sẵn chứng chỉ gốc: dùng bộ chứng chỉ của certifi."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()

def _user_id() -> str:
    return os.getenv("DEMO_USER_ID") or "demo"


_ENV_FILE = Path(__file__).resolve().parent / ".env"
_MAIL_ENV_KEYS = (
    "GMAIL_ADDRESS", "GMAIL_APP_PASSWORD", "BREVO_API_KEY", "MAIL_SENDER",
    "APPS_SCRIPT_URL", "APPS_SCRIPT_SECRET",
)
_env_mtime = 0.0


def _refresh_env() -> None:
    """Đọc lại backend/.env khi file vừa được sửa, để thêm Gmail không cần khởi động lại backend."""
    global _env_mtime
    try:
        mtime = _ENV_FILE.stat().st_mtime
    except OSError:
        return  # trên hosting không có file .env: dùng biến môi trường của hosting
    if mtime == _env_mtime:
        return
    _env_mtime = mtime
    try:
        from dotenv import dotenv_values

        for key, value in dotenv_values(_ENV_FILE).items():
            if key in _MAIL_ENV_KEYS and value:
                os.environ[key] = value.strip().strip('"').strip("'")
    except Exception as error:
        print("Không đọc lại được file .env:", str(error))


def _gmail_credentials() -> tuple[str, str]:
    _refresh_env()
    sender = (os.getenv("GMAIL_ADDRESS") or "").strip()
    password = (os.getenv("GMAIL_APP_PASSWORD") or "").replace(" ", "").strip()
    return sender, password


def _brevo_settings() -> tuple[str, str]:
    """Gửi qua API Brevo (HTTPS, cổng 443): dùng khi mạng / hosting chặn cổng gửi thư SMTP."""
    _refresh_env()
    key = (os.getenv("BREVO_API_KEY") or "").strip()
    sender = (os.getenv("MAIL_SENDER") or os.getenv("GMAIL_ADDRESS") or "").strip()
    return key, sender


def _apps_script_settings() -> tuple[str, str]:
    """Gửi qua Google Apps Script (chạy trong Gmail của bạn, gọi bằng HTTPS): không cần cổng SMTP."""
    _refresh_env()
    return (os.getenv("APPS_SCRIPT_URL") or "").strip(), (os.getenv("APPS_SCRIPT_SECRET") or "").strip()


def gmail_configured() -> bool:
    script_url, script_secret = _apps_script_settings()
    if script_url and script_secret:
        return True
    key, brevo_sender = _brevo_settings()
    if key and brevo_sender:
        return True
    sender, password = _gmail_credentials()
    return bool(sender and password)


def _app_url() -> str:
    return (os.getenv("APP_URL") or "http://localhost:3000").rstrip("/")


def _load_all() -> dict:
    if not SETTINGS_FILE.exists():
        return {}
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _save_all(data: dict) -> None:
    SETTINGS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def load_settings(user_id: str | None = None) -> dict:
    with _LOCK:
        stored = _load_all().get(user_id or _user_id(), {})
    return {**DEFAULT_SETTINGS, **stored}


def save_settings(settings: dict, user_id: str | None = None) -> dict:
    with _LOCK:
        data = _load_all()
        data[user_id or _user_id()] = settings
        _save_all(data)
    return settings


def public_settings(settings: dict) -> dict:
    pending = settings.get("pending") or {}
    return {
        "email": settings.get("email"),
        "verified": bool(settings.get("verified")),
        "enabled": bool(settings.get("enabled")),
        "daily_enabled": bool(settings.get("daily_enabled")),
        "daily_hour": int(settings.get("daily_hour") or 7),
        "weak_enabled": bool(settings.get("weak_enabled", True)),
        "disabled_reason": settings.get("disabled_reason"),
        "pending_email": pending.get("email"),
        "gmail_configured": gmail_configured(),
        "last_sent": settings.get("last_sent") or {},
    }


def validate_email(value: str) -> str:
    address = (value or "").strip().lower()
    if not EMAIL_PATTERN.match(address):
        raise HTTPException(status_code=400, detail="Email không đúng định dạng, ví dụ: ten.ban@gmail.com")
    domain = address.split("@", 1)[1]
    if domain in COMMON_TYPOS:
        suggestion = address.split("@", 1)[0] + "@" + COMMON_TYPOS[domain]
        raise HTTPException(
            status_code=400,
            detail=f"Có phải bạn muốn nhập {suggestion}? Hãy kiểm tra lại tên miền email.",
        )
    return address


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


# ============================================================
# Gửi thư
# ============================================================

def send_email(to: str, subject: str, html_body: str, text_body: str) -> None:
    if not gmail_configured():
        raise RuntimeError(
            "Chưa cấu hình gửi thư: thêm BREVO_API_KEY (hoặc GMAIL_ADDRESS + GMAIL_APP_PASSWORD) vào file .env của backend."
        )

    script_url, script_secret = _apps_script_settings()
    if script_url and script_secret:
        _send_apps_script(script_url, script_secret, to, subject, html_body, text_body)
        return

    brevo_key, brevo_sender = _brevo_settings()
    if brevo_key and brevo_sender:
        _send_brevo(brevo_key, brevo_sender, to, subject, html_body, text_body)
        return

    sender, password = _gmail_credentials()

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr(("StudyPilot", sender))
    message["To"] = to
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    # Thử cổng 465 (SSL) trước; nếu mạng / phần mềm diệt virus cắt kết nối thì thử cổng 587 (STARTTLS).
    # Mỗi cách thử tối đa 2 lần vì Gmail đôi khi đóng kết nối giữa chừng.
    last_error: Exception | None = None
    for method in _SMTP_METHODS:
        for _attempt in range(2):
            try:
                method(sender, password, message)
                return
            except smtplib.SMTPAuthenticationError as error:
                raise RuntimeError(
                    "Gmail từ chối đăng nhập. Kiểm tra lại GMAIL_ADDRESS và Mật khẩu ứng dụng "
                    "(16 ký tự, tạo ở myaccount.google.com/apppasswords)."
                ) from error
            except smtplib.SMTPRecipientsRefused as error:
                raise RuntimeError("Gmail không nhận địa chỉ người nhận này.") from error
            except (smtplib.SMTPException, OSError) as error:
                last_error = error
                time.sleep(1)
    raise RuntimeError(
        "Không kết nối được tới máy chủ Gmail (cả cổng 465 và 587). Thường do phần mềm diệt virus, "
        "tường lửa hoặc mạng Wi-Fi chặn gửi thư. Hãy tắt tính năng quét thư của phần mềm diệt virus "
        f"hoặc thử mạng khác (ví dụ 4G). Chi tiết: {last_error}"
    )


def _send_apps_script(url: str, secret: str, to: str, subject: str, html_body: str, text_body: str) -> None:
    payload = json.dumps({
        "secret": secret, "to": to, "subject": subject, "html": html_body, "text": text_body,
    }).encode("utf-8")
    request = urllib.request.Request(
        url, data=payload, method="POST", headers={"Content-Type": "application/json"}
    )
    last_error: Exception | None = None
    for _attempt in range(2):
        try:
            # Apps Script chạy lệnh rồi chuyển hướng (302) sang trang chứa kết quả; urllib tự đi theo
            with urllib.request.urlopen(request, timeout=40, context=_ssl_context()) as response:
                body = response.read().decode("utf-8", errors="ignore")
            try:
                result = json.loads(body)
            except json.JSONDecodeError:
                raise RuntimeError(
                    "Apps Script không trả về kết quả. Kiểm tra lại APPS_SCRIPT_URL (phải là link /exec) "
                    "và phần 'Ai có quyền truy cập' phải là 'Bất kỳ ai'."
                )
            if result.get("ok"):
                return
            error = str(result.get("error") or "")
            if error == "unauthorized":
                raise RuntimeError("APPS_SCRIPT_SECRET không khớp với SECRET trong Apps Script.")
            raise RuntimeError(f"Apps Script không gửi được thư: {error}")
        except RuntimeError:
            raise
        except (urllib.error.URLError, OSError) as error:
            last_error = error
            time.sleep(1)
    raise RuntimeError(f"Không kết nối được tới Apps Script: {last_error}")


def _send_brevo(api_key: str, sender: str, to: str, subject: str, html_body: str, text_body: str) -> None:
    payload = json.dumps({
        "sender": {"name": "StudyPilot", "email": sender},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html_body,
        "textContent": text_body,
    }).encode("utf-8")
    request = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=payload,
        method="POST",
        headers={"api-key": api_key, "Content-Type": "application/json", "Accept": "application/json"},
    )
    last_error: Exception | None = None
    for _attempt in range(2):
        try:
            with urllib.request.urlopen(request, timeout=30, context=_ssl_context()) as response:
                if 200 <= response.status < 300:
                    return
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="ignore")[:300]
            if error.code == 401:
                raise RuntimeError("Brevo từ chối API key. Kiểm tra lại BREVO_API_KEY trong file .env.") from error
            if error.code == 400 and "sender" in detail.lower():
                raise RuntimeError(
                    f"Brevo chưa cho phép gửi từ {sender}. Vào Brevo → Senders, thêm và xác minh địa chỉ này."
                ) from error
            if error.code < 500:
                raise RuntimeError(f"Brevo không gửi được thư ({error.code}): {detail}") from error
            last_error = error
        except (urllib.error.URLError, OSError) as error:
            last_error = error
        time.sleep(1)
    raise RuntimeError(f"Không kết nối được tới Brevo: {last_error}")


def _send_ssl_465(sender: str, password: str, message: EmailMessage) -> None:
    context = _ssl_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30, context=context) as server:
        server.login(sender, password)
        server.send_message(message)


def _send_starttls_587(sender: str, password: str, message: EmailMessage) -> None:
    context = _ssl_context()
    with smtplib.SMTP("smtp.gmail.com", 587, timeout=30) as server:
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
        server.login(sender, password)
        server.send_message(message)


_SMTP_METHODS = (_send_ssl_465, _send_starttls_587)


# ============================================================
# Mẫu thư (HTML dùng inline style để hiển thị đúng trong Gmail)
# ============================================================

PURPLE = "#4a1068"
PINK = "#e0457b"
PERI = "#5b7fe3"
INK = "#24123a"
MUTED = "#716a82"
PAPER = "#fbf8f1"
LINE = "#ece6ef"


def _layout(title: str, intro: str, blocks: list[str], button: tuple[str, str] | None = None) -> str:
    button_html = ""
    if button:
        label, href = button
        button_html = (
            f'<tr><td style="padding:8px 32px 28px">'
            f'<a href="{html.escape(href)}" style="display:inline-block;background:{PERI};color:#fff;'
            f'text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px;'
            f'border:2px solid {PURPLE}">{html.escape(label)} &rarr;</a></td></tr>'
        )
    return f"""<!DOCTYPE html>
<html lang="vi"><body style="margin:0;background:{PAPER};font-family:Arial,Helvetica,sans-serif;color:{INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAPER};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="max-width:560px;background:#fff;border:2px solid {PURPLE};border-radius:20px;overflow:hidden">
  <tr><td style="background:{PURPLE};padding:22px 32px">
    <div style="color:#ffd3e2;font-size:12px;font-weight:700;letter-spacing:1px">STUDYPILOT &#10022;</div>
    <div style="color:#fff;font-size:22px;font-weight:800;margin-top:6px">{html.escape(title)}</div>
  </td></tr>
  <tr><td style="padding:24px 32px 8px;font-size:15px;line-height:1.6;color:#4d4366">{intro}</td></tr>
  {''.join(blocks)}
  {button_html}
  <tr><td style="padding:16px 32px;border-top:1px solid {LINE};font-size:12px;color:{MUTED}">
    Bạn nhận thư này vì đã bật thông báo học tập trong StudyPilot.
    Muốn tắt, mở app &rarr; biểu tượng chuông &rarr; Thông báo qua Gmail.
  </td></tr>
</table>
</td></tr></table></body></html>"""


def _block(heading: str, rows: list[str], color: str = PERI) -> str:
    items = "".join(
        f'<tr><td style="padding:8px 0;border-bottom:1px solid {LINE};font-size:14px;line-height:1.5">{row}</td></tr>'
        for row in rows
    )
    return (
        f'<tr><td style="padding:10px 32px">'
        f'<div style="font-size:13px;font-weight:800;color:{color};text-transform:uppercase;'
        f'letter-spacing:.5px;margin-bottom:4px">{html.escape(heading)}</div>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{items}</table>'
        f"</td></tr>"
    )


def _link(label: str, href: str) -> str:
    return f'<a href="{html.escape(href)}" style="color:{PERI};font-weight:700;text-decoration:none">{html.escape(label)}</a>'


# ============================================================
# Dữ liệu học tập
# ============================================================

def _vn_date(value) -> datetime.date | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(VIETNAM_TZ).date()
    except (TypeError, ValueError):
        return None


def _clean_title(name: str) -> str:
    try:
        from document_analyzer import strip_heading_number
        name = strip_heading_number(name)
    except Exception:
        pass
    return re.sub(r"\s+", " ", str(name or "")).strip() or "Bài học"


def _load_study_data(user_id: str) -> dict:
    plans = (
        supabase.table("exam_plans")
        .select("id, title, exam_date, subject_id")
        .eq("user_id", user_id)
        .execute()
    ).data or []
    subjects = {
        str(item["id"]): item.get("name")
        for item in (supabase.table("subjects").select("id, name").eq("user_id", user_id).execute()).data or []
    }
    topics = (
        supabase.table("topics")
        .select("id, name, exam_plan_id")
        .eq("user_id", user_id)
        .execute()
    ).data or []
    sessions = (
        supabase.table("study_sessions")
        .select("id, topic_id, scheduled_start, duration_minutes, status")
        .eq("user_id", user_id)
        .execute()
    ).data or []
    return {"plans": plans, "subjects": subjects, "topics": topics, "sessions": sessions}


def build_daily_digest(user_id: str, force: bool = False) -> tuple[str, str, str] | None:
    """Thư nhắc học buổi sáng. Trả None nếu hôm nay không có gì để nhắc."""
    today = datetime.now(VIETNAM_TZ).date()
    data = _load_study_data(user_id)
    topic_by_id = {str(item["id"]): item for item in data["topics"]}
    plan_by_id = {str(item["id"]): item for item in data["plans"]}
    app = _app_url()

    blocks: list[str] = []
    text_lines: list[str] = []
    total_minutes = 0

    for plan in sorted(data["plans"], key=lambda item: str(item.get("exam_date") or "")):
        plan_id = str(plan["id"])
        subject_name = data["subjects"].get(str(plan.get("subject_id"))) or plan.get("title") or "Môn học"
        plan_topic_ids = {str(t["id"]) for t in data["topics"] if str(t.get("exam_plan_id")) == plan_id}
        plan_sessions = [s for s in data["sessions"] if str(s.get("topic_id")) in plan_topic_ids]
        materials = f"{app}/study-materials?subject={plan.get('subject_id')}"

        today_items = [
            s for s in plan_sessions
            if _vn_date(s.get("scheduled_start")) == today and s.get("status") != "completed"
        ]
        overdue = [
            s for s in plan_sessions
            if (_vn_date(s.get("scheduled_start")) or today) < today and s.get("status") != "completed"
        ]
        exam_day = _vn_date(plan.get("exam_date"))
        days_left = (exam_day - today).days if exam_day else None

        rows: list[str] = []
        for session in sorted(today_items, key=lambda s: str(s.get("scheduled_start"))):
            topic = topic_by_id.get(str(session.get("topic_id"))) or {}
            minutes = int(session.get("duration_minutes") or 0)
            total_minutes += minutes
            title = _clean_title(topic.get("name"))
            rows.append(
                f"<b>{html.escape(title)}</b> &middot; {minutes} phút &nbsp;"
                + _link("Vào học", f"{materials}&session={session['id']}")
            )
            text_lines.append(f"- [{subject_name}] {title} ({minutes} phút)")

        if overdue:
            rows.append(
                f'<span style="color:{PINK};font-weight:700">Còn {len(overdue)} bài chưa học từ các ngày trước</span>'
                f" &nbsp;" + _link("Học bù", f"{app}/study-plans/{plan_id}")
            )
            text_lines.append(f"- [{subject_name}] Còn {len(overdue)} bài chưa học từ các ngày trước")

        if days_left is not None and days_left in (7, 3, 2, 1, 0):
            countdown = "Hôm nay là ngày thi, chúc bạn thi tốt!" if days_left == 0 else f"Còn {days_left} ngày nữa là thi"
            rows.append(f'<span style="color:{PURPLE};font-weight:800">&#127919; {countdown}</span>')
            text_lines.append(f"- [{subject_name}] {countdown}")

        if rows:
            blocks.append(_block(subject_name, rows))

    # Ngày ôn lại người dùng đã chọn (bài kiểm tra dưới 80%)
    try:
        review_plans = (
            supabase.table("review_plans")
            .select("id, status, retake_quiz_id, review_items")
            .eq("user_id", user_id)
            .execute()
        ).data or []
        review_rows = []
        for review in review_plans:
            if not review.get("retake_quiz_id") or review.get("status") == "completed":
                continue
            dates = {
                item.get("review_date")
                for item in review.get("review_items") or []
                if isinstance(item, dict)
            }
            if today.isoformat() in dates:
                quiz = (
                    supabase.table("quizzes").select("title").eq("id", str(review["retake_quiz_id"])).limit(1).execute()
                ).data or []
                title = quiz[0]["title"] if quiz else "Kiểm tra lại"
                title = title.replace("Kiểm tra lại ngày ", "Kiểm tra lại ngày học ", 1)
                review_rows.append(
                    f"<b>{html.escape(title)}</b><br>"
                    f'<span style="color:{MUTED}">Ôn lại bài, trả lời Tự kiểm tra nhanh rồi làm bài kiểm tra lại.</span>'
                )
                text_lines.append(f"- Hôm nay là ngày ôn: {title}")
        if review_rows:
            blocks.insert(0, _block("Hôm nay là ngày ôn lại", review_rows, PINK))
    except Exception as error:
        print("Không đọc được lịch ôn lại:", str(error))

    if not blocks and not force:
        return None

    if not blocks:
        blocks.append(_block("Hôm nay", ["Hôm nay bạn không có bài nào theo lịch. Nghỉ ngơi hoặc ôn lại Flashcards nhé!"]))

    weekday = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"][today.weekday()]
    intro = (
        f"Chào bạn! Hôm nay {weekday}, {today.strftime('%d/%m')}."
        + (f" Bạn có khoảng <b>{total_minutes} phút</b> học theo kế hoạch." if total_minutes else "")
    )
    subject = (
        f"📚 Hôm nay học gì? {total_minutes} phút đang chờ bạn"
        if total_minutes
        else "📚 StudyPilot nhắc lịch học hôm nay"
    )
    html_body = _layout("Lịch học hôm nay", intro, blocks, ("Mở StudyPilot", f"{app}/"))
    text_body = "StudyPilot - Hôm nay học gì?\n\n" + "\n".join(text_lines or ["Hôm nay không có bài theo lịch."]) + f"\n\n{app}/"
    return subject, html_body, text_body


WEAK_REMINDER_DAYS = (7, 5, 3, 2, 1)


def _percent(attempt: dict) -> int:
    total = int(attempt.get("total_questions") or 0)
    if total:
        return round(int(attempt.get("correct_count") or 0) / total * 100)
    return round(float(attempt.get("score") or 0))


def find_weak_lessons(user_id: str, plan_id: str, data: dict) -> list[dict]:
    """Các buổi học có điểm kiểm tra mới nhất (bài chính hoặc kiểm tra lại) dưới 80%."""
    topic_by_id = {str(t["id"]): t for t in data["topics"]}
    plan_topic_ids = {tid for tid, t in topic_by_id.items() if str(t.get("exam_plan_id")) == plan_id}
    sessions = {
        str(s["id"]): s for s in data["sessions"] if str(s.get("topic_id")) in plan_topic_ids
    }
    if not sessions:
        return []

    quizzes = (
        supabase.table("quizzes")
        .select("id, study_session_id")
        .eq("user_id", user_id)
        .eq("exam_plan_id", plan_id)
        .execute()
    ).data or []
    session_of_quiz = {
        str(q["id"]): str(q["study_session_id"])
        for q in quizzes
        if q.get("study_session_id") and str(q["study_session_id"]) in sessions
    }

    # Bài "Kiểm tra lại" gắn với buổi gốc qua review_items.origin_session_id
    retake_status = {}
    try:
        for review in (
            supabase.table("review_plans")
            .select("status, retake_quiz_id, review_items")
            .eq("user_id", user_id)
            .execute()
        ).data or []:
            origin = next(
                (
                    str(item.get("origin_session_id"))
                    for item in review.get("review_items") or []
                    if isinstance(item, dict) and item.get("origin_session_id")
                ),
                None,
            )
            if review.get("retake_quiz_id") and origin in sessions:
                session_of_quiz[str(review["retake_quiz_id"])] = origin
                retake_status[origin] = review.get("status")
    except Exception as error:
        print("Không đọc được bài kiểm tra lại:", str(error))

    if not session_of_quiz:
        return []

    attempts = (
        supabase.table("quiz_attempts")
        .select("quiz_id, score, correct_count, total_questions, submitted_at, status")
        .eq("user_id", user_id)
        .eq("status", "submitted")
        .in_("quiz_id", list(session_of_quiz.keys()))
        .execute()
    ).data or []

    latest: dict[str, dict] = {}
    for attempt in sorted(attempts, key=lambda a: str(a.get("submitted_at") or "")):
        latest[session_of_quiz[str(attempt["quiz_id"])]] = attempt

    weak = []
    for session_id, attempt in latest.items():
        score = _percent(attempt)
        if score >= 80:
            continue
        session = sessions[session_id]
        topic = topic_by_id.get(str(session.get("topic_id"))) or {}
        weak.append({
            "session_id": session_id,
            "title": _clean_title(topic.get("name")),
            "score": score,
            "date": _vn_date(session.get("scheduled_start")),
            "retake_status": retake_status.get(session_id),
        })
    return sorted(weak, key=lambda item: item["score"])


def build_weak_review(user_id: str, force: bool = False) -> tuple[str, str, str] | None:
    """Gần ngày thi mà vẫn còn bài dưới 80% → nhắc vào ôn lại."""
    today = datetime.now(VIETNAM_TZ).date()
    data = _load_study_data(user_id)
    app = _app_url()

    blocks: list[str] = []
    text_lines: list[str] = []
    nearest_days = None
    total_weak = 0

    for plan in sorted(data["plans"], key=lambda item: str(item.get("exam_date") or "")):
        exam_day = _vn_date(plan.get("exam_date"))
        if not exam_day:
            continue
        days_left = (exam_day - today).days
        if days_left < 1 or (days_left not in WEAK_REMINDER_DAYS and not (force and days_left <= 30)):
            continue

        plan_id = str(plan["id"])
        weak = find_weak_lessons(user_id, plan_id, data)
        if not weak:
            continue

        subject_name = data["subjects"].get(str(plan.get("subject_id"))) or plan.get("title") or "Môn học"
        materials = f"{app}/study-materials?subject={plan.get('subject_id')}"
        nearest_days = days_left if nearest_days is None else min(nearest_days, days_left)
        total_weak += len(weak)

        rows = [
            f'<span style="color:{PURPLE};font-weight:800">&#127919; Còn {days_left} ngày nữa là thi '
            f"&middot; {len(weak)} bài dưới 80%</span>"
        ]
        for item in weak[:8]:
            color = PINK if item["score"] < 50 else "#b9771a"
            level = "Ôn cấp tốc" if item["score"] < 50 else "Ôn lại"
            day = f" &middot; học ngày {item['date'].strftime('%d/%m')}" if item["date"] else ""
            rows.append(
                f"<b>{html.escape(item['title'])}</b>{day}<br>"
                f'<span style="color:{color};font-weight:700">Điểm gần nhất {item["score"]}% &middot; {level}</span>'
                f" &nbsp;" + _link("Ôn ngay", f"{materials}&session={item['session_id']}")
            )
            text_lines.append(f"- [{subject_name}] {item['title']}: {item['score']}%")
        blocks.append(_block(subject_name, rows, PINK))

    if not blocks:
        if not force:
            return None
        blocks.append(_block(
            "Phần còn yếu",
            ["Hiện chưa có bài nào dưới 80% gần ngày thi. Bạn đang làm rất tốt!"],
        ))

    intro = (
        "Sắp đến ngày thi rồi! Đây là những bài bạn làm kiểm tra dưới 80%. "
        "Hãy đọc lại tóm tắt, trả lời Tự kiểm tra nhanh rồi làm bài kiểm tra lại để chắc kiến thức."
        if total_weak
        else "Đây là thư thử của loại thông báo ôn phần còn yếu."
    )
    subject = (
        f"⚠️ Còn {nearest_days} ngày thi: {total_weak} phần cần ôn lại"
        if total_weak
        else "⚠️ StudyPilot: ôn tập phần còn yếu"
    )
    html_body = _layout("Ôn lại phần còn yếu", intro, blocks, ("Xem đánh giá năng lực", f"{app}/weak-areas"))
    text_body = (
        "StudyPilot - Ôn lại phần còn yếu trước ngày thi\n\n"
        + "\n".join(text_lines or ["Chưa có bài nào dưới 80%."])
        + f"\n\n{app}/weak-areas"
    )
    return subject, html_body, text_body


# ============================================================
# Phát hiện thư báo lỗi (địa chỉ không tồn tại)
# ============================================================

def check_bounces() -> None:
    """Đọc thư báo lỗi trong hộp thư của tài khoản gửi; tắt thông báo cho địa chỉ bị lỗi."""
    if not gmail_configured():
        return
    settings = load_settings()
    address = settings.get("email")
    if not address or not settings.get("enabled"):
        return

    try:
        mailbox = imaplib.IMAP4_SSL("imap.gmail.com", 993)
        mailbox.login(*_gmail_credentials())
        mailbox.select("INBOX")
        since = (datetime.now(VIETNAM_TZ) - timedelta(days=2)).strftime("%d-%b-%Y")
        status, found = mailbox.search(None, f'(FROM "mailer-daemon" SINCE {since})')
        bounced = False
        if status == "OK":
            for number in (found[0] or b"").split()[-20:]:
                _, raw = mailbox.fetch(number, "(RFC822)")
                if not raw or not raw[0]:
                    continue
                message = email.message_from_bytes(raw[0][1])
                body = ""
                for part in message.walk():
                    if part.get_content_type() == "text/plain":
                        body += part.get_payload(decode=True).decode(errors="ignore")
                if address.lower() in body.lower():
                    bounced = True
                    break
        mailbox.logout()
    except Exception as error:
        print("Không kiểm tra được thư báo lỗi:", str(error))
        return

    if bounced:
        settings.update({
            "enabled": False,
            "disabled_reason": "Gmail báo không gửi được tới địa chỉ này nên thông báo đã tạm tắt. Bật lại để thử tiếp.",
        })
        save_settings(settings)
        print("Đã tắt thông báo vì email bị báo lỗi:", address)


# ============================================================
# Bộ hẹn giờ chạy ngầm
# ============================================================

_scheduler_started = False
_retry_after: dict[str, float] = {}


def _send_scheduled(settings: dict, kind: str, builder) -> bool:
    """Gửi 1 loại thư. True = xong cho hôm nay (đã gửi hoặc không có gì để nhắc).
    Lỗi thì thử lại sau 10 phút, không làm hỏng loại thư còn lại."""
    if time.time() < _retry_after.get(kind, 0):
        return False
    try:
        content = builder(_user_id())
        if content:
            send_email(settings["email"], *content)
            print(f"Đã gửi thư nhắc ({kind}) tới {settings['email']}")
        _retry_after.pop(kind, None)
        return True
    except Exception as error:
        _retry_after[kind] = time.time() + 10 * 60
        print(f"Lỗi khi gửi thư nhắc ({kind}), sẽ thử lại sau 10 phút:", str(error))
        return False


def _scheduler_loop() -> None:
    last_bounce_check = 0.0
    while True:
        try:
            now = datetime.now(VIETNAM_TZ)
            today = now.date().isoformat()
            settings = load_settings()

            if settings.get("enabled") and settings.get("email") and gmail_configured():
                last_sent = settings.setdefault("last_sent", {})
                hour = int(settings.get("daily_hour") or 7)

                # Nhắc buổi sáng: gửi 1 lần/ngày, trong khoảng [giờ đã chọn, +4 giờ]
                # (nếu backend bật muộn trong buổi sáng vẫn gửi bù).
                if (
                    settings.get("daily_enabled")
                    and hour <= now.hour < hour + 4
                    and last_sent.get("daily") != today
                ):
                    if _send_scheduled(settings, "daily", build_daily_digest):
                        last_sent["daily"] = today
                        save_settings(settings)

                # Ôn phần còn yếu: gần ngày thi (còn 7/5/3/2/1 ngày) nếu có bài dưới 80%
                if (
                    settings.get("weak_enabled", True)
                    and hour <= now.hour < hour + 4
                    and last_sent.get("weak") != today
                ):
                    if _send_scheduled(settings, "weak", build_weak_review):
                        last_sent["weak"] = today
                        save_settings(settings)

                if time.time() - last_bounce_check > 30 * 60:
                    last_bounce_check = time.time()
                    check_bounces()

        except Exception as error:
            # Lỗi bất ngờ (đọc dữ liệu...): ghi lại rồi chạy tiếp ở vòng sau
            print("Lỗi bộ hẹn giờ thông báo:", str(error))

        time.sleep(60)


def start_scheduler() -> None:
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True
    threading.Thread(target=_scheduler_loop, name="studypilot-email", daemon=True).start()
    print("Đã bật bộ hẹn giờ thông báo Gmail.")


# ============================================================
# API
# ============================================================

class VerifyStartRequest(BaseModel):
    email: str


class VerifyConfirmRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class SettingsUpdateRequest(BaseModel):
    # Gmail của tài khoản đang đăng nhập (đã xác thực lúc đăng ký bằng mã 6 số / Google)
    email: str | None = None
    enabled: bool | None = None
    daily_enabled: bool | None = None
    daily_hour: int | None = Field(default=None, ge=5, le=21)
    weak_enabled: bool | None = None


class TestSendRequest(BaseModel):
    kind: str = "schedule"  # "schedule" | "weak"


@router.get("/settings")
def get_notification_settings():
    return {"data": public_settings(load_settings())}


@router.put("/settings")
def update_notification_settings(request: SettingsUpdateRequest):
    settings = load_settings()
    changes = request.model_dump(exclude_none=True)

    # Thư luôn gửi tới Gmail của tài khoản, không cần xác minh thêm lần nữa
    account_email = changes.pop("email", None)
    if account_email:
        address = validate_email(account_email)
        if address != settings.get("email") or not settings.get("verified"):
            settings.update({"email": address, "verified": True, "pending": None, "disabled_reason": None})

    if changes.get("enabled") and not settings.get("verified"):
        raise HTTPException(status_code=400, detail="Chưa có Gmail nhận thư. Hãy đăng nhập lại rồi thử lại.")

    settings.update(changes)
    if changes.get("enabled"):
        settings["disabled_reason"] = None
    save_settings(settings)
    return {"message": "Đã lưu cài đặt thông báo.", "data": public_settings(settings)}


@router.post("/verify/start")
def start_email_verification(request: VerifyStartRequest):
    address = validate_email(request.email)
    settings = load_settings()
    pending = settings.get("pending") or {}

    if pending.get("email") == address and pending.get("sent_at"):
        waited = time.time() - float(pending["sent_at"])
        if waited < CODE_RESEND_SECONDS:
            raise HTTPException(
                status_code=429,
                detail=f"Vui lòng đợi {int(CODE_RESEND_SECONDS - waited)} giây rồi gửi lại mã.",
            )

    code = f"{secrets.randbelow(1_000_000):06d}"
    html_body = _layout(
        "Mã xác minh email",
        "Nhập mã dưới đây vào StudyPilot để bật thông báo học tập qua email. "
        f"Mã có hiệu lực trong {CODE_TTL_MINUTES} phút.",
        [
            f'<tr><td style="padding:8px 32px 20px"><div style="font-size:34px;font-weight:800;letter-spacing:10px;'
            f'color:{PURPLE};background:#eef1fd;border-radius:14px;padding:16px;text-align:center">{code}</div></td></tr>',
            f'<tr><td style="padding:0 32px 16px;font-size:13px;color:{MUTED}">'
            "Nếu bạn không yêu cầu mã này, hãy bỏ qua thư.</td></tr>",
        ],
    )
    try:
        send_email(
            address,
            f"{code} là mã xác minh StudyPilot của bạn",
            html_body,
            f"Mã xác minh StudyPilot của bạn: {code} (hiệu lực {CODE_TTL_MINUTES} phút).",
        )
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Không gửi được mã tới email này: {error}")

    settings["pending"] = {
        "email": address,
        "code_hash": _hash_code(code),
        "sent_at": time.time(),
        "expires_at": time.time() + CODE_TTL_MINUTES * 60,
        "attempts": 0,
    }
    save_settings(settings)
    return {"message": f"Đã gửi mã 6 số tới {address}. Kiểm tra cả mục Spam nếu chưa thấy."}


@router.post("/verify/confirm")
def confirm_email_verification(request: VerifyConfirmRequest):
    settings = load_settings()
    pending = settings.get("pending") or {}

    if not pending.get("code_hash"):
        raise HTTPException(status_code=400, detail="Hãy bấm Gửi mã trước.")
    if time.time() > float(pending.get("expires_at") or 0):
        raise HTTPException(status_code=400, detail="Mã đã hết hạn, hãy gửi lại mã mới.")
    if int(pending.get("attempts") or 0) >= CODE_MAX_ATTEMPTS:
        raise HTTPException(status_code=400, detail="Nhập sai quá nhiều lần, hãy gửi lại mã mới.")

    if _hash_code(request.code.strip()) != pending["code_hash"]:
        pending["attempts"] = int(pending.get("attempts") or 0) + 1
        settings["pending"] = pending
        save_settings(settings)
        left = CODE_MAX_ATTEMPTS - pending["attempts"]
        raise HTTPException(status_code=400, detail=f"Mã chưa đúng. Bạn còn {left} lần thử.")

    settings.update({
        "email": pending["email"],
        "verified": True,
        "enabled": True,
        "disabled_reason": None,
        "pending": None,
    })
    save_settings(settings)
    return {"message": "Xác minh thành công! Thông báo học tập đã được bật.", "data": public_settings(settings)}


@router.post("/test")
def send_test_notification(request: TestSendRequest):
    settings = load_settings()
    if not settings.get("verified") or not settings.get("email"):
        raise HTTPException(status_code=400, detail="Chưa có Gmail nhận thư. Hãy đăng nhập lại rồi thử lại.")

    try:
        content = (
            build_weak_review(_user_id(), force=True)
            if request.kind == "weak"
            else build_daily_digest(_user_id(), force=True)
        )
        send_email(settings["email"], *content)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Không gửi được thư thử: {error}")

    return {"message": f"Đã gửi thư thử tới {settings['email']}."}


@router.delete("/email")
def remove_notification_email():
    settings = {**DEFAULT_SETTINGS}
    save_settings(settings)
    return {"message": "Đã xóa email và tắt thông báo.", "data": public_settings(settings)}
