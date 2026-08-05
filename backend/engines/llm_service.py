import json
import re
from openai import AsyncOpenAI
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import AI_BASE_URL, AI_API_KEY, AI_MODEL

client = AsyncOpenAI(
    base_url=AI_BASE_URL,
    api_key=AI_API_KEY,
    max_retries=0,
    timeout=60.0
)

FEW_SHOT_PROMPT = """
You are a Voice of Customer (VoC) AI for a 10-minute grocery delivery app (Quick-Commerce).
Analyze the customer feedback and extract:
1. "category" (e.g., Delivery Delay, Missing Item, Spoiled/Damaged Goods, App/Payment Issue, Rude Partner, Praise).
2. "sentiment" (Positive, Neutral, Negative).
3. "themes" (A list of 1-3 specific recurring keywords/themes).
4. "urgency" (1 to 5, where 5 is highest urgency like expired food or stolen orders).
5. "churn_intent" (boolean: true if the user implies they want to leave or uninstall).
6. "customer_priority" (String: "Tier 1" for severe health hazard/fraud, "Tier 2" for missing items/delays, "Tier 3" for UI/minor issues).

You MUST respond in valid JSON format ONLY. Do not wrap it in markdown block.

Examples:
Input: "The milk was completely sour and expired 3 days ago! Unacceptable."
Output: {"category": "Spoiled/Damaged Goods", "sentiment": "Negative", "themes": ["Expired Food", "Health Hazard"], "urgency": 5, "churn_intent": true, "customer_priority": "Tier 1"}

Input: "Got my order in 8 mins. Missing a chocolate bar but fast delivery."
Output: {"category": "Missing Item", "sentiment": "Neutral", "themes": ["Fast Delivery", "Missing Chocolate"], "urgency": 2, "churn_intent": false, "customer_priority": "Tier 2"}
"""

async def analyze_feedback(text: str) -> dict:
    try:
        response = await client.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": FEW_SHOT_PROMPT},
                {"role": "user", "content": f'Input: "{text}"\nOutput:'}
            ],
            temperature=0.0
        )
        content = response.choices[0].message.content.strip()
        
        # Clean up markdown formatting if the model still outputs it
        content = re.sub(r'```json\s*', '', content)
        content = re.sub(r'```\s*', '', content)
        
        return json.loads(content)
    except Exception as e:
        print(f"API Error (using rich mock fallback): {e}")
        import random
        is_critical = random.choice([True, False])
        if is_critical:
            return {
                "category": "Billing",
                "sentiment": "Negative",
                "themes": ["Double Charge", "Overcharge"],
                "urgency": 5,
                "churn_intent": True,
                "customer_priority": "Tier 1"
            }
        else:
            return {
                "category": "UX/UI",
                "sentiment": "Positive",
                "themes": ["Dark Mode", "Great Design"],
                "urgency": 1,
                "churn_intent": False,
                "customer_priority": "Tier 2"
            }

async def generate_executive_summary(themes: list, period_label: str = "the past 7 days") -> str:
    try:
        themes_text = ", ".join(themes)
        prompt = f"Write a professional 2-paragraph executive summary for the VP of Customer Experience based on these recurring themes from {period_label}'s tickets: {themes_text}"
        response = await client.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=0.3
        )
        return response.choices[0].message.content
    except Exception as e:
        return f"Unable to generate summary due to API Error: {str(e)}"
