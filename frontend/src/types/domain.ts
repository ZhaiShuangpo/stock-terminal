import type { Time } from 'lightweight-charts';

export interface StockData {
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
  pe?: number;
  pb?: number;
  marketCap?: number;
  quoteTime?: string;
  sectorName?: string;
  trend: number[];
}

export interface SearchResult {
  symbol: string;
  name: string;
  code: string;
}

export interface IndexData {
  name: string;
  code: string;
  price: number;
  change: number;
  changePercent: number;
}

export interface SectorData {
  id: string;
  name: string;
  changePercent: number;
  change5d: number;
  change20d: number;
  volRatio: number;
  fundFlow: number;
}

export interface ResonanceStock extends StockData {
  turnover: number;
  netProfitGrowth?: number | null;
  revenueGrowth?: number | null;
  maxPe: number;
  maxPb: number;
  maBullish: boolean;
  pocBreakout: boolean;
  sectorName?: string;
}

export interface SectorStockMeta {
  mode: 'long_term' | 'tactical';
  universeSort?: 'marketCap' | 'dailyChange';
  sampleSize: number;
  requestedLimit?: number;
  technicalEnrichment?: boolean;
  asOf: string;
  message: string;
}

export interface MarketAlert {
  time: string;
  symbol: string;
  name: string;
  type: string;
  value: string;
}

export interface FundFlow {
  netAmount: number;
  ratioAmount: number;
}

export interface MarketSentiment {
  up: number;
  down: number;
  flat: number;
  limitUp: number;
  limitDown: number;
  totalVolume: number;
  ladder: Record<string, unknown>;
  prevZtAvg: number;
  loading?: boolean;
}

export interface IntradayPoint {
  time: Time;
  value: number;
}

export interface HistoryPoint {
  time: Time;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface LinePoint {
  time: Time;
  value: number;
  color?: string;
}

export interface ChartMarker {
  time: Time;
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle';
  text: string;
  size: number;
}

export interface MarketDataMessage {
  type: 'market_data';
  payload: StockData[];
  indices: IndexData[];
  alerts: MarketAlert[];
  sectors: SectorData[];
  resonanceStocks: ResonanceStock[];
  resonanceMeta: ResonanceMeta;
}

export interface Group {
  id: string;
  name: string;
  bossName: string;
  symbols: string[];
}

export interface PaperTrade {
  id: string;
  symbol: string;
  name: string;
  buyPrice: number;
  buyTime: number;
  aiLogic: string;
  quantity?: number;
  strategyId?: string;
  strategyVersion?: string;
  signalType?: 'LONG_TERM' | 'TACTICAL' | 'MANUAL';
  signalSource?: string;
  thesisId?: string;
  benchmarkCode?: string;
  benchmarkName?: string;
  benchmarkBuyPrice?: number;
  benchmarkSellPrice?: number;
  entrySnapshot?: TradeEntrySnapshot;
  sellPrice?: number;
  sellTime?: number;
  sellAiLogic?: string;
  evaluation?: string;
  evalStatus?: string;
  evaluationConfidence?: number;
  evaluationAsOf?: string;
  evaluationSources?: EvidenceSource[];
  isEvaluating?: boolean;
}

export interface EvidenceSource {
  title: string;
  url: string;
  publishedAt?: string;
  sourceType?: string;
  keyFact?: string;
}

export interface ThesisEvaluationResult {
  evaluation: string;
  status: 'HOLD' | 'WARNING' | 'SELL';
  confidence?: number;
  asOf?: string;
  searchStatus?: 'complete' | 'partial' | 'failed';
  modelUsed?: string;
  kpiFindings?: string[];
  invalidations?: string[];
  sources?: EvidenceSource[];
}

export interface TradeEntrySnapshot {
  price: number;
  changePercent: number;
  pe?: number;
  pb?: number;
  marketCap?: number;
  sectorName?: string;
  capturedAt: number;
  aiModel?: string;
  aiConfidence?: number;
}

export interface InvestmentThesis {
  id: string;
  symbol: string;
  name: string;
  sectorName?: string;
  coreThesis: string;
  catalysts: string;
  risks: string;
  kpis: string;
  invalidation: string;
  horizon: '1Y' | '3Y' | '5Y';
  status: 'WATCH' | 'ACTIVE' | 'WARNING' | 'INVALIDATED';
  conviction: 1 | 2 | 3 | 4 | 5;
  createdAt: number;
  updatedAt: number;
  lastReviewedAt?: number;
  reviewHistory?: ThesisReview[];
}

export interface ThesisReview {
  reviewedAt: number;
  status: InvestmentThesis['status'];
  note: string;
  confidence?: number;
  sources?: EvidenceSource[];
}

export interface ResonanceMeta {
  status: 'initializing' | 'ok' | 'partial' | 'error';
  updatedAt: string | null;
  dataTimestamp: string | null;
  failedPages: number[];
  message: string;
}
