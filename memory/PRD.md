# SafeCount – Product Requirements (MVP)

## Summary
SafeCount is a mobile-first emergency accountability app for organizations (warehouses, factories, schools, offices, public institutions). It answers one question fast: **"Who is safe, and who has not been confirmed safe?"**

## Roles
- **Admin** — manages org, teams, members, assembly points; views history.
- **Firewatch** — starts drills/emergencies, monitors live response, marks people safe, sends reminders, ends alerts, gets reports.
- **Team Member** — receives an alert and taps **I am safe / I need help / I am not at this location today**.

## Status colors (user spec)
- 🟢 Green `#16A34A` — Safe
- 🔴 Red `#DC2626` — Needs help / emergency
- 🟠 Orange `#EA580C` — Not confirmed safe (not responded)
- 🔵 Blue `#2563EB` — Not at location
- ⚪ Grey `#9CA3AF` — Manually marked / inactive

## Implemented (MVP)
1. JWT email/password auth (bcrypt + pyjwt) with idempotent seed
2. Role-based home screens (Admin / Firewatch / Team Member)
3. Firewatch Dashboard with prominent **Start Emergency** / **Start Drill**
4. Start Alert flow — type, message, confirmation modal
5. Live Emergency Dashboard — elapsed timer, summary cards, progress bar, member list grouped by status, polling every 3s
6. Manual mark safe + send reminder + end alert (with "still unsafe" warning)
7. Report screen — summary, avg response time, response list
8. Team Member calm Home Screen with privacy notice
9. Emergency mode auto-switch (member polls every 5s, routes into urgent red screen)
10. Three big response buttons + safe-location chooser + help reasons
11. Seed data: Vilnius Logistics Center, Warehouse Shift A, Jonas Kazlauskas + 20 Lithuanian members, 3 assembly points
12. Twilio SMS sender (graceful no-op stub when keys not configured)

## Smart business enhancement
Built-in **drill metrics** — every drill auto-stores `started_at`, `ended_at`, per-member `response_time`, and average response time on the report. Organizations can use these compliance-ready metrics for **insurance discounts, ISO 45001 evidence, and quarterly safety audits** — turning a free safety tool into a quantifiable operational KPI dashboard.

## Privacy-first
- No background tracking
- `location_shared` is opt-in, only during an active emergency
- Stops automatically when alert ends

## Tech stack
- **Backend** FastAPI + Motor (MongoDB) + bcrypt + pyjwt
- **Frontend** Expo SDK 54 + expo-router + AsyncStorage + @expo/vector-icons
- **Design** Swiss / high-contrast: Work Sans + IBM Plex Sans, large rounded cards, calm-to-urgent visual contrast

## Demo accounts (`/app/memory/test_credentials.md`)
| Role | Email | Password |
|---|---|---|
| Admin | admin@safecount.demo | Demo1234 |
| Firewatch | jonas@safecount.demo | Demo1234 |
| Member | ruta@safecount.demo | Demo1234 |

The login screen has a one-tap **demo chip shortcut** for each role.
