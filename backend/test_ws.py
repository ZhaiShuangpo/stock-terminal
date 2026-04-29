import asyncio
import websockets
import json

async def test():
    async with websockets.connect("ws://localhost:8000/ws/market") as ws:
        await ws.send(json.dumps({"type": "subscribe", "symbols": ["sh600519"]}))
        for _ in range(2):
            msg = await ws.recv()
            print(msg[:200]) # Print first 200 chars

asyncio.run(test())
