import { useEffect, useState, useMemo, useRef } from 'react';
import { Activity, Settings, Search, X, GripVertical } from 'lucide-react';
import { Chart } from './components/Chart';
import { calculateMA, calculateMACD } from './utils/indicators';

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

interface StockData {
  code: string;
  symbol: string;
  name: string;
  price: number;
  high: number;
  low: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
  trend: number[];
}

interface Group {
  id: string;
  name: string;
  bossName: string;
  symbols: string[];
}

interface PaperTrade {
  id: string;
  symbol: string;
  name: string;
  buyPrice: number;
  buyTime: number;
  aiLogic: string;
}

// Sortable Row Component
interface SortableRowProps {
  stock: StockData;
  isSelected: boolean;
  isBossMode: boolean;
  latestAlert: any;
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
  support?: number | null;
  resistance?: number | null;
  winRate?: string | null;
}

export default function App() {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [connected, setConnected] = useState(false);
  const [latency, setLatency] = useState(0);
  const [isBossMode, setIsBossMode] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{symbol: string, name: string, code: string}[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  
  useEffect(() => {
    localStorage.setItem('gemini_api_key', apiKey);
  }, [apiKey]);

  const [aiAnalyses, setAiAnalyses] = useState<Record<string, AIAnalysisResult>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<'intraday' | 'day' | 'week' | 'month'>('intraday');
  const [intradayData, setIntradayData] = useState<any[]>([]);
  const [vwapData, setVwapData] = useState<any[]>([]);
  const [volumeData, setVolumeData] = useState<any[]>([]);
  const [ma5Data, setMa5Data] = useState<any[]>([]);
  const [ma10Data, setMa10Data] = useState<any[]>([]);
  const [ma20Data, setMa20Data] = useState<any[]>([]);
  const [macdData, setMacdData] = useState<{ dif: any[], dea: any[], histogram: any[] } | null>(null);
  const [markers, setMarkers] = useState<any[]>([]);
  const [marketReview, setMarketReview] = useState<string>('');
  const [isReviewing, setIsReviewing] = useState(false);
  
  const [activeTab, setActiveTab] = useState('dashboard');
  const [indices, setIndices] = useState<any[]>([]);
  const [sectors, setSectors] = useState<any[]>([]);
  const [alertStream, setAlertStream] = useState<any[]>([]);
  const [fundFlow, setFundFlow] = useState<any>(null);

  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>(() => {
    const saved = localStorage.getItem('paper_trades');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('paper_trades', JSON.stringify(paperTrades));
  }, [paperTrades]);

  const [groups, setGroups] = useState<Group[]>(() => {
    const saved = localStorage.getItem('stock_groups');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: 'all', name: '🔥 全部自选', bossName: 'Task Queue', symbols: ["sh600519", "sz300750", "sh601318", "sz002594", "sh601127", "sh601138", "sz000001", "sh600036"] },
      { id: 'main', name: '⭐ 主线题材', bossName: 'Active Jobs', symbols: ["sh601138", "sh601127"] },
      { id: 'dividend', name: '🛡️ 防守高息', bossName: 'Background', symbols: ["sh600036", "sh601318", "sz000001"] },
      { id: 'etf', name: '📈 宽基ETF', bossName: 'Failed', symbols: ["sh600030"] }
    ];
  });

  const [activeGroupId, setActiveGroupId] = useState('all');

  const allSymbols = useMemo(() => Array.from(new Set(groups.flatMap(g => g.symbols))), [groups]);
  
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
    if (!searchQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`http://localhost:8000/api/search?q=${searchQuery}`);
        const data = await res.json();
        setSearchResults(data.results || []);
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    let connectTime: number;
    const connect = () => {
      connectTime = Date.now();
      const ws = new WebSocket('ws://localhost:8000/ws/market');
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        setLatency(Date.now() - connectTime);
        ws.send(JSON.stringify({ type: 'subscribe', symbols: allSymbolsRef.current }));
      };
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          setLatency(Date.now() - data.timestamp);
        } else if (data.type === 'market_data') {
          if (data.indices) setIndices(data.indices);
          if (data.sectors) setSectors(data.sectors);
          if (data.alerts && data.alerts.length > 0) {
            setAlertStream(prev => [...data.alerts, ...prev].slice(0, 50));
          }
          setStocks(prevStocks => {
            const newStocksMap = new Map(data.payload.map((s: StockData) => [s.symbol, s]));
            return allSymbolsRef.current.map(sym => newStocksMap.get(sym) || prevStocks.find(p => p.symbol === sym)).filter(Boolean) as StockData[];
          });
          setSelectedStock(prev => {
            if (prev) {
              const updated = data.payload.find((s: StockData) => s.symbol === prev.symbol);
              return updated || prev;
            }
            return prev;
          });
        }
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
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

  useEffect(() => {
    if (!selectedStock) {
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
    let isMounted = true;
    const fetchData = async () => {
      try {
        if (chartPeriod === 'intraday') {
          const [resIntraday, resFund] = await Promise.all([
            fetch(`http://localhost:8000/api/intraday?symbol=${selectedStock.symbol}`),
            fetch(`http://localhost:8000/api/fundflow?symbol=${selectedStock.symbol}`)
          ]);
          const dataIntraday = await resIntraday.json();
          const dataFund = await resFund.json();
          
          if (dataIntraday.data && dataIntraday.date && isMounted) {
            const year = dataIntraday.date.substring(0, 4);
            const month = dataIntraday.date.substring(4, 6);
            const day = dataIntraday.date.substring(6, 8);
            
            const chartData: any[] = [];
            const vwapPoints: any[] = [];
            const newMarkers: any[] = [];
            let prevCumVol = 0;
            const volWindow: number[] = [];

            dataIntraday.data.forEach((item: string) => {
              const parts = item.split(' ');
              const price = parseFloat(parts[1]);
              const cumVol = parseFloat(parts[2]);
              const cumAmount = parseFloat(parts[3]);
              
              const hour = parseInt(parts[0].substring(0, 2), 10);
              const minute = parseInt(parts[0].substring(2, 4), 10);
              const time = Math.floor(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), hour, minute) / 1000);
              
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
          if (dataFund.data && isMounted) {
            setFundFlow(dataFund.data);
          }
        } else {
          // Historical data (day, week, month)
          const resHistory = await fetch(`http://localhost:8000/api/history?symbol=${selectedStock.symbol}&period=${chartPeriod}`);
          const dataHistory = await resHistory.json();
          if (dataHistory.data && isMounted) {
            const rawData = dataHistory.data;
            setIntradayData(rawData);
            setVwapData([]);
            
            if (rawData.length > 0) {
              const volData = rawData.map((d: any) => ({
                time: d.time,
                value: d.volume,
                color: d.close >= d.open ? 'rgba(255, 59, 48, 0.5)' : 'rgba(52, 199, 89, 0.5)'
              }));
              setVolumeData(volData);
              const ma5 = calculateMA(rawData, 5);
              const ma20 = calculateMA(rawData, 20);
              setMa5Data(ma5);
              setMa10Data(calculateMA(rawData, 10));
              setMa20Data(ma20);
              const macdObj = calculateMACD(rawData);
              setMacdData(macdObj);
              
              // Generate B/S signals: Resonance (MA + MACD) and Divergence (Price vs MACD)
              const histMarkers: any[] = [];
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
      } catch (e) {
        console.error("Failed to fetch stock data", e);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedStock?.symbol, chartPeriod]);

  const displayedStocks = useMemo(() => {
    const activeGroup = groups.find(g => g.id === activeGroupId);
    if (!activeGroup) return [];
    return activeGroup.symbols.map(sym => stocks.find(s => s.symbol === sym)).filter(Boolean) as StockData[];
  }, [stocks, groups, activeGroupId]);

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

  const handleGenerateReview = async () => {
    if (!apiKey) {
      setShowSettings(true);
      return;
    }
    setIsReviewing(true);
    setMarketReview('正在汇总全市场数据，召唤 Gemini 操盘手生成复盘中...');
    try {
      const response = await fetch('http://localhost:8000/api/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gemini-Key': apiKey
        },
        body: JSON.stringify({
          stocks: stocks,
          indices: indices
        })
      });
      const data = await response.json();
      setMarketReview(data.review);
    } catch (e) {
      setMarketReview('报告生成失败，请检查网络或 API Key 状态。');
    } finally {
      setIsReviewing(false);
    }
  };

  return (
    <div className={`min-h-screen ${isBossMode ? 'bg-gray-950 grayscale' : 'bg-[var(--color-stock-bg)]'} text-white flex flex-col text-sm transition-all duration-300`}>
      <header className="h-12 border-b border-gray-800 flex items-center justify-between px-4 bg-[var(--color-stock-panel)]">
        <div className="flex items-center space-x-4">
          <Activity className={`w-5 h-5 ${isBossMode ? 'text-gray-400' : 'text-[var(--color-stock-red)]'}`} />
          <h1 className="font-bold tracking-wider text-gray-100">{isBossMode ? 'System Monitor' : '大A极客盯盘'}</h1>
          <div className="h-4 w-px bg-gray-700 mx-2"></div>
          {!isBossMode && (
            <nav className="flex space-x-1">
              {[{ id: 'dashboard', name: '行情中心' }, { id: 'alerts', name: '异动预警' }, { id: 'ai', name: '智能复盘' }, { id: 'paper', name: '虚拟交易' }].map((tab) => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1 rounded-md transition-colors ${activeTab === tab.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800/50'}`}>
                  {tab.name}
                </button>
              ))}
            </nav>
          )}
        </div>
        <div className="flex items-center space-x-4 text-gray-400">
          {!isBossMode && sectors.length > 0 && (
            <div className="flex items-center space-x-3 mr-2 hidden xl:flex border-r border-gray-700 pr-4">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">🔥 领涨板块</span>
              {sectors.map(sec => (
                <div key={sec.name} className="flex flex-col items-center">
                  <span className="text-[10px] text-gray-300 leading-none mb-1">{sec.name}</span>
                  <div className="flex items-baseline space-x-1">
                    <span className={`text-[10px] font-mono ${getColorClass(sec.changePercent)}`}>+{sec.changePercent.toFixed(2)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
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
            <div className="p-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">分组视图</div>
            <div className="flex flex-col space-y-0.5 px-2">
              {groups.map((group) => (
                <button key={group.id} onClick={() => setActiveGroupId(group.id)}
                  className={`flex items-center justify-between px-3 py-2 rounded-md text-left transition-colors ${activeGroupId === group.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'}`}>
                  <span className="truncate">{isBossMode ? group.bossName : group.name}</span>
                  <span className="text-xs bg-gray-900 px-1.5 rounded text-gray-500">{group.symbols.length}</span>
                </button>
              ))}
            </div>
          </aside>
        )}

        <section className="flex-1 flex flex-col bg-black overflow-hidden relative">
          {activeTab === 'dashboard' ? (
            <>
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
          ) : activeTab === 'alerts' ? (
            <div className="flex-1 flex flex-col p-6 overflow-hidden">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">全屏异动预警流</h2>
                <button onClick={() => setAlertStream([])} className="text-xs text-gray-500 hover:text-white">清空记录</button>
              </div>
              <div className="flex-1 overflow-auto space-y-2">
                {alertStream.length === 0 ? <div className="flex items-center justify-center h-full text-gray-600">等待盘中异动触发...</div> : alertStream.map((alert, idx) => (
                  <div key={idx} className="flex items-center space-x-4 bg-gray-900/50 border border-gray-800 p-3 rounded-lg hover:border-gray-700 transition-colors animate-in fade-in slide-in-from-top-2">
                    <span className="text-gray-500 font-mono text-xs">{alert.time}</span>
                    <div className="flex items-baseline space-x-2">
                      <span className="font-bold text-gray-200">{alert.name}</span>
                      <span className="text-xs text-gray-500">{alert.symbol}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${alert.type === '急速拉升' ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'}`}>{alert.type}</span>
                    <span className={`font-mono font-bold ${alert.type === '急速拉升' ? 'text-red-500' : 'text-green-500'}`}>{alert.value}</span>
                    <div className="flex-1"></div>
                    <button onClick={() => { const stock = stocks.find(s => s.symbol === alert.symbol); if (stock) { setSelectedStock(stock); setActiveTab('dashboard'); } }}
                      className="text-xs text-blue-500 hover:underline">查看图表</button>
                  </div>
                ))}
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
                      <p className="text-sm text-gray-500">基于自选股异动与大盘情绪的深度 AI 策略报告</p>
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
                    <div className="prose prose-invert max-w-none prose-h3:text-blue-400 prose-h3:mt-6 prose-h3:mb-3 prose-p:text-gray-300 prose-p:leading-relaxed whitespace-pre-wrap">
                      {marketReview}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                      <div className="mb-6 opacity-20">
                        <Activity className="w-20 h-20" />
                      </div>
                      <h3 className="text-lg font-bold text-gray-400 mb-2">暂无复盘数据</h3>
                      <p className="text-sm text-gray-600 max-w-xs">
                        点击上方按钮，Gemini 将深度诊断您的持仓情况并给出次日操盘策略。
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
            <div className="flex-1 flex flex-col p-8 overflow-hidden">
               <div className="flex items-center justify-between mb-8">
                 <h2 className="text-2xl font-bold">虚拟交易与胜率回测</h2>
                 <button onClick={() => { if(window.confirm('确定清空所有交易记录？')) setPaperTrades([]); }} className="text-xs text-gray-500 hover:text-white">清空记录</button>
               </div>
               <div className="flex-1 overflow-auto space-y-4">
                 {paperTrades.length === 0 ? <div className="text-center text-gray-500 mt-20">暂无虚拟交易记录。<br/>在个股详情面板点击「记录虚拟买入」开始测试你的策略。</div> : paperTrades.slice().reverse().map(trade => {
                   const currentStock = stocks.find(s => s.symbol === trade.symbol);
                   const currentPrice = currentStock?.price || trade.buyPrice;
                   const pnl = currentPrice - trade.buyPrice;
                   const pnlPercent = (pnl / trade.buyPrice) * 100;
                   return (
                     <div key={trade.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors">
                       <div className="flex justify-between items-start mb-4 border-b border-gray-800 pb-4">
                         <div>
                           <div className="font-bold text-lg">{trade.name} <span className="text-gray-500 text-sm font-normal">{trade.symbol}</span></div>
                           <div className="text-xs text-gray-500 mt-1">买入时间: {new Date(trade.buyTime).toLocaleString()}</div>
                         </div>
                         <div className="text-right">
                           <div className="text-xs text-gray-500 mb-1">当前浮亏/浮盈</div>
                           <div className={`text-xl font-bold font-mono ${pnl >= 0 ? 'text-[var(--color-stock-red)]' : 'text-[var(--color-stock-green)]'}`}>
                             {pnl > 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                           </div>
                         </div>
                       </div>
                       <div className="grid grid-cols-2 gap-4 mb-4 text-sm font-mono bg-black p-3 rounded">
                         <div><span className="text-gray-500">买入价格:</span> {trade.buyPrice.toFixed(2)}</div>
                         <div><span className="text-gray-500">当前价格:</span> {currentPrice.toFixed(2)}</div>
                       </div>
                       <div className="text-sm">
                         <span className="text-blue-400 font-bold mb-1 block">买入时的 AI 逻辑 / 策略理由：</span>
                         <p className="text-gray-400 whitespace-pre-wrap bg-blue-950/20 p-3 rounded border border-blue-900/30">{trade.aiLogic}</p>
                       </div>
                     </div>
                   );
                 })}
               </div>
            </div>
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
                  <button onClick={() => {
                    setGroups(prev => prev.map(g => (activeGroupId === 'all' || g.id === activeGroupId) ? { ...g, symbols: g.symbols.filter(sym => sym !== selectedStock.symbol) } : g));
                    setSelectedStock(null);
                  }} className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">移除自选</button>
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
                        setChartPeriod(period.id as any);
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
              </div>
              <div className={`p-0 relative ${chartPeriod === 'intraday' ? 'h-64' : 'h-96'}`}>
                {isBossMode ? (
                  <div className="w-full h-full p-4 font-mono text-green-500 bg-black overflow-hidden flex flex-col">
                    <div className="text-xs mb-2 text-green-400">root@server:~# top -b -n 1</div>
                    <div className="text-xs mb-4">
                      Tasks: 135 total,   1 running, 134 sleeping,   0 stopped,   0 zombie<br/>
                      %Cpu(s):  {Math.floor(Math.random() * 20 + 10).toFixed(1)} us,   {Math.floor(Math.random() * 5 + 1).toFixed(1)} sy,   0.0 ni,  {Math.floor(Math.random() * 20 + 60).toFixed(1)} id,   0.0 wa<br/>
                      MiB Mem :  16384.0 total,   {Math.floor(Math.random() * 4000 + 1000).toFixed(1)} free,   8192.0 used,   {Math.floor(Math.random() * 4000 + 1000).toFixed(1)} buff/cache
                    </div>
                    <div className="flex-1 border border-green-900/50 rounded bg-green-950/10 p-2 relative overflow-hidden">
                       <div className="absolute inset-0 flex items-end justify-between px-1 opacity-50">
                         {Array.from({ length: 40 }).map((_, i) => (
                           <div key={i} className="w-2 bg-green-500 rounded-t-sm transition-all duration-500" style={{ height: `${Math.random() * 100}%` }}></div>
                         ))}
                       </div>
                       <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
                         <Activity className="w-32 h-32 text-green-500 animate-pulse" />
                       </div>
                    </div>
                  </div>
                ) : (
                  <Chart 
                    data={intradayData} 
                    vwapData={chartPeriod === 'intraday' ? vwapData : []} 
                    markers={markers} 
                    prevClose={selectedStock.price - selectedStock.change} 
                    type={chartPeriod === 'intraday' ? 'area' : 'candlestick'} 
                    volumeData={chartPeriod !== 'intraday' ? volumeData : undefined}
                    ma5Data={chartPeriod !== 'intraday' ? ma5Data : undefined}
                    ma10Data={chartPeriod !== 'intraday' ? ma10Data : undefined}
                    ma20Data={chartPeriod !== 'intraday' ? ma20Data : undefined}
                    macdData={chartPeriod !== 'intraday' && macdData ? macdData : undefined}
                    supportPrice={aiAnalyses[selectedStock.symbol]?.support ?? undefined}
                    resistancePrice={aiAnalyses[selectedStock.symbol]?.resistance ?? undefined}
                    colors={{
                      backgroundColor: 'transparent',
                      lineColor: selectedStock.changePercent >= 0 ? '#ff3b30' : '#34c759',
                      textColor: '#D9D9D9',
                      areaTopColor: selectedStock.changePercent >= 0 ? 'rgba(255, 59, 48, 0.4)' : 'rgba(52, 199, 89, 0.4)',
                      areaBottomColor: 'rgba(0, 0, 0, 0)',
                      upColor: '#ff3b30',
                      downColor: '#34c759',
                    }}
                  />
                )}
              </div>
            </div>
            <div className="flex-1 p-4 overflow-auto">
              {!isBossMode ? (
                <>
                  <div className="flex justify-between items-center mb-4">
                    <button 
                      onClick={() => {
                        const newTrade: PaperTrade = {
                          id: Date.now().toString(),
                          symbol: selectedStock.symbol,
                          name: selectedStock.name,
                          buyPrice: selectedStock.price,
                          buyTime: Date.now(),
                          aiLogic: aiAnalyses[selectedStock.symbol]?.analysis || '手动盘中发起',
                        };
                        setPaperTrades([...paperTrades, newTrade]);
                        alert('已记录虚拟买入，可在"虚拟交易"面板追踪盈亏');
                      }}
                      className="w-full py-2 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-bold rounded-lg shadow-lg shadow-red-500/20 transition-all"
                    >
                      记录虚拟买入
                    </button>
                  </div>
                  <div className="bg-blue-900/10 border border-blue-900/50 rounded-lg p-3 mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-blue-400 font-medium">✨ Gemini AI 异动分析</span>
                    <button disabled={isAnalyzing} onClick={async () => {
                        if (!apiKey) { setShowSettings(true); return; }
                        setIsAnalyzing(true); 
                        const currentSymbol = selectedStock.symbol;
                        setAiAnalyses(prev => ({ ...prev, [currentSymbol]: { analysis: 'Gemini 思考中...' } }));
                        try {
                          const res = await fetch(`http://localhost:8000/api/analyze?symbol=${currentSymbol}&name=${encodeURIComponent(selectedStock.name)}&price=${selectedStock.price}&changePercent=${selectedStock.changePercent}`, { headers: { 'X-Gemini-Key': apiKey } });
                          const data = await res.json(); 
                          setAiAnalyses(prev => ({ ...prev, [currentSymbol]: data.analysis ? data : { analysis: '分析失败，请重试' } }));
                        } catch (e) { 
                          setAiAnalyses(prev => ({ ...prev, [currentSymbol]: { analysis: '网络错误，无法连接到分析引擎' } })); 
                        } finally { setIsAnalyzing(false); }
                      }}
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
                    >{isAnalyzing ? '分析中...' : '开始推演'}</button>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {aiAnalyses[selectedStock.symbol]?.analysis || "点击「开始推演」，Gemini 将结合最新消息和资金面为您归因。"}
                  </p>
                  {aiAnalyses[selectedStock.symbol]?.winRate && (
                    <div className="mt-3 p-2 bg-blue-950/30 rounded border border-blue-900/30 flex space-x-6 text-xs font-mono">
                      {aiAnalyses[selectedStock.symbol]?.support && <span className="text-[var(--color-stock-red)]">支撑(防守): {aiAnalyses[selectedStock.symbol]?.support?.toFixed(2)}</span>}
                      {aiAnalyses[selectedStock.symbol]?.resistance && <span className="text-[var(--color-stock-green)]">压力(进攻): {aiAnalyses[selectedStock.symbol]?.resistance?.toFixed(2)}</span>}
                      <span className="text-blue-300 font-bold">胜率评级: {aiAnalyses[selectedStock.symbol]?.winRate}</span>
                    </div>
                  )}
                </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">今开</span><span className={getColorClass(selectedStock.price - selectedStock.change)}>{(selectedStock.price - selectedStock.change).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">昨收</span><span>{(selectedStock.price - selectedStock.change).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">最高</span><span className="text-[var(--color-stock-red)]">{(selectedStock.high || 0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">最低</span><span className="text-[var(--color-stock-green)]">{(selectedStock.low || 0).toFixed(2)}</span></div>
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
        </div>
        <div className="flex items-center space-x-4"><span className="bg-gray-800 px-2 py-0.5 rounded border border-gray-700">Esc 切换 Boss Key</span></div>
      </footer>

      {showSettings && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 p-6 rounded-lg w-96 shadow-2xl">
            <h3 className="text-lg font-bold mb-4">系统设置</h3>
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-2">Gemini API Key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AI 异动分析需要配置 API Key" className="w-full bg-black border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              <p className="text-xs text-gray-500 mt-2">API Key 仅保存在您的本地浏览器中，不会上传到我们的服务器。</p>
            </div>
            <div className="flex justify-end space-x-3"><button onClick={() => setShowSettings(false)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">关闭</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
