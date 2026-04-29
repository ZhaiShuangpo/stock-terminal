# 📈 大A盯盘终端 (Stock Terminal)

## Project Overview
This project is a modern, high-information-density Web stock terminal designed for A-share investors. It utilizes a "Backend Market Engine + Frontend Geek Interaction" architecture to provide real-time market monitoring, AI-driven stock analysis, and discreet usage capabilities.

**Key Technologies & Architecture:**
*   **Backend (`/backend`)**: Built with Python (FastAPI). It handles asynchronous market data fetching (via Tencent/Sina APIs), WebSocket streaming for live updates, and integrates `google-genai` for AI-powered market reviews and individual stock analysis with search grounding (Google Search integration).
*   **Frontend (`/frontend`)**: Built with React 19, TypeScript, Vite, and Tailwind CSS. It features real-time intraday charting (`lightweight-charts`), drag-and-drop customizable watchlists (`@dnd-kit`), and a "Boss Mode" for discreet office usage.

## Building and Running

**Prerequisites:**
*   Python 3.12+ (with `venv` setup in `backend/venv`)
*   Node.js 18+ (for frontend dependencies)

**Quick Start (All Services):**
To launch both the backend (port 8000) and frontend (port 5173) services in the background:
```bash
./start_all.sh
```

**Stopping Services:**
To cleanly terminate the running backend and frontend processes:
```bash
./stop_all.sh
```

**Manual Execution & Debugging:**
*   **Backend:**
    ```bash
    cd backend
    source venv/bin/activate
    python main.py
    ```
*   **Frontend:**
    ```bash
    cd frontend
    npm install
    npm run dev
    ```

**Testing:**
*   **Backend WebSocket Test:** 
    ```bash
    cd backend
    source venv/bin/activate
    python test_ws.py  # or test_ws_v2.py
    ```
*   **Frontend Build Check:** 
    ```bash
    cd frontend
    npm run build
    ```

## Development Conventions
*   **Code Style & Typing:**
    *   The frontend strictly adheres to TypeScript. Linting is enforced via ESLint (`npm run lint`).
    *   The backend utilizes modern Python features, heavily relying on asynchronous programming (`asyncio`, `httpx`, `websockets`) for performance.
*   **Real-time Data Flow:** WebSockets (`/ws/market`) are the primary mechanism for streaming live market data. REST endpoints are reserved for discrete actions (e.g., search, historical data fetching, AI analysis).
*   **AI Integration Principles:** 
    *   The backend leverages the Gemini API (primarily `gemini-2.5-flash` with a robust fallback loop including `gemini-3-flash`, `gemini-3.1-flash-lite`, etc., for high availability).
    *   AI prompts must utilize `google_search` grounding and be injected with real-time market data (price, change percent) to prevent model hallucinations during stock analysis and market reviews.
*   **Privacy & Local Storage:** Sensitive user configurations, including the Gemini API Key and customized watchlist groups, must be persisted locally in the browser's `localStorage`. They should never be transmitted to or stored on a central server.
*   **UI/UX Guidelines:** Adhere to the established dark theme and responsive grid layout. Any new UI components must respect and integrate with the "Boss Mode" functionality (toggled via the `Esc` key), ensuring sensitive financial data can be instantly obfuscated.