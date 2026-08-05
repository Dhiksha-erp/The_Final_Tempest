import json

from database import FeedbackRecord
from engines.llm_service import analyze_feedback
from engines.confidence_engine import calculate_confidence
from engines.risk_engine import compute_risk_score
from engines.recommendation_engine import generate_recommendation


async def run_pipeline(db, records: list[FeedbackRecord]) -> list[dict]:
    """Runs the 4-stage analysis pipeline over existing FeedbackRecord rows,
    updating each one in place, and returns the combined result dicts."""
    results = []

    for record in records:
        llm_output = await analyze_feedback(record.text)

        confidence = calculate_confidence(llm_output)
        risk_score, risk_level = compute_risk_score(
            sentiment=llm_output.get("sentiment"),
            urgency=llm_output.get("urgency"),
            churn_intent=llm_output.get("churn_intent"),
            customer_priority=llm_output.get("customer_priority"),
            category=llm_output.get("category")
        )
        recommendation = generate_recommendation(risk_level, llm_output.get("category"))

        record.category = llm_output.get("category")
        record.sentiment = llm_output.get("sentiment")
        record.urgency = llm_output.get("urgency")
        record.themes = json.dumps(llm_output.get("themes", []))
        record.churn_intent = llm_output.get("churn_intent")
        record.customer_priority = llm_output.get("customer_priority")
        record.confidence_score = confidence
        record.risk_score = risk_score
        record.risk_level = risk_level
        record.recommendation = recommendation

        results.append({
            "id": record.id,
            "batch_id": record.batch_id,
            "text": record.text,
            "analysis": llm_output,
            "confidence_score": confidence,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "recommendation": recommendation
        })

    return results
