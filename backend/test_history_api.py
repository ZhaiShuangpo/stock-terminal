import asyncio
from main import history_stock
import json

async def test():
    data = await history_stock("sh600519", "day")
    print(json.dumps(data, indent=2, ensure_ascii=False)[:500])
    print("...")

asyncio.run(test())
