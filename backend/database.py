import json
from sqlalchemy import create_engine, Column, String, Integer, Float, Boolean, Text
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
    uploaded_at = Column(String, nullable=False, default=lambda: datetime.datetime.now().isoformat())

class FeedbackRecord(Base):
    __tablename__ = "feedbacks"

    id = Column(String, primary_key=True, index=True)
    batch_id = Column(String, nullable=True) # Foreign key equivalent to UploadBatch.id
    text = Column(Text, nullable=False)
    
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
    
    def get_themes_list(self):
        try:
            return json.loads(self.themes) if self.themes else []
        except:
            return []

# Create all tables on import
Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
