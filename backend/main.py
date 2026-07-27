from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from sqlalchemy.orm import Session
import json
import uuid

# Import Database
from database import SessionLocal, FeedbackRecord, UploadBatch, get_db

# Import Engines
from engines.llm_service import analyze_feedback, generate_executive_summary
from engines.confidence_engine import calculate_confidence
from engines.risk_engine import compute_risk_score
from engines.recommendation_engine import generate_recommendation

# Import Config
from config import ADMIN_USERNAME, ADMIN_PASSWORD

app = FastAPI(title="The Final Tempest - Risk Engine API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class FeedbackInput(BaseModel):
    id: str
    text: str

class BatchAnalyzeRequest(BaseModel):
    filename: str
    feedbacks: List[FeedbackInput]

class LoginRequest(BaseModel):
    username: str
    password: str

@app.get("/api/health")
def health_check():
    return {"status": "healthy"}

@app.post("/api/login")
def login(payload: LoginRequest):
    if payload.username == ADMIN_USERNAME and payload.password == ADMIN_PASSWORD:
        return {"success": True}
    raise HTTPException(status_code=401, detail="Invalid admin id or password")

@app.post("/api/batch-analyze")
async def analyze_batch(payload: BatchAnalyzeRequest, db: Session = Depends(get_db)):
    batch_id = str(uuid.uuid4())
    
    # Create batch record
    new_batch = UploadBatch(id=batch_id, filename=payload.filename)
    db.add(new_batch)
    db.commit()

    results = []
    for item in payload.feedbacks:
        if not item.text.strip():
            continue
        
        # 1. LLM Service
        llm_output = await analyze_feedback(item.text)
        
        # 2. Confidence Engine
        confidence = calculate_confidence(llm_output)
        
        # 3. Risk Engine
        risk_score, risk_level = compute_risk_score(
            sentiment=llm_output.get("sentiment"),
            urgency=llm_output.get("urgency"),
            churn_intent=llm_output.get("churn_intent"),
            customer_priority=llm_output.get("customer_priority")
        )
        
        # 4. Recommendation Engine
        recommendation = generate_recommendation(risk_level, llm_output.get("category"))
        
        # Combine Result
        res_dict = {
            "id": item.id,
            "batch_id": batch_id,
            "text": item.text,
            "analysis": llm_output,
            "confidence_score": confidence,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "recommendation": recommendation
        }
        results.append(res_dict)
        
        # Save to DB
        db_record = FeedbackRecord(
            id=item.id,
            batch_id=batch_id,
            text=item.text,
            category=llm_output.get("category"),
            sentiment=llm_output.get("sentiment"),
            urgency=llm_output.get("urgency"),
            themes=json.dumps(llm_output.get("themes", [])),
            churn_intent=llm_output.get("churn_intent"),
            customer_priority=llm_output.get("customer_priority"),
            confidence_score=confidence,
            risk_score=risk_score,
            risk_level=risk_level,
            recommendation=recommendation
        )
        db.merge(db_record)
        
    db.commit()
    return {"data": results, "batch_id": batch_id}

@app.get("/api/feedbacks")
def get_feedbacks(db: Session = Depends(get_db)):
    records = db.query(FeedbackRecord).all()
    results = []
    for r in records:
        results.append({
            "id": r.id,
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
        # Get count of feedbacks for this batch
        count = db.query(FeedbackRecord).filter(FeedbackRecord.batch_id == b.id).count()
        results.append({
            "id": b.id,
            "filename": b.filename,
            "uploaded_at": b.uploaded_at,
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
