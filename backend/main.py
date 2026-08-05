from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session
import json
import uuid
import datetime
import io
import pandas as pd


# Import Database
from database import SessionLocal, FeedbackRecord, UploadBatch, Address, Order, Profile, get_db

# Import Engines
from engines.llm_service import generate_executive_summary
from engines.coupon_engine import list_coupons, compute_order_totals
from engines.recommendation_engine import generate_recommendation

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
    image_data: Optional[str] = None

class AddressInput(BaseModel):
    label: str
    full_name: str
    phone: str
    line1: str
    line2: Optional[str] = None
    city: str
    state: str
    pincode: str
    is_default: bool = False

class OrderItemInput(BaseModel):
    name: str
    weight: str
    cost: float
    qty: int

class OrderInput(BaseModel):
    address_id: Optional[str] = None
    items: List[OrderItemInput]
    coupon_code: Optional[str] = None

class OrderPreviewInput(BaseModel):
    items: List[OrderItemInput]
    coupon_code: Optional[str] = None

class ProfileInput(BaseModel):
    full_name: str
    email: str
    phone: str

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
async def submit_user_feedback(payload: SingleFeedbackInput, db: Session = Depends(get_db)):
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
            status="Analyzed"
        )
        db.add(batch)
        db.flush()

    next_ticket_no = (db.query(func.max(FeedbackRecord.ticket_no)).scalar() or 0) + 1
    record = FeedbackRecord(id=str(uuid.uuid4()), ticket_no=next_ticket_no, batch_id=batch.id, text=text, image_data=payload.image_data)
    db.add(record)
    db.flush()

    # Analyze immediately so the admin dashboard never shows an unanalyzed ticket.
    await run_pipeline(db, [record])
    db.commit()

    return {"ticket_id": ticket_id_for(record), "batch_date": today_str}

def address_out(a: Address) -> dict:
    return {
        "id": a.id, "label": a.label, "full_name": a.full_name, "phone": a.phone,
        "line1": a.line1, "line2": a.line2, "city": a.city, "state": a.state,
        "pincode": a.pincode, "is_default": a.is_default
    }

@app.get("/api/user/addresses")
def list_addresses(db: Session = Depends(get_db)):
    addresses = db.query(Address).order_by(Address.is_default.desc()).all()
    return {"data": [address_out(a) for a in addresses]}

@app.post("/api/user/addresses")
def create_address(payload: AddressInput, db: Session = Depends(get_db)):
    if payload.is_default:
        db.query(Address).update({Address.is_default: False})
    address = Address(id=str(uuid.uuid4()), **payload.dict())
    db.add(address)
    db.commit()
    return {"data": address_out(address)}

@app.put("/api/user/addresses/{address_id}")
def update_address(address_id: str, payload: AddressInput, db: Session = Depends(get_db)):
    address = db.query(Address).filter(Address.id == address_id).first()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")
    if payload.is_default:
        db.query(Address).update({Address.is_default: False})
    for key, value in payload.dict().items():
        setattr(address, key, value)
    db.commit()
    return {"data": address_out(address)}

@app.delete("/api/user/addresses/{address_id}")
def delete_address(address_id: str, db: Session = Depends(get_db)):
    address = db.query(Address).filter(Address.id == address_id).first()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")
    db.delete(address)
    db.commit()
    return {"success": True}

def order_id_for(order: Order) -> str:
    return f"ORD-{order.order_no:05d}"

def order_out(order: Order) -> dict:
    return {
        "id": order.id,
        "order_id": order_id_for(order),
        "address_id": order.address_id,
        "items": order.get_items_list(),
        "coupon_code": order.coupon_code,
        "subtotal": order.subtotal,
        "discount": order.discount,
        "delivery_fee": order.delivery_fee,
        "tax": order.tax,
        "total": order.total,
        "status": order.status,
        "placed_at": order.placed_at
    }

@app.get("/api/user/orders")
def list_orders(db: Session = Depends(get_db)):
    orders = db.query(Order).order_by(Order.placed_at.desc()).all()
    return {"data": [order_out(o) for o in orders]}

@app.get("/api/coupons")
def get_coupons():
    return {"data": list_coupons()}

@app.post("/api/user/orders/preview")
def preview_order(payload: OrderPreviewInput):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item")
    subtotal = sum(item.cost * item.qty for item in payload.items)
    totals = compute_order_totals(subtotal, payload.coupon_code)
    return {"data": {"subtotal": round(subtotal, 2), **totals}}

@app.post("/api/user/orders")
def place_order(payload: OrderInput, db: Session = Depends(get_db)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item")
    if not payload.address_id:
        raise HTTPException(status_code=400, detail="A delivery address is required to place an order")
    if not db.query(Address).filter(Address.id == payload.address_id).first():
        raise HTTPException(status_code=404, detail="Selected address not found")

    subtotal = sum(item.cost * item.qty for item in payload.items)
    totals = compute_order_totals(subtotal, payload.coupon_code)
    if totals["error"]:
        raise HTTPException(status_code=400, detail=totals["error"])

    next_order_no = (db.query(func.max(Order.order_no)).scalar() or 0) + 1
    order = Order(
        id=str(uuid.uuid4()),
        order_no=next_order_no,
        address_id=payload.address_id,
        items=json.dumps([item.dict() for item in payload.items]),
        coupon_code=payload.coupon_code.upper() if payload.coupon_code else None,
        subtotal=round(subtotal, 2),
        discount=totals["discount"],
        delivery_fee=totals["delivery_fee"],
        tax=totals["tax"],
        total=totals["total"],
        status="Placed"
    )
    db.add(order)
    db.commit()
    return {"data": order_out(order)}

@app.get("/api/user/profile")
def get_profile(db: Session = Depends(get_db)):
    profile = db.query(Profile).filter(Profile.id == "default").first()
    if not profile:
        profile = Profile(id="default", full_name="Guest User", email="", phone="")
        db.add(profile)
        db.commit()
    return {"data": {"full_name": profile.full_name, "email": profile.email, "phone": profile.phone}}

@app.put("/api/user/profile")
def update_profile(payload: ProfileInput, db: Session = Depends(get_db)):
    profile = db.query(Profile).filter(Profile.id == "default").first()
    if not profile:
        profile = Profile(id="default")
        db.add(profile)
    profile.full_name = payload.full_name
    profile.email = payload.email
    profile.phone = payload.phone
    db.commit()
    return {"data": {"full_name": profile.full_name, "email": profile.email, "phone": profile.phone}}

@app.get("/api/feedbacks")
def get_feedbacks(db: Session = Depends(get_db)):
    records = db.query(FeedbackRecord).all()
    batch_dates = {b.id: b.batch_date for b in db.query(UploadBatch).all()}
    results = []
    for r in records:
        results.append({
            "id": r.id,
            "ticket_id": ticket_id_for(r),
            "batch_id": r.batch_id,
            "date": batch_dates.get(r.batch_id),
            "text": r.text,
            "image_data": r.image_data,
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
            "risk_override": r.risk_override,
            "recommendation": r.recommendation
        })
    return {"data": results}

VALID_RISK_LEVELS = {"Critical", "High", "Medium", "Low"}

class RiskLevelInput(BaseModel):
    risk_level: str

@app.put("/api/feedbacks/{feedback_id}/risk-level")
def set_risk_level(feedback_id: str, payload: RiskLevelInput, db: Session = Depends(get_db)):
    if payload.risk_level not in VALID_RISK_LEVELS:
        raise HTTPException(status_code=400, detail=f"risk_level must be one of {sorted(VALID_RISK_LEVELS)}")

    record = db.query(FeedbackRecord).filter(FeedbackRecord.id == feedback_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Feedback not found")

    record.risk_level = payload.risk_level
    record.risk_override = True
    record.recommendation = generate_recommendation(payload.risk_level, record.category)
    db.commit()

    return {
        "id": record.id,
        "risk_level": record.risk_level,
        "risk_override": record.risk_override,
        "recommendation": record.recommendation
    }

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

TEXT_COLUMN_NAMES = {"text", "feedback", "message", "comment", "review"}
ORDER_COLUMN_NAMES = {"order_id", "order id", "order"}

@app.post("/api/admin/bulk-upload")
async def bulk_upload_feedback(file: UploadFile = File(...), db: Session = Depends(get_db)):
    filename = (file.filename or "").lower()
    contents = await file.read()

    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents))
        elif filename.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(contents))
        else:
            raise HTTPException(status_code=400, detail="Please upload a .csv, .xlsx, or .xls file")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read this file: {e}")

    text_col = next((c for c in df.columns if str(c).strip().lower() in TEXT_COLUMN_NAMES), None)
    if not text_col:
        raise HTTPException(
            status_code=400,
            detail="No feedback text column found. Include a column named 'text', 'feedback', 'message', or 'comment'."
        )
    order_col = next((c for c in df.columns if str(c).strip().lower() in ORDER_COLUMN_NAMES), None)

    today_str = datetime.date.today().isoformat()
    batch = db.query(UploadBatch).filter(UploadBatch.batch_date == today_str).first()
    if not batch:
        batch = UploadBatch(id=str(uuid.uuid4()), filename=f"Batch - {today_str}", batch_date=today_str, status="Analyzed")
        db.add(batch)
        db.flush()

    next_ticket_no = db.query(func.max(FeedbackRecord.ticket_no)).scalar() or 0
    new_records = []
    skipped = 0

    for _, row in df.iterrows():
        raw_text = row.get(text_col)
        if pd.isna(raw_text) or not str(raw_text).strip():
            skipped += 1
            continue
        text = str(raw_text).strip()

        if order_col is not None:
            order_val = row.get(order_col)
            if not pd.isna(order_val) and str(order_val).strip():
                text = f"[Order {str(order_val).strip()}] {text}"

        next_ticket_no += 1
        record = FeedbackRecord(id=str(uuid.uuid4()), ticket_no=next_ticket_no, batch_id=batch.id, text=text)
        db.add(record)
        new_records.append(record)

    if not new_records:
        raise HTTPException(status_code=400, detail="No usable feedback rows found in this file.")

    db.flush()
    await run_pipeline(db, new_records)
    db.commit()

    return {"imported": len(new_records), "skipped": skipped, "batch_id": batch.id}

class SummaryRangeInput(BaseModel):
    start_date: str # ISO date (YYYY-MM-DD), inclusive
    end_date: str # ISO date (YYYY-MM-DD), inclusive
    period_label: str = "the past 7 days" # e.g. "today", "the past 7 days", "August 2026"

@app.post("/api/generate-summary")
async def generate_summary(payload: SummaryRangeInput, db: Session = Depends(get_db)):
    records = (
        db.query(FeedbackRecord)
        .join(UploadBatch, FeedbackRecord.batch_id == UploadBatch.id)
        .filter(UploadBatch.batch_date >= payload.start_date, UploadBatch.batch_date <= payload.end_date)
        .all()
    )
    if not records:
        return {"summary": "No feedback was submitted in this period yet.", "feedback_count": 0, "keywords": []}

    themes = []
    keywords_seen = set()
    keywords = []
    for r in records:
        record_themes = r.get_themes_list()
        themes.extend(record_themes)
        for word in record_themes + ([r.category] if r.category else []):
            if word and word.lower() not in keywords_seen:
                keywords_seen.add(word.lower())
                keywords.append(word)

    summary = await generate_executive_summary(themes[:30], payload.period_label)
    return {"summary": summary, "feedback_count": len(records), "keywords": keywords}
