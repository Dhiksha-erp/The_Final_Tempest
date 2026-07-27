def compute_risk_score(sentiment: str, urgency: int, churn_intent: bool, customer_priority: str) -> tuple[int, str]:
    score = 0
    
    # Sentiment Weight (0 - 30)
    sentiment_lower = (sentiment or "").lower()
    if sentiment_lower == "negative":
        score += 30
    elif sentiment_lower == "neutral":
        score += 10
        
    # Urgency Weight (0 - 30)
    try:
        urgency_val = int(urgency)
    except:
        urgency_val = 1
    score += (urgency_val / 5.0) * 30
    
    # Churn Intent Weight (0 - 20)
    if churn_intent:
        score += 20
        
    # Customer Priority Weight (0 - 20)
    priority_lower = (customer_priority or "").lower()
    if "tier 1" in priority_lower or "enterprise" in priority_lower or "vip" in priority_lower:
        score += 20
    elif "tier 2" in priority_lower:
        score += 10
        
    # Map to Risk Level
    if score >= 80:
        level = "Critical"
    elif score >= 60:
        level = "High"
    elif score >= 35:
        level = "Medium"
    else:
        level = "Low"
        
    return int(score), level
