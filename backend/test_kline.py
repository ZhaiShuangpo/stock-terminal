import asyncio
import httpx
import json

async def test_kline():
    url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,100,qfq"
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        data = response.json()
        print(json.dumps(data, indent=2, ensure_ascii=False)[:1000])

asyncio.run(test_kline())
