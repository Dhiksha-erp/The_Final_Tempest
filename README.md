# The Final Tempest — VoC Risk Engine + Quick-Commerce Storefront

An AI-powered Voice of Customer (VoC) pipeline bolted onto a small quick-commerce grocery storefront. Customers log into a **User Portal** to browse a grocery catalog, apply coupons, place orders, manage addresses/profile, and submit support feedback (with optional photo attachments) — every ticket is analyzed by an LLM **the instant it's submitted**. An **Admin Dashboard** visualizes the results in real time: risk/category/sentiment charts, a searchable feedback registry with manual risk override, order history, CSV/Excel bulk ticket import, and an AI-generated executive summary over any date range.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.9+), SQLAlchemy, SQLite, pandas/openpyxl (bulk import) |
| AI | `openai` SDK against the OpenAI API (`gpt-4o` by default) |
| Frontend | React 19 (Vite), React Router, Recharts, Axios, Lucide icons |

## Architecture

```
┌────────────────────────────┐        REST/JSON        ┌────────────────────────────┐
│  React Frontend            │ ───────────────────────► │      FastAPI Backend       │
│  (Vite, :5173)             │ ◄─────────────────────── │          (:8000)           │
│                            │                           │                            │
│  /       Landing           │                           │                            │
│  /user   User Portal       │                           │                            │
│  /admin  Admin Dashboard   │                           │                            │
└────────────────────────────┘                           └──────────────┬─────────────┘
                                                                        │
                                           ┌────────────────────────────┼────────────────────────────┐
                                           ▼                            ▼                            ▼
                               ┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
                               │  Analysis Pipeline   │     │  Confidence / Risk / │     │  SQLite DB           │
                               │  (services/          │     │   Recomm. / Coupon   │     │  (tempest.db)        │
                               │   analysis_          │     │   Engines            │     │                      │
                               │   pipeline.py)       │     │  (engines/*.py)      │     │                      │
                               └──────────────────────┘     └──────────────────────┘     └──────────────────────┘
                                           │
                                           ▼
                                      OpenAI API
                                       (gpt-4o)
```

### Backend — `backend/`

- **`main.py`** — FastAPI app and all routing. No business logic lives here; it wires requests to the pipeline/engines below and persists results.
- **`config.py`** — loads AI provider settings from `.env`, and holds the hardcoded admin + user credentials (see [Login Credentials](#login-credentials)).
- **`database.py`** — SQLAlchemy models over a local SQLite file (`tempest.db`), auto-created on first run:
  - `UploadBatch` — one row per calendar day of feedback.
  - `FeedbackRecord` — one row per ticket, including the LLM's classification, the risk engine's output, an optional attached photo (`image_data`, base64), a `created_at` timestamp, and `risk_override` (true once an admin manually overrides the AI's risk level).
  - `Address`, `Order`, `Profile` — the storefront's e-commerce layer (single-tenant: there's one user account, so these tables aren't scoped by user ID).
  - `_migrate()` runs on every startup and backfills new columns onto a pre-existing `tempest.db` without losing data — this is how the schema has grown across every feature added without ever needing a manual migration step.
- **`services/analysis_pipeline.py`** — `run_pipeline()`, the shared entry point that runs a list of `FeedbackRecord` rows through all four analysis engines in sequence and updates each row in place. Called synchronously by every path that creates feedback (user submission, post-order feedback prompt, bulk upload) — there is no separate "analyze later" step anywhere in the app.
- **`engines/`** — the actual business logic, one concern per file:
  - `llm_service.py` — sends feedback text to OpenAI with a few-shot prompt, parses the strict-JSON response (category, sentiment, themes, urgency, churn intent, customer priority). Falls back to randomized mock data if the API call fails, instead of crashing. Also generates the executive summary, given a list of themes and a human-readable period label (e.g. `"the past 30 days"`).
  - `confidence_engine.py` — scores how trustworthy the LLM's own output looks (penalizes missing/generic fields).
  - `risk_engine.py` — deterministic weighted formula (sentiment + urgency + churn intent + customer priority) → a 0–100 risk score → `Critical` / `High` / `Medium` / `Low`. Includes a **food-safety floor**: a negative-sentiment "Spoiled/Damaged Goods" report can never score below `High`, regardless of how mildly it's worded.
  - `recommendation_engine.py` — rule-based next-action recommendation keyed off risk level + category. Re-run automatically whenever an admin manually overrides a ticket's risk level, so the recommendation text never goes stale.
  - `coupon_engine.py` — the three available coupon codes (`WELCOME50`, `SAVE10`, `FREESHIP`) and the order-total math: discount → delivery fee (flat ₹40, waived above ₹199 or with free-shipping coupons) → 5% tax → grand total. This is the single source of truth used both for the live cart preview and the final order.
- **`test_ai_connection.py`** — standalone interactive script to sanity-check the OpenAI connection outside of the FastAPI app.

### Frontend — `frontend/src/`

A multi-route app (React Router) split into three pages:

- **`pages/Landing.jsx`** (`/`) — entry screen with two cards: **My Account** → User Portal, **Admin Portal** → Admin Dashboard.
- **`pages/UserPortal.jsx`** (`/user`) — the customer-facing app, behind a lightweight login. Sidebar tabs:
  - **Place Order** — a searchable grocery grid (16 items, each with an emoji "photo", weight, and price), a coupon-apply widget, an address picker, a live order summary (subtotal → discount → delivery → tax → total, computed by `coupon_engine.py` via a preview endpoint on every cart change), and the checkout button. An address is **required** to place an order, enforced both client- and server-side.
  - **Coupons** — browse the available coupon codes and jump straight to checkout with one pre-applied.
  - **My Orders** — full order history, persisted server-side (survives logout/refresh).
  - **Addresses** — add/edit/delete delivery addresses, mark one default.
  - **Profile Settings** — edit name/email/phone.
  - **Help Centre** — an accordion of 3 broad issue categories (**Order Related**, **App Related**, **Other**), each with a free-text field, an optional photo attachment (no size limit), and — for Order Related specifically — a dropdown of your actual past orders plus checkboxes for exactly which item(s) in that order the feedback concerns. Submits to `POST /api/user/submit-feedback`, which is analyzed immediately and appears in the admin Feedbacks table.
  - Right after checkout, a modal automatically prompts for post-order feedback: 3 emoji ratings (😞/🙂/🤩) plus an optional comment, submitted through the same feedback endpoint (tagged `Order Feedback`) so it's visible to admin too.
- **`pages/AdminDashboard.jsx`** (`/admin`) — the analyst-facing dashboard, behind an admin login. Sidebar tabs:
  - **Analytics:** Overview, Risk Analysis, Categories, Sentiment — KPI cards and Recharts visualizations over every analyzed ticket, filterable to one batch via **View Report**.
  - **Data Management:** Feedbacks (a searchable, keyword-highlighted registry where every row's **Risk Level is an editable dropdown** — admins can override the AI's call, which locks in `risk_override: true` and regenerates the recommendation text), Orders (every order ever placed, with delivery address and coupon savings), Batch Upload (bulk-import tickets from a `.csv`/`.xlsx`/`.xls` file — no file size limit), Batches (one row per calendar day; **View Report** and **Delete** only — there's no manual "Analyze" step since everything is analyzed on submission).
  - **Executive Insights** (on Overview) — pick Today / Weekly / Monthly / 6 Months / Yearly / a specific month, and the summary regenerates automatically for that exact window, with the AI-identified recurring themes and categories highlighted inline in the generated text.
- **`api.js`** — shared Axios instance pointed at `http://localhost:8000/api`.
- **`constants.js`** — the grocery catalog (name/weight/cost/emoji) and the shared chart color palette.
- **`useDarkMode.js`** — a small hook backing the dark-mode toggle with `localStorage` instead of per-page component state, so the preference survives navigating between Landing/User Portal/Admin Dashboard and page refreshes.

## End-to-End Flow

1. A customer signs into the **User Portal**, optionally places an order (address required), and is prompted for quick post-order feedback.
2. Separately (or via that prompt), they submit a support ticket through **Help Centre**. `POST /api/user/submit-feedback` creates the `FeedbackRecord` **and immediately runs it through the full 4-engine pipeline** before responding — there is no pending/unanalyzed state visible anywhere.
3. An admin signs into the **Admin Dashboard**. Every ticket is already scored — no "Analyze Now" step exists. They can search the Feedbacks table, override a risk level by hand if the AI got it wrong, bulk-import a batch of historical tickets from a spreadsheet, or generate an executive summary for any date range.
4. KPI cards, charts, and tables across Overview / Risk Analysis / Categories / Sentiment / Feedbacks all derive from the same result set, optionally filtered to one batch via **View Report**.

## Why Four Separate "Engines" (Plus a Fifth for Commerce)?

The pipeline deliberately splits into single-responsibility modules instead of one big function, because each answers a genuinely different question:

| Engine | Question it answers | Deterministic? |
|---|---|---|
| `llm_service` | *What is this feedback about?* (classification + executive summaries) | No — depends on the LLM |
| `confidence_engine` | *How much should we trust that classification?* | Yes — pure rules over the LLM's own output |
| `risk_engine` | *How bad is this, from a business standpoint?* | Yes — weighted formula + food-safety floor |
| `recommendation_engine` | *What should we actually do about it?* | Yes — rule lookup table |
| `coupon_engine` | *What does this cart actually cost?* | Yes — pure order-total math, unrelated to feedback |

Only the raw classification (and the executive-summary prose) is delegated to the LLM; the business rules that act on that classification stay under your control, testable and auditable without depending on model behavior — including when an admin decides the AI got the risk level wrong and overrides it by hand.

## The Risk Score Formula

`engines/risk_engine.py` computes a 0–100 score from four weighted signals:

| Signal | Max points | Logic |
|---|---|---|
| Sentiment | 30 | Negative = 30, Neutral = 10, Positive = 0 |
| Urgency (1–5 from LLM) | 30 | `(urgency / 5) * 30` — linear scale |
| Churn intent | 20 | Boolean from LLM: +20 if true |
| Customer priority tier | 20 | Tier 1/Enterprise/VIP = 20, Tier 2 = 10, Tier 3 = 0 |

Total maps to a label: **≥ 80** Critical · **≥ 60** High · **≥ 35** Medium · else Low.

**Food-safety floor:** if sentiment is Negative and the category is "Spoiled/Damaged Goods", the score is floored to at least 60 (High) — a food-safety complaint is a brand/health risk no matter how calmly it's phrased.

**Manual override:** an admin can set any ticket's risk level directly from the Feedbacks table. This bypasses the formula entirely, sets `risk_override = true`, and regenerates the recommendation text to match.

## Order Pricing Formula

`engines/coupon_engine.py` computes every order total the same way, whether it's a live cart preview or the final checkout:

`subtotal → apply coupon discount → delivery fee (₹40, waived if the post-discount total ≥ ₹199 or the coupon is FREESHIP) → 5% tax on the post-discount amount → grand total`

| Code | Type | Effect | Minimum order |
|---|---|---|---|
| `WELCOME50` | Flat | ₹50 off | ₹200 |
| `SAVE10` | Percent | 10% off, capped at ₹100 | ₹150 |
| `FREESHIP` | Free shipping | Waives the delivery fee | ₹99 |

## API Reference

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness check |
| POST | `/api/login` | Admin login (hardcoded credentials) |
| POST | `/api/user/login` | User-portal login (hardcoded credentials) |
| POST | `/api/user/submit-feedback` | Submit one feedback ticket (optional photo) — analyzed synchronously before responding |
| GET | `/api/feedbacks` | All feedback records, with analysis, risk, and `risk_override` |
| PUT | `/api/feedbacks/{id}/risk-level` | Admin manually sets a ticket's risk level; regenerates its recommendation |
| GET / POST / PUT / DELETE | `/api/user/addresses[/{id}]` | Manage delivery addresses |
| GET | `/api/user/orders` | Full order history |
| POST | `/api/user/orders/preview` | Live cart total preview (subtotal/discount/delivery/tax/total) given items + optional coupon |
| POST | `/api/user/orders` | Place an order (address required; coupon re-validated server-side) |
| GET | `/api/coupons` | List available coupon codes |
| GET / PUT | `/api/user/profile` | Get/update the user's profile |
| GET | `/api/batches` | All batches with ticket counts and status |
| DELETE | `/api/batches/{batch_id}` | Delete a batch and its feedback records |
| POST | `/api/admin/bulk-upload` | Bulk-import tickets from a `.csv`/`.xlsx`/`.xls` file (multipart upload, no size limit) |
| POST | `/api/generate-summary` | AI executive summary + highlighted keywords for a given date range |

## Login Credentials

Both logins are currently **hardcoded** (no user database yet). Credentials live in `backend/config.py`:

```python
# Admin Portal
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin123"

# User Portal
USER_USERNAME = "user"
USER_PASSWORD = "user123"
```

**Change these** to your own values before using the app. The checks happen server-side in `/api/login` and `/api/user/login` — credentials are never shipped to the browser.

## Environment Variables (`backend/.env`)

All AI configuration is decoupled from code via `.env` (never committed — see `.gitignore`):

```env
AI_BASE_URL="https://api.openai.com/v1"
AI_API_KEY="sk-..."
AI_MODEL="gpt-4o"
```

If the OpenAI call fails for any reason (bad key, network issue, rate limit), `analyze_feedback` transparently falls back to mock analysis data instead of erroring out (see [Known Limitations](EXPLANATION.md#6-known-limitations--things-worth-improving) in `EXPLANATION.md`). `generate_executive_summary` has no such fallback — a bad key surfaces as a visible error in Executive Insights, which is intentional so it's obvious when the AI provider isn't actually reachable.

## Getting Started

### Prerequisites
- **Python 3.9+**
- **Node.js** (for the Vite frontend)
- An OpenAI API key

### 1. Backend Setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Configure `backend/.env` as shown above, then start the API:

```bash
uvicorn main:app --reload
```

API available at `http://localhost:8000` (docs at `http://localhost:8000/docs`).

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

App available at `http://localhost:5173`.

### 3. Run Both at Once

From the project root:

```bash
./dev.bat
```

(Despite the `.bat` name, this is a bash script — it starts both the backend and frontend together, and stops both on `Ctrl+C`.)

### 4. Try It Out

1. Open `http://localhost:5173` — the Landing page links to **My Account** and **Admin Portal**.
2. Sign into **My Account** (`/user`) with the user credentials, place an order, and rate it when the feedback prompt pops up. Then submit a ticket via **Help Centre**.
3. Sign into **Admin Portal** (`/admin`) with the admin credentials — your ticket and order are already there, fully analyzed. Try overriding a risk level, or generating an Executive Insights summary for "Today".

### Testing the AI Connection

`backend/test_ai_connection.py` is a standalone interactive script to sanity-check your OpenAI connection independent of the FastAPI app:

```bash
cd backend && source venv/bin/activate && python3 test_ai_connection.py
```

Type any question, get a live response back — type `exit` to quit.

## Evaluation Criteria Covered

- **Structured outputs & graceful fallback:** LLM responses are strict-JSON parsed; if the AI endpoint is offline or errors, the app returns mock analysis instead of crashing.
- **No hardcoded secrets:** All AI provider config lives in `.env`, never in source.
- **Modularized backend:** `main.py` for routing, `services/analysis_pipeline.py` for orchestration, `engines/` for business logic (including the e-commerce pricing engine), `config.py` for settings.
- **Separation of customer and analyst experiences:** a full self-serve storefront + support portal for customers, and an analytics/override/bulk-import dashboard for admins, each behind its own login, sharing one FastAPI backend.
- **Human-in-the-loop AI:** the AI classifies and scores automatically, but an admin can always override a risk level by hand — the system doesn't pretend the model is infallible.
- **Few-shot prompting** drives precise, consistent categorization; the dashboard visualizes sentiment, category, and risk distribution via charts, with a searchable, keyword-highlighted registry underneath.
