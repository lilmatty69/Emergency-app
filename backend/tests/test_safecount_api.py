"""SafeCount backend API tests covering auth, teams, members, assembly points, and full alert flow."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://safecount-demo.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password="Demo1234"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    return data["token"], data["user"]


@pytest.fixture(scope="module")
def admin_ctx():
    t, u = _login("admin@safecount.demo")
    return {"token": t, "user": u, "headers": {"Authorization": f"Bearer {t}"}}


@pytest.fixture(scope="module")
def jonas_ctx():
    t, u = _login("jonas@safecount.demo")
    return {"token": t, "user": u, "headers": {"Authorization": f"Bearer {t}"}}


@pytest.fixture(scope="module")
def ruta_ctx():
    t, u = _login("ruta@safecount.demo")
    return {"token": t, "user": u, "headers": {"Authorization": f"Bearer {t}"}}


# Auth
def test_login_admin(admin_ctx):
    assert admin_ctx["user"]["email"] == "admin@safecount.demo"
    assert "admin" in admin_ctx["user"]["roles"]
    assert "_id" not in admin_ctx["user"]
    assert "password_hash" not in admin_ctx["user"]


def test_login_invalid():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@safecount.demo", "password": "wrong"})
    assert r.status_code == 401


def test_auth_me(jonas_ctx):
    r = requests.get(f"{API}/auth/me", headers=jonas_ctx["headers"])
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "jonas@safecount.demo"
    assert "password_hash" not in body and "_id" not in body


# Teams
def test_teams_my_jonas(jonas_ctx):
    r = requests.get(f"{API}/teams/my", headers=jonas_ctx["headers"])
    assert r.status_code == 200
    teams = r.json()
    assert len(teams) >= 1
    t = teams[0]
    assert t["name"] == "Warehouse Shift A"
    assert t["member_count"] == 20
    assert t["assembly_point_name"] == "Main Gate"
    pytest.warehouse_team_id = t["id"]


def test_teams_admin_enriched(admin_ctx):
    r = requests.get(f"{API}/teams", headers=admin_ctx["headers"])
    assert r.status_code == 200
    teams = r.json()
    assert len(teams) >= 1
    t = next(x for x in teams if x["name"] == "Warehouse Shift A")
    assert t["firewatch_name"] == "Jonas Kazlauskas"
    assert t["assembly_point_name"] == "Main Gate"
    assert t["member_count"] == 20


def test_members_admin(admin_ctx):
    r = requests.get(f"{API}/members", headers=admin_ctx["headers"])
    assert r.status_code == 200
    members = r.json()
    assert len(members) >= 22
    for m in members:
        assert "_id" not in m
        assert "password_hash" not in m


def test_assembly_points(admin_ctx):
    r = requests.get(f"{API}/assembly-points", headers=admin_ctx["headers"])
    assert r.status_code == 200
    aps = r.json()
    names = sorted([a["name"] for a in aps])
    assert names == ["Loading Zone Exit", "Main Gate", "Parking Lot A"]


# Full alert flow
def test_full_alert_flow(jonas_ctx, ruta_ctx, admin_ctx):
    team_id = getattr(pytest, "warehouse_team_id", None)
    assert team_id, "Warehouse team id not set"

    # Start alert
    r = requests.post(f"{API}/alerts", headers=jonas_ctx["headers"],
                      json={"type": "fire", "mode": "drill", "team_ids": [team_id], "message": "Drill test"})
    assert r.status_code == 200, r.text
    alert = r.json()
    assert alert["status"] == "active"
    assert "_id" not in alert
    alert_id = alert["id"]

    # Ruta sees active
    r = requests.get(f"{API}/alerts/active", headers=ruta_ctx["headers"])
    assert r.status_code == 200
    active = r.json()
    assert active and active["id"] == alert_id

    # Ruta responds safe
    r = requests.post(f"{API}/alerts/{alert_id}/respond", headers=ruta_ctx["headers"],
                      json={"status": "safe", "safe_location": "Main Gate"})
    assert r.status_code == 200
    assert "_id" not in r.json()

    # Jonas: responses
    r = requests.get(f"{API}/alerts/{alert_id}/responses", headers=jonas_ctx["headers"])
    assert r.status_code == 200
    data = r.json()
    assert data["summary"]["safe"] == 1
    assert data["summary"]["not_responded"] == 19
    assert data["summary"]["total"] == 20
    # find another member id who hasn't responded
    other_id = next(m["user_id"] for m in data["members"] if m["status"] == "not_responded")

    # Manual mark-safe
    r = requests.post(f"{API}/alerts/{alert_id}/mark-safe", headers=jonas_ctx["headers"],
                      json={"user_id": other_id})
    assert r.status_code == 200

    r = requests.get(f"{API}/alerts/{alert_id}/responses", headers=jonas_ctx["headers"])
    assert r.json()["summary"]["safe"] == 2

    # Remind
    r = requests.post(f"{API}/alerts/{alert_id}/remind", headers=jonas_ctx["headers"])
    assert r.status_code == 200
    assert "reminded" in r.json()

    # End
    r = requests.post(f"{API}/alerts/{alert_id}/end", headers=jonas_ctx["headers"])
    assert r.status_code == 200

    r = requests.get(f"{API}/alerts/{alert_id}", headers=jonas_ctx["headers"])
    assert r.json()["status"] == "ended"

    # Report
    r = requests.get(f"{API}/alerts/{alert_id}/report", headers=jonas_ctx["headers"])
    assert r.status_code == 200
    rep = r.json()
    assert rep["summary"]["total"] == 20
    assert rep["summary"]["safe"] == 2
    assert isinstance(rep["response_list"], list)
    assert "_id" not in rep["alert"]

    # History
    r = requests.get(f"{API}/alerts/history/list", headers=admin_ctx["headers"])
    assert r.status_code == 200
    hist = r.json()
    assert any(a["id"] == alert_id for a in hist)
