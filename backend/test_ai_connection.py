import asyncio
from openai import AsyncOpenAI
from config import AI_BASE_URL, AI_API_KEY, AI_MODEL


async def main():
    print(f"Base URL: {AI_BASE_URL}")
    print(f"Model:    {AI_MODEL}")
    print(f"API Key:  {AI_API_KEY[:8]}...{AI_API_KEY[-4:]}")
    print("Type your question below (or 'exit' to quit).")
    print("-" * 40)

    client = AsyncOpenAI(base_url=AI_BASE_URL, api_key=AI_API_KEY, timeout=30.0)

    while True:
        question = input("\nYou: ").strip()
        if question.lower() in ("exit", "quit"):
            break
        if not question:
            continue

        try:
            response = await client.chat.completions.create(
                model=AI_MODEL,
                messages=[{"role": "user", "content": question}],
            )
            print("GPT:", response.choices[0].message.content)
        except Exception as e:
            print(f"FAILED - {type(e).__name__}: {e}")


if __name__ == "__main__":
    asyncio.run(main())
