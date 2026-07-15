import { lazy, Suspense, useEffect, useState, useMemo, useRef } from 'react';
import { Activity, Settings, Search, X, GripVertical, Folder, File, Files, GitBranch, Play, ChevronDown, ChevronRight } from 'lucide-react';
import { calculateMA, calculateMACD } from './utils/indicators';
import { assessLongTermCandidate, isTacticalCandidate } from './utils/stockSelection';
import { SECTOR_ETF_MAP } from './utils/etfMapping';
import { fetchJson, marketWebSocketUrl } from './services/api';
import type {
  ChartMarker, FundFlow, Group, HistoryPoint, IndexData, IntradayPoint, InvestmentThesis,
  LinePoint, MarketAlert, MarketDataMessage, MarketSentiment, PaperTrade,
  ResonanceMeta, ResonanceStock, SearchResult, SectorData, SectorStockMeta, StockData, ThesisEvaluationResult,
} from './types/domain';
import type { UTCTimestamp } from 'lightweight-charts';

const Chart = lazy(() => import('./components/Chart').then((module) => ({ default: module.Chart })));
const PortfolioCenter = lazy(() => import('./components/PortfolioCenter').then((module) => ({ default: module.PortfolioCenter })));
const ResearchCenter = lazy(() => import('./components/ResearchCenter').then((module) => ({ default: module.ResearchCenter })));
const StrategyLab = lazy(() => import('./components/StrategyLab').then((module) => ({ default: module.StrategyLab })));
const pageFallback = <div className="flex-1 flex items-center justify-center text-gray-500">正在加载模块…</div>;

// Dnd-kit imports
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';

// Sortable Group Component
interface SortableGroupProps {
  group: Group;
  isActive: boolean;
  isBossMode: boolean;
  editingGroupId: string | null;
  editingGroupName: string;
  onClick: () => void;
  onEditStart: (id: string, name: string) => void;
  onEditChange: (val: string) => void;
  onEditBlur: (id: string, val: string) => void;
  onEditKeyDown: (e: React.KeyboardEvent, id: string, val: string) => void;
  onDelete: (id: string) => void;
}

const SortableGroup = ({
  group, isActive, isBossMode, editingGroupId, editingGroupName,
  onClick, onEditStart, onEditChange, onEditBlur, onEditKeyDown, onDelete
}: SortableGroupProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 0,
    position: 'relative' as const,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between px-2 py-2 rounded-md text-left transition-colors group/item ${isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'}`}
    >
      {!isBossMode && group.id !== 'all' && (
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-gray-700 hover:text-gray-400 mr-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
          <GripVertical className="w-3 h-3" />
        </div>
      )}
      {editingGroupId === group.id && !isBossMode ? (
        <input
          type="text"
          value={editingGroupName}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={() => onEditBlur(group.id, editingGroupName)}
          onKeyDown={(e) => onEditKeyDown(e, group.id, editingGroupName)}
          autoFocus
          className="bg-black text-white px-1 py-0.5 text-xs rounded border border-blue-500 w-24 outline-none flex-1"
        />
      ) : (
        <div className="flex-1 flex items-center justify-between truncate cursor-pointer" onClick={onClick}>
          <span className="truncate">{isBossMode ? group.bossName : group.name}</span>
          <span className="text-xs bg-gray-900 px-1.5 rounded text-gray-500 ml-2">{group.symbols.length}</span>
        </div>
      )}

      {!isBossMode && group.id !== 'all' && editingGroupId !== group.id && (
         <div className="hidden group-hover/item:flex items-center space-x-1 ml-2">
            <button onClick={(e) => { e.stopPropagation(); onEditStart(group.id, group.name); }} className="text-gray-500 hover:text-blue-400 text-xs">✎</button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(group.id); }} className="text-gray-500 hover:text-red-400 text-xs">×</button>
         </div>
      )}
    </div>
  );
};

// Sortable Row Component
interface SortableRowProps {
  stock: StockData;
  isSelected: boolean;
  isBossMode: boolean;
  latestAlert?: MarketAlert;
  onClick: () => void;
  getColorClass: (val: number) => string;
  getBgColorClass: (val: number) => string;
  renderSparkline: (trend: number[], change: number) => React.ReactNode;
}

const SortableRow = ({
  stock, isSelected, isBossMode, latestAlert, onClick,
  getColorClass, getBgColorClass, renderSparkline
}: SortableRowProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: stock.symbol });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 0,
    position: 'relative' as const,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid grid-cols-10 gap-4 px-6 py-2 border-b border-gray-900/50 hover:bg-gray-800/50 transition-colors items-center cursor-pointer group ${isSelected ? 'bg-gray-800/60' : ''}`}
      onClick={onClick}
    >
      <div className="col-span-2 flex items-center space-x-2">
        {!isBossMode && (
          <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-gray-700 hover:text-gray-400 p-1 -ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <GripVertical className="w-4 h-4" />
          </div>
        )}
        <div className="flex flex-col">
          <span className="font-medium text-gray-200">{isBossMode ? `SVC-${stock.code.slice(-4)}` : stock.name}</span>
          <span className="text-xs text-gray-500">{stock.code}</span>
        </div>
      </div>
      <div className={`text-right font-mono text-base ${getColorClass(stock.changePercent)}`}>
        {stock.price.toFixed(2)}
      </div>
      <div className="text-right">
        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono font-medium ${getBgColorClass(stock.changePercent)}`}>
          {stock.changePercent > 0 && !isBossMode ? '+' : ''}{stock.changePercent.toFixed(2)}%
        </span>
      </div>
      <div className={`text-right font-mono text-sm ${getColorClass(stock.changePercent)}`}>
        {stock.change > 0 && !isBossMode ? '+' : ''}{stock.change.toFixed(2)}
      </div>
      <div className="text-right text-gray-400 font-mono text-sm">
        {isBossMode ? (stock.volume / 1000).toFixed(0) : (stock.volume / 1000000).toFixed(2)}
      </div>
      <div className="text-right text-gray-400 font-mono text-sm">
        {isBossMode ? (stock.amount / 1000).toFixed(1) : (stock.amount / 100000000).toFixed(2)}
      </div>
      <div className="text-center flex justify-center">
        {renderSparkline(stock.trend, stock.changePercent)}
      </div>
      <div className="col-span-2 text-center">
        {latestAlert && !isBossMode ? (
          <span className={`inline-flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded-full border ${
            latestAlert.type === '急速拉升' ? 'text-red-500 border-red-500/30 bg-red-500/5' : 'text-green-500 border-green-500/30 bg-green-500/5'
          }`}>
            <span className="opacity-60 font-mono">{latestAlert.time.substring(0, 5)}</span>
            <span className="font-bold">{latestAlert.type}</span>
          </span>
        ) : (
          <span className="text-gray-700 text-xs">-</span>
        )}
      </div>
    </div>
  );
};

interface AIAnalysisResult {
  analysis: string;
  longTermStrategy?: string;
  swingStrategy?: string;
  shortTermStrategy?: string;
  support?: number | null;
  resistance?: number | null;
  supportBasis?: string;
  resistanceBasis?: string;
  winRate?: string | null;
  ratingBasis?: string;
  asOf?: string;
  searchStatus?: 'complete' | 'partial' | 'failed';
  directCatalystFound?: boolean;
  confidence?: number;
  modelUsed?: string;
  searchQueries?: string[];
  sources?: Array<{
    title: string;
    url: string;
    publishedAt?: string;
    sourceType?: string;
    keyFact?: string;
  }>;
}

interface MarketReviewResult {
  review: string;
  asOf?: string;
  modelUsed?: string;
  searchStatus?: 'complete' | 'partial' | 'failed';
  searchQueries?: string[];
  sources?: Array<{ title: string; url: string }>;
}

interface NewsSummaryResult {
  summary: string;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'UNCERTAIN';
  factSentiment?: string;
  shortTermImpact?: string;
  pricedInRisk?: string;
  confidence?: number;
  asOf?: string;
  searchStatus?: 'complete' | 'partial' | 'failed';
  modelUsed?: string;
  sources?: Array<{ title: string; url: string; publishedAt?: string; sourceType?: string; keyFact?: string }>;
}

interface BackendHealth {
  status: 'ok' | 'degraded';
  sectorMap?: {
    stockCount: number;
    healthy: boolean;
    minimumHealthyStockCount: number;
    status?: 'initializing' | 'rebuilding' | 'ready' | 'degraded';
    source?: 'eastmoney' | 'sina' | 'local-cache' | null;
    updatedAt?: string | null;
    lastError?: string | null;
  };
}

function readStoredJson<T>(key: string, fallback: T): T {
  const saved = localStorage.getItem(key);
  if (!saved) return fallback;
  try {
    return JSON.parse(saved) as T;
  } catch {
    console.warn(`Ignoring invalid local storage value: ${key}`);
    return fallback;
  }
}

interface VSCodeMockProps {
  stocks: StockData[];
  onClose: () => void;
}

function VSCodeMock({ stocks, onClose }: VSCodeMockProps) {
  const [activeFile, setActiveFile] = useState('config.json');
  const [monitorTick, setMonitorTick] = useState(0);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({
    root: true,
    backend: true,
    src: true,
    components: true
  });

  useEffect(() => {
    const timer = setInterval(() => setMonitorTick(tick => tick + 1), 1500);
    return () => clearInterval(timer);
  }, []);

  const pipelineBandwidth = (8 + (monitorTick % 50) / 10).toFixed(1);
  const packetsProcessed = 400 + (monitorTick * 17) % 200;

  const toggleFolder = (folder: string) => {
    setOpenFolders(prev => ({ ...prev, [folder]: !prev[folder] }));
  };

  const generateConfigJson = () => {
    const configObj = {
      environment: "production",
      services: stocks.map(s => ({
        name: `svc-stock-${s.symbol}`,
        port: Number(s.code) || 8000,
        rate_limit: s.price,
        delta_pct: s.changePercent,
        active: true,
        threads: s.pe && s.pe > 0 ? Math.round(s.pe) : 12,
        memory_mb: s.marketCap && s.marketCap > 0 ? Math.round(s.marketCap * 10) : 1024
      })),
      pipeline: {
        websocket_port: 8000,
        enable_ssl: false,
        timeout_ms: 3000
      }
    };
    return JSON.stringify(configObj, null, 2);
  };

  const highlightJson = (jsonStr: string) => {
    return jsonStr.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'text-blue-400';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'text-yellow-300';
          } else {
            cls = 'text-green-400';
          }
        } else if (/true|false/.test(match)) {
          cls = 'text-orange-400';
        } else if (/null/.test(match)) {
          cls = 'text-purple-400';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  };

  const highlightJs = (code: string) => {
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\b(import|export|default|const|let|var|function|return|if|else|for|while|class|interface|type|from|typeof|new|try|catch|finally|async|await)\b/g, '<span class="text-purple-400">$1</span>')
      .replace(/\b(useState|useEffect|createConnection|setData|setStatus|on|close)\b/g, '<span class="text-blue-400">$1</span>')
      .replace(/(['"`].*?['"`])/g, '<span class="text-green-400">$1</span>')
      .replace(/\b(\d+)\b/g, '<span class="text-orange-400">$1</span>')
      .replace(/(\/\/.*)/g, '<span class="text-gray-500">$1</span>');
  };

  const highlightPy = (code: string) => {
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\b(import|from|def|async|await|try|except|as|print|while|True|False|None|class|return)\b/g, '<span class="text-purple-400">$1</span>')
      .replace(/(@\w+)/g, '<span class="text-yellow-400">$1</span>')
      .replace(/(['"`].*?['"`])/g, '<span class="text-green-400">$1</span>')
      .replace(/#.*/g, '<span class="text-gray-500">$&</span>');
  };

  const mockAppCode = `import React, { useState, useEffect } from 'react';
import { createConnection } from './utils/socket';
import { Chart } from './components/Chart';

export default function App() {
  const [data, setData] = useState([]);
  const [status, setStatus] = useState('disconnected');

  useEffect(() => {
    const conn = createConnection('ws://localhost:8000/ws');
    conn.on('connect', () => setStatus('connected'));
    conn.on('data', (payload) => setData(payload));
    return () => conn.close();
  }, []);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>System Monitor Panel</h1>
        <span className={\`status-dot \${status}\`}>{status}</span>
      </header>
      <main className="app-body">
        <Chart data={data} type="line" />
      </main>
    </div>
  );
}`;

  const mockChartCode = `import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';

export const Chart = ({ data, type = 'line' }) => {
  const chartContainerRef = useRef(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#1e1e1e' } },
      width: 400,
      height: 200
    });
    const series = chart.addAreaSeries();
    series.setData(data);
    return () => chart.remove();
  }, [data]);

  return <div ref={chartContainerRef} className="w-full h-full" />;
};`;

  const mockPyCode = `import asyncio
import time
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
)

@app.websocket("/ws/market")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            # Broadcast pipeline metrics
            metrics = get_system_metrics()
            await websocket.send_json(metrics)
            await asyncio.sleep(2.0)
    except Exception as e:
        print(f"WS error: {e}")
`;

  const mockReadme = `# Stock Terminal Dashboard

Backend: FastAPI python with WebSocket live streaming.
Frontend: React 19 with Tailwind CSS and lightweight-charts.

## Dev Command
\`npm run dev\` to start dev server on port 5173.
`;

  const getEditorContent = () => {
    switch (activeFile) {
      case 'config.json':
        return `<pre class="font-mono text-xs p-4 leading-relaxed">${highlightJson(generateConfigJson())}</pre>`;
      case 'App.tsx':
        return `<pre class="font-mono text-xs p-4 leading-relaxed">${highlightJs(mockAppCode)}</pre>`;
      case 'Chart.tsx':
        return `<pre class="font-mono text-xs p-4 leading-relaxed">${highlightJs(mockChartCode)}</pre>`;
      case 'main.py':
        return `<pre class="font-mono text-xs p-4 leading-relaxed">${highlightPy(mockPyCode)}</pre>`;
      case 'README.md':
        return `<pre class="font-mono text-xs p-4 leading-relaxed text-blue-300">${mockReadme}</pre>`;
      default:
        return `<pre class="font-mono text-xs p-4 leading-relaxed">{\n  "status": "active"\n}</pre>`;
    }
  };

  return (
    <div className="min-h-screen bg-[#1e1e1e] text-[#d4d4d4] flex flex-col select-none font-sans overflow-hidden">
      {/* Title Bar */}
      <div className="h-8 bg-[#1e1e1e] border-b border-[#2d2d2d] flex items-center justify-between px-3 text-xs text-[#8c8c8c]">
        <div className="flex items-center space-x-2">
          <div className="flex space-x-1.5 mr-2">
            <div onClick={onClose} className="w-3 h-3 rounded-full bg-[#ff5f56] flex items-center justify-center cursor-pointer group hover:bg-[#ff5f56]/80">
              <span className="text-[7px] text-[#4c0002] opacity-0 group-hover:opacity-100 font-bold">×</span>
            </div>
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
            <div className="w-3 h-3 rounded-full bg-[#27c93f]"></div>
          </div>
          <span className="truncate">{activeFile} - stock-terminal - Visual Studio Code</span>
        </div>
        <div className="hidden md:flex items-center bg-[#2d2d2d] border border-[#3c3c3c] rounded px-6 py-0.5 text-[#a6a6a6] w-96 justify-center space-x-1.5 cursor-pointer">
          <Search className="w-3 h-3 text-[#a6a6a6]" />
          <span>stock-terminal</span>
        </div>
        <div className="flex items-center space-x-3 text-[10px] md:text-xs">
          <span>Go</span>
          <span>Run</span>
          <span>Terminal</span>
          <span>Help</span>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar */}
        <div className="w-12 bg-[#181818] border-r border-[#2d2d2d] flex flex-col items-center py-2 justify-between">
          <div className="flex flex-col items-center space-y-4 w-full">
            <div className="w-full flex justify-center border-l-2 border-blue-500 py-1 text-white cursor-pointer">
              <Files className="w-6 h-6" />
            </div>
            <div className="text-[#858585] hover:text-white cursor-pointer">
              <Search className="w-6 h-6" />
            </div>
            <div className="text-[#858585] hover:text-white cursor-pointer">
              <GitBranch className="w-6 h-6" />
            </div>
            <div className="text-[#858585] hover:text-white cursor-pointer">
              <Play className="w-6 h-6" />
            </div>
          </div>
          <div className="text-[#858585] hover:text-white cursor-pointer">
            <Settings className="w-5 h-5" />
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-56 bg-[#252526] border-r border-[#2d2d2d] flex flex-col text-xs text-[#cccccc] overflow-auto">
          <div className="p-3 text-[11px] font-bold uppercase tracking-wider text-[#858585]">
            Explorer: STOCK-TERMINAL
          </div>

          <div className="flex-1 flex flex-col py-1">
            <div className="flex items-center px-3 py-1 bg-[#2a2a2b] font-semibold">
              <ChevronDown className="w-3 h-3 mr-1 text-[#858585]" />
              <span className="truncate">STOCK-TERMINAL</span>
            </div>

            <div className="pl-3">
              <div onClick={() => toggleFolder('backend')} className="flex items-center px-3 py-1 hover:bg-[#2a2a2b] cursor-pointer">
                {openFolders.backend ? <ChevronDown className="w-3 h-3 mr-1 text-[#858585]" /> : <ChevronRight className="w-3 h-3 mr-1 text-[#858585]" />}
                <Folder className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
                <span>backend</span>
              </div>
              {openFolders.backend && (
                <div className="pl-6">
                  <div onClick={() => setActiveFile('main.py')} className={`flex items-center px-3 py-1 hover:bg-[#2a2a2b] cursor-pointer ${activeFile === 'main.py' ? 'bg-[#37373d] text-white' : ''}`}>
                    <File className="w-3.5 h-3.5 mr-1.5 text-blue-300" />
                    <span>main.py</span>
                  </div>
                </div>
              )}

              <div onClick={() => toggleFolder('src')} className="flex items-center px-3 py-1 hover:bg-[#2a2a2b] cursor-pointer">
                {openFolders.src ? <ChevronDown className="w-3 h-3 mr-1 text-[#858585]" /> : <ChevronRight className="w-3 h-3 mr-1 text-[#858585]" />}
                <Folder className="w-3.5 h-3.5 mr-1.5 text-yellow-400" />
                <span>src</span>
              </div>
              {openFolders.src && (
                <div className="pl-6">
                  <div onClick={() => toggleFolder('components')} className="flex items-center px-3 py-1 hover:bg-[#2a2a2b] cursor-pointer">
                    {openFolders.components ? <ChevronDown className="w-3 h-3 mr-1 text-[#858585]" /> : <ChevronRight className="w-3 h-3 mr-1 text-[#858585]" />}
                    <Folder className="w-3.5 h-3.5 mr-1.5 text-yellow-400" />
                    <span>components</span>
                  </div>
                  {openFolders.components && (
                    <div className="pl-6">
                      <div onClick={() => setActiveFile('Chart.tsx')} className={`flex items-center px-3 py-1 hover:bg-[#2a2a2b] cursor-pointer ${activeFile === 'Chart.tsx' ? 'bg-[#37373d] text-white' : ''}`}>
                        <File className="w-3.5 h-3.5 mr-1.5 text-blue-300" />
                        <span>Chart.tsx</span>
                      </div>
                    </div>
                  )}

                  <div onClick={() => setActiveFile('App.tsx')} className={`flex items-center px-3 py-1 hover:bg-[#2a2a2b] cursor-pointer ${activeFile === 'App.tsx' ? 'bg-[#37373d] text-white' : ''}`}>
                    <File className="w-3.5 h-3.5 mr-1.5 text-blue-300" />
                    <span>App.tsx</span>
                  </div>
                </div>
              )}

              <div onClick={() => setActiveFile('config.json')} className={`flex items-center px-3 py-1 hover:bg-[#2a2a2b] cursor-pointer ${activeFile === 'config.json' ? 'bg-[#37373d] text-white' : ''}`}>
                <File className="w-3.5 h-3.5 mr-1.5 text-yellow-500" />
                <span>config.json</span>
              </div>
              <div onClick={() => setActiveFile('README.md')} className={`flex items-center px-3 py-1 hover:bg-[#2a2a2b] cursor-pointer ${activeFile === 'README.md' ? 'bg-[#37373d] text-white' : ''}`}>
                <File className="w-3.5 h-3.5 mr-1.5 text-sky-400" />
                <span>README.md</span>
              </div>
            </div>
          </div>
        </div>

        {/* Editor Area */}
        <div className="flex-1 flex flex-col bg-[#1e1e1e] overflow-hidden">
          <div className="h-9 bg-[#2d2d2d] flex items-center border-b border-[#252526] overflow-x-auto text-xs text-[#969696]">
            {['config.json', 'App.tsx', 'main.py', 'README.md', 'Chart.tsx'].includes(activeFile) && (
              <div className="h-full flex items-center bg-[#1e1e1e] text-white border-t border-t-blue-500 px-4 space-x-2 border-r border-[#252526] cursor-pointer">
                <span>{activeFile}</span>
                <span onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-[#969696] hover:text-white text-[10px]">×</span>
              </div>
            )}
            <div className="flex-1"></div>
            <div onClick={onClose} className="px-3 hover:text-white cursor-pointer" title="退出伪装模式">
              <X className="w-4 h-4" />
            </div>
          </div>

          <div className="flex-1 overflow-auto custom-scrollbar relative">
            <div className="absolute top-0 bottom-0 left-0 w-10 bg-[#1e1e1e] border-r border-[#2d2d2d] flex flex-col items-center pt-4 text-[#858585] font-mono text-[11px] select-none leading-relaxed">
              {Array.from({ length: 45 }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <div
              className="pl-14 text-[#d4d4d4]"
              dangerouslySetInnerHTML={{ __html: getEditorContent() }}
            />
          </div>

          <div className="h-44 border-t border-[#2d2d2d] bg-[#1e1e1e] flex flex-col">
            <div className="h-8 bg-[#1e1e1e] border-b border-[#2d2d2d] flex items-center px-4 space-x-4 text-xs font-semibold text-[#969696]">
              <span className="hover:text-white cursor-pointer">PROBLEMS</span>
              <span className="hover:text-white cursor-pointer">OUTPUT</span>
              <span className="hover:text-white cursor-pointer">DEBUG CONSOLE</span>
              <span className="text-white border-b border-b-blue-500 pb-1 cursor-pointer">TERMINAL</span>
            </div>
            <div className="flex-1 p-3 font-mono text-xs text-green-400 overflow-auto bg-[#1e1e1e]">
              <div>[vite] hot module replacement enabled</div>
              <div>[info] dev server running on <span className="text-blue-400 underline">http://localhost:5173/</span></div>
              <div>[info] backend websocket pipeline connected to ws://localhost:8000/ws/market</div>
              <div className="text-gray-400">[data] pipeline bandwidth: {pipelineBandwidth} kb/s</div>
              <div className="text-gray-400">[data] packets processed: {packetsProcessed}</div>
              <div className="text-green-500">[OK] dev server check completed: no errors.</div>
              <div className="text-yellow-400">[warn] deprecated API dependency detected in express mock.</div>
              <div className="text-[#d4d4d4] flex items-center space-x-1.5 mt-1">
                <span>user@stock-terminal % </span>
                <span className="w-1.5 h-3.5 bg-[#d4d4d4] animate-pulse"></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-5 bg-[#007acc] text-white flex items-center justify-between px-3 text-[11px]">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1 hover:bg-[#1f8ad2] px-1 cursor-pointer">
            <GitBranch className="w-3.5 h-3.5" />
            <span>main*</span>
          </div>
          <span>0 ⊗ 0 ⚠</span>
        </div>
        <div className="flex items-center space-x-3">
          <span>TypeScript JSX</span>
          <span>Ln 12, Col 34</span>
          <span>UTF-8</span>
          <span>LF</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [connected, setConnected] = useState(false);
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [latency, setLatency] = useState(0);
  const [isBossMode, setIsBossMode] = useState(false);
  const [bossMonitorTick, setBossMonitorTick] = useState(0);
  const [selectedStock, setSelectedStock] = useState<StockData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');

  useEffect(() => {
    localStorage.setItem('gemini_api_key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    let disposed = false;
    const refreshHealth = async () => {
      try {
        const health = await fetchJson<BackendHealth>('/api/health');
        if (!disposed) setBackendHealth(health);
      } catch {
        if (!disposed) setBackendHealth(null);
      }
    };
    refreshHealth();
    const timer = window.setInterval(refreshHealth, 60_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  const [aiAnalyses, setAiAnalyses] = useState<Record<string, AIAnalysisResult>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<'intraday' | 'day' | 'week' | 'month'>('intraday');
  const [intradayData, setIntradayData] = useState<Array<IntradayPoint | HistoryPoint>>([]);
  const [vwapData, setVwapData] = useState<LinePoint[]>([]);
  const [volumeData, setVolumeData] = useState<LinePoint[]>([]);
  const [ma5Data, setMa5Data] = useState<LinePoint[]>([]);
  const [ma10Data, setMa10Data] = useState<LinePoint[]>([]);
  const [ma20Data, setMa20Data] = useState<LinePoint[]>([]);
  const [ma60Data, setMa60Data] = useState<LinePoint[]>([]);
  const [ma120Data, setMa120Data] = useState<LinePoint[]>([]);
  const [macdData, setMacdData] = useState<{ dif: LinePoint[], dea: LinePoint[], histogram: LinePoint[] } | null>(null);
  const [markers, setMarkers] = useState<ChartMarker[]>([]);
  const [marketReview, setMarketReview] = useState<string>('');
  const [marketReviewMeta, setMarketReviewMeta] = useState<MarketReviewResult | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);

  const [activeTab, setActiveTab] = useState('dashboard');
  const [indices, setIndices] = useState<IndexData[]>([]);
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [resonanceStocks, setResonanceStocks] = useState<ResonanceStock[]>([]);
  const [resonanceMeta, setResonanceMeta] = useState<ResonanceMeta | null>(null);
  const [selectedSector, setSelectedSector] = useState<SectorData | null>(null);
  const [sectorStocks, setSectorStocks] = useState<ResonanceStock[]>([]);
  const [sectorStockMode, setSectorStockMode] = useState<'long_term' | 'all' | 'tactical'>('long_term');
  const [sectorStockMeta, setSectorStockMeta] = useState<SectorStockMeta | null>(null);
  const [sectorStocksLoading, setSectorStocksLoading] = useState(false);
  const [sectorStocksError, setSectorStocksError] = useState('');
  const [alertStream, setAlertStream] = useState<MarketAlert[]>([]);
  const [fundFlow, setFundFlow] = useState<FundFlow | null>(null);
  const [sentiment, setSentiment] = useState<MarketSentiment | null>(null);
  const [newsSummaries, setNewsSummaries] = useState<Record<string, NewsSummaryResult>>({});
  const [isAnalyzingNews, setIsAnalyzingNews] = useState(false);
  const [chartIndicators, setChartIndicators] = useState(() =>
    readStoredJson('chart_indicators', { ma: true, macd: true, volume: true, vp: true })
  );

  useEffect(() => {
    localStorage.setItem('chart_indicators', JSON.stringify(chartIndicators));
  }, [chartIndicators]);

  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>(() => {
    const parsed = readStoredJson<unknown>('paper_trades', []);
    if (!Array.isArray(parsed)) {
      console.warn('Ignoring invalid local storage value: paper_trades');
      return [];
    }
    return parsed.map((trade) => ({ ...(trade as PaperTrade), isEvaluating: false }));
  });

  useEffect(() => {
    localStorage.setItem('paper_trades', JSON.stringify(paperTrades));
  }, [paperTrades]);

  const [investmentTheses, setInvestmentTheses] = useState<InvestmentThesis[]>(() => {
    const parsed = readStoredJson<unknown>('investment_theses', []);
    return Array.isArray(parsed) ? parsed as InvestmentThesis[] : [];
  });

  useEffect(() => {
    localStorage.setItem('investment_theses', JSON.stringify(investmentTheses));
  }, [investmentTheses]);

  const [groups, setGroups] = useState<Group[]>(() => {
    const savedGroups = readStoredJson<unknown>('stock_groups', null);
    if (Array.isArray(savedGroups)) {
      return savedGroups as Group[];
    }
    if (savedGroups !== null) {
      console.warn('Ignoring invalid local storage value: stock_groups');
    }
    return [
      { id: 'all', name: '🔥 全部自选', bossName: 'Task Queue', symbols: ["sh600519", "sz300750", "sh601318", "sz002594", "sh601127", "sh601138", "sz000001", "sh600036"] },
      { id: 'main', name: '⭐ 主线题材', bossName: 'Active Jobs', symbols: ["sh601138", "sh601127"] },
      { id: 'dividend', name: '🛡️ 防守高息', bossName: 'Background', symbols: ["sh600036", "sh601318", "sz000001"] },
      { id: 'etf', name: '📈 宽基ETF', bossName: 'Failed', symbols: ["sh600030"] }
    ];
  });

  const exportResearchData = () => {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      groups,
      paperTrades,
      investmentTheses,
      chartIndicators,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `stock-research-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importResearchData = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result)) as Record<string, unknown>;
        if (payload.schemaVersion !== 1 || !Array.isArray(payload.groups) || !Array.isArray(payload.paperTrades) || !Array.isArray(payload.investmentTheses)) {
          throw new Error('备份结构不兼容');
        }
        if (!window.confirm('导入会覆盖当前自选分组、策略记录和研究卡片，是否继续？')) return;
        setGroups(payload.groups as Group[]);
        setPaperTrades((payload.paperTrades as PaperTrade[]).map((trade) => ({ ...trade, isEvaluating: false })));
        setInvestmentTheses(payload.investmentTheses as InvestmentThesis[]);
        if (payload.chartIndicators && typeof payload.chartIndicators === 'object') setChartIndicators(payload.chartIndicators as typeof chartIndicators);
        window.alert('研究数据已恢复。');
      } catch (error) {
        window.alert(`导入失败：${error instanceof Error ? error.message : '无法解析文件'}`);
      }
    };
    reader.readAsText(file);
  };

  const [activeGroupId, setActiveGroupId] = useState('all');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');

  const handleAddGroup = () => {
    const newGroup: Group = {
      id: `group_${Date.now()}`,
      name: '新建分组',
      bossName: `Worker-${Math.floor(Math.random() * 1000)}`,
      symbols: []
    };
    setGroups([...groups, newGroup]);
    setEditingGroupId(newGroup.id);
    setEditingGroupName(newGroup.name);
  };

  const handleUpdateGroupName = (id: string, newName: string) => {
    if (newName.trim() === '') return;
    setGroups(prev => prev.map(g => g.id === id ? { ...g, name: newName } : g));
    setEditingGroupId(null);
  };

  const handleDeleteGroup = (id: string) => {
    if (id === 'all') return;
    if (window.confirm('确定删除此分组吗？')) {
      setGroups(prev => prev.filter(g => g.id !== id));
      if (activeGroupId === id) setActiveGroupId('all');
    }
  };

  const allSymbols = useMemo(() => {
    const groupSymbols = groups.flatMap(g => g.symbols);
    const activePaperSymbols = paperTrades.filter(t => t.sellPrice === undefined).map(t => t.symbol);
    return Array.from(new Set([...groupSymbols, ...activePaperSymbols]));
  }, [groups, paperTrades]);

  const wsRef = useRef<WebSocket | null>(null);
  const allSymbolsRef = useRef(allSymbols);

  // Dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    allSymbolsRef.current = allSymbols;
    localStorage.setItem('stock_groups', JSON.stringify(groups));
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', symbols: allSymbols }));
    }
  }, [allSymbols, groups]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsBossMode(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isBossMode) return;
    const timer = setInterval(() => setBossMonitorTick(tick => tick + 1), 1500);
    return () => clearInterval(timer);
  }, [isBossMode]);

  useEffect(() => {
    if (!searchQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await fetchJson<{ results: SearchResult[] }>(
          `/api/search?q=${encodeURIComponent(searchQuery)}`,
          { signal: controller.signal },
        );
        setSearchResults(data.results || []);
      } catch (error) {
        if (!controller.signal.aborted) console.error(error);
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  useEffect(() => {
    if (activeTab !== 'sectors') return;
    const controller = new AbortController();
    const fetchSectorDashboard = async () => {
      const [sentimentResult, resonanceResult] = await Promise.allSettled([
        fetchJson<MarketSentiment>('/api/market_sentiment', { signal: controller.signal }),
        fetchJson<{ data: ResonanceStock[]; meta: ResonanceMeta }>('/api/resonance_stocks', { signal: controller.signal }),
      ]);

      if (sentimentResult.status === 'fulfilled' && !controller.signal.aborted) {
        setSentiment(sentimentResult.value);
      }
      if (resonanceResult.status === 'fulfilled' && !controller.signal.aborted) {
        const snapshot = resonanceResult.value;
        if (Array.isArray(snapshot.data)) {
          setResonanceStocks(snapshot.data);
          setResonanceMeta(snapshot.meta || null);
        }
      }
    };
    fetchSectorDashboard();
    const interval = setInterval(fetchSectorDashboard, 60000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [activeTab]);

  useEffect(() => {
    let connectTime = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let reconnectAttempt = 0;

    const connect = () => {
      if (disposed) return;
      connectTime = Date.now();
      const ws = new WebSocket(marketWebSocketUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        reconnectAttempt = 0;
        setConnected(true);
        setLatency(Date.now() - connectTime);
        ws.send(JSON.stringify({ type: 'subscribe', symbols: allSymbolsRef.current }));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as Partial<Omit<MarketDataMessage, 'type'>> & { type?: string; timestamp?: number };
          if (data.type === 'ping' && typeof data.timestamp === 'number') {
            ws.send(JSON.stringify({ type: 'pong' }));
            setLatency(Math.max(0, Date.now() - data.timestamp));
          } else if (data.type === 'market_data' && Array.isArray(data.payload)) {
            if (Array.isArray(data.indices)) setIndices(data.indices);
            if (Array.isArray(data.sectors)) setSectors(data.sectors);
            if (Array.isArray(data.resonanceStocks)) setResonanceStocks(data.resonanceStocks);
            if (data.resonanceMeta) setResonanceMeta(data.resonanceMeta);
            if (Array.isArray(data.alerts) && data.alerts.length > 0) {
              setAlertStream(prev => [...data.alerts!, ...prev].slice(0, 50));
            }
            setStocks(prevStocks => {
              const payload = data.payload as StockData[];
              const newStocksMap = new Map(payload.map(stock => [stock.symbol, stock]));
              return allSymbolsRef.current.map(sym => newStocksMap.get(sym) || prevStocks.find(stock => stock.symbol === sym)).filter(Boolean) as StockData[];
            });
            setSelectedStock(prev => {
              if (!prev) return prev;
              return (data.payload as StockData[]).find(stock => stock.symbol === prev.symbol) || prev;
            });
          }
        } catch (error) {
          console.error('Ignoring malformed market WebSocket message', error);
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (disposed || wsRef.current !== ws) return;
        setConnected(false);
        wsRef.current = null;
        const delay = Math.min(30000, 1000 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, delay + Math.random() * 500);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const getColorClass = (val: number) => {
    if (isBossMode) return 'text-gray-300';
    if (val > 0) return 'text-[var(--color-stock-red)]';
    if (val < 0) return 'text-[var(--color-stock-green)]';
    return 'text-white';
  };

  const getBgColorClass = (val: number) => {
    if (isBossMode) return 'bg-gray-800 text-gray-300';
    if (val > 0) return 'bg-[var(--color-stock-red)]/10 text-[var(--color-stock-red)]';
    if (val < 0) return 'bg-[var(--color-stock-green)]/10 text-[var(--color-stock-green)]';
    return 'bg-gray-800 text-white';
  };

  const renderSparkline = (trend: number[], change: number) => {
    if (!trend || trend.length === 0) return null;
    const max = Math.max(...trend);
    const min = Math.min(...trend);
    const range = max - min || 1;
    const color = isBossMode ? '#8e8e93' : (change > 0 ? '#ff3b30' : change < 0 ? '#34c759' : '#8e8e93');
    return (
      <svg width="60" height="20" viewBox="0 0 60 20" className="inline-block">
        <polyline fill="none" stroke={color} strokeWidth="1.5"
          points={trend.map((val, i) => `${(i / (trend.length - 1)) * 60},${20 - ((val - min) / range) * 20}`).join(' ')}
        />
      </svg>
    );
  };

  const selectedSymbol = selectedStock?.symbol;

  useEffect(() => {
    if (!selectedSymbol) {
      setIntradayData([]);
      setVwapData([]);
      setVolumeData([]);
      setMa5Data([]);
      setMa10Data([]);
      setMa20Data([]);
      setMacdData(null);
      setMarkers([]);
      setFundFlow(null);
      return;
    }
    const symbol = selectedSymbol;
    const controller = new AbortController();
    const fetchData = async () => {
      try {
        if (chartPeriod === 'intraday') {
          const [dataIntraday, dataFund] = await Promise.all([
            fetchJson<{ data: string[]; date?: string }>(`/api/intraday?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal }),
            fetchJson<{ data: FundFlow | null }>(`/api/fundflow?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal }),
          ]);

          if (dataIntraday.data && dataIntraday.date && !controller.signal.aborted) {
            const year = dataIntraday.date.substring(0, 4);
            const month = dataIntraday.date.substring(4, 6);
            const day = dataIntraday.date.substring(6, 8);

            const chartData: IntradayPoint[] = [];
            const vwapPoints: LinePoint[] = [];
            const newMarkers: ChartMarker[] = [];
            let prevCumVol = 0;
            const volWindow: number[] = [];

            dataIntraday.data.forEach((item: string) => {
              const parts = item.split(' ');
              const price = parseFloat(parts[1]);
              const cumVol = parseFloat(parts[2]);
              const cumAmount = parseFloat(parts[3]);

              const hour = parseInt(parts[0].substring(0, 2), 10);
              const minute = parseInt(parts[0].substring(2, 4), 10);
              const time = Math.floor(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), hour, minute) / 1000) as UTCTimestamp;

              chartData.push({ time, value: price });

              if (cumVol > 0) {
                const vwap = cumAmount / (cumVol * 100);
                vwapPoints.push({ time, value: vwap });
              }

              const minVol = cumVol - prevCumVol;
              prevCumVol = cumVol;

              // Volume breakout logic: minVol > 3 * MA(10)
              if (volWindow.length >= 10) {
                const maVol = volWindow.reduce((a, b) => a + b, 0) / volWindow.length;
                if (maVol > 0 && minVol > maVol * 3) {
                  const prevPrice = chartData[chartData.length - 2]?.value || 0;
                  if (price > prevPrice) {
                    newMarkers.push({
                      time,
                      position: 'belowBar',
                      color: '#ff3b30',
                      shape: 'arrowUp',
                      text: 'B',
                      size: 1,
                    });
                  } else if (price < prevPrice) {
                    newMarkers.push({
                      time,
                      position: 'aboveBar',
                      color: '#34c759',
                      shape: 'arrowDown',
                      text: 'S',
                      size: 1,
                    });
                  }
                }
                volWindow.shift();
              }
              volWindow.push(minVol);
            });

            setIntradayData(chartData);
            setVwapData(vwapPoints);
            setMarkers(newMarkers);
          }
          if (dataFund.data && !controller.signal.aborted) {
            setFundFlow(dataFund.data);
          }
        } else {
          // Historical data (day, week, month)
          const dataHistory = await fetchJson<{ data: HistoryPoint[] }>(
            `/api/history?symbol=${encodeURIComponent(symbol)}&period=${chartPeriod}`,
            { signal: controller.signal },
          );
          if (dataHistory.data && !controller.signal.aborted) {
            const rawData = dataHistory.data;
            setIntradayData(rawData);
            setVwapData([]);

            if (rawData.length > 0) {
              const volData = rawData.map(d => ({
                time: d.time,
                value: d.volume,
                color: d.close >= d.open ? 'rgba(255, 59, 48, 0.5)' : 'rgba(52, 199, 89, 0.5)'
              }));
              setVolumeData(volData);
              const ma5 = calculateMA(rawData, 5);
              const ma20 = calculateMA(rawData, 20);
              const ma60 = calculateMA(rawData, 60);
              const ma120 = calculateMA(rawData, 120);
              setMa5Data(ma5);
              setMa10Data(calculateMA(rawData, 10));
              setMa20Data(ma20);
              setMa60Data(ma60);
              setMa120Data(ma120);
              const macdObj = calculateMACD(rawData);
              setMacdData(macdObj);

              // Generate B/S signals: Resonance (MA + MACD) and Divergence (Price vs MACD)
              const histMarkers: ChartMarker[] = [];
              const ma5Dict = new Map(ma5.map(d => [d.time, d.value]));
              const ma20Dict = new Map(ma20.map(d => [d.time, d.value]));
              const difDict = new Map(macdObj.dif.map(d => [d.time, d.value]));
              const deaDict = new Map(macdObj.dea.map(d => [d.time, d.value]));

              let prevMa5: number | null = null;
              let prevMa20: number | null = null;
              let lastDivTimeIdx = 0;

              for (let i = 0; i < rawData.length; i++) {
                const item = rawData[i];
                const currentMa5 = ma5Dict.get(item.time);
                const currentMa20 = ma20Dict.get(item.time);
                const currentDif = difDict.get(item.time);
                const currentDea = deaDict.get(item.time);

                // 1. MACD & MA Resonance Strategy
                if (currentMa5 !== undefined && currentMa20 !== undefined && prevMa5 !== null && prevMa20 !== null && currentDif !== undefined && currentDea !== undefined) {
                  if (prevMa5 <= prevMa20 && currentMa5 > currentMa20) {
                    if (currentDif > currentDea) {
                      histMarkers.push({ time: item.time, position: 'belowBar', color: '#ff2d55', shape: 'arrowUp', text: '强B', size: 2 });
                    } else {
                      histMarkers.push({ time: item.time, position: 'belowBar', color: '#ff3b30', shape: 'arrowUp', text: 'B', size: 1 });
                    }
                  } else if (prevMa5 >= prevMa20 && currentMa5 < currentMa20) {
                    if (currentDif < currentDea) {
                      histMarkers.push({ time: item.time, position: 'aboveBar', color: '#34c759', shape: 'arrowDown', text: '强S', size: 2 });
                    } else {
                      histMarkers.push({ time: item.time, position: 'aboveBar', color: '#30d158', shape: 'arrowDown', text: 'S', size: 1 });
                    }
                  }
                }

                // 2. MACD Divergence Detection (Top/Bottom)
                if (i > 30 && (i - lastDivTimeIdx > 10) && currentDif !== undefined) {
                  let windowHigh = -Infinity;
                  let windowHighDif = -Infinity;
                  let windowLow = Infinity;
                  let windowLowDif = Infinity;

                  // Look back window to find local high/low and their MACD DIF
                  for (let j = i - 20; j < i - 2; j++) {
                     const jItem = rawData[j];
                     const jDif = difDict.get(jItem.time) || 0;
                     if (jItem.high > windowHigh) {
                        windowHigh = jItem.high;
                        windowHighDif = jDif;
                     }
                     if (jItem.low < windowLow) {
                        windowLow = jItem.low;
                        windowLowDif = jDif;
                     }
                  }

                  // Top Divergence: Price hits new high, but MACD DIF is lower
                  if (item.high > windowHigh && currentDif < windowHighDif - 0.02) {
                     histMarkers.push({ time: item.time, position: 'aboveBar', color: '#ff9f0a', shape: 'arrowDown', text: '逃顶', size: 2 });
                     lastDivTimeIdx = i;
                  }
                  // Bottom Divergence: Price hits new low, but MACD DIF is higher
                  else if (item.low < windowLow && currentDif > windowLowDif + 0.02) {
                     histMarkers.push({ time: item.time, position: 'belowBar', color: '#bf5af2', shape: 'arrowUp', text: '抄底', size: 2 });
                     lastDivTimeIdx = i;
                  }
                }

                // 3. Smart Money / Volume Breakout (主力异动)
                if (i > 20) {
                  let sumVol = 0;
                  for (let k = i - 20; k < i; k++) {
                    sumVol += rawData[k].volume;
                  }
                  const avgVol20 = sumVol / 20;
                  if (item.volume > avgVol20 * 3) {
                    if (item.close > item.open && item.close > rawData[i-1].close) {
                      histMarkers.push({ time: item.time, position: 'belowBar', color: '#ffd60a', shape: 'circle', text: '主进', size: 1 });
                    } else if (item.close < item.open && item.close < rawData[i-1].close) {
                      histMarkers.push({ time: item.time, position: 'aboveBar', color: '#32ade6', shape: 'circle', text: '主退', size: 1 });
                    }
                  }
                }

                if (currentMa5 !== undefined) prevMa5 = currentMa5;
                if (currentMa20 !== undefined) prevMa20 = currentMa20;
              }
              setMarkers(histMarkers);
            } else {
              setMarkers([]);
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error("Failed to fetch stock data", error);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [selectedSymbol, chartPeriod]);

  const displayedStocks = useMemo(() => {
    const activeGroup = groups.find(g => g.id === activeGroupId);
    if (!activeGroup) return [];
    return activeGroup.symbols.map(sym => stocks.find(s => s.symbol === sym)).filter(Boolean) as StockData[];
  }, [stocks, groups, activeGroupId]);

  const displayedSectorStocks = useMemo(() => {
    if (sectorStockMode === 'tactical') return sectorStocks.filter(isTacticalCandidate);
    if (sectorStockMode === 'long_term') return sectorStocks.filter((stock) => assessLongTermCandidate(stock).tier !== 'INSUFFICIENT');
    return sectorStocks;
  }, [sectorStocks, sectorStockMode]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setGroups((prevGroups) => {
        return prevGroups.map((group) => {
          if (group.id === activeGroupId) {
            const oldIndex = group.symbols.indexOf(active.id as string);
            const newIndex = group.symbols.indexOf(over.id as string);
            return {
              ...group,
              symbols: arrayMove(group.symbols, oldIndex, newIndex),
            };
          }
          return group;
        });
      });
    }
  };

  const handleGroupDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setGroups((prevGroups) => {
        const oldIndex = prevGroups.findIndex(g => g.id === active.id);
        const newIndex = prevGroups.findIndex(g => g.id === over.id);

        // Prevent moving 'all' group from index 0 if we decide to keep it pinned
        // But for now let's just use arrayMove on everything
        return arrayMove(prevGroups, oldIndex, newIndex);
      });
    }
  };

  const handleGenerateReview = async () => {
    if (!apiKey) {
      setShowSettings(true);
      return;
    }
    setIsReviewing(true);
    setMarketReview('正在汇总指数、市场宽度与板块轮动数据，并联网核验当日驱动...');
    setMarketReviewMeta(null);
    try {
      const data = await fetchJson<MarketReviewResult>('/api/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gemini-Key': apiKey
        },
        body: JSON.stringify({
          indices,
          sectors,
          sentiment,
        })
      });
      setMarketReview(data.review);
      setMarketReviewMeta(data);
    } catch {
      setMarketReview('报告生成失败，请检查网络或 API Key 状态。');
      setMarketReviewMeta(null);
    } finally {
      setIsReviewing(false);
    }
  };

  const loadSectorStocks = async (sec: SectorData, mode: 'long_term' | 'all' | 'tactical') => {
    setSectorStocksLoading(true);
    setSectorStocksError('');
    setSectorStockMeta(null);
    setSectorStocks([]);
    try {
      const requestMode = mode === 'tactical' ? 'tactical' : 'long_term';
      const data = await fetchJson<{ data: ResonanceStock[]; meta: SectorStockMeta }>(`/api/sector/${encodeURIComponent(sec.id)}?mode=${requestMode}`);
      if (Array.isArray(data.data)) {
        const normalized = data.data.map((stock) => ({ ...stock, sectorName: sec.name }));
        normalized.sort(mode === 'long_term'
          ? (a, b) => assessLongTermCandidate(b).score - assessLongTermCandidate(a).score
          : (a, b) => Number(isTacticalCandidate(b)) - Number(isTacticalCandidate(a)) || b.changePercent - a.changePercent);
        setSectorStocks(normalized);
        setSectorStockMeta(data.meta || null);
      }
    } catch (e) {
      console.error("Failed to fetch sector stocks", e);
      setSectorStocksError('板块成分股获取失败，请稍后重试。');
    } finally {
      setSectorStocksLoading(false);
    }
  };

  const handleSectorClick = async (sec: SectorData) => {
    setSelectedSector(sec);
    setSectorStockMode('long_term');
    await loadSectorStocks(sec, 'long_term');
  };

  const syncAiAnalysisToResearch = (stock: StockData, analysis: AIAnalysisResult) => {
    if (!analysis.analysis || ['Gemini 思考中...', '分析失败，请重试', '网络错误，无法连接到分析引擎'].includes(analysis.analysis)) return;
    const existing = investmentTheses.find((thesis) => thesis.symbol === stock.symbol && thesis.status !== 'INVALIDATED');
    const now = Date.now();
    const review = {
      reviewedAt: now,
      status: existing?.status || 'WATCH' as const,
      note: `【AI投资分析证据】\n${analysis.analysis}\n\n【长期策略】\n${analysis.longTermStrategy || '未提供'}`,
      confidence: analysis.confidence,
      sources: analysis.sources,
    };
    if (existing) {
      if (existing.reviewHistory?.some((item) => item.note === review.note)) {
        window.alert('这份AI投资分析已经同步到该研究卡片。');
        setActiveTab('research');
        return;
      }
      setInvestmentTheses((current) => current.map((thesis) => thesis.id === existing.id ? { ...thesis, updatedAt: now, lastReviewedAt: now, reviewHistory: [review, ...(thesis.reviewHistory || [])] } : thesis));
      window.alert('已作为“复核证据”追加到现有研究卡片，不会覆盖长期核心逻辑。');
    } else {
      setInvestmentTheses((current) => [{
        id: `thesis_${now}`, symbol: stock.symbol, name: stock.name, sectorName: stock.sectorName,
        coreThesis: '待人工填写：请基于商业模式、竞争优势与长期盈利能力建立核心逻辑。',
        catalysts: analysis.directCatalystFound ? 'AI投资分析发现待核验催化，详见复核记录与来源。' : 'AI投资分析未确认可验证的直接催化。',
        risks: '待人工补充：AI投资分析不能替代长期风险清单与独立尽调。',
        kpis: '待人工补充：收入、利润、现金流、市场份额等可验证指标。',
        invalidation: '待人工补充：未设置明确证伪条件前保持“观察”状态。',
        horizon: '1Y', status: 'WATCH', conviction: 1, createdAt: now, updatedAt: now, lastReviewedAt: now,
        reviewHistory: [review],
      }, ...current]);
      window.alert('已创建“观察”状态的研究草稿。AI投资分析仅作为复核证据，需人工确认长期逻辑与证伪条件。');
    }
    setActiveTab('research');
  };

  if (isBossMode) {
    return (
      <VSCodeMock
        stocks={stocks}
        onClose={() => setIsBossMode(false)}
      />
    );
  }

  return (
    <div className={`min-h-screen ${isBossMode ? 'bg-gray-950 grayscale' : 'bg-[var(--color-stock-bg)]'} text-white flex flex-col text-sm transition-all duration-300`}>
      <header className="h-12 border-b border-gray-800 flex items-center justify-between px-4 bg-[var(--color-stock-panel)]">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <nav className="flex w-max space-x-1 whitespace-nowrap">
            {[{ id: 'dashboard', name: '投资驾驶舱' }, { id: 'sectors', name: '行业机会' }, { id: 'research', name: '公司研究' }, { id: 'portfolio', name: '组合风险' }, { id: 'paper', name: '策略实验室' }, { id: 'ai', name: '智能复盘' }, { id: 'alerts', name: '战术预警' }].map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1 rounded-md transition-colors ${activeTab === tab.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800/50'}`}>
                {tab.name}
              </button>
            ))}
          </nav>
        </div>
        <div className="ml-3 flex shrink-0 items-center space-x-4 text-gray-400">
          <div className="flex items-center space-x-4 mr-4 hidden lg:flex">
            {indices.map(idx => (
              <div key={idx.code} className="flex flex-col items-center">
                <span className="text-[10px] text-gray-500 uppercase leading-none mb-1">{idx.name}</span>
                <div className="flex items-baseline space-x-1.5">
                  <span className={`text-xs font-mono font-bold ${getColorClass(idx.changePercent)}`}>{idx.price.toFixed(2)}</span>
                  <span className={`text-[10px] font-mono ${getColorClass(idx.changePercent)}`}>{idx.changePercent > 0 ? '+' : ''}{idx.changePercent.toFixed(2)}%</span>
                </div>
              </div>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-1.5" />
            <input type="text" placeholder="代码/拼音 (Cmd+K)" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-md pl-8 pr-3 py-1 text-xs focus:outline-none focus:border-gray-500 w-48 transition-all text-white placeholder-gray-500" />
            {searchQuery && !isBossMode && (
              <div className="absolute top-full mt-1 left-0 w-48 bg-gray-900 border border-gray-700 rounded-md shadow-xl z-50 max-h-64 overflow-y-auto">
                {isSearching ? <div className="px-3 py-2 text-xs text-gray-500">Searching...</div> : searchResults.length > 0 ? searchResults.map(res => (
                  <button key={res.symbol} onClick={() => {
                    setGroups(prev => prev.map(g => (g.id === 'all' || g.id === activeGroupId) ? { ...g, symbols: g.symbols.includes(res.symbol) ? g.symbols : [res.symbol, ...g.symbols] } : g));
                    setStocks(prev => prev.some(s => s.symbol === res.symbol) ? prev : [{ symbol: res.symbol, code: res.code, name: res.name, price: 0, high: 0, low: 0, change: 0, changePercent: 0, volume: 0, amount: 0, trend: [] } as StockData, ...prev]);
                    setSearchQuery('');
                  }} className="w-full text-left px-3 py-2 hover:bg-gray-800 text-xs flex justify-between items-center group transition-colors">
                    <span className="text-gray-300 group-hover:text-white">{res.name}</span>
                    <span className="text-gray-600 group-hover:text-gray-400 font-mono">{res.code}</span>
                  </button>
                )) : <div className="px-3 py-2 text-xs text-gray-500">No results</div>}
              </div>
            )}
          </div>
          <button onClick={() => setShowSettings(true)} className="hover:text-white"><Settings className="w-4 h-4" /></button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {activeTab === 'dashboard' && (
          <aside className="w-48 border-r border-gray-800 bg-[var(--color-stock-panel)] flex flex-col hidden md:flex">
            <div className="p-3 text-xs font-semibold text-gray-500 uppercase tracking-wider flex justify-between items-center">
              <span>分组视图</span>
              {!isBossMode && (
                <button onClick={handleAddGroup} className="hover:text-white transition-colors" title="新建分组">+</button>
              )}
            </div>
            <div className="flex flex-col space-y-0.5 px-2 flex-1 overflow-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleGroupDragEnd}
                modifiers={[restrictToVerticalAxis]}
              >
                <SortableContext
                  items={groups.map(g => g.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {groups.map((group) => (
                    <SortableGroup
                      key={group.id}
                      group={group}
                      isActive={activeGroupId === group.id}
                      isBossMode={isBossMode}
                      editingGroupId={editingGroupId}
                      editingGroupName={editingGroupName}
                      onClick={() => setActiveGroupId(group.id)}
                      onEditStart={(id, name) => { setEditingGroupId(id); setEditingGroupName(name); }}
                      onEditChange={(val) => setEditingGroupName(val)}
                      onEditBlur={(id, val) => handleUpdateGroupName(id, val)}
                      onEditKeyDown={(e, id, val) => e.key === 'Enter' && handleUpdateGroupName(id, val)}
                      onDelete={handleDeleteGroup}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </aside>
        )}

        <section className="flex-1 flex flex-col bg-black overflow-hidden relative">
          {activeTab === 'dashboard' ? (
            <>
              <div className="grid grid-cols-4 gap-3 px-6 py-3 border-b border-gray-800 bg-gray-950/60 text-xs">
                <button onClick={() => setActiveTab('research')} className="text-left bg-gray-900 border border-gray-800 rounded p-2 hover:border-blue-900"><span className="text-gray-500">有效研究逻辑</span><b className="block text-lg text-blue-400">{investmentTheses.filter((thesis) => thesis.status === 'ACTIVE').length}</b></button>
                <button onClick={() => setActiveTab('research')} className="text-left bg-gray-900 border border-gray-800 rounded p-2 hover:border-amber-900"><span className="text-gray-500">待复核/预警</span><b className="block text-lg text-amber-400">{investmentTheses.filter((thesis) => ['WATCH', 'WARNING'].includes(thesis.status)).length}</b></button>
                <button onClick={() => setActiveTab('portfolio')} className="text-left bg-gray-900 border border-gray-800 rounded p-2 hover:border-blue-900"><span className="text-gray-500">模拟持仓</span><b className="block text-lg">{paperTrades.filter((trade) => trade.sellPrice === undefined).length}</b></button>
                <button onClick={() => setActiveTab('portfolio')} className="text-left bg-gray-900 border border-gray-800 rounded p-2 hover:border-red-900"><span className="text-gray-500">无逻辑覆盖持仓</span><b className="block text-lg text-red-400">{paperTrades.filter((trade) => trade.sellPrice === undefined && !trade.thesisId).length}</b></button>
              </div>
              <div className="grid grid-cols-10 gap-4 px-6 py-2 border-b border-gray-800 text-xs font-medium text-[var(--color-stock-muted)] sticky top-0 bg-black z-10">
                <div className="col-span-2">{isBossMode ? 'Task ID' : '名称 / 代码'}</div>
                <div className="text-right">{isBossMode ? 'Value' : '最新价'}</div>
                <div className="text-right">{isBossMode ? 'Ratio' : '涨跌幅'}</div>
                <div className="text-right">{isBossMode ? 'Delta' : '涨跌额'}</div>
                <div className="text-right">{isBossMode ? 'Mem (KB)' : '成交量(万手)'}</div>
                <div className="text-right">{isBossMode ? 'CPU (%)' : '成交额(亿)'}</div>
                <div className="text-center">{isBossMode ? 'Load' : '分时走势'}</div>
                <div className="col-span-2 text-center">{isBossMode ? 'Status' : '最新异动'}</div>
              </div>
              <div className="flex-1 overflow-auto overflow-x-hidden">
                {displayedStocks.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-500">此分组暂无自选股...</div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                    modifiers={[restrictToVerticalAxis]}
                  >
                    <SortableContext
                      items={displayedStocks.map(s => s.symbol)}
                      strategy={verticalListSortingStrategy}
                    >
                      {displayedStocks.map((stock) => (
                        <SortableRow
                          key={stock.symbol}
                          stock={stock}
                          isSelected={selectedStock?.symbol === stock.symbol}
                          isBossMode={isBossMode}
                          latestAlert={alertStream.find(a => a.symbol === stock.symbol)}
                          onClick={() => setSelectedStock(stock)}
                          getColorClass={getColorClass}
                          getBgColorClass={getBgColorClass}
                          renderSparkline={renderSparkline}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            </>
          ) : activeTab === 'sectors' ? (
            <div className="flex-1 flex flex-col p-6 overflow-hidden bg-[var(--color-stock-bg)]">
              {selectedSector ? (
                <>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-4">
                      <button onClick={() => setSelectedSector(null)} className="text-gray-400 hover:text-white flex items-center">
                        <span className="mr-1">←</span> 返回板块列表
                      </button>
                      <h2 className="text-xl font-bold">{selectedSector.name} <span className="text-sm font-normal text-gray-500 ml-2">成分股</span></h2>
                    </div>
                    <div className={`text-xl font-mono font-bold ${getColorClass(selectedSector.changePercent)}`}>
                      {selectedSector.changePercent > 0 ? '+' : ''}{selectedSector.changePercent.toFixed(2)}%
                    </div>
                  </div>

                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/60 p-3">
                    <div className="flex gap-2">
                      {[
                        { id: 'long_term', label: '长期研究候选' },
                        { id: 'all', label: '全部长期样本' },
                        { id: 'tactical', label: '短期战术候选' },
                      ].map((option) => <button key={option.id} onClick={() => { const mode = option.id as 'long_term' | 'all' | 'tactical'; const changesBackendUniverse = (mode === 'tactical') !== (sectorStockMode === 'tactical'); setSectorStockMode(mode); if (changesBackendUniverse) loadSectorStocks(selectedSector, mode); }} className={`px-3 py-1.5 rounded text-xs ${sectorStockMode === option.id ? 'bg-blue-600 text-white' : 'bg-black text-gray-400 hover:text-white'}`}>{option.label}</button>)}
                    </div>
                    <div className="text-[10px] text-gray-500 text-right">
                      <div>{sectorStockMeta?.message || '正在准备板块样本'}</div>
                      {sectorStockMeta?.asOf && <div>数据 {new Date(sectorStockMeta.asOf).toLocaleString('zh-CN')} · 样本 {sectorStockMeta.sampleSize}</div>}
                    </div>
                    {sectorStockMode !== 'tactical' && <div className="w-full border-t border-gray-800 pt-2 text-[10px] text-gray-600">长期评分只使用当前可获得的规模、PE/PB、营收/利润同比和换手数据，不使用“今日涨幅≥2%”作为入选条件；因缺少ROIC、自由现金流、负债结构和历史估值分位，结果仅作为研究队列，不是买入建议。</div>}
                  </div>

                  {/* Sector ETF Mapping Banner */}
                  {(() => {
                    const mappedEtf = SECTOR_ETF_MAP[selectedSector.name];
                    if (mappedEtf) {
                      return (
                        <div className="mb-4 bg-gradient-to-r from-blue-900/30 to-indigo-900/30 border border-blue-800/50 rounded-lg p-4 flex items-center justify-between shadow-lg">
                          <div>
                            <div className="text-blue-400 font-bold mb-1 flex items-center space-x-2">
                              <span>相关行业 ETF 参考</span>
                              <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded border border-blue-500/30">静态映射 · 非投资建议</span>
                            </div>
                            <div className="text-gray-300 text-sm">【{selectedSector.name}】的相关 ETF 映射仅用于进一步研究，需自行核对持仓结构、规模、流动性及跟踪误差。</div>
                          </div>
                          <button
                            onClick={() => {
                               // Quick fetch logic to add ETF to watchlist (mocking the exact price for now as we'd need another API call, but we can set it up for the WebSocket to catch)
                               const newEtf = { symbol: mappedEtf.symbol, code: mappedEtf.symbol.slice(2), name: mappedEtf.name, price: 0, high: 0, low: 0, change: 0, changePercent: 0, volume: 0, amount: 0, trend: [] } as StockData;
                               setStocks(prev => prev.some(s => s.symbol === mappedEtf.symbol) ? prev : [newEtf, ...prev]);
                               setGroups(prev => prev.map(g => g.id === 'all' ? { ...g, symbols: [mappedEtf.symbol, ...g.symbols] } : g));
                               setSelectedStock(newEtf);
                               alert(`已将 ${mappedEtf.name} 加入【全部自选】并打开详情，稍后行情将自动更新。`);
                            }}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded shadow transition-colors"
                          >
                            查看 {mappedEtf.name}
                          </button>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <div className="flex-1 overflow-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pb-10">
                      {sectorStocksLoading ? (
                        <div className="col-span-full text-center text-gray-500 mt-20">正在按“{sectorStockMode === 'tactical' ? '短期战术' : '长期研究'}”口径拉取成分股...</div>
                      ) : sectorStocksError ? (
                        <div className="col-span-full text-center text-red-400 mt-20">{sectorStocksError}</div>
                      ) : displayedSectorStocks.length === 0 ? (
                        <div className="col-span-full text-center text-gray-500 mt-20">当前样本中没有符合该口径的个股；可切换“全部长期样本”查看数据覆盖情况。</div>
                      ) : (
                        displayedSectorStocks.map((stock) => {
                          const pe = stock.pe ?? 0;
                          const pb = stock.pb ?? 0;
                          const assessment = assessLongTermCandidate(stock);
                          const tactical = isTacticalCandidate(stock);
                          const borderClass = sectorStockMode === 'tactical' && tactical ? 'border-yellow-600/50' : assessment.tier === 'CANDIDATE' ? 'border-blue-700/60' : 'border-gray-800';

                          return (
                            <div key={stock.symbol} onClick={() => {
                              const newStock = { symbol: stock.symbol, code: stock.code, name: stock.name, price: stock.price, high: stock.high, low: stock.low, change: stock.change, changePercent: stock.changePercent, volume: stock.volume, amount: stock.amount, pe: stock.pe, pb: stock.pb, marketCap: stock.marketCap, sectorName: selectedSector.name, turnover: stock.turnover, trend: [] } as StockData;
                              setStocks(prev => prev.some(s => s.symbol === stock.symbol) ? prev : [newStock, ...prev]);
                              setSelectedStock(newStock);
                            }} className={`bg-gray-900 border ${borderClass} rounded-lg p-3 flex flex-col justify-between hover:border-gray-600 transition-colors cursor-pointer group relative overflow-hidden`}>
                              {tactical && sectorStockMode === 'tactical' && <div className="absolute top-0 right-0 bg-gradient-to-l from-yellow-600/20 to-transparent w-16 h-full pointer-events-none"></div>}

                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <div className="text-gray-200 font-bold group-hover:text-white transition-colors flex items-center space-x-2">
                                    <span>{stock.name}</span>
                                    {sectorStockMode === 'tactical' ? tactical && <span className="text-[10px] bg-yellow-500/20 text-yellow-500 px-1 py-0.5 rounded border border-yellow-500/30">短期共振</span> : <span className={`text-[10px] px-1 py-0.5 rounded border ${assessment.tier === 'CANDIDATE' ? 'text-blue-400 border-blue-800' : assessment.tier === 'WATCH' ? 'text-purple-400 border-purple-900' : 'text-gray-500 border-gray-800'}`}>{assessment.tier === 'CANDIDATE' ? `长期研究 ${assessment.score}` : assessment.tier === 'WATCH' ? `观察 ${assessment.score}` : '数据不足'}</span>}
                                  </div>
                                  <div className="text-xs text-gray-500 font-mono mt-0.5">{stock.code}</div>
                                </div>
                                <div className="text-right">
                                  <div className={`text-base font-mono font-bold ${getColorClass(stock.changePercent)}`}>{stock.price.toFixed(2)}</div>
                                  <div className={`text-xs font-mono ${getColorClass(stock.changePercent)}`}>{stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%</div>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500 border-t border-gray-800/50 pt-2 mt-1">
                                <span>PE: {pe > 0 ? pe.toFixed(1) : '-'}</span>
                                <span>PB: {pb > 0 ? pb.toFixed(2) : '-'}</span>
                                <span>换手: {stock.turnover > 0 ? `${stock.turnover.toFixed(1)}%` : '-'}</span>
                                <span>市值: {(stock.marketCap || 0).toFixed(0)}亿</span>
                                {typeof stock.netProfitGrowth === 'number' && (
                                  <span className={stock.netProfitGrowth > 0 ? 'text-red-400' : 'text-green-400'}>
                                    利润: {stock.netProfitGrowth > 0 ? '+' : ''}{stock.netProfitGrowth.toFixed(1)}%
                                  </span>
                                )}
                                {typeof stock.revenueGrowth === 'number' && <span className={stock.revenueGrowth > 0 ? 'text-red-400' : 'text-green-400'}>营收: {stock.revenueGrowth > 0 ? '+' : ''}{stock.revenueGrowth.toFixed(1)}%</span>}
                                <span>字段覆盖: {(assessment.coverage * 100).toFixed(0)}%</span>
                                {sectorStockMode === 'tactical' && stock.maBullish && <span className="text-yellow-500/80">均线多头</span>}
                                {sectorStockMode === 'tactical' && stock.pocBreakout && <span className="text-purple-400/80">筹码突破</span>}
                              </div>
                              {sectorStockMode !== 'tactical' && <div className="mt-2 flex flex-wrap gap-1 text-[10px]">{assessment.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-blue-950/30 px-1.5 py-0.5 text-blue-400">{tag}</span>)}{assessment.warnings.slice(0, 2).map((warning) => <span key={warning} className="rounded bg-amber-950/30 px-1.5 py-0.5 text-amber-500">{warning}</span>)}</div>}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold">板块涨跌幅排行榜</h2>
                    <div className="text-xs text-gray-500">数据实时更新</div>
                  </div>

                  {sentiment && (
                    <div className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {/* 1. 涨跌分布 */}
                      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                        <div className="text-xs text-gray-500 mb-2">全市场涨跌分布</div>
                        <div className="flex justify-between items-end mb-2">
                           <div className="text-center">
                              <div className="text-xl font-bold text-[var(--color-stock-red)]">{sentiment.up}</div>
                              <div className="text-[10px] text-gray-500">上涨</div>
                           </div>
                           <div className="text-center">
                              <div className="text-xl font-bold text-[var(--color-stock-green)]">{sentiment.down}</div>
                              <div className="text-[10px] text-gray-500">下跌</div>
                           </div>
                           <div className="text-center">
                              <div className="text-xl font-bold text-gray-400">{sentiment.flat}</div>
                              <div className="text-[10px] text-gray-500">平盘</div>
                           </div>
                        </div>
                        <div className="w-full h-1.5 flex rounded-full overflow-hidden opacity-80">
                           <div className="bg-[var(--color-stock-red)]" style={{ width: `${(sentiment.up / (sentiment.up + sentiment.down + sentiment.flat)) * 100}%` }}></div>
                           <div className="bg-gray-500" style={{ width: `${(sentiment.flat / (sentiment.up + sentiment.down + sentiment.flat)) * 100}%` }}></div>
                           <div className="bg-[var(--color-stock-green)]" style={{ width: `${(sentiment.down / (sentiment.up + sentiment.down + sentiment.flat)) * 100}%` }}></div>
                        </div>
                      </div>

                      {/* 2. 涨跌停与连板表现 */}
                      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col justify-between">
                        <div className="text-xs text-gray-500 mb-1">赚钱效应指标</div>
                        <div className="flex justify-between items-center">
                           <span className="text-gray-400 text-sm">今日涨停 / 跌停</span>
                           <span className="font-bold font-mono text-base"><span className="text-[var(--color-stock-red)]">{sentiment.limitUp}</span> <span className="text-gray-600">/</span> <span className="text-[var(--color-stock-green)]">{sentiment.limitDown}</span></span>
                        </div>
                        <div className="text-[10px] text-gray-600 mt-2 pt-2 border-t border-gray-800/50">不展示当前数据源未可靠提供的昨日涨停收益</div>
                      </div>

                      {/* 3. 两市成交量 */}
                      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col justify-between">
                        <div className="text-xs text-gray-500 mb-1">实时两市成交额</div>
                        <div className="text-2xl font-bold font-mono text-blue-400 mt-1">{sentiment.totalVolume} <span className="text-xs text-gray-500 font-normal">亿</span></div>
                        <div className="text-xs text-gray-400 mt-2 flex items-center space-x-2">
                           <span>由于接口限制，暂不提供缩放量对比</span>
                        </div>
                      </div>

                    </div>
                  )}

                  {/* 左侧埋伏与共振个股推荐看板 */}
                  <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 左侧埋伏板块 */}
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col">
                      <div className="text-sm font-bold text-purple-400 mb-3 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span>长期观察：低位改善板块</span>
                          <span className="text-[10px] text-gray-500 font-normal">（价格修复+资金观察 · 非买入信号）</span>
                        </div>
                      </div>
                      {(() => {
                        const ambushSectors = sectors.filter(sec =>
                          sec.change20d <= -5.0 &&
                          sec.change5d > 0.0 &&
                          sec.change5d < 4.0 &&
                          sec.changePercent >= -1.0 &&
                          sec.volRatio < 0.8 &&
                          sec.fundFlow > 0
                        );
                        if (ambushSectors.length === 0) {
                          return (
                            <div className="flex-1 flex items-center justify-center py-6 text-gray-600 text-xs border border-dashed border-gray-800 rounded-md">
                              当前市场无符合观察条件的板块
                            </div>
                          );
                        }
                        return (
                          <div className="flex flex-wrap gap-2">
                            {ambushSectors.map(sec => (
                              <button
                                key={sec.id}
                                onClick={() => handleSectorClick(sec)}
                                className="bg-purple-950/20 border border-purple-500/30 hover:border-purple-500/80 hover:bg-purple-900/10 px-3 py-1.5 rounded text-xs font-bold text-purple-300 transition-colors flex items-center space-x-2"
                              >
                                <span>{sec.name}</span>
                                <span className="text-[10px] text-purple-400 font-mono bg-purple-500/10 px-1 py-0.2 rounded">{sec.changePercent > 0 ? '+' : ''}{sec.changePercent.toFixed(2)}%</span>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>

                    {/* 共振首选个股 */}
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col">
                      <div className="text-sm font-bold text-yellow-500 mb-3 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span>短期趋势共振候选</span>
                          <span className="text-[10px] text-gray-500 font-normal">（当日样本 · 战术信号，不代表长期价值）</span>
                        </div>
                        {resonanceMeta && (
                          <span
                            className={`text-[10px] font-normal ${resonanceMeta.status === 'ok' ? 'text-gray-500' : 'text-orange-400'}`}
                            title={resonanceMeta.message}
                          >
                            {resonanceMeta.dataTimestamp
                              ? `数据 ${new Date(resonanceMeta.dataTimestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                              : resonanceMeta.message}
                            {resonanceMeta.status === 'partial' ? ' · 部分样本' : ''}
                          </span>
                        )}
                      </div>
                      {resonanceStocks.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center py-6 text-gray-600 text-xs border border-dashed border-gray-800 rounded-md">
                          {resonanceMeta && ['error', 'initializing'].includes(resonanceMeta.status)
                            ? resonanceMeta.message
                            : '当前最新样本无符合共振首选的个股'}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2 overflow-auto max-h-32 pr-1">
                          {resonanceStocks.map(stock => (
                            <button
                              key={stock.symbol}
                              onClick={() => {
                                const newStock = {
                                  symbol: stock.symbol,
                                  code: stock.code,
                                  name: stock.name,
                                  price: stock.price,
                                  high: stock.high,
                                  low: stock.low,
                                  change: stock.change,
                                  changePercent: stock.changePercent,
                                  volume: stock.volume,
                                  amount: stock.amount,
                                  pe: stock.pe,
                                  pb: stock.pb,
                                  marketCap: stock.marketCap,
                                  turnover: stock.turnover,
                                  trend: []
                                } as StockData;
                                setStocks(prev => prev.some(s => s.symbol === stock.symbol) ? prev : [newStock, ...prev]);
                                setSelectedStock(newStock);
                              }}
                              className="bg-yellow-950/20 border border-yellow-500/30 hover:border-yellow-500/80 hover:bg-yellow-900/10 px-3 py-1.5 rounded text-xs font-bold text-yellow-400 transition-colors flex flex-col items-start min-w-[120px]"
                            >
                              <div className="flex justify-between w-full space-x-3 items-center">
                                <span className="text-gray-200">{stock.name}</span>
                                <span className="font-mono text-[10px] text-gray-500">{stock.code}</span>
                              </div>
                              <div className="mt-1 flex items-center space-x-2 text-[10px] text-gray-400 font-mono">
                                <span className={getColorClass(stock.changePercent)}>{stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%</span>
                                <span className="text-gray-600">|</span>
                                <span className="text-purple-400 text-[9px] bg-purple-500/5 px-1 py-0.2 rounded border border-purple-500/10">{stock.sectorName}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-10">
                      {sectors.length === 0 ? (
                        <div className="col-span-full text-center text-gray-500 mt-20">正在拉取板块数据...</div>
                      ) : (
                        sectors.sort((a, b) => b.changePercent - a.changePercent).map((sec, idx) => {
                          const isAmbushSector =
                            sec.change20d <= -5.0 &&
                            sec.change5d > 0.0 &&
                            sec.change5d < 4.0 &&
                            sec.changePercent >= -1.0 &&
                            sec.volRatio < 0.8 &&
                            sec.fundFlow > 0;
                          const borderClass = isAmbushSector ? 'border-purple-600/50' : 'border-gray-800';

                          return (
                            <div key={sec.name} onClick={() => handleSectorClick(sec)} className={`bg-gray-900 border ${borderClass} rounded-lg p-4 flex flex-col items-center justify-center hover:border-gray-600 transition-colors relative overflow-hidden cursor-pointer`}>
                              {idx < 3 && <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 to-orange-500"></div>}
                              {isAmbushSector && <div className="absolute top-0 right-0 bg-gradient-to-l from-purple-600/20 to-transparent w-16 h-full pointer-events-none"></div>}
                              {isAmbushSector && (
                                <div className="absolute top-2 right-2 bg-purple-500/20 text-purple-400 text-[10px] px-1.5 py-0.5 rounded font-bold border border-purple-500/30 shadow-sm shadow-purple-500/10">🎯 左侧埋伏</div>
                              )}

                              <div className="text-gray-300 font-bold mb-2 text-lg">{sec.name}</div>
                              <div className={`text-2xl font-mono font-bold ${getColorClass(sec.changePercent)}`}>
                                {sec.changePercent > 0 ? '+' : ''}{sec.changePercent.toFixed(2)}%
                              </div>
                              <div className="flex space-x-3 mt-2 text-xs font-mono justify-center flex-wrap gap-y-1">
                                <div className="flex flex-col items-center">
                                  <span className="text-gray-600 text-[10px] mb-0.5">5日</span>
                                  <span className={getColorClass(sec.change5d)}>{sec.change5d > 0 ? '+' : ''}{sec.change5d.toFixed(2)}%</span>
                                </div>
                                <div className="flex flex-col items-center">
                                  <span className="text-gray-600 text-[10px] mb-0.5">20日</span>
                                  <span className={getColorClass(sec.change20d)}>{sec.change20d > 0 ? '+' : ''}{sec.change20d.toFixed(2)}%</span>
                                </div>
                                <div className="flex flex-col items-center">
                                  <span className="text-gray-600 text-[10px] mb-0.5">主力</span>
                                  <span className={sec.fundFlow > 0 ? 'text-red-500' : 'text-green-500'}>
                                    {sec.fundFlow > 0 ? '+' : ''}{(sec.fundFlow || 0).toFixed(1)}亿
                                  </span>
                                </div>
                                <div className="flex flex-col items-center">
                                  <span className="text-gray-600 text-[10px] mb-0.5">量能比</span>
                                  <span className={sec.volRatio < 0.8 ? 'text-purple-400 font-bold' : 'text-gray-400'}>
                                    {sec.volRatio ? sec.volRatio.toFixed(2) : '-'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : activeTab === 'research' ? (
            <Suspense fallback={pageFallback}><ResearchCenter stocks={stocks} theses={investmentTheses} onChange={setInvestmentTheses} onSelectStock={setSelectedStock} /></Suspense>
          ) : activeTab === 'portfolio' ? (
            <Suspense fallback={pageFallback}><PortfolioCenter trades={paperTrades} stocks={stocks} indices={indices} theses={investmentTheses} /></Suspense>
          ) : activeTab === 'alerts' ? (
            <div className="flex-1 flex flex-col p-6 overflow-hidden">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">全屏异动预警流</h2>
                <button onClick={() => setAlertStream([])} className="text-xs text-gray-500 hover:text-white">清空记录</button>
              </div>
              <div className="flex-1 overflow-auto space-y-2">
                {(() => {
                  const filteredAlerts = alertStream.filter(alert => allSymbols.includes(alert.symbol));
                  if (filteredAlerts.length === 0) {
                    return <div className="flex items-center justify-center h-full text-gray-600">等待盘中异动触发...</div>;
                  }
                  return filteredAlerts.map((alert, idx) => (
                    <div key={idx} className="flex items-center space-x-4 bg-gray-900/50 border border-gray-800 p-3 rounded-lg hover:border-gray-700 transition-colors animate-in fade-in slide-in-from-top-2">
                      <span className="text-gray-500 font-mono text-xs">{alert.time}</span>
                      <div className="flex items-baseline space-x-2">
                        <span className="font-bold text-gray-200">{alert.name}</span>
                        <span className="text-xs text-gray-500">{alert.symbol}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${['急速拉升', '封死涨停', '大单扫货', '跌停撬开'].includes(alert.type) ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'}`}>{alert.type}</span>
                      <span className={`font-mono font-bold ${['急速拉升', '封死涨停', '大单扫货', '跌停撬开'].includes(alert.type) ? 'text-red-500' : 'text-green-500'}`}>{alert.value}</span>
                      <div className="flex-1"></div>
                      <button onClick={() => { const stock = stocks.find(s => s.symbol === alert.symbol); if (stock) { setSelectedStock(stock); } }}
                        className="text-xs text-blue-500 hover:underline">查看图表</button>
                    </div>
                  ));
                })()}
              </div>
            </div>
          ) : activeTab === 'ai' ? (
            <div className="flex-1 flex flex-col p-8 overflow-hidden">
              <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-blue-600/20 rounded-xl flex items-center justify-center">
                      <Activity className="w-6 h-6 text-blue-500" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold">智能复盘实验室</h2>
                      <p className="text-sm text-gray-500">基于指数、市场宽度与板块轮动的 AI 盘面策略报告</p>
                    </div>
                  </div>
                  <button
                    disabled={isReviewing}
                    onClick={handleGenerateReview}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50"
                  >
                    {isReviewing ? '报告生成中...' : '生成今日复盘报告'}
                  </button>
                </div>

                <div className="flex-1 bg-gray-900/30 border border-gray-800 rounded-2xl p-8 overflow-auto custom-scrollbar">
                  {marketReview ? (
                    <div>
                      {marketReviewMeta?.searchStatus && (
                        <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
                          <span className={`rounded border px-2 py-1 ${marketReviewMeta.searchStatus === 'complete' ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300' : 'border-amber-800/60 bg-amber-950/30 text-amber-300'}`}>
                            联网检索：{marketReviewMeta.searchStatus === 'complete' ? '完成' : '部分完成'}
                          </span>
                          {marketReviewMeta.modelUsed && <span className="rounded border border-gray-700 px-2 py-1 text-gray-400">{marketReviewMeta.modelUsed}</span>}
                          {marketReviewMeta.asOf && <span className="rounded border border-gray-700 px-2 py-1 text-gray-500">{new Date(marketReviewMeta.asOf).toLocaleString('zh-CN')}</span>}
                        </div>
                      )}
                      <div className="prose prose-invert max-w-none prose-h3:text-blue-400 prose-h3:mt-6 prose-h3:mb-3 prose-p:text-gray-300 prose-p:leading-relaxed whitespace-pre-wrap">
                        {marketReview}
                      </div>
                      {(marketReviewMeta?.sources?.length ?? 0) > 0 && (
                        <div className="mt-6 border-t border-gray-800 pt-4">
                          <div className="mb-2 text-xs font-medium text-blue-300">联网来源</div>
                          <div className="space-y-1 text-xs">
                            {marketReviewMeta?.sources?.map((source, index) => (
                              <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="block text-blue-400 hover:text-blue-300 hover:underline">
                                {index + 1}. {source.title || source.url}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                      <div className="mb-6 opacity-20">
                        <Activity className="w-20 h-20" />
                      </div>
                      <h3 className="text-lg font-bold text-gray-400 mb-2">暂无复盘数据</h3>
                      <p className="text-sm text-gray-600 max-w-xs">
                        点击上方按钮，AI 将分析指数环境、板块轮动与下一交易日的可能路径。
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-8 grid grid-cols-3 gap-6">
                  {[
                    { title: '全网归因', desc: '实时抓取热点题材' },
                    { title: '形态识别', desc: 'MACD/KDJ 智能推演' },
                    { title: '主力追踪', desc: '大单资金攻击路径' }
                  ].map((item, i) => (
                    <div key={i} className="bg-gray-900 border border-gray-800 p-4 rounded-xl hover:border-blue-900/50 transition-colors cursor-default">
                      <div className="text-sm font-bold text-gray-200 mb-1">{item.title}</div>
                      <div className="text-xs text-gray-500">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : activeTab === 'paper' ? (
            <Suspense fallback={pageFallback}><StrategyLab
              trades={paperTrades}
              stocks={stocks}
              indices={indices}
              theses={investmentTheses}
              apiConfigured={Boolean(apiKey)}
              onChange={setPaperTrades}
              onRequireApiKey={() => setShowSettings(true)}
              onEvaluate={async (trade) => {
                setPaperTrades((current) => current.map((item) => item.id === trade.id ? { ...item, isEvaluating: true } : item));
                const thesis = investmentTheses.find((item) => item.id === trade.thesisId);
                try {
                  const data = await fetchJson<ThesisEvaluationResult>('/api/evaluate_thesis', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Gemini-Key': apiKey },
                    body: JSON.stringify({
                      symbol: trade.symbol, name: trade.name, thesis: thesis?.coreThesis || trade.aiLogic,
                      catalysts: thesis?.catalysts || '', risks: thesis?.risks || '', kpis: thesis?.kpis || '',
                      invalidation: thesis?.invalidation || '', entrySnapshot: trade.entrySnapshot || {},
                    }),
                  });
                  setPaperTrades((current) => current.map((item) => item.id === trade.id ? { ...item, isEvaluating: false, evaluation: data.evaluation, evalStatus: data.status, evaluationConfidence: data.confidence, evaluationAsOf: data.asOf, evaluationSources: data.sources } : item));
                  if (thesis) {
                    const reviewedAt = Date.now();
                    const thesisStatus = data.status === 'SELL' ? 'INVALIDATED' : data.status === 'WARNING' ? 'WARNING' : 'ACTIVE';
                    setInvestmentTheses((current) => current.map((item) => item.id === thesis.id ? { ...item, status: thesisStatus, lastReviewedAt: reviewedAt, updatedAt: reviewedAt, reviewHistory: [{ reviewedAt, status: thesisStatus, note: data.evaluation, confidence: data.confidence, sources: data.sources }, ...(item.reviewHistory || [])] } : item));
                  }
                } catch {
                  setPaperTrades((current) => current.map((item) => item.id === trade.id ? { ...item, isEvaluating: false, evaluation: '联网逻辑复核失败，请稍后重试。', evalStatus: 'WARNING', evaluationConfidence: 0 } : item));
                }
              }}
            /></Suspense>
          ) : null}
        </section>

        {selectedStock && (
          <aside className="w-1/3 border-l border-gray-800 bg-[var(--color-stock-panel)] flex flex-col shadow-2xl transition-all">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold flex items-end space-x-2">
                  <span>{isBossMode ? `SVC-${selectedStock.code.slice(-4)}` : selectedStock.name}</span>
                  <span className="text-sm text-gray-500 font-normal">{selectedStock.code}</span>
                </h2>
                <div className="flex items-center space-x-3 mt-1">
                  <span className={`text-2xl font-mono font-bold ${getColorClass(selectedStock.changePercent)}`}>{selectedStock.price.toFixed(2)}</span>
                  <span className={`text-sm font-mono ${getColorClass(selectedStock.changePercent)}`}>{selectedStock.changePercent > 0 && !isBossMode ? '+' : ''}{selectedStock.changePercent.toFixed(2)}%</span>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {!isBossMode && (
                  groups.some(g => g.symbols.includes(selectedStock.symbol)) ? (
                    <button onClick={() => {
                      setGroups(prev => prev.map(g => (activeGroupId === 'all' || g.id === activeGroupId) ? { ...g, symbols: g.symbols.filter(sym => sym !== selectedStock.symbol) } : g));
                      setSelectedStock(null);
                    }} className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">移除自选</button>
                  ) : (
                    <button onClick={() => {
                      setGroups(prev => prev.map(g => g.id === 'all' ? { ...g, symbols: [selectedStock.symbol, ...g.symbols] } : g));
                    }} className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white transition-colors">加入自选</button>
                  )
                )}
                <button onClick={() => setSelectedStock(null)} className="p-1 rounded hover:bg-gray-800 text-gray-400 transition-colors"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="flex flex-col border-b border-gray-800">
              <div className="flex items-center px-4 py-2 space-x-2 border-b border-gray-800/50 bg-gray-900/30">
                {[
                  { id: 'intraday', label: '分时' },
                  { id: 'day', label: '日线' },
                  { id: 'week', label: '周线' },
                  { id: 'month', label: '月线' },
                ].map(period => (
                  <button
                    key={period.id}
                    onClick={() => {
                      if (chartPeriod !== period.id) {
                        setChartPeriod(period.id as typeof chartPeriod);
                        setIntradayData([]);
                        setVwapData([]);
                        setVolumeData([]);
                        setMa5Data([]);
                        setMa10Data([]);
                        setMa20Data([]);
                        setMacdData(null);
                        setMarkers([]);
                      }
                    }}
                    className={`px-2 py-0.5 text-xs rounded transition-colors ${chartPeriod === period.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
                  >
                    {period.label}
                  </button>
                ))}

                {chartPeriod !== 'intraday' && (
                  <div className="flex-1 flex items-center justify-end space-x-3 text-xs text-gray-400 pl-4 border-l border-gray-800">
                    <label className="flex items-center space-x-1 cursor-pointer hover:text-white">
                      <input
                        type="checkbox"
                        checked={chartIndicators.ma}
                        onChange={(e) => setChartIndicators(prev => ({ ...prev, ma: e.target.checked }))}
                        className="rounded bg-black border-gray-700 text-blue-600 focus:ring-0 focus:ring-offset-0 w-3 h-3"
                      />
                      <span>均线</span>
                    </label>
                    <label className="flex items-center space-x-1 cursor-pointer hover:text-white">
                      <input
                        type="checkbox"
                        checked={chartIndicators.volume}
                        onChange={(e) => setChartIndicators(prev => ({ ...prev, volume: e.target.checked }))}
                        className="rounded bg-black border-gray-700 text-blue-600 focus:ring-0 focus:ring-offset-0 w-3 h-3"
                      />
                      <span>成交量</span>
                    </label>
                    <label className="flex items-center space-x-1 cursor-pointer hover:text-white">
                      <input
                        type="checkbox"
                        checked={chartIndicators.macd}
                        onChange={(e) => setChartIndicators(prev => ({ ...prev, macd: e.target.checked }))}
                        className="rounded bg-black border-gray-700 text-blue-600 focus:ring-0 focus:ring-offset-0 w-3 h-3"
                      />
                      <span>MACD</span>
                    </label>
                    <label className="flex items-center space-x-1 cursor-pointer hover:text-white">
                      <input
                        type="checkbox"
                        checked={chartIndicators.vp}
                        onChange={(e) => setChartIndicators(prev => ({ ...prev, vp: e.target.checked }))}
                        className="rounded bg-black border-gray-700 text-blue-600 focus:ring-0 focus:ring-offset-0 w-3 h-3"
                      />
                      <span>筹码</span>
                    </label>
                  </div>
                )}
              </div>
              <div className={`p-0 relative ${chartPeriod === 'intraday' ? 'h-64' : 'h-96'}`}>
                {isBossMode ? (
                  <div className="w-full h-full p-4 font-mono text-green-500 bg-black overflow-hidden flex flex-col">
                    <div className="text-xs mb-2 text-green-400">root@server:~# top -b -n 1</div>
                    <div className="text-xs mb-4">
                      Tasks: 135 total,   1 running, 134 sleeping,   0 stopped,   0 zombie<br/>
                      %Cpu(s):  {(10 + (bossMonitorTick % 20)).toFixed(1)} us,   {(1 + (bossMonitorTick % 5)).toFixed(1)} sy,   0.0 ni,  {(89 - (bossMonitorTick % 20)).toFixed(1)} id,   0.0 wa<br/>
                      MiB Mem :  16384.0 total,   {(1000 + (bossMonitorTick * 173) % 4000).toFixed(1)} free,   8192.0 used,   {(1000 + (bossMonitorTick * 97) % 4000).toFixed(1)} buff/cache
                    </div>
                    <div className="flex-1 border border-green-900/50 rounded bg-green-950/10 p-2 relative overflow-hidden">
                       <div className="absolute inset-0 flex items-end justify-between px-1 opacity-50">
                         {Array.from({ length: 40 }).map((_, i) => (
                           <div key={i} className="w-2 bg-green-500 rounded-t-sm transition-all duration-500" style={{ height: `${(i * 37 + bossMonitorTick * 11) % 100}%` }}></div>
                         ))}
                       </div>
                       <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
                         <Activity className="w-32 h-32 text-green-500 animate-pulse" />
                       </div>
                    </div>
                  </div>
                ) : (
                  <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-gray-500">正在加载图表…</div>}><Chart
                    data={intradayData}
                    vwapData={chartPeriod === 'intraday' ? vwapData : []}
                    markers={markers}
                    prevClose={selectedStock.price - selectedStock.change}
                    type={chartPeriod === 'intraday' ? 'area' : 'candlestick'}
                    volumeData={chartPeriod !== 'intraday' ? volumeData : undefined}
                    ma5Data={chartPeriod !== 'intraday' ? ma5Data : undefined}
                    ma10Data={chartPeriod !== 'intraday' ? ma10Data : undefined}
                    ma20Data={chartPeriod !== 'intraday' ? ma20Data : undefined}
                    ma60Data={chartPeriod !== 'intraday' ? ma60Data : undefined}
                    ma120Data={chartPeriod !== 'intraday' ? ma120Data : undefined}
                    macdData={chartPeriod !== 'intraday' && macdData ? macdData : undefined}
                    supportPrice={aiAnalyses[selectedStock.symbol]?.support ?? undefined}
                    resistancePrice={aiAnalyses[selectedStock.symbol]?.resistance ?? undefined}
                    visibleIndicators={chartIndicators}
                    colors={{
                      backgroundColor: 'transparent',
                      lineColor: selectedStock.changePercent >= 0 ? '#ff3b30' : '#34c759',
                      textColor: '#D9D9D9',
                      areaTopColor: selectedStock.changePercent >= 0 ? 'rgba(255, 59, 48, 0.4)' : 'rgba(52, 199, 89, 0.4)',
                      areaBottomColor: 'rgba(0, 0, 0, 0)',
                      upColor: '#ff3b30',
                      downColor: '#34c759',
                    }}
                  /></Suspense>
                )}
              </div>
            </div>
            <div className="flex-1 p-4 overflow-auto">
              {!isBossMode ? (
                <>
                  <div className="flex justify-between items-center mb-4 space-x-2">
                    {(() => {
                      const activeTrade = paperTrades.find(t => t.symbol === selectedStock.symbol && t.sellPrice === undefined);
                      return activeTrade ? (
                        <button
                          onClick={() => {
                            const sellReason = window.prompt('记录卖出/结束验证的原因：', aiAnalyses[selectedStock.symbol]?.analysis || '手动结束验证');
                            if (sellReason === null) return;
                            const benchmark = indices.find((index) => index.code === activeTrade.benchmarkCode);
                            setPaperTrades(prev => prev.map(t => t.id === activeTrade.id ? {
                              ...t,
                              sellPrice: selectedStock.price,
                              sellTime: Date.now(),
                              benchmarkSellPrice: benchmark?.price,
                              sellAiLogic: sellReason.trim() || '手动结束验证'
                            } : t));
                            alert('已记录模拟卖出，可在“策略实验室”查看结果与基准比较');
                          }}
                          className="w-full py-2 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-bold rounded-lg shadow-lg shadow-green-500/20 transition-all"
                        >
                          记录模拟卖出
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            const quantityInput = window.prompt('模拟买入股数（仅用于仓位与集中度计算）：', '100');
                            if (quantityInput === null) return;
                            const quantity = Number(quantityInput);
                            if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
                              window.alert('请输入大于 0 的整数股数。');
                              return;
                            }
                            const linkedThesis = investmentTheses.find((thesis) => thesis.symbol === selectedStock.symbol && ['ACTIVE', 'WATCH', 'WARNING'].includes(thesis.status));
                            const customLogic = window.prompt('记录核心买入逻辑/理由（已有关联研究卡片时默认使用其核心逻辑）：', linkedThesis?.coreThesis || '');
                            if (customLogic === null) return; // cancelled
                            const benchmark = indices.find((index) => index.code === '000300' || index.name.includes('沪深300'));
                            const resonance = resonanceStocks.find((stock) => stock.symbol === selectedStock.symbol);
                            const analysis = aiAnalyses[selectedStock.symbol];
                            const newTrade: PaperTrade = {
                              id: Date.now().toString(),
                              symbol: selectedStock.symbol,
                              name: selectedStock.name,
                              buyPrice: selectedStock.price,
                              buyTime: Date.now(),
                              quantity,
                              strategyId: linkedThesis ? 'long_term_thesis' : resonance ? 'realtime_resonance' : 'manual_research',
                              strategyVersion: '2026.07-v2',
                              signalType: linkedThesis ? 'LONG_TERM' : resonance ? 'TACTICAL' : 'MANUAL',
                              signalSource: linkedThesis ? '公司研究卡片' : resonance ? '短期趋势共振候选' : '个股详情手动记录',
                              thesisId: linkedThesis?.id,
                              benchmarkCode: benchmark?.code,
                              benchmarkName: benchmark?.name,
                              benchmarkBuyPrice: benchmark?.price,
                              entrySnapshot: {
                                price: selectedStock.price,
                                changePercent: selectedStock.changePercent,
                                pe: selectedStock.pe,
                                pb: selectedStock.pb,
                                marketCap: selectedStock.marketCap,
                                sectorName: selectedStock.sectorName || resonance?.sectorName,
                                capturedAt: Date.now(),
                                aiModel: analysis?.modelUsed,
                                aiConfidence: analysis?.confidence,
                              },
                              aiLogic: customLogic.trim() || aiAnalyses[selectedStock.symbol]?.analysis || '手动盘中买入',
                            };
                            setPaperTrades([...paperTrades, newTrade]);
                            alert('已记录模拟买入，可在“策略实验室”进行前向验证');
                          }}
                          className="w-full py-2 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-bold rounded-lg shadow-lg shadow-red-500/20 transition-all"
                        >
                          记录模拟买入
                        </button>
                      );
                    })()}
                  </div>
                  {(() => {
                     let warningMessage = '';
                     const support = aiAnalyses[selectedStock.symbol]?.support;
                     if (support && selectedStock.price < support) {
                        warningMessage = `⚠️【长线破位预警】当前价格已跌破 AI 强支撑防守线 (${support.toFixed(2)})！`;
                     } else if (ma60Data && ma60Data.length > 0) {
                        const lastMa60 = ma60Data[ma60Data.length - 1].value;
                        if (selectedStock.price < lastMa60) {
                           warningMessage = `⚠️【牛熊破位预警】当前价格已跌破 60 日均线生命线 (${lastMa60.toFixed(2)})！`;
                        }
                     }

                     if (warningMessage) {
                        return (
                           <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded-lg flex items-center space-x-3 animate-pulse">
                              <span className="text-red-500 font-bold">{warningMessage}</span>
                           </div>
                        );
                     }
                     return null;
                  })()}
                  <div className="bg-blue-900/10 border border-blue-900/50 rounded-lg p-3 mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-blue-400 font-medium">✨ AI 投资分析</span>
                    <div className="flex items-center gap-2">
                    {aiAnalyses[selectedStock.symbol]?.searchStatus && <button onClick={() => syncAiAnalysisToResearch(selectedStock, aiAnalyses[selectedStock.symbol])} className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-blue-300 rounded transition-colors">同步到公司研究</button>}
                    <button disabled={isAnalyzing} onClick={async () => {
                        if (!apiKey) { setShowSettings(true); return; }
                        setIsAnalyzing(true);
                        const currentSymbol = selectedStock.symbol;
                        setAiAnalyses(prev => ({ ...prev, [currentSymbol]: { analysis: 'Gemini 思考中...' } }));
                        try {
                          const params = new URLSearchParams({
                            symbol: currentSymbol,
                            name: selectedStock.name,
                            price: String(selectedStock.price),
                            changePercent: String(selectedStock.changePercent),
                            pe: String(selectedStock.pe || ''),
                            pb: String(selectedStock.pb || ''),
                            marketCap: String(selectedStock.marketCap || ''),
                            high: String(selectedStock.high || ''),
                            low: String(selectedStock.low || ''),
                            volume: String(selectedStock.volume || ''),
                            amount: String(selectedStock.amount || ''),
                            quoteTime: selectedStock.quoteTime || '',
                            fundNetAmount: String(fundFlow?.netAmount || ''),
                            fundRatio: String(fundFlow?.ratioAmount || ''),
                          });
                          const data = await fetchJson<AIAnalysisResult>(`/api/analyze?${params}`, { headers: { 'X-Gemini-Key': apiKey } });
                          setAiAnalyses(prev => ({ ...prev, [currentSymbol]: data.analysis ? data : { analysis: '分析失败，请重试' } }));
                        } catch {
                          setAiAnalyses(prev => ({ ...prev, [currentSymbol]: { analysis: '网络错误，无法连接到分析引擎' } }));
                        } finally { setIsAnalyzing(false); }
                      }}
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
                    >{isAnalyzing ? '分析中...' : '开始投资分析'}</button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {aiAnalyses[selectedStock.symbol]?.analysis || "点击「开始投资分析」，系统将结合联网证据、长期历史行情与基本面，生成长期、波段和短线策略。"}
                  </p>
                  {aiAnalyses[selectedStock.symbol]?.longTermStrategy && (
                    <div className="mt-3 grid gap-3 lg:grid-cols-3">
                      {[
                        ['长期策略 · 1—3年', aiAnalyses[selectedStock.symbol]?.longTermStrategy, 'border-emerald-900/50 bg-emerald-950/20 text-emerald-300'],
                        ['波段策略 · 1—12周', aiAnalyses[selectedStock.symbol]?.swingStrategy, 'border-amber-900/50 bg-amber-950/20 text-amber-300'],
                        ['短线策略 · 1—10日', aiAnalyses[selectedStock.symbol]?.shortTermStrategy, 'border-purple-900/50 bg-purple-950/20 text-purple-300'],
                      ].map(([title, content, style]) => (
                        <div key={title} className={`rounded border p-3 ${style}`}>
                          <div className="mb-2 text-xs font-semibold">{title}</div>
                          <div className="whitespace-pre-wrap text-xs leading-relaxed text-gray-300">{content || '数据不足，暂不形成策略'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {aiAnalyses[selectedStock.symbol]?.searchStatus && (
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                      <span className={`rounded border px-2 py-1 ${
                        aiAnalyses[selectedStock.symbol]?.searchStatus === 'complete'
                          ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300'
                          : aiAnalyses[selectedStock.symbol]?.searchStatus === 'partial'
                            ? 'border-amber-800/60 bg-amber-950/30 text-amber-300'
                            : 'border-red-800/60 bg-red-950/30 text-red-300'
                      }`}>
                        联网检索：{aiAnalyses[selectedStock.symbol]?.searchStatus === 'complete' ? '完成' : aiAnalyses[selectedStock.symbol]?.searchStatus === 'partial' ? '部分完成' : '失败'}
                      </span>
                      <span className="rounded border border-gray-700 bg-gray-900/50 px-2 py-1 text-gray-300">
                        直接催化：{aiAnalyses[selectedStock.symbol]?.directCatalystFound ? '已找到' : '未确认'}
                      </span>
                      <span className="rounded border border-gray-700 bg-gray-900/50 px-2 py-1 text-gray-300">
                        证据置信度：{aiAnalyses[selectedStock.symbol]?.confidence ?? 0}%
                      </span>
                      {aiAnalyses[selectedStock.symbol]?.modelUsed && (
                        <span className="rounded border border-gray-700 bg-gray-900/50 px-2 py-1 text-gray-400">
                          {aiAnalyses[selectedStock.symbol]?.modelUsed}
                        </span>
                      )}
                    </div>
                  )}
                  {(aiAnalyses[selectedStock.symbol]?.sources?.length ?? 0) > 0 && (
                    <div className="mt-3 rounded border border-blue-900/30 bg-black/20 p-3">
                      <div className="mb-2 text-xs font-medium text-blue-300">联网依据</div>
                      <div className="space-y-2">
                        {aiAnalyses[selectedStock.symbol]?.sources?.map((source, index) => (
                          <div key={`${source.url}-${index}`} className="text-xs text-gray-400">
                            <a href={source.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline">
                              {index + 1}. {source.title || source.url}
                            </a>
                            {(source.sourceType || source.publishedAt) && (
                              <span className="ml-2 text-gray-600">
                                {[source.sourceType, source.publishedAt].filter(Boolean).join(' · ')}
                              </span>
                            )}
                            {source.keyFact && <div className="mt-0.5 pl-4 text-gray-500">{source.keyFact}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {aiAnalyses[selectedStock.symbol]?.winRate && (
                    <div className="mt-3 p-3 bg-blue-950/30 rounded border border-blue-900/30 text-xs">
                      <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono">
                        {aiAnalyses[selectedStock.symbol]?.support && <span className="text-[var(--color-stock-red)]">主要支撑: {aiAnalyses[selectedStock.symbol]?.support?.toFixed(2)}</span>}
                        {aiAnalyses[selectedStock.symbol]?.resistance && <span className="text-[var(--color-stock-green)]">主要压力: {aiAnalyses[selectedStock.symbol]?.resistance?.toFixed(2)}</span>}
                        <span className="text-blue-300 font-bold">胜率评级: {aiAnalyses[selectedStock.symbol]?.winRate}</span>
                      </div>
                      {(aiAnalyses[selectedStock.symbol]?.supportBasis || aiAnalyses[selectedStock.symbol]?.resistanceBasis) && (
                        <div className="mt-2 space-y-1 text-gray-400">
                          {aiAnalyses[selectedStock.symbol]?.supportBasis && <div>支撑依据：{aiAnalyses[selectedStock.symbol]?.supportBasis}</div>}
                          {aiAnalyses[selectedStock.symbol]?.resistanceBasis && <div>压力依据：{aiAnalyses[selectedStock.symbol]?.resistanceBasis}</div>}
                        </div>
                      )}
                      <div className="mt-2 text-gray-500">评级说明：{aiAnalyses[selectedStock.symbol]?.ratingBasis || '定性策略评级，不代表历史回测胜率或收益承诺。'}</div>
                    </div>
                  )}
                </div>

                {/* AI Announcement & News TL;DR (太长不看) */}
                <div className="bg-indigo-900/10 border border-indigo-900/50 rounded-lg p-3 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-indigo-400 font-medium">📰 资讯/公告 AI 极速总结 (TL;DR)</span>
                    <button
                      disabled={isAnalyzingNews}
                      onClick={async () => {
                        if (!apiKey) { setShowSettings(true); return; }
                        setIsAnalyzingNews(true);
                        const currentSymbol = selectedStock.symbol;
                        setNewsSummaries(prev => ({
                          ...prev,
                          [currentSymbol]: { summary: '正在扫描全网资讯与公告，Gemini 分析中...', sentiment: 'NEUTRAL' }
                        }));
                        try {
                          const params = new URLSearchParams({ symbol: currentSymbol, name: selectedStock.name, price: String(selectedStock.price), changePercent: String(selectedStock.changePercent), volume: String(selectedStock.volume), amount: String(selectedStock.amount), quoteTime: selectedStock.quoteTime || '' });
                          const data = await fetchJson<NewsSummaryResult>(`/api/news_summary?${params}`, {
                            headers: { 'X-Gemini-Key': apiKey },
                          });
                          setNewsSummaries(prev => ({
                            ...prev,
                            [currentSymbol]: data.summary ? data : { summary: '极速总结失败，请重试。', sentiment: 'NEUTRAL' }
                          }));
                        } catch {
                          setNewsSummaries(prev => ({
                            ...prev,
                            [currentSymbol]: { summary: '网络错误，无法连接到分析引擎。', sentiment: 'NEUTRAL' }
                          }));
                        } finally {
                          setIsAnalyzingNews(false);
                        }
                      }}
                      className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors disabled:opacity-50"
                    >
                      {isAnalyzingNews ? '扫描中...' : '极速总结'}
                    </button>
                  </div>
                  <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {newsSummaries[selectedStock.symbol]?.summary || "点击「极速总结」，Gemini 将瞬间为您总结近期重大新闻、利空风险及关键公告。"}
                  </div>
                  {newsSummaries[selectedStock.symbol]?.sentiment && newsSummaries[selectedStock.symbol]?.summary && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-gray-500 font-mono">情感诊断:</span>
                      <span className={`px-2 py-0.5 rounded font-bold font-mono ${
                        newsSummaries[selectedStock.symbol].sentiment === 'POSITIVE' ? 'bg-[var(--color-stock-red)]/20 text-[var(--color-stock-red)]' :
                        newsSummaries[selectedStock.symbol].sentiment === 'NEGATIVE' ? 'bg-[var(--color-stock-green)]/20 text-[var(--color-stock-green)]' :
                        'bg-gray-800 text-gray-400'
                      }`}>
                        {newsSummaries[selectedStock.symbol].sentiment}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300">事实方向 {newsSummaries[selectedStock.symbol].factSentiment || 'UNCERTAIN'}</span>
                      <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300">短期影响 {newsSummaries[selectedStock.symbol].shortTermImpact || 'UNCERTAIN'}</span>
                      <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300">计价风险 {newsSummaries[selectedStock.symbol].pricedInRisk || 'UNKNOWN'}</span>
                      <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300">证据置信度 {newsSummaries[selectedStock.symbol].confidence ?? 0}%</span>
                    </div>
                  )}
                  {(newsSummaries[selectedStock.symbol]?.sources?.length ?? 0) > 0 && (
                    <div className="mt-3 border-t border-indigo-900/30 pt-2 space-y-1">
                      <div className="text-[10px] text-gray-500">核验来源</div>
                      {newsSummaries[selectedStock.symbol].sources!.slice(0, 5).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block text-xs text-indigo-300 hover:underline">{source.title}{source.publishedAt ? ` · ${source.publishedAt}` : ''}</a>)}
                    </div>
                  )}
                </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">今开</span><span className={getColorClass(selectedStock.price - selectedStock.change)}>{(selectedStock.price - selectedStock.change).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">昨收</span><span>{(selectedStock.price - selectedStock.change).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">最高</span><span className="text-[var(--color-stock-red)]">{(selectedStock.high || 0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">最低</span><span className="text-[var(--color-stock-green)]">{(selectedStock.low || 0).toFixed(2)}</span></div>
                {selectedStock.pe !== undefined && (
                  <div className="flex justify-between"><span className="text-gray-500">市盈率(PE)</span><span>{selectedStock.pe > 0 ? selectedStock.pe.toFixed(2) : '-'}</span></div>
                )}
                {selectedStock.pb !== undefined && (
                  <div className="flex justify-between"><span className="text-gray-500">市净率(PB)</span><span>{selectedStock.pb > 0 ? selectedStock.pb.toFixed(2) : '-'}</span></div>
                )}
                {selectedStock.marketCap !== undefined && (
                  <div className="flex justify-between col-span-2"><span className="text-gray-500">总市值/流通市值</span><span>{(selectedStock.marketCap || 0).toFixed(2)} 亿</span></div>
                )}
                {fundFlow && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500 font-bold">主力净流入</span>
                      <span className={getColorClass(fundFlow.netAmount)}>{(fundFlow.netAmount / 10000).toFixed(0)}万</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">净流入占比</span>
                      <span className={getColorClass(fundFlow.ratioAmount)}>{(fundFlow.ratioAmount * 100).toFixed(2)}%</span>
                    </div>
                  </>
                )}
              </div>
              </>
              ) : (
                <div className="text-green-500 font-mono text-xs whitespace-pre-wrap">
                  [OK] Memory checks passed.<br/>
                  [INFO] Connecting to worker {selectedStock.code.slice(-4)}...<br/>
                  [INFO] Established secure tunnel.<br/>
                  [DATA] Streaming logs...
                </div>
              )}
            </div>
          </aside>
        )}
      </main>

      <footer className="h-8 border-t border-gray-800 bg-[var(--color-stock-panel)] flex items-center justify-between px-4 text-xs text-gray-500">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1.5">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span>{connected ? 'Live (Tencent API)' : 'Disconnected'}</span>
          </div>
          {connected && <span>Latency: {latency}ms</span>}
          {stocks.some((stock) => stock.quoteTime) && <span>行情时间: {stocks.find((stock) => stock.quoteTime)?.quoteTime}</span>}
          {resonanceMeta && <span className={resonanceMeta.status === 'ok' ? 'text-gray-500' : 'text-amber-500'}>共振数据: {resonanceMeta.status === 'ok' ? '完整' : resonanceMeta.status === 'partial' ? '部分样本' : resonanceMeta.status === 'initializing' ? '初始化' : '异常'}</span>}
          {backendHealth?.sectorMap && (
            <span
              className={backendHealth.sectorMap.healthy ? 'text-gray-500' : 'text-amber-500'}
              title={backendHealth.sectorMap.lastError || undefined}
            >
              板块映射: {backendHealth.sectorMap.healthy
                ? `${backendHealth.sectorMap.stockCount}只${backendHealth.sectorMap.source ? ` · ${backendHealth.sectorMap.source}` : ''}`
                : backendHealth.sectorMap.status === 'rebuilding'
                  ? `重建中 (${backendHealth.sectorMap.stockCount}/${backendHealth.sectorMap.minimumHealthyStockCount}+)`
                  : `不可用 (${backendHealth.sectorMap.stockCount}只缓存)`}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-4"><span className="bg-gray-800 px-2 py-0.5 rounded border border-gray-700">Esc 切换 Boss Key</span></div>
      </footer>

      {showSettings && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 p-6 rounded-lg w-96 shadow-2xl">
            <h3 className="text-lg font-bold mb-4">系统设置</h3>
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-2">Gemini API Key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AI 投资分析需要配置 API Key" className="w-full bg-black border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              <p className="text-xs text-gray-500 mt-2">API Key 仅保存在本地浏览器，请求时会发送给本机后端调用 Gemini，不会持久化保存。</p>
              <div className="mt-3 rounded border border-gray-800 bg-black/30 p-3">
                <div className="text-xs text-gray-400 mb-2">模型调用优先级</div>
                <ol className="space-y-1 text-xs text-gray-300 list-decimal list-inside">
                  <li>Antigravity</li>
                  <li>Gemini 3.5 Flash</li>
                  <li>Gemini 3.1 Flash Lite</li>
                  <li>Gemini 2.5 Flash</li>
                </ol>
              </div>
              <div className="mt-3 rounded border border-gray-800 bg-black/30 p-3">
                <div className="text-xs text-gray-400 mb-2">本地研究数据迁移</div>
                <div className="flex gap-2">
                  <button onClick={exportResearchData} className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded text-xs">导出备份</button>
                  <label className="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded text-xs text-center cursor-pointer">导入备份<input type="file" accept="application/json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) importResearchData(file); e.target.value = ''; }} /></label>
                </div>
                <p className="text-[10px] text-gray-600 mt-2">包含自选分组、研究卡片、策略记录和图表偏好；不包含 API Key。</p>
              </div>
            </div>
            <div className="flex justify-end space-x-3"><button onClick={() => setShowSettings(false)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">关闭</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
