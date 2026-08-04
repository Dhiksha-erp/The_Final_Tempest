def generate_recommendation(risk_level: str, category: str) -> str:
    risk = (risk_level or "Low").lower()
    cat = (category or "").lower()
    
    if risk == "critical":
        if "spoiled" in cat or "damaged" in cat or "health" in cat:
            return "Issue instant full refund & ₹200 apology coupon. Escalate to Dark Store Manager."
        elif "payment" in cat or "fraud" in cat:
            return "Escalate to Finance VP instantly. Issue full refund and investigate transaction."
        else:
            return "Immediate human intervention required. Call customer directly."
    elif risk == "high":
        if "missing" in cat or "item" in cat:
            return "Refund missing item value automatically. Flag packer for QA check."
        elif "rude" in cat or "partner" in cat:
            return "Suspend delivery partner temporarily pending investigation."
        elif "delay" in cat:
            return "Issue automated apology and ₹50 delay coupon to wallet."
        else:
            return "Escalate to Tier 2 Support. Respond within 2 hours."
    elif risk == "medium":
        if "delay" in cat:
            return "Send automated apology SMS for slight delay."
        else:
            return "Standard ticket queue. Respond within 24 hours."
    else:
        return "No immediate action required. Log for weekly review."
