# The Final Tempest — Project Deep Dive

This document explains **how** and **why** the project works the way it does, beyond the setup steps in `README.md`. It's meant to be a technical walkthrough for understanding the codebase.

## 1. The Problem This Solves

A quick-commerce grocery app (10-minute delivery) receives a constant stream of unstructured customer feedback — support tickets, app reviews, post-order ratings. Reading each one manually to figure out "is this urgent, is this customer about to churn, what should we do about it" doesn't scale.

This project automates that triage in real time: the moment a customer submits feedback — through the support portal, a post-order rating prompt, or an admin's bulk spreadsheet import — it gets a structured risk assessment and a recommended next action, with no manual "run the analysis" step anywhere. On top of that sits a small self-serve storefront (catalog, cart, coupons, addresses, orders) so feedback has real commerce context to react to.

## 2. End-to-End Request Lifecycle

Walking through what happens from a customer placing an order and submitting feedback, to an admin seeing it fully analyzed on the dashboard:

```
CUSTOMER SIDE (User Portal, /user)
1. Customer logs in (hardcoded user/user123 checked via POST /api/user/login).
2. Customer browses the grocery grid (Place Order tab), optionally applies a coupon
   (validated + priced by engines/coupon_engine.py on every cart change via
   POST /api/user/orders/preview), picks a saved address (required), and checks out
   → POST /api/user/orders. The backend re-validates the coupon and address
   server-side before creating the Order row — nothing is trusted from the client.
3. Immediately after checkout, a modal prompts for a quick rating (😞/🙂/🤩 + optional
   comment). Submitting it calls the SAME endpoint as any other feedback:
   POST /api/user/submit-feedback { text: "[Order Feedback | Order ORD-00007 |
   Rating: Excellent] ...", image_data: null }.
4. Separately, the customer can open Help Centre and report an issue under one of
   3 broad categories (Order Related / App Related / Other). For Order Related,
   they pick one of their actual past orders from a dropdown and check off exactly
   which item(s) it concerns — this gets woven into the submitted text as
   "[Order Issue | Order ORD-00003 | Item(s): Farm Eggs] eggs broke". An optional
   photo (any size) can be attached as a base64 data URL.
5. POST /api/user/submit-feedback (main.py):
   a. Looks for an UploadBatch row whose batch_date == today's date (ISO, YYYY-MM-DD).
      None exists yet → create one, status "Analyzed" (there is no "Pending" state —
      see Section 6 for why the old batch-pending flow was removed entirely).
   b. Creates a FeedbackRecord row: new UUID, next ticket_no, the raw text, optional
      image_data.
   c. Immediately calls services/analysis_pipeline.py -> run_pipeline(db, [record])
      and commits — the HTTP response doesn't return until analysis is done.
   d. Returns a display ticket_id (TKT-00001, ...) to the customer.

ADMIN SIDE (Admin Dashboard, /admin)
6. Admin logs in (hardcoded admin/admin123 checked via POST /api/login).
7. Dashboard loads GET /api/feedbacks, /api/batches, /api/user/orders, and
   /api/user/addresses in parallel. Every feedback row already has a category,
   risk score, and recommendation — there's nothing left to trigger.
8. Admin can:
   - Search the Feedbacks table (any letter/number, highlighted inline wherever it
     appears across ticket ID/text/category/risk level/recommendation).
   - Override a ticket's Risk Level directly from a dropdown in that table
     → PUT /api/feedbacks/{id}/risk-level, which sets risk_override=true and
     regenerates the recommendation text to match the new level.
   - Bulk-import a spreadsheet of historical tickets (Batch Upload tab)
     → POST /api/admin/bulk-upload, which runs every row through the SAME
     run_pipeline() as a live submission.
   - Browse every order ever placed (Orders tab), with its delivery address and
     any coupon savings.
   - Pick a date range (Today/Weekly/Monthly/6 Months/Yearly/a specific month) on
     Overview and get a fresh AI executive summary scoped to exactly that window,
     with the recurring themes/categories that drove it highlighted inline.
9. KPI cards, risk/category/sentiment charts, and the ticket table all derive from
   `filteredResults` (a useMemo over `results`, restricted to records that have a
   category — which by now is all of them — and further filtered by whichever batch
   is selected via "View Report").
```

Every ticket still makes its **own** round-trip to the LLM — there's no batching at the AI-call level, so a 50-row bulk upload means 50 sequential LLM calls. This is simple and reliable but not fast; see [Section 6](#6-known-limitations--things-worth-improving).

## 3. Why Four Separate "Engines" (Plus a Fifth for Commerce)?

The pipeline deliberately splits into single-responsibility modules instead of one big function, because each answers a genuinely different question:

| Engine | Question it answers | Deterministic? |
|---|---|---|
| `llm_service` | *What is this feedback about?* (classification + executive summaries) | No — depends on the LLM |
| `confidence_engine` | *How much should we trust that classification?* | Yes — pure rules over the LLM's own output |
| `risk_engine` | *How bad is this, from a business standpoint?* | Yes — weighted formula + food-safety floor |
| `recommendation_engine` | *What should we actually do about it?* | Yes — rule lookup table |
| `coupon_engine` | *What does this cart actually cost?* | Yes — pure order-total math, unrelated to feedback |

The only non-deterministic, "AI" parts of the pipeline are `llm_service`'s classification and executive-summary generation. Everything downstream is plain, testable, auditable Python — which matters twice over here: you don't want risk scoring to silently drift because a model got swapped, *and* you want a human (the admin) to always have the final word over the AI's risk call. `services/analysis_pipeline.py` wires the four feedback engines together and is called from every place a `FeedbackRecord` gets created: `submit_user_feedback`, `bulk_upload_feedback`, and (indirectly, since it's the same endpoint) the post-order feedback modal.

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

**The food-safety floor** exists because real-world testing surfaced a gap: a terse "eggs broke" message scored sentiment Negative, urgency 3, no churn intent, Tier 2 — a raw score of 58, just under the High threshold, landing at Medium. But a spoiled/damaged-goods complaint is a health and brand risk regardless of how mildly it's worded, so `risk_engine.py` now floors the score to at least 60 (High) whenever sentiment is Negative and the category is "Spoiled/Damaged Goods" — independent of how calm or terse the customer's actual wording was.

**Manual override** is the other escape hatch, for the opposite direction: if an admin looks at a ticket and disagrees with either the formula *or* the floor, `PUT /api/feedbacks/{id}/risk-level` lets them set any level directly. This sets `risk_override = true` (surfaced in the Feedbacks table as a small icon next to the dropdown) and calls `generate_recommendation()` again so the recommended action text always matches whatever risk level is currently in effect — formula-derived or human-set.

## 5. The AI Layer

`engines/llm_service.py` uses the `openai` Python SDK (`AsyncOpenAI`) to call OpenAI's Chat Completions API (`gpt-4o` by default, configurable via `backend/.env`), with `temperature=0.0` for the classification call so results stay consistent for the same input.

**Prompt design:** the system prompt (`FEW_SHOT_PROMPT`) gives the model two worked examples (one severe, one mild) before asking it to classify new text. Few-shot examples like this dramatically improve consistency of the JSON structure and category labels versus a bare instruction.

**Defensive parsing:** models sometimes ignore "no markdown" instructions and wrap JSON in ` ```json ` fences anyway — `analyze_feedback` strips those with a regex before calling `json.loads()`.

**Graceful degradation (classification only):** if the OpenAI call fails for any reason (invalid key, network issue, rate limit, malformed response), `analyze_feedback` catches the exception and returns one of two hardcoded **randomized mock analyses** (a "Billing/Critical" one or a "UX/Positive" one, `random.choice` between them) rather than propagating an error up to the user. This keeps the ticket-analysis flow demoable even when the API is misbehaving — but it also means a bad API key or an outage can produce fabricated-looking-real data with only a `print()` in the backend console as a clue. Worth knowing about if every ticket in a batch looks suspiciously binary (everything's either Critical or Low, nothing in between) or repeats the same two categories.

**No fallback for summaries (deliberately):** `generate_executive_summary` has no mock fallback — if the API call fails, it returns a plain string describing the error, which the Admin Dashboard renders as-is inside the Executive Insights card. This is intentional: a fabricated executive summary is a much worse failure mode than a fabricated ticket classification (nobody makes a business decision off one ticket, but they might off a summary), so it's designed to fail loudly instead of quietly making something up.

**Period-aware summaries:** `generate_executive_summary(themes, period_label)` interpolates the period straight into the prompt ("recurring themes from *{period_label}*'s tickets"). Early testing surfaced a subtlety here too: passing a vague relative phrase like `"this month"` let the model *invent* a specific (and wrong) month name in its response. The frontend now always computes concrete, self-describing labels instead — `"the past 30 days"`, `"the past 6 months"`, or an explicit `"August 2026"` for the custom-month picker — so there's nothing left for the model to guess at.

## 6. Known Limitations / Things Worth Improving

Being upfront about the current rough edges, in case you extend this further:

- **CORS is wide open** (`allow_origins=["*"]` in `main.py`) — fine for local dev, must be locked down before any real deployment.
- **Admin and user logins are hardcoded** (`config.py`) — a placeholder until real user accounts + a database are added. No sessions/tokens either — `isAuthenticated` is just React state that resets on page reload (dark-mode preference now persists via `localStorage`, but auth deliberately does not).
- **Single-tenant commerce tables** — `Address`, `Order`, and `Profile` have no `user_id` column, because there's only one hardcoded user account. Multi-user support would need that added throughout.
- **No pagination** — `/api/feedbacks` and `/api/user/orders` return every row in one response. Fine for demo-scale data, will need pagination once the tables grow.
- **Sequential LLM calls, no background jobs** — analyzing N tickets (a live submission, or a bulk upload of thousands of rows) takes roughly `N × LLM latency`, blocking the HTTP request the whole time. A large bulk upload will just make the browser wait; there's no progress bar or async job queue.
- **Mock fallback is silent** — if you *think* you're getting real AI classification but the endpoint is actually down, you'll get plausible-looking randomized data with no visible warning in the UI (only a `print()` in the backend console). Executive summaries fail loudly instead (see Section 5) — that asymmetry is intentional, not an oversight.
- **Whole-file-in-memory uploads** — both the photo-attachment feature and the CSV/Excel bulk upload accept files of any size by design, but the implementation reads the entire file into memory at once (base64-in-JSON for photos, `UploadFile.read()` for spreadsheets) rather than streaming to disk. It'll work for anything a demo app is likely to see; a truly massive file (deep into the hundreds of MB / GB range) will just be slow and memory-hungry rather than rejected.
- **Date-based batching is calendar-day-only** — there's no timezone handling; `batch_date` is whatever `datetime.date.today()` resolves to on the server, so a customer submitting right around midnight server time could land in either day's batch. Executive Insights date ranges use the same server-local calendar day as their boundary.
- **Coupon list is hardcoded** — the three codes in `coupon_engine.py` aren't stored in the database or manageable from the admin UI; adding/editing a coupon means editing code.

## 7. Where to Look for Common Changes

| I want to... | Start here |
|---|---|
| Add a new feedback category | `engines/llm_service.py` (`FEW_SHOT_PROMPT`) and `frontend/src/pages/UserPortal.jsx` (`ISSUE_CATEGORIES`) and `engines/recommendation_engine.py` (category matching) |
| Change how risk is scored, or the food-safety floor | `engines/risk_engine.py` |
| Change the recommended actions | `engines/recommendation_engine.py` |
| Change what counts as a manual risk override | `main.py` (`set_risk_level`) and `AdminDashboard.jsx` (`handleSetRiskLevel`, the risk `<select>` in `renderFeedbacksTable`) |
| Add/edit a coupon code, delivery fee, or tax rate | `engines/coupon_engine.py` (single source of truth for both the live preview and the final order) |
| Add a grocery item | `frontend/src/constants.js` (`GROCERY_CATALOG`) |
| Change how tickets get batched (e.g. weekly instead of daily) | `main.py` (`submit_user_feedback`'s `batch_date` logic) and `database.py`'s `_migrate()` orphan-cleanup block |
| Change the bulk-upload column matching | `main.py` (`TEXT_COLUMN_NAMES`, `ORDER_COLUMN_NAMES`, `bulk_upload_feedback`) |
| Change the executive-summary date ranges | `AdminDashboard.jsx` (`computeInsightRange`) |
| Add a new API endpoint | `backend/main.py` |
| Add a new dashboard chart/tab | `frontend/src/pages/AdminDashboard.jsx` (`render*` functions + sidebar `NavItem`s) |
| Add a new User Portal tab | `frontend/src/pages/UserPortal.jsx` (`render*` functions + sidebar `NavItem`s) |
| Change the dark-mode persistence behavior | `frontend/src/useDarkMode.js` |
| Swap AI providers | `backend/.env` only — no code changes needed |
| Replace hardcoded admin/user auth with real accounts | `backend/config.py` + `/api/login` and `/api/user/login` in `main.py`, and a new `User`-style table in `database.py` (would also need `user_id` added to `Address`/`Order`/`Profile`) |
