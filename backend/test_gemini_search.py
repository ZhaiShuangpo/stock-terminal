import asyncio
from google import genai
from google.genai import types
import os

async def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("No GEMINI_API_KEY")
        return
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents='贵州茅台今天股票走势和最新新闻是什么？',
        config=types.GenerateContentConfig(
            tools=[{"google_search": {}}],
        )
    )
    print(response.text)

asyncio.run(main())
