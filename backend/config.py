import os
from dotenv import load_dotenv

load_dotenv()

AI_BASE_URL = os.getenv("AI_BASE_URL", "https://api.openai.com/v1")
AI_API_KEY = os.getenv("AI_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "gpt-4o")

# Hardcoded Admin Credentials (temporary until DB-backed auth is added)
# CHANGE THESE to your own admin id/password.
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin123"
