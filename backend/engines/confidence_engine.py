def calculate_confidence(llm_output: dict) -> float:
    score = 100.0
    
    # Penalize if missing key fields
    if not llm_output.get("category") or llm_output.get("category") == "Error":
        score -= 50.0
    if not llm_output.get("sentiment"):
        score -= 20.0
    if not llm_output.get("urgency"):
        score -= 10.0
        
    # Penalize generic categories
    category = llm_output.get("category", "").lower()
    if category in ["other", "misc", "miscellaneous"]:
        score -= 15.0
        
    # Ensure score is within bounds
    return max(0.0, min(100.0, score))
