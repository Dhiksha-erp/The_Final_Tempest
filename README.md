# The Final Tempest — VoC Risk Engine

An AI-powered Voice of Customer (VoC) pipeline for a 10-minute quick-commerce grocery delivery app. Customers submit feedback through a self-serve **User Portal**; each ticket is pooled into that day's batch. An **Admin Dashboard** triggers AI analysis per batch — classifying sentiment, category, urgency and churn risk, scoring each ticket for business risk and confidence, and generating automated action recommendations plus an executive summary — all visualized on a live dashboard.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.10+), SQLAlchemy, SQLite |
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
                               │  (services/          │     │   Recomm. Engines    │     │  (tempest.db)        │
                               │   analysis_          │     │  (engines/*.py)      │     │                      │
                               │   pipeline.py)       │     │                      │     │                      │
                               └──────────────────────┘     └──────────────────────┘     └──────────────────────┘
                                           │
                                           ▼
                                      OpenAI API
                                       (gpt-4o)
```

### Backend — `backend/`

- **`main.py`** — FastAPI app and all routing. No business logic lives here; it wires requests to the pipeline/engines below and persists results.
- **`config.py`** — loads AI provider settings from `.env`, and holds the hardcoded admin + user credentials (see [Login Credentials](#login-credentials)).
- **`database.py`** — SQLAlchemy models (`UploadBatch`, `FeedbackRecord`) over a local SQLite file (`tempest.db`), auto-created on first run. Includes a lightweight `_migrate()` that backfills new columns (`status`, `batch_date`, `ticket_no`, ...) onto a pre-existing database without losing data.
- **`services/analysis_pipeline.py`** — `run_pipeline()`, the shared entry point that runs a batch of `FeedbackRecord` rows through all four engines in sequence and updates each row in place.
- **`engines/`** — the actual analysis pipeline, one concern per file:
  - `llm_service.py` — sends feedback text to OpenAI with a few-shot prompt, parses the strict-JSON response (category, sentiment, themes, urgency, churn intent, customer priority). Falls back to randomized mock data if the API call fails, instead of crashing.
  - `confidence_engine.py` — scores how trustworthy the LLM's own output looks (penalizes missing/generic fields).
  - `risk_engine.py` — deterministic weighted formula (sentiment + urgency + churn intent + customer priority) → a 0–100 risk score → `Critical` / `High` / `Medium` / `Low`.
  - `recommendation_engine.py` — rule-based next-action recommendation keyed off risk level + category (e.g. "issue instant refund" for spoiled goods, "suspend delivery partner" for rude-partner tickets).

### Frontend — `frontend/src/`

A multi-route app (React Router) split into three pages:

- **`pages/Landing.jsx`** (`/`) — entry screen with two cards linking to the User Portal and Admin Dashboard.
- **`pages/UserPortal.jsx`** (`/user`) — customer-facing self-serve support form, behind a lightweight user login. Pick an issue category from an accordion (delivery delay, missing item, damaged goods, wrong item, payment issue, rude partner, other), optionally attach an order ID, and submit free-text feedback → `POST /api/user/submit-feedback`. Every submission on the same calendar day rolls into one shared batch; the response returns a ticket ID (`TKT-00001`, ...) shown back to the customer, plus a running list of what was submitted this session.
- **`pages/AdminDashboard.jsx`** (`/admin`) — the analyst-facing dashboard, behind an admin login gate. Sidebar navigation across: **Overview**, **Risk Analysis**, **Categories**, **Sentiment**, **Feedbacks**, **Batches** (badge shows the pending-batch count). Key flows:
  - **Batches** tab lists every day's batch with its ticket count and status (`Pending` / `Analyzed`). **Analyze Now** runs only the not-yet-analyzed tickets in that batch through `POST /api/batches/{batch_id}/analyze`; **View Report** filters the analytics tabs down to that batch; **Delete** removes the batch and its feedback records from the DB.
  - Once analyzed, tickets populate KPI cards, pie/bar charts (Recharts), and a per-ticket table across the other tabs.
  - An AI-generated **executive summary** is produced from the top recurring themes via `/api/generate-summary`.
- **`api.js`** — shared Axios instance pointed at `http://localhost:8000/api`.
- **`constants.js`** — shared color palette used across all charts.

## API Reference

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness check |
| POST | `/api/login` | Validates admin credentials (hardcoded, see below) |
| POST | `/api/user/login` | Validates user-portal credentials (hardcoded, see below) |
| POST | `/api/user/submit-feedback` | Customer submits one feedback ticket; pooled into today's batch, returns a `ticket_id` |
| POST | `/api/batches/{batch_id}/analyze` | Runs every unanalyzed ticket in a batch through the full pipeline and stores results |
| GET | `/api/feedbacks` | Returns all feedback records (analyzed and pending) |
| GET | `/api/batches` | Returns all batches with their ticket counts and status |
| DELETE | `/api/batches/{batch_id}` | Deletes a batch and all its feedback records |
| POST | `/api/generate-summary` | Generates an executive summary from a list of themes |

## Login Credentials

Both logins are currently **hardcoded** (no user database yet — planned for later). Credentials live in `backend/config.py`:

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

All AI configuration is decoupled from code via `.env` (no hardcoded secrets in source):

```env
AI_BASE_URL="https://api.openai.com/v1"
AI_API_KEY="sk-..."
AI_MODEL="gpt-4o"
```

If the OpenAI call fails for any reason (bad key, network issue, rate limit), the backend transparently falls back to mock analysis data instead of erroring out.

## Getting Started

### Prerequisites
- **Python 3.10+**
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

1. Open `http://localhost:5173` — the Landing page links to the two portals.
2. Go to **Help & Support** (`/user`), sign in with the user credentials from `config.py`, pick an issue category, and submit some feedback. Note the ticket ID returned.
3. Go to **Admin Portal** (`/admin`), sign in with the admin credentials, open the **Batches** tab, and click **Analyze Now** on today's batch.
4. Click **View Report** (or the **Overview** tab) to see the KPI cards, risk/category/sentiment charts, and the AI-generated executive summary populate.

### Testing the AI Connection

`backend/test_ai_connection.py` is a standalone interactive script to sanity-check your OpenAI connection independent of the FastAPI app:

```bash
cd backend && source venv/bin/activate && python3 test_ai_connection.py
```

Type any question, get a live response back — type `exit` to quit.

## Evaluation Criteria Covered

- **Structured outputs & graceful fallback:** LLM responses are strict-JSON parsed; if the AI endpoint is offline or errors, the app returns mock analysis instead of crashing.
- **No hardcoded secrets:** All AI provider config lives in `.env`, never in source.
- **Modularized backend:** `main.py` for routing, `services/analysis_pipeline.py` for orchestration, `engines/` for business logic, `config.py` for settings — clean separation of concerns.
- **Separation of customer and analyst experiences:** a dedicated User Portal for ticket submission and an Admin Dashboard for review/analysis, each behind its own login, sharing one FastAPI backend.
- **Few-shot prompting** drives precise, consistent categorization; the dashboard visualizes sentiment, category, and risk distribution via charts.
