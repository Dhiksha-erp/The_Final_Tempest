from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from typing import List
from sqlalchemy import func
from sqlalchemy.orm import Session
import uuid
import datetime

# Import Database
from database import SessionLocal, FeedbackRecord, UploadBatch, get_db

# Import Engines
from engines.llm_service import generate_executive_summary

# Import Shared Pipeline
from services.analysis_pipeline import run_pipeline

# Import Config
from config import ADMIN_USERNAME, ADMIN_PASSWORD, USER_USERNAME, USER_PASSWORD

app = FastAPI(title="The Final Tempest - Risk Engine API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoginRequest(BaseModel):
    username: str
    password: str

class SingleFeedbackInput(BaseModel):
    text: str

def ticket_id_for(record: FeedbackRecord) -> str:
    # Legacy rows (created before ticket_no existed) fall back to their original id.
    return f"TKT-{record.ticket_no:05d}" if record.ticket_no else record.id

def batch_label_for(batch: UploadBatch) -> str:
    if batch.batch_date:
        try:
            parsed = datetime.datetime.strptime(batch.batch_date, "%Y-%m-%d")
            return parsed.strftime("%d %b %Y")
        except ValueError:
            return batch.batch_date
    # Legacy rows (created before batch_date existed) fall back to older naming schemes.
    return f"Batch #{batch.batch_no}" if batch.batch_no else batch.filename

@app.get("/api/health")
def health_check():
    return {"status": "healthy"}

@app.post("/api/login")
def login(payload: LoginRequest):
    if payload.username == ADMIN_USERNAME and payload.password == ADMIN_PASSWORD:
        return {"success": True}
    raise HTTPException(status_code=401, detail="Invalid admin id or password")

@app.post("/api/user/login")
def user_login(payload: LoginRequest):
    if payload.username == USER_USERNAME and payload.password == USER_PASSWORD:
        return {"success": True}
    raise HTTPException(status_code=401, detail="Invalid user id or password")

@app.post("/api/user/submit-feedback")
def submit_user_feedback(payload: SingleFeedbackInput, db: Session = Depends(get_db)):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Feedback text cannot be empty")

    # Every feedback item submitted on the same calendar day rolls into one batch.
    today_str = datetime.date.today().isoformat()
    batch = db.query(UploadBatch).filter(UploadBatch.batch_date == today_str).first()
    if not batch:
        batch = UploadBatch(
            id=str(uuid.uuid4()),
            filename=f"Batch - {today_str}",
            batch_date=today_str,
            status="Pending"
        )
        db.add(batch)
        db.flush()
    elif batch.status == "Analyzed":
        # New feedback arrived after today's batch was already analyzed - reopen it.
        batch.status = "Pending"

    next_ticket_no = (db.query(func.max(FeedbackRecord.ticket_no)).scalar() or 0) + 1
    record = FeedbackRecord(id=str(uuid.uuid4()), ticket_no=next_ticket_no, batch_id=batch.id, text=text)
    db.add(record)
    db.commit()

    return {"ticket_id": ticket_id_for(record), "batch_date": today_str}

@app.post("/api/batches/{batch_id}/analyze")
async def analyze_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.status == "Analyzed":
        raise HTTPException(status_code=400, detail="Batch has already been analyzed")

    # Only unanalyzed records - if this batch was reopened after a same-day
    # top-up, previously analyzed items shouldn't be re-run through the AI.
    records = db.query(FeedbackRecord).filter(
        FeedbackRecord.batch_id == batch_id,
        FeedbackRecord.category.is_(None)
    ).all()
    results = await run_pipeline(db, records) if records else []

    batch.status = "Analyzed"
    db.commit()

    for r in results:
        r["ticket_id"] = ticket_id_for(next(rec for rec in records if rec.id == r["id"]))

    return {"data": results, "batch_id": batch_id}

@app.get("/api/feedbacks")
def get_feedbacks(db: Session = Depends(get_db)):
    records = db.query(FeedbackRecord).all()
    results = []
    for r in records:
        results.append({
            "id": r.id,
            "ticket_id": ticket_id_for(r),
            "batch_id": r.batch_id,
            "text": r.text,
            "analysis": {
                "category": r.category,
                "sentiment": r.sentiment,
                "urgency": r.urgency,
                "themes": r.get_themes_list(),
                "churn_intent": r.churn_intent,
                "customer_priority": r.customer_priority
            },
            "confidence_score": r.confidence_score,
            "risk_score": r.risk_score,
            "risk_level": r.risk_level,
            "recommendation": r.recommendation
        })
    return {"data": results}

@app.get("/api/batches")
def get_batches(db: Session = Depends(get_db)):
    batches = db.query(UploadBatch).order_by(UploadBatch.uploaded_at.desc()).all()
    results = []
    for b in batches:
        count = db.query(FeedbackRecord).filter(FeedbackRecord.batch_id == b.id).count()
        results.append({
            "id": b.id,
            "label": batch_label_for(b),
            "uploaded_at": b.uploaded_at,
            "status": b.status,
            "feedback_count": count
        })

    return {"data": results}

@app.delete("/api/batches/{batch_id}")
def delete_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    db.query(FeedbackRecord).filter(FeedbackRecord.batch_id == batch_id).delete()
    db.delete(batch)
    db.commit()
    return {"success": True}

@app.post("/api/generate-summary")
async def generate_summary(themes: List[str]):
    summary = await generate_executive_summary(themes)
    return {"summary": summary}
