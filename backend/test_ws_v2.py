import asyncio
import websockets
import json

async def test():
    async with websockets.connect("ws://localhost:8000/ws/market") as ws:
        await ws.send(json.dumps({"type": "subscribe", "symbols": ["sh600519"]}))
        msg = await ws.recv()
        data = json.loads(msg)
        if data.get("type") == "ping": # skip ping
             msg = await ws.recv()
             data = json.loads(msg)
        print(json.dumps(data, indent=2, ensure_ascii=False)[:500])

asyncio.run(test())
