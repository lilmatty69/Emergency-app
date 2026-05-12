"""SafeCount backend - FastAPI + Motor (MongoDB) + JWT auth."""
import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional, Literal

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("safecount")

# ---------- Config ----------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "safecount-dev-secret-change-in-production-please")
JWT_ALG = "HS256"
JWT_TTL_MIN = 60 * 24 * 7  # 7 days

# Twilio (graceful no-op if not configured)
TWILIO_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM = os.environ.get("TWILIO_PHONE_NUMBER", "")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="SafeCount API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)


# ---------- Helpers ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


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


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
    if not creds:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
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


class CreateAssemblyPointReq(BaseModel):
    name: str
    description: Optional[str] = None
    location_id: Optional[str] = None


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


# ---------- Auth routes ----------
@api.post("/auth/register")
async def register(req: RegisterReq):
    if await db.users.find_one({"email": req.email.lower()}):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = {
        "id": new_id(),
        "email": req.email.lower(),
        "password_hash": hash_pw(req.password),
        "name": req.name,
        "phone": req.phone,
        "roles": ["admin", "firewatch", "member"],  # MVP: open all roles per registered user
        "organization_id": None,
        "team_ids": [],
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    token = make_token(user["id"])
    user.pop("_id", None)
    user.pop("password_hash", None)
    return {"token": token, "user": user}


@api.post("/auth/login")
async def login(req: LoginReq):
    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not verify_pw(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = make_token(user["id"])
    user.pop("_id", None)
    user.pop("password_hash", None)
    return {"token": token, "user": user}


@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


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
        "last_drill_at": None,
        "created_at": now_iso(),
    }
    await db.teams.insert_one(team)
    team.pop("_id", None)
    return team


@api.get("/teams/my")
async def teams_for_firewatch(user=Depends(get_current_user)):
    teams = await db.teams.find({"firewatch_user_id": user["id"]}, {"_id": 0}).to_list(100)
    for t in teams:
        ap = await db.assembly_points.find_one({"id": t.get("assembly_point_id")}, {"_id": 0})
        t["assembly_point_name"] = ap["name"] if ap else None
        t["member_count"] = len(t.get("member_ids", []))
        # active alert?
        active = await db.alerts.find_one({"team_ids": t["id"], "status": "active"}, {"_id": 0})
        t["active_alert_id"] = active["id"] if active else None
    return teams


@api.get("/teams/mine-member")
async def my_team_as_member(user=Depends(get_current_user)):
    team = await db.teams.find_one({"member_ids": user["id"]}, {"_id": 0})
    if not team:
        return None
    fw = await db.users.find_one({"id": team.get("firewatch_user_id")}, {"_id": 0, "password_hash": 0})
    ap = await db.assembly_points.find_one({"id": team.get("assembly_point_id")}, {"_id": 0})
    org = await db.organizations.find_one({"id": team.get("organization_id")}, {"_id": 0})
    return {
        "team": team,
        "firewatch_name": fw["name"] if fw else None,
        "assembly_point": ap,
        "organization": org,
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
    return await db.assembly_points.find(
        {"organization_id": user.get("organization_id")}, {"_id": 0}
    ).to_list(100)


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


# ---------- Alerts ----------
@api.post("/alerts")
async def start_alert(req: StartAlertReq, user=Depends(get_current_user)):
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
    # mark last_drill_at if drill
    if req.mode == "drill":
        await db.teams.update_many({"id": {"$in": req.team_ids}}, {"$set": {"last_drill_at": alert["started_at"]}})
    # Send SMS (stub) to all members
    members = await db.users.find({"team_ids": {"$in": req.team_ids}}, {"_id": 0}).to_list(2000)
    for m in members:
        if m.get("phone"):
            send_sms_stub(m["phone"], req.message)
    alert.pop("_id", None)
    return alert


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
    return alert


@api.get("/alerts/{alert_id}")
async def get_alert(alert_id: str, user=Depends(get_current_user)):
    alert = await db.alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


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
        })
    return {"summary": summary, "members": enriched, "alert": alert}


@api.post("/alerts/{alert_id}/respond")
async def respond_alert(alert_id: str, req: RespondAlertReq, user=Depends(get_current_user)):
    alert = await db.alerts.find_one({"id": alert_id})
    if not alert or alert["status"] != "active":
        raise HTTPException(status_code=400, detail="Alert not active")
    resp = {
        "id": new_id(),
        "alert_id": alert_id,
        "user_id": user["id"],
        "user_name": user["name"],
        "status": req.status,
        "safe_location": req.safe_location,
        "note": req.note,
        "location_shared": req.location_shared,
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
    count = 0
    for m in members:
        if m["id"] not in responded_ids and m.get("phone"):
            send_sms_stub(m["phone"], "Reminder: please confirm your safety in SafeCount now.")
            count += 1
    return {"reminded": count}


@api.post("/alerts/{alert_id}/end")
async def end_alert(alert_id: str, user=Depends(get_current_user)):
    alert = await db.alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    await db.alerts.update_one(
        {"id": alert_id},
        {"$set": {"status": "ended", "ended_at": now_iso()}},
    )
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
            "name": m["name"],
            "email": m["email"],
            "status": st,
            "response_time": r["response_time"] if r else None,
            "safe_location": r.get("safe_location") if r else None,
            "note": r.get("note") if r else None,
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
    org = await db.organizations.find_one({"name": "Vilnius Logistics Center"})
    if org:
        logger.info("Seed: already present, skipping.")
        return
    org_id = new_id()
    location_id = new_id()
    ap_gate = {"id": new_id(), "organization_id": org_id, "location_id": location_id,
               "name": "Main Gate", "description": "Primary entrance assembly area", "created_at": now_iso()}
    ap_park = {"id": new_id(), "organization_id": org_id, "location_id": location_id,
               "name": "Parking Lot A", "description": "Western parking lot near visitor entrance", "created_at": now_iso()}
    ap_load = {"id": new_id(), "organization_id": org_id, "location_id": location_id,
               "name": "Loading Zone Exit", "description": "Rear loading dock open area", "created_at": now_iso()}

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
            "organization_id": org_id, "team_ids": [], "role_title": "Warehouse Operator",
            "created_at": now_iso(),
        })

    team_id = new_id()
    team = {
        "id": team_id, "organization_id": org_id, "location_id": location_id,
        "name": "Warehouse Shift A", "firewatch_user_id": firewatch["id"],
        "assembly_point_id": ap_gate["id"],
        "member_ids": [m["id"] for m in members],
        "last_drill_at": None,
        "created_at": now_iso(),
    }
    for m in members:
        m["team_ids"] = [team_id]

    org_doc = {
        "id": org_id, "name": "Vilnius Logistics Center", "type": "warehouse",
        "address": "Savanoriu pr. 178, Vilnius, Lithuania",
        "admin_user_ids": [admin["id"]], "location_ids": [location_id],
        "created_at": now_iso(),
    }
    location = {
        "id": location_id, "organization_id": org_id,
        "name": "Main Warehouse", "address": "Savanoriu pr. 178, Vilnius",
        "description": "Primary 24,000 sqm logistics warehouse",
        "created_at": now_iso(),
    }

    await db.organizations.insert_one(org_doc)
    await db.locations.insert_one(location)
    await db.assembly_points.insert_many([ap_gate, ap_park, ap_load])
    await db.users.insert_many([admin, firewatch] + members)
    await db.teams.insert_one(team)

    logger.info("Seed: created Vilnius Logistics Center with 20 members.")


@app.on_event("startup")
async def on_startup():
    try:
        await db.users.create_index("email", unique=True)
    except Exception:
        pass
    await seed()


@app.on_event("shutdown")
async def shutdown():
    client.close()


# Mount router and CORS
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@api.get("/")
async def root():
    return {"app": "SafeCount", "status": "ok"}
