import json
import uuid
from sqlalchemy import create_engine, Column, String, Integer, Float, Boolean, Text, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

SQLALCHEMY_DATABASE_URL = "sqlite:///./tempest.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

import datetime

class UploadBatch(Base):
    __tablename__ = "upload_batches"

    id = Column(String, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    batch_no = Column(Integer, index=True) # Legacy display sequence ("Batch #1", ...), superseded by batch_date
    batch_date = Column(String, index=True) # ISO date (YYYY-MM-DD) all feedback from that day rolls into
    uploaded_at = Column(String, nullable=False, default=lambda: datetime.datetime.now().isoformat())
    status = Column(String, nullable=False, default="Pending") # "Pending" or "Analyzed"

class FeedbackRecord(Base):
    __tablename__ = "feedbacks"

    id = Column(String, primary_key=True, index=True)
    batch_id = Column(String, nullable=True) # Foreign key equivalent to UploadBatch.id
    ticket_no = Column(Integer, index=True) # Auto-incrementing display sequence (TKT-00001, ...)
    text = Column(Text, nullable=False)
    image_data = Column(Text, nullable=True) # Optional base64 data URL of an attached photo
    created_at = Column(String, nullable=True, default=lambda: datetime.datetime.now().isoformat())

    # LLM Extracted Fields
    category = Column(String, nullable=True)
    sentiment = Column(String, nullable=True)
    urgency = Column(Integer, nullable=True)
    themes = Column(String, nullable=True) # Stored as JSON string
    churn_intent = Column(Boolean, nullable=True)
    customer_priority = Column(String, nullable=True)
    
    # Engine Computed Fields
    confidence_score = Column(Float, nullable=True)
    risk_score = Column(Integer, nullable=True)
    risk_level = Column(String, nullable=True)
    recommendation = Column(String, nullable=True)
    risk_override = Column(Boolean, nullable=False, default=False) # True once an admin manually sets the risk level

    def get_themes_list(self):
        try:
            return json.loads(self.themes) if self.themes else []
        except:
            return []

class Address(Base):
    __tablename__ = "addresses"

    id = Column(String, primary_key=True, index=True)
    label = Column(String, nullable=False, default="Home")
    full_name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    line1 = Column(String, nullable=False)
    line2 = Column(String, nullable=True)
    city = Column(String, nullable=False)
    state = Column(String, nullable=False)
    pincode = Column(String, nullable=False)
    is_default = Column(Boolean, nullable=False, default=False)

class Order(Base):
    __tablename__ = "orders"

    id = Column(String, primary_key=True, index=True)
    order_no = Column(Integer, index=True)
    address_id = Column(String, nullable=True)
    items = Column(Text, nullable=False) # Stored as JSON string: [{name, weight, cost, qty}]
    coupon_code = Column(String, nullable=True)
    subtotal = Column(Float, nullable=False, default=0)
    discount = Column(Float, nullable=False, default=0)
    delivery_fee = Column(Float, nullable=False, default=0)
    tax = Column(Float, nullable=False, default=0)
    total = Column(Float, nullable=False) # Grand total: subtotal - discount + delivery_fee + tax
    status = Column(String, nullable=False, default="Placed")
    placed_at = Column(String, nullable=False, default=lambda: datetime.datetime.now().isoformat())

    def get_items_list(self):
        try:
            return json.loads(self.items) if self.items else []
        except:
            return []

class Profile(Base):
    __tablename__ = "profiles"

    id = Column(String, primary_key=True, default="default")
    full_name = Column(String, nullable=False, default="")
    email = Column(String, nullable=False, default="")
    phone = Column(String, nullable=False, default="")

# Create all tables on import
Base.metadata.create_all(bind=engine)

def _migrate():
    """create_all() only creates missing tables, it never alters existing ones.
    This backfills new columns onto a pre-existing tempest.db without losing data."""
    insp = inspect(engine)
    with engine.begin() as conn:
        batch_cols = {c["name"] for c in insp.get_columns("upload_batches")}
        if "status" not in batch_cols:
            conn.execute(text("ALTER TABLE upload_batches ADD COLUMN status VARCHAR DEFAULT 'Analyzed'"))
        if "batch_no" not in batch_cols:
            conn.execute(text("ALTER TABLE upload_batches ADD COLUMN batch_no INTEGER"))
        if "batch_date" not in batch_cols:
            conn.execute(text("ALTER TABLE upload_batches ADD COLUMN batch_date VARCHAR"))

        feedback_cols = {c["name"] for c in insp.get_columns("feedbacks")}
        if "ticket_no" not in feedback_cols:
            conn.execute(text("ALTER TABLE feedbacks ADD COLUMN ticket_no INTEGER"))
        if "image_data" not in feedback_cols:
            conn.execute(text("ALTER TABLE feedbacks ADD COLUMN image_data TEXT"))
        if "created_at" not in feedback_cols:
            conn.execute(text("ALTER TABLE feedbacks ADD COLUMN created_at VARCHAR"))
        if "risk_override" not in feedback_cols:
            conn.execute(text("ALTER TABLE feedbacks ADD COLUMN risk_override BOOLEAN DEFAULT 0"))

        # One-time cleanup: feedback left unassigned by the old count-based
        # pooling logic (superseded by date-based batching) needs a home,
        # or it would sit orphaned forever and never get analyzed.
        orphaned = conn.execute(
            text("SELECT id FROM feedbacks WHERE batch_id IS NULL OR batch_id = ''")
        ).fetchall()
        if orphaned:
            today_str = datetime.date.today().isoformat()
            existing = conn.execute(
                text("SELECT id, status FROM upload_batches WHERE batch_date = :d"),
                {"d": today_str}
            ).fetchone()
            if existing:
                batch_id, status = existing
                if status == "Analyzed":
                    conn.execute(text("UPDATE upload_batches SET status = 'Pending' WHERE id = :id"), {"id": batch_id})
            else:
                batch_id = str(uuid.uuid4())
                conn.execute(
                    text(
                        "INSERT INTO upload_batches (id, filename, batch_date, uploaded_at, status) "
                        "VALUES (:id, :filename, :batch_date, :uploaded_at, 'Pending')"
                    ),
                    {
                        "id": batch_id,
                        "filename": f"Batch - {today_str}",
                        "batch_date": today_str,
                        "uploaded_at": datetime.datetime.now().isoformat()
                    }
                )
            for row in orphaned:
                conn.execute(text("UPDATE feedbacks SET batch_id = :bid WHERE id = :fid"), {"bid": batch_id, "fid": row[0]})

_migrate()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
