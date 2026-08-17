"""RESQLIFE backend - FastAPI + Motor (MongoDB) + JWT auth."""
import asyncio
import base64
import math
import os
import re
import uuid
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, List, Optional, Literal

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

ROOT_DIR = Path(__file__).parent
AVATAR_DIR = ROOT_DIR / "uploads" / "avatars"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
MAX_AVATAR_BYTES = 400_000
if not os.environ.get("RAILWAY_ENVIRONMENT_NAME"):
    load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("safecount")

# ---------- Config ----------
def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name, default)
    if value is None:
        return None
    return value.strip().strip('"').strip("'")


def _on_railway() -> bool:
    return any(
        os.environ.get(key)
        for key in (
            "RAILWAY_ENVIRONMENT_NAME",
            "RAILWAY_ENVIRONMENT",
            "RAILWAY_PROJECT_ID",
            "RAILWAY_SERVICE_ID",
            "RAILWAY_PUBLIC_DOMAIN",
        )
    )


# Prefer RESQLIFE_MONGO_URL so Railway's injected MONGO_URL cannot override it.
MONGO_URL = _env("RESQLIFE_MONGO_URL") or _env("MONGO_URL") or ""
if not MONGO_URL:
    raise RuntimeError("MONGO_URL / RESQLIFE_MONGO_URL is not set")
CODE_VERSION = "2026-08-17-d"
logger.info(
    "boot v=%s mongo_source=%s mongo_keys=%s",
    CODE_VERSION,
    "RESQLIFE_MONGO_URL" if _env("RESQLIFE_MONGO_URL") else "MONGO_URL",
    [k for k in os.environ if "MONGO" in k.upper()],
)
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "safecount-dev-secret-change-in-production-please")
JWT_ALG = "HS256"
JWT_TTL_MIN = 60 * 24 * 7  # 7 days
TERMS_VERSION = "2026-07-13"

# Supabase Auth (session access_token from mobile app)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
# Server-only secret (sb_secret_…). Never expose to the Expo app.
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SECRET_KEY", "")
DEMO_MODE = os.environ.get("DEMO_MODE", "false").lower() in ("1", "true", "yes")


def supabase_auth_enabled() -> bool:
    return bool(SUPABASE_JWT_SECRET or (SUPABASE_URL and SUPABASE_SERVICE_KEY))

# Twilio (graceful no-op if not configured)
TWILIO_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM = os.environ.get("TWILIO_PHONE_NUMBER", "")

client = AsyncIOMotorClient(
    MONGO_URL,
    serverSelectionTimeoutMS=8000,
    connectTimeoutMS=8000,
)
db = client[DB_NAME]

app = FastAPI(title="RESQLIFE API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)


# ---------- Helpers ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def new_join_code() -> str:
    """Generates a unique 6-digit numeric join code."""
    import random
    return str(random.randint(100000, 999999))


def normalize_join_code(code: str) -> str:
    """Strip invite prefixes/spaces; join codes are 6 digits."""
    c = code.strip().upper().replace(" ", "")
    for prefix in ("SAFECOUNT:", "RESQLIFE:"):
        if c.startswith(prefix):
            c = c[len(prefix) :]
    return c


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def make_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_TTL_MIN),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def sanitize_user(user: dict) -> dict:
    u = dict(user)
    u.pop("_id", None)
    u.pop("password_hash", None)
    return u


def user_avatar_fields(user: dict) -> dict:
    """Avatar paths for list UIs (photos + initials fallback on clients)."""
    return {
        "avatar_url": user.get("avatar_url"),
        "avatar_updated_at": user.get("avatar_updated_at"),
    }


def strip_mongo_id(doc: Optional[dict]) -> Optional[dict]:
    if doc is None:
        return None
    out = dict(doc)
    out.pop("_id", None)
    return out


def strip_mongo_ids(docs: List[dict]) -> List[dict]:
    return [strip_mongo_id(d) or {} for d in docs]


def _claims_from_supabase_auth_api(token: str) -> dict:
    """Verify session via Supabase Auth API (uses sb_secret_ service key)."""
    if not (SUPABASE_URL and SUPABASE_SERVICE_KEY):
        raise HTTPException(status_code=503, detail="Supabase service key is not configured on the server")
    import requests

    try:
        resp = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": SUPABASE_SERVICE_KEY,
            },
            timeout=10,
        )
    except requests.RequestException as e:
        logger.warning("Supabase auth API error: %s", e)
        raise HTTPException(status_code=503, detail="Could not verify session with Supabase") from e
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    body = resp.json()
    user = body.get("user") if isinstance(body, dict) and "user" in body else body
    if not isinstance(user, dict) or not user.get("id"):
        raise HTTPException(status_code=401, detail="Invalid session response from Supabase")
    return {"sub": user["id"], "email": user.get("email")}


def decode_supabase_jwt(token: str) -> dict:
    if SUPABASE_JWT_SECRET:
        try:
            return jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
        except jwt.PyJWTError as e:
            raise HTTPException(status_code=401, detail="Invalid or expired session") from e
    return _claims_from_supabase_auth_api(token)


async def user_from_supabase_claims(claims: dict) -> dict:
    email = (claims.get("email") or "").lower()
    supabase_id = claims.get("sub")
    if not email or not supabase_id:
        raise HTTPException(status_code=401, detail="Invalid auth token claims")
    user = await db.users.find_one(
        {"$or": [{"supabase_id": supabase_id}, {"email": email}]},
        {"_id": 0, "password_hash": 0},
    )
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Account not set up yet. Complete sign-up and sync your profile.",
        )
    if not user.get("supabase_id"):
        await db.users.update_one({"id": user["id"]}, {"$set": {"supabase_id": supabase_id}})
        user["supabase_id"] = supabase_id
    return user


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
    if not creds:
        raise HTTPException(status_code=401, detail="Missing token")
    token = creds.credentials

    # Supabase session token (production)
    if supabase_auth_enabled():
        claims = decode_supabase_jwt(token)
        return await user_from_supabase_claims(claims)

    # Legacy app JWT (local dev without Supabase)
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def send_sms_stub(to: str, body: str):
    """Twilio SMS sender. Falls back to log-only if not configured."""
    if not (TWILIO_SID and TWILIO_TOKEN and TWILIO_FROM):
        logger.info(f"[SMS-STUB] to={to} body={body!r}")
        return
    try:
        from twilio.rest import Client as TwilioClient  # type: ignore
        TwilioClient(TWILIO_SID, TWILIO_TOKEN).messages.create(body=body, from_=TWILIO_FROM, to=to)
    except Exception as e:
        logger.warning(f"SMS send failed: {e}")


EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
ANDROID_LT_ALERT_EMERGENCY = "lt_alert_3"
ANDROID_LT_ALERT_DRILL = "lt_alert_drill"

# LT-Alert stiliaus numatyti tekstai (sutampa su frontend/src/notifications/ltAlertStyle.ts)
_LT_ALERT_EMERGENCY_BODY = {
    "fire": (
        "PERSPĖJIMAS. Mokymo įstaigoje paskelbtas gaisras. Nedelsdami palikite patalpas saugiu išėjimu, "
        "nenaudokite lifto. Eikite į evakuacijos susitikimo tašką. Laikykitės ramūs, padėkite aplinkiniams. "
        "Patvirtinkite savo būseną RESQLIFE programėlėje."
    ),
    "gas_leak": (
        "PERSPĖJIMAS. Galimas dujų nuotėkis. Nedelsdami palikite pavojingą zoną, nekurkite atviro liepsnos "
        "ir nejunkite elektros jungiklių. Eikite į susitikimo tašką ir patvirtinkite būseną RESQLIFE programėlėje."
    ),
    "evacuation": (
        "PERSPĖJIMAS. Paskelbtas evakuacijos įsakymas. Nedelsdami palikite pastatą ir eikite į nurodytą "
        "susitikimo tašką. Laikykitės koordinatoriaus nurodymų. Patvirtinkite, kad saugus, RESQLIFE programėlėje."
    ),
    "storm": (
        "PERSPĖJIMAS. Pavojingi meteorologiniai reiškiniai. Venkite langų, stiklinių fasadų ir medžių. "
        "Slėpkitės saugioje patalpoje arba eikite į susitikimo tašką. Patvirtinkite būseną RESQLIFE programėlėje."
    ),
    "security": (
        "PERSPĖJIMAS. Galima grėsmė saugumui. Nedelsdami vykdykite koordinatoriaus nurodymus, "
        "slėpkitės saugioje vietoje ir patvirtinkite būseną RESQLIFE programėlėje."
    ),
    "other": (
        "PERSPĖJIMAS. Paskelbtas įspėjimas mokymo įstaigoje. Nedelsdami vykdykite koordinatoriaus nurodymus "
        "ir patvirtinkite savo būseną RESQLIFE programėlėje."
    ),
}
_LT_ALERT_DRILL_BODY = (
    "Bandomasis įspėjimas. Vyksta mokymo įstaigos saugumo pratybos. Elkitės taip, lyg tai būtų tikras "
    "perspėjimas: evakuokitės į susitikimo tašką ir patvirtinkite, kad saugus, RESQLIFE programėlėje."
)
_LT_ALERT_REMINDER_BODY = (
    "PERSPĖJIMAS. Nepatvirtinote savo saugumo. Nedelsdami atidarykite RESQLIFE programėlę ir praneškite, "
    "ar esate saugus, ar jums reikia pagalbos."
)
_HAZARD_LT = {
    "fire": "gaisras",
    "gas_leak": "dujų nuotėkis",
    "evacuation": "evakuacija",
    "storm": "audra",
    "security": "saugumo grėsmė",
    "other": "pavojus",
}


def _alert_full_body(alert: dict, *, reminder: bool = False) -> str:
    custom = (alert.get("message") or "").strip()
    if reminder:
        return custom or _LT_ALERT_REMINDER_BODY
    if alert.get("mode") == "drill":
        return custom or _LT_ALERT_DRILL_BODY
    alert_type = (alert.get("type") or "other").lower()
    return custom or _LT_ALERT_EMERGENCY_BODY.get(alert_type, _LT_ALERT_EMERGENCY_BODY["other"])


def _alert_banner_body(full: str) -> str:
    """Short preview for collapsed notification banner (~3 lines)."""
    parts = [p.strip() for p in re.findall(r"[^.!?]+[.!?]+", full) if p.strip()]
    lead = parts[1:] if parts and parts[0].upper().startswith("PERSPĖJIMAS") else parts
    matching = [
        s
        for s in lead
        if re.search(
            r"nedelsdami|evakuac|eikite|patvirtinkite|slėpkitės|vykdykite|atidarykite",
            s,
            re.I,
        )
    ]
    action = " ".join(matching[:2])
    banner = action.strip() or " ".join(lead[:2])
    if len(banner) > 128:
        banner = banner[:127].rstrip() + "…"
    if len(full) > len(banner) + 24:
        banner = f"{banner} Atidarykite — pilna žinutė."
    return banner or full[:128]


def _alert_push_copy(alert: dict, *, reminder: bool = False) -> tuple[str, str, str, str]:
    """Returns (title, subtitle, banner_body, full_body)."""
    full = _alert_full_body(alert, reminder=reminder)
    alert_type = (alert.get("type") or "other").lower()
    hazard = _HAZARD_LT.get(alert_type, "pavojus")
    if reminder:
        return (
            "LT-Alert · Priminimas",
            "Priminimas — reikia atsakymo",
            _alert_banner_body(full),
            full,
        )
    if alert.get("mode") == "drill":
        return ("LT-Alert · Pratybos", "Bandomasis perspėjimas", _alert_banner_body(full), full)
    return ("LT-Alert", f"Įspėjimas: {hazard}", _alert_banner_body(full), full)


def _alert_android_channel(alert: dict, *, reminder: bool = False) -> str:
    if alert.get("mode") == "drill" and not reminder:
        return ANDROID_LT_ALERT_DRILL
    return ANDROID_LT_ALERT_EMERGENCY


def send_expo_push(messages: list[dict]) -> int:
    """Send push messages via Expo. Returns count accepted for delivery."""
    if not messages:
        return 0
    import requests

    sent = 0
    for i in range(0, len(messages), 100):
        chunk = messages[i : i + 100]
        try:
            resp = requests.post(
                EXPO_PUSH_URL,
                json=chunk,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                timeout=15,
            )
            if resp.status_code != 200:
                logger.warning("Expo push HTTP %s: %s", resp.status_code, resp.text[:500])
                continue
            body = resp.json()
            for item in body.get("data") or []:
                if item.get("status") == "ok":
                    sent += 1
                else:
                    logger.warning("Expo push ticket error: %s", item)
        except requests.RequestException as e:
            logger.warning("Expo push request failed: %s", e)
    return sent


async def send_alert_push_notifications(
    alert: dict,
    *,
    only_user_ids: Optional[set] = None,
    reminder: bool = False,
) -> int:
    """Notify team members who registered an Expo push token."""
    query: dict = {
        "team_ids": {"$in": alert["team_ids"]},
        "expo_push_token": {"$exists": True, "$nin": [None, ""]},
    }
    if only_user_ids is not None:
        query["id"] = {"$in": list(only_user_ids)}
    members = await db.users.find(
        query, {"_id": 0, "expo_push_token": 1, "push_platform": 1}
    ).to_list(2000)
    title, subtitle, banner_body, full_body = _alert_push_copy(alert, reminder=reminder)
    is_emergency = alert.get("mode") == "emergency" and not reminder
    channel_id = _alert_android_channel(alert, reminder=reminder)
    messages = []
    for m in members:
        token = m.get("expo_push_token")
        if not token or not str(token).startswith("ExponentPushToken"):
            continue
        # iOS: short body + subtitle (banner height is fixed). Android: full body for expanded BigText.
        push_body = (
            full_body[:2000]
            if m.get("push_platform") == "android"
            else banner_body[:240]
        )
        msg = {
            "to": token,
            "title": title,
            "subtitle": subtitle,
            "body": push_body,
            "sound": "default",
            "priority": "high",
            "channelId": channel_id,
            "data": {
                "alertId": alert["id"],
                "fullMessage": full_body[:2000],
                "reminder": reminder,
                "reminderAt": alert.get("last_reminded_at"),
            },
        }
        if is_emergency or reminder:
            msg["interruptionLevel"] = "time-sensitive"
        messages.append(msg)
    count = send_expo_push(messages)
    if count:
        logger.info("Expo push sent %s tickets for alert %s", count, alert.get("id"))
    return count


# ---------- Models ----------
class RegisterReq(BaseModel):
    email: EmailStr
    password: str = Field(min_length=4)
    name: str
    phone: Optional[str] = None


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class CreateTeamReq(BaseModel):
    name: str
    location_id: Optional[str] = None
    firewatch_user_id: Optional[str] = None
    assembly_point_id: Optional[str] = None


class CreateMemberReq(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    role_title: Optional[str] = None
    team_id: str


class UpdateTeamMemberReq(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    phone: Optional[str] = None
    role_title: Optional[str] = Field(default=None, max_length=120)


class CreateAssemblyPointReq(BaseModel):
    name: str
    description: Optional[str] = None
    location_id: Optional[str] = None


class AssemblyPointPinReq(BaseModel):
    latitude: float
    longitude: float
    address: Optional[str] = None


class AssemblyPointIn(BaseModel):
    id: Optional[str] = None
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str] = None


def _coerce_coord(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def _assembly_point_pin_fields(ap_in: AssemblyPointIn) -> dict:
    """Persist coordinates when the client sent valid numbers; only clear when explicitly null."""
    fields = getattr(ap_in, "model_fields_set", None) or set()
    out: dict = {}
    lat = _coerce_coord(ap_in.latitude)
    lng = _coerce_coord(ap_in.longitude)
    if lat is not None and lng is not None:
        out["latitude"] = lat
        out["longitude"] = lng
    else:
        if "latitude" in fields:
            out["latitude"] = lat
        if "longitude" in fields:
            out["longitude"] = lng
    if "address" in fields:
        out["address"] = ap_in.address
    return out


async def _assembly_points_for_workspace(
    org_id: str,
    location_id: Optional[str],
    primary_ap_id: Optional[str],
) -> List[dict]:
    """Meeting points for this workspace, always including the team's primary assembly point."""
    all_aps = await db.assembly_points.find({"organization_id": org_id}, {"_id": 0}).to_list(100)
    by_id: dict[str, dict] = {}
    for ap in all_aps:
        ap_loc = ap.get("location_id")
        if ap.get("id") == primary_ap_id:
            by_id[ap["id"]] = ap
        elif location_id and ap_loc == location_id:
            by_id[ap["id"]] = ap
        elif not ap_loc:
            by_id[ap["id"]] = ap
    return list(by_id.values())


def _assembly_point_payload(ap: Optional[dict]) -> Optional[dict]:
    if not ap:
        return None
    lat = _coerce_coord(ap.get("latitude"))
    lng = _coerce_coord(ap.get("longitude"))
    return {
        "id": ap.get("id"),
        "name": ap.get("name"),
        "description": ap.get("description"),
        "latitude": lat,
        "longitude": lng,
        "address": ap.get("address"),
    }


class FirewatchSetupReq(BaseModel):
    team_id: Optional[str] = None
    organization_name: Optional[str] = None
    location_name: str = Field(min_length=1, max_length=120)
    location_address: Optional[str] = None
    location_description: Optional[str] = None
    team_name: str = Field(min_length=1, max_length=120)
    assembly_points: List[AssemblyPointIn] = Field(min_length=1, max_length=15)
    default_assembly_point_index: int = 0


class UpdateTeamReq(BaseModel):
    name: Optional[str] = None
    location_id: Optional[str] = None
    assembly_point_id: Optional[str] = None


class StartAlertReq(BaseModel):
    type: Literal["fire", "gas_leak", "evacuation", "storm", "security", "other"]
    mode: Literal["drill", "emergency"]
    team_ids: List[str]
    message: str = "Emergency alert. Please confirm your safety immediately."


class RespondAlertReq(BaseModel):
    status: Literal["safe", "needs_help", "not_at_location"]
    safe_location: Optional[str] = None  # assembly point id or label
    note: Optional[str] = None
    location_shared: bool = False


class ManualMarkSafeReq(BaseModel):
    user_id: str


class SendChatMessageReq(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class UpsertLiveLocationReq(BaseModel):
    latitude: float
    longitude: float
    accuracy_m: Optional[float] = None


LIVE_LOCATION_STALE_SECONDS = 30


# ---------- Auth routes ----------
class AuthSyncReq(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    account_type: Optional[Literal["member", "firewatch"]] = None


class PushTokenReq(BaseModel):
    token: str = Field(min_length=10)
    platform: Optional[Literal["ios", "android", "web"]] = None


class UpdateProfileReq(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    account_type: Optional[Literal["member", "firewatch"]] = None


class AcceptTermsReq(BaseModel):
    accepted: bool
    terms_version: Optional[str] = Field(default=None, max_length=32)


class ChangePasswordReq(BaseModel):
    current_password: str = Field(min_length=4)
    new_password: str = Field(min_length=6, max_length=128)


class AvatarUploadReq(BaseModel):
    image_base64: str = Field(min_length=32)
    content_type: Optional[Literal["image/jpeg", "image/png", "image/webp"]] = "image/jpeg"


@api.post("/auth/sync")
async def auth_sync(req: AuthSyncReq, creds: HTTPAuthorizationCredentials = Depends(bearer)):
    """Link Supabase auth user to SafeCount MongoDB profile (call after sign-up / sign-in)."""
    if not creds:
        raise HTTPException(status_code=401, detail="Missing token")
    claims = decode_supabase_jwt(creds.credentials)
    email = (claims.get("email") or "").lower()
    supabase_id = claims.get("sub")
    if not email or not supabase_id:
        raise HTTPException(status_code=400, detail="Token missing email or user id")

    existing = await db.users.find_one(
        {"$or": [{"supabase_id": supabase_id}, {"email": email}]},
        {"_id": 0},
    )
    if existing:
        updates = {"supabase_id": supabase_id, "email": email}
        if req.name:
            updates["name"] = req.name
        if req.phone is not None:
            updates["phone"] = req.phone
        await db.users.update_one({"id": existing["id"]}, {"$set": updates})
        user = await db.users.find_one({"id": existing["id"]}, {"_id": 0, "password_hash": 0})
        return sanitize_user(user)

    name = req.name or (email.split("@")[0].replace(".", " ").title())
    demo_roles = {
        "admin@safecount.demo": ["admin"],
        "jonas@safecount.demo": ["firewatch"],
        "ruta@safecount.demo": ["member"],
    }
    if email in demo_roles:
        roles = demo_roles[email]
    elif req.account_type == "firewatch":
        roles = ["firewatch", "member"]
    else:
        roles = ["member"]
    user = {
        "id": new_id(),
        "supabase_id": supabase_id,
        "email": email,
        "password_hash": None,
        "name": name,
        "phone": req.phone,
        "roles": roles,
        "organization_id": None,
        "team_ids": [],
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    return sanitize_user(user)


@api.post("/auth/register")
async def register(req: RegisterReq):
    if supabase_auth_enabled():
        raise HTTPException(
            status_code=400,
            detail="Use Supabase sign-up in the app, then POST /auth/sync with your session token.",
        )
    if await db.users.find_one({"email": req.email.lower()}):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = {
        "id": new_id(),
        "email": req.email.lower(),
        "password_hash": hash_pw(req.password),
        "name": req.name,
        "phone": req.phone,
        "roles": ["member"],
        "organization_id": None,
        "team_ids": [],
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    token = make_token(user["id"])
    return {"token": token, "user": sanitize_user(user)}


@api.post("/auth/login")
async def login(req: LoginReq):
    """Legacy login when Supabase is not configured. Demo mode allows passwordless auto-create."""
    if supabase_auth_enabled():
        raise HTTPException(
            status_code=400,
            detail="Use Supabase sign-in in the app. Legacy /auth/login is disabled when Supabase is enabled.",
        )
    user = await db.users.find_one({"email": req.email.lower()})
    if user:
        if not DEMO_MODE and user.get("password_hash") and not verify_pw(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")
    elif DEMO_MODE:
        user = {
            "id": new_id(),
            "email": req.email.lower(),
            "password_hash": hash_pw(req.password),
            "name": req.email.split("@")[0].replace(".", " ").title(),
            "phone": None,
            "roles": ["admin", "firewatch", "member"],
            "organization_id": None,
            "team_ids": [],
            "created_at": now_iso(),
        }
        await db.users.insert_one(user)
    else:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = make_token(user["id"])
    return {"token": token, "user": sanitize_user(user)}


@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


@api.put("/users/me/push-token")
async def save_push_token(req: PushTokenReq, user=Depends(get_current_user)):
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {
                "expo_push_token": req.token.strip(),
                "push_platform": req.platform,
                "push_token_updated_at": now_iso(),
            }
        },
    )
    return {"ok": True}


def _decode_avatar_bytes(raw: str) -> bytes:
    payload = raw.strip()
    if "," in payload and payload.startswith("data:"):
        payload = payload.split(",", 1)[1]
    try:
        data = base64.b64decode(payload, validate=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid image data") from e
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 400 KB)")
    if len(data) < 64:
        raise HTTPException(status_code=400, detail="Image data too small")
    return data


def _avatar_ext(content_type: str) -> str:
    if content_type == "image/png":
        return "png"
    if content_type == "image/webp":
        return "webp"
    return "jpg"


@api.patch("/users/me")
async def update_profile(req: UpdateProfileReq, user=Depends(get_current_user)):
    updates: dict = {}
    role_updates: dict = {}
    if req.name is not None:
        updates["name"] = req.name.strip()
    if req.phone is not None:
        phone = req.phone.strip()
        updates["phone"] = phone or None
    if req.account_type == "firewatch":
        role_updates["$addToSet"] = {"roles": {"$each": ["member", "firewatch"]}}
    elif req.account_type == "member":
        role_updates["$set"] = {"roles": ["member"]}
    if not updates and not role_updates:
        return sanitize_user(user)
    updates["profile_updated_at"] = now_iso()
    update_doc: dict = {}
    if updates:
        update_doc["$set"] = updates
    if role_updates.get("$set"):
        update_doc.setdefault("$set", {}).update(role_updates["$set"])
    if role_updates.get("$addToSet"):
        update_doc["$addToSet"] = role_updates["$addToSet"]
    await db.users.update_one({"id": user["id"]}, update_doc)
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return sanitize_user(updated)


@api.post("/users/me/accept-terms")
async def accept_terms(req: AcceptTermsReq, user=Depends(get_current_user)):
    if not req.accepted:
        raise HTTPException(status_code=400, detail="Terms must be accepted to use the app")
    version = (req.terms_version or TERMS_VERSION).strip() or TERMS_VERSION
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"terms_accepted_at": now_iso(), "terms_version": version}},
    )
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return sanitize_user(updated)


@api.put("/users/me/avatar")
async def upload_avatar(req: AvatarUploadReq, user=Depends(get_current_user)):
    data = _decode_avatar_bytes(req.image_base64)
    ext = _avatar_ext(req.content_type or "image/jpeg")
    path = AVATAR_DIR / f"{user['id']}.{ext}"
    for old in AVATAR_DIR.glob(f"{user['id']}.*"):
        if old != path:
            old.unlink(missing_ok=True)
    path.write_bytes(data)
    avatar_url = f"/api/static/avatars/{user['id']}.{ext}"
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"avatar_url": avatar_url, "avatar_updated_at": now_iso()}},
    )
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return sanitize_user(updated)


@api.delete("/users/me/avatar")
async def remove_avatar(user=Depends(get_current_user)):
    for old in AVATAR_DIR.glob(f"{user['id']}.*"):
        old.unlink(missing_ok=True)
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"avatar_url": None, "avatar_updated_at": now_iso()}},
    )
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return sanitize_user(updated)


async def _purge_team(team_id: str) -> None:
    alert_ids = [
        a["id"]
        async for a in db.alerts.find({"team_ids": team_id}, {"_id": 0, "id": 1})
    ]
    if alert_ids:
        await db.alert_responses.delete_many({"alert_id": {"$in": alert_ids}})
        await db.alerts.delete_many({"id": {"$in": alert_ids}})
    team = await db.teams.find_one({"id": team_id}, {"_id": 0, "member_ids": 1})
    if team:
        member_ids = team.get("member_ids") or []
        if member_ids:
            await db.users.update_many(
                {"id": {"$in": member_ids}},
                {"$pull": {"team_ids": team_id}},
            )
        await db.teams.delete_one({"id": team_id})


async def _delete_owned_teams(user_id: str) -> None:
    owned = await db.teams.find({"firewatch_user_id": user_id}, {"_id": 0, "id": 1}).to_list(100)
    for team in owned:
        await _purge_team(team["id"])


def _delete_supabase_auth_user(supabase_id: Optional[str]) -> None:
    if not supabase_id or not (SUPABASE_URL and SUPABASE_SERVICE_KEY):
        return
    import requests

    try:
        resp = requests.delete(
            f"{SUPABASE_URL}/auth/v1/admin/users/{supabase_id}",
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "apikey": SUPABASE_SERVICE_KEY,
            },
            timeout=15,
        )
    except requests.RequestException as e:
        logger.warning("Supabase user delete failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Could not delete login account. Try again in a moment.",
        ) from e
    if resp.status_code not in (200, 204, 404):
        logger.warning("Supabase user delete HTTP %s: %s", resp.status_code, resp.text[:200])
        raise HTTPException(
            status_code=502,
            detail="Could not delete login account. Try again in a moment.",
        )


@api.delete("/users/me")
async def delete_my_account(user=Depends(get_current_user)):
    user_id = user["id"]
    supabase_id = user.get("supabase_id")

    if supabase_auth_enabled():
        if not supabase_id:
            raise HTTPException(
                status_code=400,
                detail="Login id missing on profile. Sign out, sign in again, then retry account deletion.",
            )
        _delete_supabase_auth_user(supabase_id)

    await _delete_owned_teams(user_id)

    for old in AVATAR_DIR.glob(f"{user_id}.*"):
        old.unlink(missing_ok=True)

    await db.teams.update_many({"member_ids": user_id}, {"$pull": {"member_ids": user_id}})
    await db.alert_responses.delete_many({"user_id": user_id})
    await db.users.delete_one({"id": user_id})
    return {"ok": True, "deleted": True}


@api.put("/users/me/password")
async def change_password_legacy(req: ChangePasswordReq, user=Depends(get_current_user)):
    """Change password for legacy (non-Supabase) accounts."""
    if supabase_auth_enabled():
        raise HTTPException(
            status_code=400,
            detail="Use the app profile screen to change your password (Supabase account).",
        )
    pw_hash = user.get("password_hash")
    if not pw_hash or not verify_pw(req.current_password, pw_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_pw(req.new_password), "profile_updated_at": now_iso()}},
    )
    return {"ok": True}


@api.get("/health")
async def health():
    return {"ok": True, "v": CODE_VERSION}


async def _mongo_ping() -> tuple[bool, str | None]:
    try:
        await asyncio.wait_for(db.command("ping"), timeout=8)
        return True, None
    except Exception as e:
        return False, str(e)


def _mongo_connection_info() -> dict[str, str | bool | None]:
    """Safe summary of MONGO_URL for deploy diagnostics (no password)."""
    match = re.match(r"mongodb\+srv://([^:/]+)(?::[^@]+)?@([^/?]+)", MONGO_URL)
    source = "RESQLIFE_MONGO_URL" if _env("RESQLIFE_MONGO_URL") else "MONGO_URL"
    return {
        "mongo_user": match.group(1) if match else None,
        "mongo_host": match.group(2) if match else None,
        "mongo_source": source,
        "has_resqlife_mongo_url": bool(_env("RESQLIFE_MONGO_URL")),
        "on_railway": _on_railway(),
        "railway_service": _env("RAILWAY_SERVICE_NAME"),
        "boot_id": _env("BOOT_ID"),
        "env_keys": sorted(
            k
            for k in os.environ
            if any(part in k.upper() for part in ("MONGO", "BOOT", "SUPABASE", "JWT", "DB_"))
        ),
    }


@api.get("/health/db")
async def health_db():
    ok, err = await _mongo_ping()
    info = {"database": DB_NAME, **_mongo_connection_info()}
    if ok:
        return {"ok": True, **info}
    return {"ok": False, **info, "error": err}


@api.get("/auth/config")
async def auth_config():
    teams_registered = 0
    try:
        teams_registered = await db.teams.count_documents({})
    except Exception as e:
        logger.error("auth/config: MongoDB query failed: %s", e)
    return {
        "supabase_url": SUPABASE_URL or None,
        "supabase_enabled": supabase_auth_enabled(),
        "demo_mode": DEMO_MODE and not supabase_auth_enabled(),
        "teams_registered": teams_registered,
    }


DEMO_AUTH_USERS = [
    ("admin@safecount.demo", "Demo1234", "Admin User"),
    ("jonas@safecount.demo", "Demo1234", "Jonas Kazlauskas"),
    ("ruta@safecount.demo", "Demo1234", "Ruta Petraitiene"),
]


async def ensure_supabase_demo_users() -> dict:
    """Create or confirm seed demo users in Supabase Auth (email already confirmed)."""
    if not (SUPABASE_URL and SUPABASE_SERVICE_KEY):
        return {"ok": False, "reason": "supabase_not_configured", "results": []}
    import requests

    results = []
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "apikey": SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
    }
    for email, password, name in DEMO_AUTH_USERS:
        try:
            resp = requests.post(
                f"{SUPABASE_URL}/auth/v1/admin/users",
                headers=headers,
                json={
                    "email": email,
                    "password": password,
                    "email_confirm": True,
                    "user_metadata": {"name": name},
                },
                timeout=15,
            )
            if resp.status_code in (200, 201):
                results.append({"email": email, "status": "created"})
            elif resp.status_code == 422:
                results.append({"email": email, "status": "exists"})
            else:
                results.append({"email": email, "status": "error", "detail": resp.text[:200]})
                logger.warning("Demo user %s: %s %s", email, resp.status_code, resp.text[:120])
        except requests.RequestException as e:
            results.append({"email": email, "status": "error", "detail": str(e)})
            logger.warning("Demo user %s request failed: %s", email, e)
    return {"ok": True, "results": results}


@api.post("/auth/ensure-demo-users")
async def ensure_demo_users_endpoint():
    return await ensure_supabase_demo_users()


# ---------- Organization & lookups ----------
@api.get("/org")
async def get_org(user=Depends(get_current_user)):
    org_id = user.get("organization_id")
    if not org_id:
        return None
    org = await db.organizations.find_one({"id": org_id}, {"_id": 0})
    return org


@api.get("/locations")
async def list_locations(user=Depends(get_current_user)):
    org_id = user.get("organization_id")
    return await db.locations.find({"organization_id": org_id}, {"_id": 0}).to_list(100)


# ---------- Teams ----------
@api.get("/teams")
async def list_teams(user=Depends(get_current_user)):
    org_id = user.get("organization_id")
    teams = await db.teams.find({"organization_id": org_id}, {"_id": 0}).to_list(500)
    # enrich
    for t in teams:
        fw = await db.users.find_one({"id": t.get("firewatch_user_id")}, {"_id": 0, "password_hash": 0})
        ap = await db.assembly_points.find_one({"id": t.get("assembly_point_id")}, {"_id": 0})
        t["firewatch_name"] = fw["name"] if fw else None
        t["assembly_point_name"] = ap["name"] if ap else None
        t["member_count"] = len(t.get("member_ids", []))
    return teams


@api.post("/teams")
async def create_team(req: CreateTeamReq, user=Depends(get_current_user)):
    team = {
        "id": new_id(),
        "organization_id": user.get("organization_id"),
        "name": req.name,
        "location_id": req.location_id,
        "firewatch_user_id": req.firewatch_user_id,
        "assembly_point_id": req.assembly_point_id,
        "member_ids": [],
        "join_code": new_join_code(),
        "last_drill_at": None,
        "created_at": now_iso(),
    }
    await db.teams.insert_one(team)
    team.pop("_id", None)
    return team


class JoinTeamReq(BaseModel):
    code: str


async def _team_for_member_user(user: dict) -> Optional[dict]:
    """Team the user belongs to as a responder (roster or coordinator of that team)."""
    team = await db.teams.find_one({"member_ids": user["id"]}, {"_id": 0})
    if team:
        return team
    team = await db.teams.find_one({"firewatch_user_id": user["id"]}, {"_id": 0})
    if team:
        return team
    team_ids = user.get("team_ids") or []
    if team_ids:
        return await db.teams.find_one({"id": team_ids[0]}, {"_id": 0})
    return None


def _user_on_team(user: dict, team: dict) -> bool:
    return user["id"] in (team.get("member_ids") or []) or team.get("firewatch_user_id") == user["id"]


async def _leave_team_as_member(user_id: str, team_id: str) -> None:
    team = await db.teams.find_one({"id": team_id}, {"_id": 0, "firewatch_user_id": 1})
    if not team:
        return
    if team.get("firewatch_user_id") == user_id:
        raise HTTPException(
            status_code=400,
            detail="Coordinators cannot leave their own team this way",
        )
    await db.teams.update_one({"id": team_id}, {"$pull": {"member_ids": user_id}})
    await db.users.update_one({"id": user_id}, {"$pull": {"team_ids": team_id}})


async def _leave_all_member_teams_except(user_id: str, keep_team_id: Optional[str] = None) -> None:
    """Remove user from every team they joined as a member (not as coordinator)."""
    teams = await db.teams.find(
        {"member_ids": user_id},
        {"_id": 0, "id": 1, "firewatch_user_id": 1},
    ).to_list(100)
    for t in teams:
        tid = t["id"]
        if keep_team_id and tid == keep_team_id:
            continue
        if t.get("firewatch_user_id") == user_id:
            continue
        await db.teams.update_one({"id": tid}, {"$pull": {"member_ids": user_id}})
        await db.users.update_one({"id": user_id}, {"$pull": {"team_ids": tid}})


@api.post("/teams/leave")
async def leave_my_team(user=Depends(get_current_user)):
    """Member leaves their current team so they can join another."""
    team = await _team_for_member_user(user)
    if not team:
        return {"ok": True, "left": False}
    if team.get("firewatch_user_id") == user["id"]:
        raise HTTPException(
            status_code=400,
            detail="Koordinatorius negali palikti savo komandos — naudokite koordinatoriaus nustatymus",
        )
    if user["id"] not in (team.get("member_ids") or []):
        return {"ok": True, "left": False}
    await _leave_team_as_member(user["id"], team["id"])
    return {"ok": True, "left": True, "team_id": team["id"]}


@api.get("/teams/lookup")
async def lookup_team(code: str, user=Depends(get_current_user)):
    """Preview team info from join code before committing. Used by confirmation step."""
    c = normalize_join_code(code)
    team = await db.teams.find_one({"join_code": c}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Code not found")
    org = await db.organizations.find_one({"id": team["organization_id"]}, {"_id": 0})
    fw = await db.users.find_one(
        {"id": team.get("firewatch_user_id")},
        {"_id": 0, "password_hash": 0},
    )
    already_member = _user_on_team(user, team)
    return {
        "team": {"id": team["id"], "name": team["name"], "member_count": len(team.get("member_ids", []))},
        "organization": {"id": org["id"], "name": org["name"]} if org else None,
        "firewatch": {"id": fw["id"], "name": fw["name"]} if fw else None,
        "already_member": already_member,
    }


@api.post("/teams/join")
async def join_team(req: JoinTeamReq, user=Depends(get_current_user)):
    code = normalize_join_code(req.code)
    team = await db.teams.find_one({"join_code": code}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Code not found")
    if _user_on_team(user, team):
        if user["id"] not in (team.get("member_ids") or []):
            await db.teams.update_one({"id": team["id"]}, {"$addToSet": {"member_ids": user["id"]}})
            await db.users.update_one(
                {"id": user["id"]},
                {
                    "$addToSet": {"team_ids": team["id"]},
                    "$set": {
                        "organization_id": team["organization_id"],
                        "joined_by_method": "six_digit_code" if code.isdigit() else "qr_code",
                        "joined_at": now_iso(),
                    },
                },
            )
        active = await db.alerts.find_one(
            {"team_ids": team["id"], "status": "active"}, {"_id": 0}
        )
        return {
            "ok": True,
            "team": team,
            "active_alert_id": active["id"] if active else None,
            "already_member": True,
        }
    await _leave_all_member_teams_except(user["id"], keep_team_id=team["id"])
    await db.teams.update_one({"id": team["id"]}, {"$addToSet": {"member_ids": user["id"]}})
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$addToSet": {"team_ids": team["id"]},
            "$set": {
                "organization_id": team["organization_id"],
                "joined_by_method": "six_digit_code" if code.isdigit() else "qr_code",
                "joined_at": now_iso(),
            },
        },
    )
    active = await db.alerts.find_one(
        {"team_ids": team["id"], "status": "active"}, {"_id": 0}
    )
    if active:
        await send_alert_push_notifications(active, only_user_ids={user["id"]})
    return {
        "ok": True,
        "team": team,
        "active_alert_id": active["id"] if active else None,
    }


async def _team_for_coordinator(team_id: str, user: dict) -> dict:
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if team.get("firewatch_user_id") != user["id"] and "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="Only this team's coordinator can manage it")
    return team


@api.get("/teams/{team_id}/members")
async def list_team_members(team_id: str, user=Depends(get_current_user)):
    team = await _team_for_coordinator(team_id, user)
    member_ids = team.get("member_ids") or []
    if not member_ids:
        return {"team_id": team_id, "team_name": team.get("name"), "members": []}
    rows = await db.users.find(
        {"id": {"$in": member_ids}}, {"_id": 0, "password_hash": 0}
    ).to_list(500)
    rows.sort(key=lambda m: (m.get("name") or "").lower())
    members = [
        {
            "id": m["id"],
            "name": m.get("name"),
            "email": m.get("email"),
            "phone": m.get("phone"),
            "role_title": m.get("role_title"),
            "joined_at": m.get("joined_at"),
            "joined_by_method": m.get("joined_by_method"),
            **user_avatar_fields(m),
        }
        for m in rows
    ]
    return {"team_id": team_id, "team_name": team.get("name"), "members": members}


@api.patch("/teams/{team_id}/members/{member_id}")
async def update_team_member(
    team_id: str, member_id: str, req: UpdateTeamMemberReq, user=Depends(get_current_user)
):
    team = await _team_for_coordinator(team_id, user)
    if member_id not in (team.get("member_ids") or []):
        raise HTTPException(status_code=404, detail="Member not on this team")
    member = await db.users.find_one({"id": member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="User not found")
    updates = {k: v for k, v in req.model_dump(exclude_unset=True).items()}
    if "name" in updates and updates["name"] is not None:
        updates["name"] = updates["name"].strip()
    if "phone" in updates:
        updates["phone"] = (updates["phone"] or "").strip() or None
    if "role_title" in updates:
        rt = updates["role_title"]
        updates["role_title"] = rt.strip() if rt else None
    if updates:
        await db.users.update_one({"id": member_id}, {"$set": updates})
    updated = await db.users.find_one({"id": member_id}, {"_id": 0, "password_hash": 0})
    return sanitize_user(updated)


@api.delete("/teams/{team_id}/members/{member_id}")
async def remove_team_member(team_id: str, member_id: str, user=Depends(get_current_user)):
    team = await _team_for_coordinator(team_id, user)
    if member_id not in (team.get("member_ids") or []):
        raise HTTPException(status_code=404, detail="Member not on this team")
    if member_id == team.get("firewatch_user_id"):
        raise HTTPException(status_code=400, detail="Cannot remove the team coordinator")
    await db.teams.update_one({"id": team_id}, {"$pull": {"member_ids": member_id}})
    await db.users.update_one({"id": member_id}, {"$pull": {"team_ids": team_id}})
    return {"ok": True}


@api.get("/teams/{team_id}/join-code")
async def get_team_join_code(team_id: str, user=Depends(get_current_user)):
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if not team.get("join_code"):
        code = new_join_code()
        await db.teams.update_one({"id": team_id}, {"$set": {"join_code": code}})
        team["join_code"] = code
    org = await db.organizations.find_one({"id": team["organization_id"]}, {"_id": 0})
    fw = await db.users.find_one(
        {"id": team.get("firewatch_user_id")},
        {"_id": 0, "password_hash": 0},
    )
    return {
        "team_id": team_id,
        "team_name": team["name"],
        "join_code": team["join_code"],
        "organization_name": org["name"] if org else None,
        "firewatch_name": fw["name"] if fw else None,
        "member_count": len(team.get("member_ids", [])),
    }


@api.post("/teams/{team_id}/regenerate-code")
async def regenerate_team_code(team_id: str, user=Depends(get_current_user)):
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    new_code = new_join_code()
    await db.teams.update_one({"id": team_id}, {"$set": {"join_code": new_code}})
    return {"team_id": team_id, "join_code": new_code}


def _valid_team_id(team_id: Optional[str]) -> Optional[str]:
    if not team_id:
        return None
    tid = team_id.strip()
    if tid.lower() in ("undefined", "null", ""):
        return None
    return tid


async def _firewatch_team_for_user(user_id: str, team_id: Optional[str] = None) -> Optional[dict]:
    tid = _valid_team_id(team_id)
    if tid:
        team = await db.teams.find_one({"id": tid}, {"_id": 0})
        if not team:
            return None
        if team.get("firewatch_user_id") == user_id:
            return team
        user = await db.users.find_one({"id": user_id}, {"_id": 0}) or {}
        if (
            team.get("organization_id")
            and team.get("organization_id") == user.get("organization_id")
            and "firewatch" in user.get("roles", [])
        ):
            return team
        if "admin" in user.get("roles", []):
            return team
        return None
    return await db.teams.find_one({"firewatch_user_id": user_id}, {"_id": 0})


@api.get("/firewatch/setup")
async def get_firewatch_setup(team_id: Optional[str] = None, user=Depends(get_current_user)):
    """Whether this user has configured site, location, and meeting points."""
    team = await _firewatch_team_for_user(user["id"], team_id)
    if team_id and not team:
        raise HTTPException(status_code=404, detail="Team not found")
    org_id = user.get("organization_id")
    if not team:
        can_setup = not user.get("team_ids")
        return {
            "complete": False,
            "can_setup": can_setup,
            "team": None,
            "location": None,
            "assembly_points": [],
            "organization": None,
        }
    location = None
    if team.get("location_id"):
        location = await db.locations.find_one({"id": team["location_id"]}, {"_id": 0})
    org = await db.organizations.find_one({"id": team.get("organization_id")}, {"_id": 0}) if team.get("organization_id") else None
    loc_id = team.get("location_id")
    assembly_points = await _assembly_points_for_workspace(
        team["organization_id"], loc_id, team.get("assembly_point_id")
    )
    complete = bool(
        location
        and len(assembly_points) >= 1
        and team.get("assembly_point_id")
        and team.get("name")
    )
    return {
        "complete": complete,
        "can_setup": True,
        "team": team,
        "location": location,
        "assembly_points": [
            _assembly_point_payload(ap) for ap in assembly_points if ap
        ],
        "organization": org,
    }


@api.post("/firewatch/setup")
async def save_firewatch_setup(req: FirewatchSetupReq, user=Depends(get_current_user)):
    """Create or update the Firewatch workspace (location, meeting points, team) before inviting members."""
    if not req.assembly_points:
        raise HTTPException(status_code=400, detail="Add at least one emergency meeting point")
    default_idx = max(0, min(req.default_assembly_point_index, len(req.assembly_points) - 1))

    team = await _firewatch_team_for_user(user["id"], req.team_id)
    if req.team_id and not team:
        raise HTTPException(status_code=404, detail="Team not found")
    org_id = team.get("organization_id") if team else user.get("organization_id")

    if not org_id:
        org_id = new_id()
        org_name = req.organization_name or f"{user.get('name', 'Site')}'s workspace"
        await db.organizations.insert_one(
            {
                "id": org_id,
                "name": org_name,
                "type": "site",
                "address": req.location_address,
                "admin_user_ids": [user["id"]],
                "location_ids": [],
                "created_at": now_iso(),
            }
        )
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"organization_id": org_id}, "$addToSet": {"roles": "firewatch"}},
        )

    if not team:
        location_id = new_id()
        location = {
            "id": location_id,
            "organization_id": org_id,
            "name": req.location_name.strip(),
            "address": req.location_address,
            "description": req.location_description,
            "created_at": now_iso(),
        }
        await db.locations.insert_one(location)
        await db.organizations.update_one(
            {"id": org_id},
            {"$addToSet": {"location_ids": location_id}},
        )

        saved_aps: List[dict] = []
        for ap_in in req.assembly_points:
            ap = {
                "id": new_id(),
                "organization_id": org_id,
                "location_id": location_id,
                "name": ap_in.name.strip(),
                "description": ap_in.description,
                "latitude": ap_in.latitude,
                "longitude": ap_in.longitude,
                "address": ap_in.address,
                "created_at": now_iso(),
            }
            await db.assembly_points.insert_one(ap)
            saved_aps.append(ap)

        default_ap_id = saved_aps[default_idx]["id"]
        team = {
            "id": new_id(),
            "organization_id": org_id,
            "name": req.team_name.strip(),
            "location_id": location_id,
            "firewatch_user_id": user["id"],
            "assembly_point_id": default_ap_id,
            "member_ids": [],
            "join_code": new_join_code(),
            "last_drill_at": None,
            "created_at": now_iso(),
        }
        await db.teams.insert_one(team)
        return {
            "ok": True,
            "team": strip_mongo_id(team),
            "location": strip_mongo_id(location),
            "assembly_points": strip_mongo_ids(saved_aps),
        }

    # Update existing workspace
    location_id = team.get("location_id") or new_id()
    if team.get("location_id"):
        await db.locations.update_one(
            {"id": location_id},
            {
                "$set": {
                    "name": req.location_name.strip(),
                    "address": req.location_address,
                    "description": req.location_description,
                }
            },
        )
        location = await db.locations.find_one({"id": location_id}, {"_id": 0})
    else:
        location = {
            "id": location_id,
            "organization_id": org_id,
            "name": req.location_name.strip(),
            "address": req.location_address,
            "description": req.location_description,
            "created_at": now_iso(),
        }
        await db.locations.insert_one(location)
        await db.organizations.update_one({"id": org_id}, {"$addToSet": {"location_ids": location_id}})

    if req.organization_name:
        await db.organizations.update_one({"id": org_id}, {"$set": {"name": req.organization_name.strip()}})

    existing_aps = await _assembly_points_for_workspace(
        org_id, location_id, team.get("assembly_point_id")
    )
    by_id = {a["id"]: a for a in existing_aps}
    kept_ids: List[str] = []
    saved_aps: List[dict] = []

    for ap_in in req.assembly_points:
        ap_id = ap_in.id
        if not ap_id or ap_id not in by_id:
            name_key = ap_in.name.strip().lower()
            match = next(
                (a for a in existing_aps if a.get("name", "").strip().lower() == name_key),
                None,
            )
            if match:
                ap_id = match["id"]

        if ap_id and ap_id in by_id:
            ap_updates = {
                "name": ap_in.name.strip(),
                "description": ap_in.description,
                **_assembly_point_pin_fields(ap_in),
            }
            await db.assembly_points.update_one(
                {"id": ap_id},
                {"$set": ap_updates},
            )
            ap_doc = await db.assembly_points.find_one({"id": ap_id}, {"_id": 0})
            kept_ids.append(ap_id)
            saved_aps.append(ap_doc)
        else:
            ap = {
                "id": new_id(),
                "organization_id": org_id,
                "location_id": location_id,
                "name": ap_in.name.strip(),
                "description": ap_in.description,
                "latitude": ap_in.latitude,
                "longitude": ap_in.longitude,
                "address": ap_in.address,
                "created_at": now_iso(),
            }
            await db.assembly_points.insert_one(ap)
            kept_ids.append(ap["id"])
            saved_aps.append(ap)

    for old in existing_aps:
        if old["id"] not in kept_ids:
            await db.assembly_points.delete_one({"id": old["id"]})

    default_ap_id = saved_aps[default_idx]["id"]
    await db.teams.update_one(
        {"id": team["id"]},
        {
            "$set": {
                "name": req.team_name.strip(),
                "location_id": location_id,
                "assembly_point_id": default_ap_id,
            }
        },
    )
    await db.users.update_one({"id": user["id"]}, {"$addToSet": {"roles": "firewatch"}})
    team = await db.teams.find_one({"id": team["id"]}, {"_id": 0})
    return {
        "ok": True,
        "team": strip_mongo_id(team),
        "location": strip_mongo_id(location),
        "assembly_points": strip_mongo_ids(saved_aps),
    }


@api.post("/teams/{team_id}/assembly-point/pin")
async def update_team_assembly_point_pin(
    team_id: str, req: AssemblyPointPinReq, user=Depends(get_current_user)
):
    """Save map coordinates on this team's primary meeting point (dashboard display)."""
    team = await _firewatch_team_for_user(user["id"], team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    ap_id = team.get("assembly_point_id")
    if not ap_id:
        raise HTTPException(status_code=400, detail="Team has no meeting point")
    ap = await db.assembly_points.find_one({"id": ap_id}, {"_id": 0})
    if not ap:
        org_id = team.get("organization_id")
        loc_id = team.get("location_id")
        ap = {
            "id": ap_id,
            "organization_id": org_id,
            "location_id": loc_id,
            "name": "Susitikimo taškas",
            "description": None,
            "created_at": now_iso(),
        }
        await db.assembly_points.insert_one(ap)
    lat = _coerce_coord(req.latitude)
    lng = _coerce_coord(req.longitude)
    if lat is None or lng is None:
        raise HTTPException(status_code=400, detail="Invalid coordinates")
    updates: dict = {"latitude": lat, "longitude": lng}
    if req.address is not None:
        updates["address"] = req.address
    loc_id = team.get("location_id")
    if loc_id and ap.get("location_id") != loc_id:
        updates["location_id"] = loc_id
    await db.assembly_points.update_one({"id": ap_id}, {"$set": updates})
    updated = await db.assembly_points.find_one({"id": ap_id}, {"_id": 0})
    return {"ok": True, "assembly_point": _assembly_point_payload(updated)}


@api.patch("/teams/{team_id}")
async def update_team(team_id: str, req: UpdateTeamReq, user=Depends(get_current_user)):
    team = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if team.get("firewatch_user_id") != user["id"] and "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="Only this team's Firewatch can edit it")
    updates = {k: v for k, v in req.model_dump(exclude_unset=True).items() if v is not None}
    if updates:
        await db.teams.update_one({"id": team_id}, {"$set": updates})
    return await db.teams.find_one({"id": team_id}, {"_id": 0})


@api.get("/teams/my")
async def teams_for_firewatch(user=Depends(get_current_user)):
    teams = await db.teams.find({"firewatch_user_id": user["id"]}, {"_id": 0}).to_list(100)
    for t in teams:
        ap = await db.assembly_points.find_one({"id": t.get("assembly_point_id")}, {"_id": 0})
        t["assembly_point_name"] = ap["name"] if ap else None
        t["assembly_point"] = _assembly_point_payload(ap)
        loc = await db.locations.find_one(
            {"id": t.get("location_id")},
            {"_id": 0, "name": 1, "address": 1, "description": 1},
        )
        t["location_name"] = loc["name"] if loc else None
        t["location_address"] = loc.get("address") if loc else None
        t["location_description"] = loc.get("description") if loc else None
        t["member_count"] = len(t.get("member_ids", []))
        # active alert?
        active = await db.alerts.find_one({"team_ids": t["id"], "status": "active"}, {"_id": 0})
        t["active_alert_id"] = active["id"] if active else None
        # ensure join_code present
        if not t.get("join_code"):
            new_code = new_join_code()
            await db.teams.update_one({"id": t["id"]}, {"$set": {"join_code": new_code}})
            t["join_code"] = new_code
    return teams


@api.get("/teams/mine-member")
async def my_team_as_member(user=Depends(get_current_user)):
    team = await _team_for_member_user(user)
    if not team:
        return None
    fw = await db.users.find_one({"id": team.get("firewatch_user_id")}, {"_id": 0, "password_hash": 0})
    ap = await db.assembly_points.find_one({"id": team.get("assembly_point_id")}, {"_id": 0})
    org = await db.organizations.find_one({"id": team.get("organization_id")}, {"_id": 0})
    loc = None
    if team.get("location_id"):
        loc = await db.locations.find_one(
            {"id": team["location_id"]},
            {"_id": 0, "name": 1, "address": 1},
        )
    member_ids = team.get("member_ids") or []
    members: List[dict] = []
    if member_ids:
        rows = await db.users.find(
            {"id": {"$in": member_ids}},
            {"_id": 0, "name": 1, "id": 1},
        ).to_list(500)
        rows.sort(key=lambda m: (m.get("name") or "").lower())
        members = [{"id": m["id"], "name": m.get("name")} for m in rows]
    firewatch = None
    if fw:
        firewatch = {
            "id": fw["id"],
            "name": fw.get("name"),
            "phone": fw.get("phone"),
            "email": fw.get("email"),
        }
    return {
        "team": team,
        "firewatch": firewatch,
        "firewatch_name": fw["name"] if fw else None,
        "assembly_point": _assembly_point_payload(ap),
        "organization": org,
        "location": loc,
        "members": members,
    }


# ---------- Members ----------
@api.get("/members")
async def list_members(user=Depends(get_current_user)):
    org_id = user.get("organization_id")
    members = await db.users.find(
        {"organization_id": org_id}, {"_id": 0, "password_hash": 0}
    ).to_list(1000)
    return members


@api.post("/members")
async def create_member(req: CreateMemberReq, user=Depends(get_current_user)):
    existing = await db.users.find_one({"email": req.email.lower()})
    if existing:
        member_id = existing["id"]
    else:
        new_user = {
            "id": new_id(),
            "email": req.email.lower(),
            "password_hash": hash_pw("Demo1234"),
            "name": req.name,
            "phone": req.phone,
            "roles": ["member"],
            "organization_id": user.get("organization_id"),
            "team_ids": [req.team_id],
            "role_title": req.role_title,
            "created_at": now_iso(),
        }
        await db.users.insert_one(new_user)
        member_id = new_user["id"]
    await db.teams.update_one({"id": req.team_id}, {"$addToSet": {"member_ids": member_id}})
    await db.users.update_one({"id": member_id}, {"$addToSet": {"team_ids": req.team_id}})
    return {"ok": True, "member_id": member_id}


# ---------- Assembly Points ----------
@api.get("/assembly-points")
async def list_aps(user=Depends(get_current_user)):
    rows = await db.assembly_points.find(
        {"organization_id": user.get("organization_id")}, {"_id": 0}
    ).to_list(100)
    return [_assembly_point_payload(ap) for ap in rows if ap]


@api.post("/assembly-points")
async def create_ap(req: CreateAssemblyPointReq, user=Depends(get_current_user)):
    ap = {
        "id": new_id(),
        "organization_id": user.get("organization_id"),
        "location_id": req.location_id,
        "name": req.name,
        "description": req.description,
        "created_at": now_iso(),
    }
    await db.assembly_points.insert_one(ap)
    ap.pop("_id", None)
    return ap


@api.patch("/assembly-points/{ap_id}/pin")
async def patch_assembly_point_pin(
    ap_id: str, req: AssemblyPointPinReq, user=Depends(get_current_user)
):
    """Update only map coordinates for a meeting point (coordinator quick-save)."""
    ap = await db.assembly_points.find_one({"id": ap_id}, {"_id": 0})
    if not ap:
        raise HTTPException(status_code=404, detail="Assembly point not found")
    org_id = ap.get("organization_id")
    team = await db.teams.find_one(
        {"organization_id": org_id, "firewatch_user_id": user["id"]},
        {"_id": 0},
    )
    if not team:
        raise HTTPException(status_code=403, detail="Not allowed")
    lat = _coerce_coord(req.latitude)
    lng = _coerce_coord(req.longitude)
    if lat is None or lng is None:
        raise HTTPException(status_code=400, detail="Invalid coordinates")
    await db.assembly_points.update_one(
        {"id": ap_id},
        {"$set": {"latitude": lat, "longitude": lng, "address": req.address}},
    )
    updated = await db.assembly_points.find_one({"id": ap_id}, {"_id": 0})
    return {"ok": True, "assembly_point": _assembly_point_payload(updated)}


# ---------- Alert chat ----------
async def _team_ids_for_user(user: dict) -> List[str]:
    team_ids = list(user.get("team_ids") or [])
    fw_teams = await db.teams.find({"firewatch_user_id": user["id"]}, {"_id": 0, "id": 1}).to_list(100)
    return list(set(team_ids + [t["id"] for t in fw_teams]))


async def _get_alert_or_404(alert_id: str) -> dict:
    alert = await db.alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


async def _require_alert_access(alert: dict, user: dict) -> None:
    user_teams = await _team_ids_for_user(user)
    if not set(user_teams) & set(alert.get("team_ids") or []):
        raise HTTPException(status_code=403, detail="Not allowed to access this alert")


def _user_chat_role(user: dict) -> str:
    if "firewatch" in (user.get("roles") or []):
        return "firewatch"
    return "member"


async def _insert_alert_message(
    alert_id: str,
    *,
    user_id: str,
    user_name: str,
    role: str,
    body: str,
    type: str = "text",
) -> dict:
    msg = {
        "id": new_id(),
        "alert_id": alert_id,
        "user_id": user_id,
        "user_name": user_name,
        "role": role,
        "body": body.strip(),
        "type": type,
        "created_at": now_iso(),
    }
    payload = dict(msg)
    await db.alert_messages.insert_one(msg)
    return payload


async def _insert_system_alert_message(alert_id: str, body: str) -> dict:
    return await _insert_alert_message(
        alert_id,
        user_id="system",
        user_name="RESQLIFE",
        role="system",
        body=body.strip(),
        type="system",
    )


async def _require_firewatch_for_alert(alert: dict, user: dict) -> None:
    """Only the team coordinator (or org admin) may view live member locations."""
    await _require_alert_access(alert, user)
    roles = user.get("roles") or []
    if "admin" in roles and user.get("organization_id") == alert.get("organization_id"):
        return
    fw = await db.teams.find_one(
        {
            "id": {"$in": alert.get("team_ids") or []},
            "firewatch_user_id": user["id"],
        },
        {"_id": 0, "id": 1},
    )
    if fw:
        return
    raise HTTPException(status_code=403, detail="Only the coordinator can view live locations")


async def _wipe_alert_live_locations(alert_id: str) -> None:
    await db.alert_live_locations.delete_many({"alert_id": alert_id})


def _parse_iso_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


# ---------- Alerts ----------
@api.post("/alerts")
async def start_alert(req: StartAlertReq, user=Depends(get_current_user)):
    # Demo-friendly: reuse an existing active alert for the same team(s) instead of stacking duplicates.
    existing = await db.alerts.find_one(
        {"team_ids": {"$in": req.team_ids}, "status": "active"},
        {"_id": 0},
    )
    if existing:
        logger.info("start_alert: reusing active alert %s", existing["id"])
        members = await db.users.find(
            {"team_ids": {"$in": existing["team_ids"]}}, {"_id": 0, "id": 1}
        ).to_list(2000)
        pending_ids = set()
        for m in members:
            st = await _my_alert_response_status(existing["id"], m["id"])
            if st == "not_responded":
                pending_ids.add(m["id"])
        if pending_ids:
            await send_alert_push_notifications(
                existing, only_user_ids=pending_ids
            )
        existing = dict(existing)
        existing.pop("_id", None)
        return existing

    alert = {
        "id": new_id(),
        "organization_id": user.get("organization_id"),
        "team_ids": req.team_ids,
        "type": req.type,
        "mode": req.mode,
        "status": "active",
        "started_by": user["id"],
        "started_by_name": user["name"],
        "started_at": now_iso(),
        "ended_at": None,
        "message": req.message,
        "notes": [],
    }
    await db.alerts.insert_one(alert)
    mode_label = "Pratybos pradėtos" if req.mode == "drill" else "Įspėjimas pradėtas"
    await _insert_system_alert_message(alert["id"], f"{mode_label}. {req.message}")
    # mark last_drill_at if drill
    if req.mode == "drill":
        await db.teams.update_many({"id": {"$in": req.team_ids}}, {"$set": {"last_drill_at": alert["started_at"]}})
    # Notify members (SMS stub + push)
    members = await db.users.find({"team_ids": {"$in": req.team_ids}}, {"_id": 0}).to_list(2000)
    for m in members:
        if m.get("phone"):
            send_sms_stub(m["phone"], req.message)
    await send_alert_push_notifications(alert)
    alert.pop("_id", None)
    return alert


async def _my_alert_response_status(alert_id: str, user_id: str) -> str:
    resp = await db.alert_responses.find_one(
        {"alert_id": alert_id, "user_id": user_id},
        {"_id": 0, "status": 1},
    )
    return resp["status"] if resp else "not_responded"


def _enrich_alert_for_user(alert: dict, user_id: str, my_status: str) -> dict:
    out = dict(alert)
    out["my_status"] = my_status
    return out


@api.get("/alerts/active")
async def my_active_alert(user=Depends(get_current_user)):
    """Returns the active alert affecting the current user (member or firewatch)."""
    team_ids = user.get("team_ids", [])
    # Also include teams where user is firewatch
    fw_teams = await db.teams.find({"firewatch_user_id": user["id"]}, {"_id": 0, "id": 1}).to_list(100)
    all_team_ids = list(set(team_ids + [t["id"] for t in fw_teams]))
    if not all_team_ids:
        return None
    alert = await db.alerts.find_one(
        {"team_ids": {"$in": all_team_ids}, "status": "active"}, {"_id": 0}
    )
    if not alert:
        return None
    my_status = await _my_alert_response_status(alert["id"], user["id"])
    return _enrich_alert_for_user(alert, user["id"], my_status)


@api.get("/alerts/{alert_id}")
async def get_alert(alert_id: str, user=Depends(get_current_user)):
    alert = await db.alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    my_status = await _my_alert_response_status(alert_id, user["id"])
    return _enrich_alert_for_user(alert, user["id"], my_status)


@api.get("/alerts/{alert_id}/responses")
async def get_responses(alert_id: str, user=Depends(get_current_user)):
    alert = await db.alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    # All team members for this alert
    members = await db.users.find(
        {"team_ids": {"$in": alert["team_ids"]}}, {"_id": 0, "password_hash": 0}
    ).to_list(2000)
    responses = await db.alert_responses.find({"alert_id": alert_id}, {"_id": 0}).to_list(2000)
    by_user = {r["user_id"]: r for r in responses}

    summary = {"safe": 0, "needs_help": 0, "not_responded": 0, "not_at_location": 0, "total": len(members)}
    enriched = []
    for m in members:
        r = by_user.get(m["id"])
        if r:
            st = r["status"]
        else:
            st = "not_responded"
        if st == "manually_marked_safe":
            summary["safe"] += 1
        elif st in summary:
            summary[st] += 1
        enriched.append({
            "user_id": m["id"],
            "name": m["name"],
            "phone": m.get("phone"),
            "email": m["email"],
            "status": st,
            "response": r,
            **user_avatar_fields(m),
        })
    return {"summary": summary, "members": enriched, "alert": alert}


@api.get("/alerts/{alert_id}/messages")
async def list_alert_messages(
    alert_id: str,
    since: Optional[str] = None,
    user=Depends(get_current_user),
):
    alert = await _get_alert_or_404(alert_id)
    await _require_alert_access(alert, user)
    query: dict = {"alert_id": alert_id}
    if since:
        query["created_at"] = {"$gt": since}
    messages = (
        await db.alert_messages.find(query, {"_id": 0})
        .sort("created_at", 1)
        .to_list(500)
    )
    return {"messages": messages, "alert_status": alert.get("status")}


@api.post("/alerts/{alert_id}/messages")
async def send_alert_message(
    alert_id: str,
    req: SendChatMessageReq,
    user=Depends(get_current_user),
):
    alert = await _get_alert_or_404(alert_id)
    await _require_alert_access(alert, user)
    if alert.get("status") != "active":
        raise HTTPException(status_code=400, detail="Chat is only available during active alerts")
    body = req.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    msg = await _insert_alert_message(
        alert_id,
        user_id=user["id"],
        user_name=user["name"],
        role=_user_chat_role(user),
        body=body,
    )
    return msg


@api.post("/alerts/{alert_id}/location")
async def upsert_alert_live_location(
    alert_id: str,
    req: UpsertLiveLocationReq,
    user=Depends(get_current_user),
):
    """Member foreground ping — upsert live coordinates for this alert."""
    alert = await _get_alert_or_404(alert_id)
    await _require_alert_access(alert, user)
    if alert.get("status") != "active":
        raise HTTPException(status_code=400, detail="Location sharing is only active during alerts")
    lat = _coerce_coord(req.latitude)
    lng = _coerce_coord(req.longitude)
    if lat is None or lng is None:
        raise HTTPException(status_code=400, detail="Invalid coordinates")
    if abs(lat) > 90 or abs(lng) > 180:
        raise HTTPException(status_code=400, detail="Coordinates out of range")
    acc = _coerce_coord(req.accuracy_m)
    if acc is not None and acc < 0:
        acc = None
    now = now_iso()
    doc = {
        "alert_id": alert_id,
        "user_id": user["id"],
        "name": user.get("name") or "Narys",
        "latitude": lat,
        "longitude": lng,
        "accuracy_m": acc,
        "updated_at": now,
        "sharing": True,
    }
    await db.alert_live_locations.update_one(
        {"alert_id": alert_id, "user_id": user["id"]},
        {"$set": doc},
        upsert=True,
    )
    # Snapshot flag on response (if they already responded)
    await db.alert_responses.update_one(
        {"alert_id": alert_id, "user_id": user["id"]},
        {"$set": {"location_shared": True}},
    )
    return {
        "ok": True,
        "user_id": user["id"],
        "latitude": lat,
        "longitude": lng,
        "accuracy_m": acc,
        "updated_at": now,
    }


@api.delete("/alerts/{alert_id}/location")
async def clear_alert_live_location(alert_id: str, user=Depends(get_current_user)):
    """Stop sharing / app backgrounded — remove this user's live pin."""
    alert = await _get_alert_or_404(alert_id)
    await _require_alert_access(alert, user)
    await db.alert_live_locations.delete_one({"alert_id": alert_id, "user_id": user["id"]})
    return {"ok": True}


@api.get("/alerts/{alert_id}/locations")
async def list_alert_live_locations(alert_id: str, user=Depends(get_current_user)):
    """Coordinator-only: live pins for members currently sharing (fresh updates only)."""
    alert = await _get_alert_or_404(alert_id)
    await _require_firewatch_for_alert(alert, user)
    rows = await db.alert_live_locations.find(
        {"alert_id": alert_id, "sharing": True},
        {"_id": 0},
    ).to_list(500)
    responses = await db.alert_responses.find(
        {"alert_id": alert_id},
        {"_id": 0, "user_id": 1, "status": 1},
    ).to_list(2000)
    status_by_user = {r["user_id"]: r.get("status") or "not_responded" for r in responses}
    now = datetime.now(timezone.utc)
    fresh = []
    for row in rows:
        updated = _parse_iso_dt(row.get("updated_at"))
        if not updated:
            continue
        uid = row["user_id"]
        age = (now - updated).total_seconds()
        member_status = status_by_user.get(uid, "not_responded")
        stale_limit = LIVE_LOCATION_STALE_SECONDS
        if member_status in ("needs_help", "not_at_location"):
            stale_limit = LIVE_LOCATION_STALE_SECONDS * 4
        if age > stale_limit:
            continue
        fresh.append(
            {
                "user_id": uid,
                "name": row.get("name") or "Narys",
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "accuracy_m": row.get("accuracy_m"),
                "updated_at": row["updated_at"],
                "age_seconds": int(max(0, age)),
                "status": status_by_user.get(uid, "not_responded"),
            }
        )
    fresh.sort(key=lambda x: x["name"].lower())
    return {
        "locations": fresh,
        "stale_after_seconds": LIVE_LOCATION_STALE_SECONDS,
        "alert_status": alert.get("status"),
        "sharing_count": len(fresh),
    }


@api.post("/alerts/{alert_id}/respond")
async def respond_alert(alert_id: str, req: RespondAlertReq, user=Depends(get_current_user)):
    alert = await db.alerts.find_one({"id": alert_id})
    if not alert or alert["status"] != "active":
        raise HTTPException(status_code=400, detail="Alert not active")
    # Forced share policy: location is shared while the member app is open during the alert.
    sharing = await db.alert_live_locations.find_one(
        {"alert_id": alert_id, "user_id": user["id"], "sharing": True},
        {"_id": 0, "user_id": 1},
    )
    resp = {
        "id": new_id(),
        "alert_id": alert_id,
        "user_id": user["id"],
        "user_name": user["name"],
        "status": req.status,
        "safe_location": req.safe_location,
        "note": req.note,
        "location_shared": bool(sharing) or bool(req.location_shared),
        "response_time": now_iso(),
        "manually_updated_by": None,
    }
    # upsert
    await db.alert_responses.update_one(
        {"alert_id": alert_id, "user_id": user["id"]},
        {"$set": resp},
        upsert=True,
    )
    resp.pop("_id", None)
    resp["my_status"] = req.status
    return resp


@api.post("/alerts/{alert_id}/mark-safe")
async def manual_mark_safe(alert_id: str, req: ManualMarkSafeReq, user=Depends(get_current_user)):
    target = await db.users.find_one({"id": req.user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    resp = {
        "id": new_id(),
        "alert_id": alert_id,
        "user_id": req.user_id,
        "user_name": target["name"],
        "status": "manually_marked_safe",
        "safe_location": "Manually marked",
        "note": f"Manually marked safe by {user['name']}",
        "location_shared": False,
        "response_time": now_iso(),
        "manually_updated_by": user["id"],
    }
    await db.alert_responses.update_one(
        {"alert_id": alert_id, "user_id": req.user_id},
        {"$set": resp},
        upsert=True,
    )
    resp.pop("_id", None)
    return resp


@api.post("/alerts/{alert_id}/remind")
async def remind(alert_id: str, user=Depends(get_current_user)):
    alert = await db.alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    members = await db.users.find({"team_ids": {"$in": alert["team_ids"]}}, {"_id": 0}).to_list(2000)
    responded = await db.alert_responses.find({"alert_id": alert_id}, {"_id": 0, "user_id": 1}).to_list(2000)
    responded_ids = {r["user_id"] for r in responded}
    pending_ids = {m["id"] for m in members if m["id"] not in responded_ids}
    reminded_at = now_iso()
    await db.alerts.update_one(
        {"id": alert_id},
        {"$set": {"last_reminded_at": reminded_at}, "$inc": {"reminder_count": 1}},
    )
    alert = {**alert, "last_reminded_at": reminded_at}
    sms_sent = 0
    for m in members:
        if m["id"] in pending_ids and m.get("phone"):
            send_sms_stub(m["phone"], "Priminimas: patvirtinkite savo saugumą RESQLIFE programėlėje.")
            sms_sent += 1
    push_sent = await send_alert_push_notifications(
        alert, only_user_ids=pending_ids, reminder=True
    )
    return {
        "reminded": len(pending_ids),
        "push_sent": push_sent,
        "sms_sent": sms_sent,
        "last_reminded_at": reminded_at,
    }


@api.post("/alerts/demo/reset-actives")
async def reset_active_alerts(user=Depends(get_current_user)):
    """Demo helper: end all active alerts on teams this Firewatch (or org admin) oversees."""
    ended_at = now_iso()
    fw_teams = await db.teams.find({"firewatch_user_id": user["id"]}, {"_id": 0, "id": 1}).to_list(100)
    team_ids = [t["id"] for t in fw_teams]
    query: dict = {"status": "active"}
    if team_ids:
        query["team_ids"] = {"$in": team_ids}
    elif user.get("organization_id") and "admin" in user.get("roles", []):
        query["organization_id"] = user["organization_id"]
    else:
        return {"ended": 0, "message": "No teams to reset"}
    active_ids = [
        a["id"]
        async for a in db.alerts.find(query, {"_id": 0, "id": 1})
    ]
    result = await db.alerts.update_many(query, {"$set": {"status": "ended", "ended_at": ended_at}})
    if active_ids:
        await db.alert_live_locations.delete_many({"alert_id": {"$in": active_ids}})
    return {"ended": result.modified_count}


@api.post("/alerts/{alert_id}/end")
async def end_alert(alert_id: str, user=Depends(get_current_user)):
    alert = await db.alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    await db.alerts.update_one(
        {"id": alert_id},
        {"$set": {"status": "ended", "ended_at": now_iso()}},
    )
    await _wipe_alert_live_locations(alert_id)
    await _insert_system_alert_message(alert_id, "Įspėjimas baigtas. Pokalbis uždarytas.")
    return {"ok": True}


@api.get("/alerts/history/list")
async def alerts_history(user=Depends(get_current_user)):
    org_id = user.get("organization_id")
    alerts = await db.alerts.find({"organization_id": org_id}, {"_id": 0}).sort("started_at", -1).to_list(100)
    return alerts


@api.get("/alerts/{alert_id}/report")
async def alert_report(alert_id: str, user=Depends(get_current_user)):
    alert = await db.alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    members = await db.users.find(
        {"team_ids": {"$in": alert["team_ids"]}}, {"_id": 0, "password_hash": 0}
    ).to_list(2000)
    responses = await db.alert_responses.find({"alert_id": alert_id}, {"_id": 0}).to_list(2000)
    by_user = {r["user_id"]: r for r in responses}

    counts = {"safe": 0, "needs_help": 0, "not_responded": 0, "not_at_location": 0}
    response_times = []
    response_list = []
    start_dt = datetime.fromisoformat(alert["started_at"])
    for m in members:
        r = by_user.get(m["id"])
        st = r["status"] if r else "not_responded"
        if st == "manually_marked_safe":
            counts["safe"] += 1
        elif st in counts:
            counts[st] += 1
        if r and st != "not_responded":
            try:
                rt = (datetime.fromisoformat(r["response_time"]) - start_dt).total_seconds()
                response_times.append(rt)
            except Exception:
                pass
        response_list.append({
            "user_id": m["id"],
            "name": m["name"],
            "email": m["email"],
            "status": st,
            "response_time": r["response_time"] if r else None,
            "safe_location": r.get("safe_location") if r else None,
            "note": r.get("note") if r else None,
            **user_avatar_fields(m),
        })

    org = await db.organizations.find_one({"id": alert["organization_id"]}, {"_id": 0})
    teams = await db.teams.find({"id": {"$in": alert["team_ids"]}}, {"_id": 0}).to_list(50)

    avg_response = round(sum(response_times) / len(response_times), 1) if response_times else None

    return {
        "alert": alert,
        "organization": org,
        "teams": teams,
        "summary": {
            "total": len(members),
            **counts,
            "avg_response_seconds": avg_response,
        },
        "response_list": response_list,
    }


# ---------- Seed ----------
LITHUANIAN_NAMES = [
    ("Ruta Petraitiene", "ruta@safecount.demo", "+37060000001"),
    ("Mantas Jankauskas", "mantas@safecount.demo", "+37060000002"),
    ("Egle Vasiliauskaite", "egle@safecount.demo", "+37060000003"),
    ("Tomas Stankevicius", "tomas@safecount.demo", "+37060000004"),
    ("Laura Butkute", "laura@safecount.demo", "+37060000005"),
    ("Andrius Pauliukas", "andrius@safecount.demo", "+37060000006"),
    ("Inga Sirvydaite", "inga@safecount.demo", "+37060000007"),
    ("Karolis Daukantas", "karolis@safecount.demo", "+37060000008"),
    ("Vaida Liutkute", "vaida@safecount.demo", "+37060000009"),
    ("Paulius Norkus", "paulius@safecount.demo", "+37060000010"),
    ("Gabriele Adomaityte", "gabriele@safecount.demo", "+37060000011"),
    ("Marius Kavaliauskas", "marius@safecount.demo", "+37060000012"),
    ("Justina Urbonaite", "justina@safecount.demo", "+37060000013"),
    ("Donatas Sabaliauskas", "donatas@safecount.demo", "+37060000014"),
    ("Aiste Gricius", "aiste@safecount.demo", "+37060000015"),
    ("Rokas Mockus", "rokas@safecount.demo", "+37060000016"),
    ("Monika Balciunaite", "monika@safecount.demo", "+37060000017"),
    ("Lukas Vaitkus", "lukas@safecount.demo", "+37060000018"),
    ("Ieva Simkute", "ieva@safecount.demo", "+37060000019"),
    ("Saulius Kaminskas", "saulius@safecount.demo", "+37060000020"),
]


async def seed():
    """Idempotent seed of demo organization and users."""
    DEMO_ORG = "Demonstracinė mokykla"
    TEAM = "Evakuacijos komanda"
    org = await db.organizations.find_one({"name": DEMO_ORG})
    if org:
        logger.info("Seed: already present, skipping.")
        return
    org_id = new_id()
    location_id = new_id()
    ap_gate = {
        "id": new_id(),
        "organization_id": org_id,
        "location_id": location_id,
        "name": "Pagrindinė aikštė",
        "description": "Prie pagrindinio įėjimo",
        "latitude": 54.6872,
        "longitude": 25.2797,
        "address": "Vilnius, Lietuva",
        "created_at": now_iso(),
    }
    ap_park = {"id": new_id(), "organization_id": org_id, "location_id": location_id,
               "name": "Sporto salės kiemas", "description": "Šoninis kiemas prie sporto salės", "created_at": now_iso()}
    ap_load = {"id": new_id(), "organization_id": org_id, "location_id": location_id,
               "name": "Stadionas", "description": "Mokyklos stadionas / lauko aikštelė", "created_at": now_iso()}

    # Demo users
    admin = {
        "id": new_id(), "email": "admin@safecount.demo", "password_hash": hash_pw("Demo1234"),
        "name": "Admin User", "phone": "+37060000000",
        "roles": ["admin"], "organization_id": org_id, "team_ids": [], "created_at": now_iso(),
    }
    firewatch = {
        "id": new_id(), "email": "jonas@safecount.demo", "password_hash": hash_pw("Demo1234"),
        "name": "Jonas Kazlauskas", "phone": "+37060000099",
        "roles": ["firewatch"], "organization_id": org_id, "team_ids": [], "created_at": now_iso(),
    }
    members = []
    for n, e, p in LITHUANIAN_NAMES:
        members.append({
            "id": new_id(), "email": e, "password_hash": hash_pw("Demo1234"),
            "name": n, "phone": p, "roles": ["member"],
            "organization_id": org_id, "team_ids": [], "role_title": "Mokinys / darbuotojas",
            "created_at": now_iso(),
        })

    team_id = new_id()
    team = {
        "id": team_id, "organization_id": org_id, "location_id": location_id,
        "name": TEAM, "firewatch_user_id": firewatch["id"],
        "assembly_point_id": ap_gate["id"],
        "member_ids": [m["id"] for m in members],
        "join_code": "482913",
        "last_drill_at": None,
        "created_at": now_iso(),
    }
    for m in members:
        m["team_ids"] = [team_id]

    org_doc = {
        "id": org_id, "name": DEMO_ORG, "type": "school",
        "address": "",
        "admin_user_ids": [admin["id"]], "location_ids": [location_id],
        "created_at": now_iso(),
    }
    location = {
        "id": location_id, "organization_id": org_id,
        "name": "Pagrindinis pastatas", "address": "",
        "description": "Pagrindinis mokyklos pastatas ir kiemas",
        "created_at": now_iso(),
    }

    await db.organizations.insert_one(org_doc)
    await db.locations.insert_one(location)
    await db.assembly_points.insert_many([ap_gate, ap_park, ap_load])
    await db.users.insert_many([admin, firewatch] + members)
    await db.teams.insert_one(team)

    logger.info("Seed: created demo school with 20 members.")


async def _background_startup() -> None:
    """Seed/demo setup runs after the server is already accepting /api/health."""
    ok, err = await _mongo_ping()
    if not ok:
        logger.error("MongoDB not reachable at startup: %s", err)
        return
    try:
        await db.users.create_index("email", unique=True)
    except Exception:
        pass
    try:
        async for t in db.teams.find({}, {"id": 1, "join_code": 1, "name": 1}):
            code = t.get("join_code")
            if not code or not (isinstance(code, str) and code.isdigit() and len(code) == 6):
                new_code = "482913" if t.get("name") == "Evakuacijos komanda" else new_join_code()
                await db.teams.update_one({"id": t["id"]}, {"$set": {"join_code": new_code}})
        await seed()
        await ensure_supabase_demo_users()
    except Exception as e:
        logger.error("Startup seed skipped: %s", e)


@app.on_event("startup")
async def on_startup():
    logger.info("RESQLIFE API starting (health available immediately)")
    asyncio.create_task(_background_startup())


@app.on_event("shutdown")
async def shutdown():
    client.close()


# Mount router, static avatars, and CORS
app.include_router(api)
app.mount("/api/static/avatars", StaticFiles(directory=str(AVATAR_DIR)), name="avatar-files")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@api.get("/")
async def root():
    return {"app": "RESQLIFE", "status": "ok"}
