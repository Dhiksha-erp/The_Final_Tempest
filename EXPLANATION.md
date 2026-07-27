# The Final Tempest — Project Deep Dive

This document explains **how** and **why** the project works the way it does, beyond the setup steps in `README.md`. It's meant to be a technical walkthrough for understanding the codebase.

## 1. The Problem This Solves

A quick-commerce grocery app (10-minute delivery) receives a constant stream of unstructured customer feedback — support tickets, app reviews, chat transcripts. Reading each one manually to figure out "is this urgent, is this customer about to churn, what should we do about it" doesn't scale.

This project automates that triage: feed it raw text, get back a structured risk assessment and a recommended next action, for every single ticket, in seconds.

## 2. End-to-End Request Lifecycle

This is the most important thing to understand — everything else in the codebase exists to support this one flow. Walking through what happens when you upload a JSON file and click "Analyze":

```
1. Browser reads the JSON file locally (FileReader) — nothing sent to the server yet.
2. User clicks "Analyze New Upload" → POST /api/batch-analyze { filename, feedbacks: [{id, text}, ...] }
3. main.py creates a new UploadBatch row (a UUID + filename + auto timestamp).
4. For EACH feedback item, sequentially:
   a. engines/llm_service.py → analyze_feedback(text)
      → sends text to the configured AI endpoint with a few-shot system prompt
      → gets back strict JSON: {category, sentiment, themes, urgency, churn_intent, customer_priority}
   b. engines/confidence_engine.py → calculate_confidence(llm_output)
      → starts at 100, deducts points for missing/generic fields → a trust score for step (a)'s output
   c. engines/risk_engine.py → compute_risk_score(...)
      → weighted formula over sentiment + urgency + churn_intent + customer_priority → 0-100 risk score + label
   d. engines/recommendation_engine.py → generate_recommendation(risk_level, category)
      → rule lookup table → a concrete next action string
   e. Combined result saved as a FeedbackRecord row, and included in the API response
5. Once all items are processed, batch commits to SQLite, response returns full results + batch_id.
6. Frontend merges new results into state, auto-selects the new batch as the active filter,
   and separately calls POST /api/generate-summary with the top 20 themes to get an
   executive-summary paragraph from the LLM.
7. Dashboard re-renders: KPI cards, risk/category/sentiment charts, and the ticket table
   all derive from `filteredResults` (a useMemo over `results`, filtered by selected batch).
```

Every ticket makes its **own** round-trip to the LLM (step 4a) — there's no batching at the AI-call level, so a 50-ticket upload means 50 sequential LLM calls plus 1 summary call. This is simple and reliable but not fast; see [Section 6](#6-known-limitations--things-worth-improving).

## 3. Why Four Separate "Engines"?

The pipeline deliberately splits into four single-responsibility modules instead of one big function, because each answers a genuinely different question:

| Engine | Question it answers | Deterministic? |
|---|---|---|
| `llm_service` | *What is this feedback about?* (classification) | No — depends on the LLM |
| `confidence_engine` | *How much should we trust that classification?* | Yes — pure rules over the LLM's own output |
| `risk_engine` | *How bad is this, from a business standpoint?* | Yes — pure weighted formula |
| `recommendation_engine` | *What should we actually do about it?* | Yes — rule lookup table |

The only non-deterministic, "AI" part of the pipeline is `llm_service`. Everything downstream of it is plain, testable, auditable Python logic — which matters, because you generally don't want your risk scoring or recommended actions to silently change because a model got updated. Only the raw classification is delegated to the LLM; the business rules that act on that classification stay under your control.

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

Worked example: a Tier-1 customer's message about spoiled food, sentiment Negative, urgency 5, churn intent true → 30 (negative) + 30 (urgency 5/5) + 20 (churn) + 20 (Tier 1) = **100 → Critical**. This is exactly what you'd see for the "rotten bananas" ticket in the sample dataset.

## 5. The AI Layer

`engines/llm_service.py` uses the `openai` Python SDK to call OpenAI's Chat Completions API (`gpt-4o` by default, configurable via `backend/.env`).

**Prompt design:** the system prompt (`FEW_SHOT_PROMPT`) gives the model two worked examples (one severe, one mild) before asking it to classify new text. Few-shot examples like this dramatically improve consistency of the JSON structure and category labels versus a bare instruction.

**Defensive parsing:** models sometimes ignore "no markdown" instructions and wrap JSON in ` ```json ` fences anyway — `analyze_feedback` strips those with a regex before calling `json.loads()`.

**Graceful degradation:** if the OpenAI call fails for any reason (invalid key, network issue, rate limit, malformed response), `analyze_feedback` and `generate_executive_summary` both catch the exception and return **randomized mock analysis** rather than propagating an error up to the user. This keeps the dashboard demoable even when the API is misbehaving — but it also means a bad API key or an outage can produce fabricated-looking-real data with only a `print()` in the backend console as a clue. Worth knowing about if numbers look "too random."

## 6. Known Limitations / Things Worth Improving

Being upfront about the current rough edges, in case you extend this further:

- **CORS is wide open** (`allow_origins=["*"]` in `main.py`) — fine for local dev, must be locked down before any real deployment.
- **Admin login is hardcoded** (`config.py: ADMIN_USERNAME` / `ADMIN_PASSWORD`) — a placeholder until real user accounts + a database are added. No sessions/tokens either — `isAuthenticated` is just React state that resets on page reload.
- **No pagination** — `/api/feedbacks` returns every row in the table in one response. Fine for demo-scale data, will need pagination once the table grows.
- **Sequential LLM calls** — a large upload will take roughly `(number of tickets) × (LLM latency)` to finish, since each ticket's classification call happens one after another rather than concurrently.
- **Mock fallback is silent** — if you *think* you're getting real AI analysis but the endpoint is actually down, you'll get plausible-looking randomized data with no visible warning in the UI (only a `print()` in the backend console).

## 7. Where to Look for Common Changes

| I want to... | Start here |
|---|---|
| Add a new feedback category | `engines/llm_service.py` (`FEW_SHOT_PROMPT`) and `engines/recommendation_engine.py` (category matching) |
| Change how risk is scored | `engines/risk_engine.py` |
| Change the recommended actions | `engines/recommendation_engine.py` |
| Add a new API endpoint | `backend/main.py` |
| Add a new dashboard chart/tab | `frontend/src/App.jsx` (`render*` functions + sidebar `NavItem`s) |
| Swap AI providers | `backend/.env` only — no code changes needed |
| Replace hardcoded admin auth with real accounts | `backend/config.py` + `/api/login` in `main.py`, and a new `User`-style table in `database.py` |
