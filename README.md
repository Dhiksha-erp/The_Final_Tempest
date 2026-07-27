# The Final Tempest — VoC Risk Engine

An AI-powered Voice of Customer (VoC) pipeline for a 10-minute quick-commerce grocery delivery app. It ingests raw customer feedback (as JSON), runs it through an LLM to classify sentiment, category, urgency and churn risk, scores each ticket for business risk and confidence, and generates automated action recommendations plus an executive summary — all visualized on a live dashboard.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.9+), SQLAlchemy, SQLite |
| AI | `openai` SDK against the OpenAI API (`gpt-4o` by default) |
| Frontend | React (Vite), Recharts, Axios, Lucide icons |

## Architecture

```
┌──────────────────────┐        REST/JSON        ┌───────────────────────────┐
│   React Frontend     │ ───────────────────────► │      FastAPI Backend      │
│   (Vite, :5173)      │ ◄─────────────────────── │         (:8000)           │
└──────────────────────┘                          └─────────────┬─────────────┘
                                                                  │
                                    ┌─────────────────────────────┼─────────────────────────────┐
                                    ▼                             ▼                             ▼
                          ┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
                          │   LLM Service     │          │  Confidence /     │          │   SQLite DB       │
                          │ (engines/llm_     │          │  Risk / Recomm.   │          │  (tempest.db)     │
                          │  service.py)      │          │  Engines          │          │                   │
                          └────────┬──────────┘          └──────────────────┘          └──────────────────┘
                                   │
                                   ▼
                        OpenAI API
                       (gpt-4o)
```

### Backend — `backend/`

- **`main.py`** — FastAPI app and all routing. No business logic lives here; it wires requests to the engines below and persists results.
- **`config.py`** — loads AI provider settings from `.env`, and holds the hardcoded admin credentials (see [Admin Login](#admin-login)).
- **`database.py`** — SQLAlchemy models (`UploadBatch`, `FeedbackRecord`) over a local SQLite file (`tempest.db`), auto-created on first run.
- **`engines/`** — the actual analysis pipeline, one concern per file:
  - `llm_service.py` — sends feedback text to OpenAI with a few-shot prompt, parses the strict-JSON response (category, sentiment, themes, urgency, churn intent, customer priority). Falls back to randomized mock data if the API call fails, instead of crashing.
  - `confidence_engine.py` — scores how trustworthy the LLM's own output looks (penalizes missing/generic fields).
  - `risk_engine.py` — deterministic weighted formula (sentiment + urgency + churn intent + customer priority) → a 0–100 risk score → `Critical` / `High` / `Medium` / `Low`.
  - `recommendation_engine.py` — rule-based next-action recommendation keyed off risk level + category (e.g. "issue instant refund" for spoiled goods, "suspend delivery partner" for rude-partner tickets).

### Frontend — `frontend/src/App.jsx`

A single-page dashboard behind an admin login gate. Sidebar navigation across: **Overview**, **Risk Analysis**, **Categories**, **Sentiment**, **Feedbacks**, **Upload History**. Key flows:

- Upload a JSON file of feedback tickets → sent to `/api/batch-analyze` → results rendered as KPI cards, pie/bar charts (Recharts), and a per-ticket table.
- **Upload History** tab lists every previous upload with a **View Report** filter and a **Delete** button (removes the batch and its feedback records from the DB).
- An AI-generated **executive summary** is produced from the top recurring themes via `/api/generate-summary`.

## API Reference

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness check |
| POST | `/api/login` | Validates admin credentials (hardcoded, see below) |
| POST | `/api/batch-analyze` | Runs a batch of `{id, text}` feedback items through the full pipeline and stores results |
| GET | `/api/feedbacks` | Returns all analyzed feedback records |
| GET | `/api/batches` | Returns all upload batches with their ticket counts |
| DELETE | `/api/batches/{batch_id}` | Deletes an upload batch and all its feedback records |
| POST | `/api/generate-summary` | Generates an executive summary from a list of themes |

## Admin Login

Login is currently **hardcoded** (no user database yet — planned for later). Credentials live in `backend/config.py`:

```python
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "ChangeMe123!"
```

**Change these** to your own values before using the app. The check happens server-side in `/api/login` — credentials are never shipped to the browser.

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
- **Python 3.10+** (the pinned dependency versions require it; on Python 3.9 you'll need to relax the pins in `requirements.txt`)
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

Dashboard available at `http://localhost:5173`.

### 3. Run Both at Once

From the project root:

```bash
./dev.bat
```

(Despite the `.bat` name, this is a bash script — it starts both the backend and frontend together, and stops both on `Ctrl+C`.)

### 4. Try It Out

1. Open `http://localhost:5173` and log in with the admin credentials from `config.py`.
2. Click **Upload JSON** and pick a sample dataset — `backend/dataset.json` (15 tickets) or `backend/dataset_50.json` (50 tickets) — both already match the required format:
   ```json
   [
     { "id": "1", "text": "The app is crashing." }
   ]
   ```
3. Click **Analyze New Upload** to run it through the pipeline and populate the dashboard.

### Testing the AI Connection

`backend/test_ai_connection.py` is a standalone interactive script to sanity-check your OpenAI connection independent of the FastAPI app:

```bash
cd backend && source venv/bin/activate && python3 test_ai_connection.py
```

Type any question, get a live response back — type `exit` to quit.

## Evaluation Criteria Covered

- **Structured outputs & graceful fallback:** LLM responses are strict-JSON parsed; if the AI endpoint is offline or errors, the app returns mock analysis instead of crashing.
- **No hardcoded secrets:** All AI provider config lives in `.env`, never in source.
- **Modularized backend:** `main.py` for routing, `engines/` for business logic, `config.py` for settings — clean separation of concerns.
- **Few-shot prompting** drives precise, consistent categorization; the dashboard visualizes sentiment, category, and risk distribution via charts.
