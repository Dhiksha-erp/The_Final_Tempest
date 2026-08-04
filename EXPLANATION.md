# The Final Tempest — Project Deep Dive

This document explains **how** and **why** the project works the way it does, beyond the setup steps in `README.md`. It's meant to be a technical walkthrough for understanding the codebase.

## 1. The Problem This Solves

A quick-commerce grocery app (10-minute delivery) receives a constant stream of unstructured customer feedback — support tickets, app reviews, chat transcripts. Reading each one manually to figure out "is this urgent, is this customer about to churn, what should we do about it" doesn't scale.

This project automates that triage: customers submit raw text through a self-serve portal, and an admin can trigger a structured risk assessment plus a recommended next action, for every ticket in a batch, in seconds.

## 2. End-to-End Request Lifecycle

This is the most important thing to understand — everything else in the codebase exists to support this one flow. Walking through what happens from a customer submitting feedback to an admin seeing it on the dashboard:

```
CUSTOMER SIDE (User Portal, /user)
1. Customer logs in (hardcoded user/user123 checked via POST /api/user/login).
2. Customer picks an issue category from an accordion, optionally adds an Order ID,
   writes free text, and submits → POST /api/user/submit-feedback { text }.
3. main.py:
   a. Looks for an UploadBatch row whose batch_date == today's date (ISO, YYYY-MM-DD).
      - None exists yet → create one (new UUID, status "Pending").
      - Exists but already status "Analyzed" → flip it back to "Pending" (new ticket
        arrived after the day's analysis already ran).
   b. Creates a FeedbackRecord row: new UUID, next ticket_no (max + 1), the raw text.
      No AI analysis happens here — the row has category/sentiment/etc. all NULL.
   c. Returns a display ticket_id (TKT-00001, ...) to the customer.

   → Every feedback item submitted on the same calendar day rolls into ONE shared batch.

ADMIN SIDE (Admin Dashboard, /admin)
4. Admin logs in (hardcoded admin/admin123 checked via POST /api/login).
5. Dashboard loads GET /api/feedbacks (every record ever created) and GET /api/batches
   (every day's batch + ticket count + status). Batches tab shows a badge with the
   count of still-Pending batches.
6. Admin clicks "Analyze Now" on a Pending batch → POST /api/batches/{batch_id}/analyze.
   a. Backend queries FeedbackRecord rows in that batch WHERE category IS NULL
      (skips anything already analyzed, relevant if the batch was reopened by a
      same-day top-up after a previous analysis run).
   b. services/analysis_pipeline.py -> run_pipeline(db, records) loops over those
      records ONE AT A TIME:
      i.   engines/llm_service.py -> analyze_feedback(text)
           → sends text to the configured AI endpoint with a few-shot system prompt
           → gets back strict JSON: {category, sentiment, themes, urgency,
             churn_intent, customer_priority}
      ii.  engines/confidence_engine.py -> calculate_confidence(llm_output)
           → starts at 100, deducts points for missing/generic fields → a trust
             score for step (i)'s output
      iii. engines/risk_engine.py -> compute_risk_score(...)
           → weighted formula over sentiment + urgency + churn_intent +
             customer_priority → 0-100 risk score + label
      iv.  engines/recommendation_engine.py -> generate_recommendation(risk_level,
           category)
           → rule lookup table → a concrete next action string
      v.   All of the above is written back onto that FeedbackRecord row in place.
   c. Once every record is processed, batch.status flips to "Analyzed" and
      everything commits to SQLite in one go.
7. Dashboard reloads /api/feedbacks + /api/batches, collects up to 20 themes from
   analyzed tickets, and calls POST /api/generate-summary to get a fresh
   executive-summary paragraph from the LLM.
8. Dashboard re-renders: KPI cards, risk/category/sentiment charts, and the ticket
   table all derive from `filteredResults` (a useMemo over `results`, restricted to
   records that actually have a category, and further filtered by whichever batch
   is selected via "View Report").
```

Every ticket makes its **own** round-trip to the LLM (step 6.b.i) — there's no batching at the AI-call level, so analyzing a 50-ticket batch means 50 sequential LLM calls plus 1 summary call. This is simple and reliable but not fast; see [Section 6](#6-known-limitations--things-worth-improving).

## 3. Why Four Separate "Engines"?

The pipeline deliberately splits into four single-responsibility modules instead of one big function, because each answers a genuinely different question:

| Engine | Question it answers | Deterministic? |
|---|---|---|
| `llm_service` | *What is this feedback about?* (classification) | No — depends on the LLM |
| `confidence_engine` | *How much should we trust that classification?* | Yes — pure rules over the LLM's own output |
| `risk_engine` | *How bad is this, from a business standpoint?* | Yes — pure weighted formula |
| `recommendation_engine` | *What should we actually do about it?* | Yes — rule lookup table |

The only non-deterministic, "AI" part of the pipeline is `llm_service`. Everything downstream of it is plain, testable, auditable Python logic — which matters, because you generally don't want your risk scoring or recommended actions to silently change because a model got updated. Only the raw classification is delegated to the LLM; the business rules that act on that classification stay under your control. `services/analysis_pipeline.py` is what wires all four together and is shared by the one place that needs them: `POST /api/batches/{batch_id}/analyze`.

## 4. The Risk Score Formula, Explained

`engines/risk_engine.py` computes a 0–100 score from four weighted signals:

| Signal | Max points | Logic |
|---|---|---|
| Sentiment | 30 | Negative = 30, Neutral = 10, Positive = 0 |
| Urgency (1–5 from LLM) | 30 | `(urgency / 5) * 30` — linear scale |
| Churn intent | 20 | Boolean from LLM: +20 if true |
| Customer priority tier | 20 | Tier 1/Enterprise/VIP = 20, Tier 2 = 10, Tier 3 = 0 |

Total maps to a label:
- **≥ 80** → Critical
- **≥ 60** → High
- **≥ 35** → Medium
- **else** → Low

Worked example: a Tier-1 customer's message about spoiled food, sentiment Negative, urgency 5, churn intent true → 30 (negative) + 30 (urgency 5/5) + 20 (churn) + 20 (Tier 1) = **100 → Critical**.

## 5. The AI Layer

`engines/llm_service.py` uses the `openai` Python SDK (`AsyncOpenAI`) to call OpenAI's Chat Completions API (`gpt-4o` by default, configurable via `backend/.env`), with `temperature=0.0` for the classification call so results stay consistent for the same input.

**Prompt design:** the system prompt (`FEW_SHOT_PROMPT`) gives the model two worked examples (one severe, one mild) before asking it to classify new text. Few-shot examples like this dramatically improve consistency of the JSON structure and category labels versus a bare instruction.

**Defensive parsing:** models sometimes ignore "no markdown" instructions and wrap JSON in ` ```json ` fences anyway — `analyze_feedback` strips those with a regex before calling `json.loads()`.

**Graceful degradation:** if the OpenAI call fails for any reason (invalid key, network issue, rate limit, malformed response), `analyze_feedback` and `generate_executive_summary` both catch the exception. `analyze_feedback` returns one of two hardcoded **randomized mock analyses** (a "Billing/Critical" one or a "UX/Positive" one, `random.choice` between them) rather than propagating an error up to the user; `generate_executive_summary` instead returns a plain string saying the summary couldn't be generated. This keeps the ticket-analysis flow demoable even when the API is misbehaving — but it also means a bad API key or an outage can produce fabricated-looking-real data with only a `print()` in the backend console as a clue. Worth knowing about if numbers look "too random" or suspiciously binary (everything's either Critical or low-risk, nothing in between).

## 6. Known Limitations / Things Worth Improving

Being upfront about the current rough edges, in case you extend this further:

- **CORS is wide open** (`allow_origins=["*"]` in `main.py`) — fine for local dev, must be locked down before any real deployment.
- **Admin and user logins are hardcoded** (`config.py`: `ADMIN_USERNAME`/`ADMIN_PASSWORD`, `USER_USERNAME`/`USER_PASSWORD`) — a placeholder until real user accounts + a database are added. No sessions/tokens either — `isAuthenticated` is just React state that resets on page reload.
- **No pagination** — `/api/feedbacks` returns every row in the table in one response. Fine for demo-scale data, will need pagination once the table grows.
- **Sequential LLM calls** — analyzing a large batch will take roughly `(number of unanalyzed tickets) × (LLM latency)` to finish, since each ticket's classification call happens one after another rather than concurrently.
- **Mock fallback is silent** — if you *think* you're getting real AI analysis but the endpoint is actually down, you'll get plausible-looking randomized data with no visible warning in the UI (only a `print()` in the backend console).
- **Date-based batching is calendar-day-only** — there's no timezone handling; `batch_date` is whatever `datetime.date.today()` resolves to on the server, so a customer submitting right around midnight server time could land in either day's batch.

## 7. Where to Look for Common Changes

| I want to... | Start here |
|---|---|
| Add a new feedback category | `engines/llm_service.py` (`FEW_SHOT_PROMPT`) and `frontend/src/pages/UserPortal.jsx` (`ISSUE_CATEGORIES`) and `engines/recommendation_engine.py` (category matching) |
| Change how risk is scored | `engines/risk_engine.py` |
| Change the recommended actions | `engines/recommendation_engine.py` |
| Change how tickets get batched (e.g. weekly instead of daily) | `main.py` (`submit_user_feedback`'s `batch_date` logic) and `database.py`'s `_migrate()` orphan-cleanup block |
| Add a new API endpoint | `backend/main.py` |
| Add a new dashboard chart/tab | `frontend/src/pages/AdminDashboard.jsx` (`render*` functions + sidebar `NavItem`s) |
| Swap AI providers | `backend/.env` only — no code changes needed |
| Replace hardcoded admin/user auth with real accounts | `backend/config.py` + `/api/login` and `/api/user/login` in `main.py`, and a new `User`-style table in `database.py` |
