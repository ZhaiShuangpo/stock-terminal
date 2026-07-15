import { useMemo, useState } from 'react';
import type { InvestmentThesis, StockData } from '../types/domain';

interface Props {
  stocks: StockData[];
  theses: InvestmentThesis[];
  onChange: (theses: InvestmentThesis[]) => void;
  onSelectStock: (stock: StockData) => void;
}

type ThesisForm = Pick<InvestmentThesis, 'coreThesis' | 'catalysts' | 'risks' | 'kpis' | 'invalidation' | 'horizon' | 'conviction'>;
const emptyForm: ThesisForm = { coreThesis: '', catalysts: '', risks: '', kpis: '', invalidation: '', horizon: '3Y', conviction: 3 };
const labels = { coreThesis: '核心投资逻辑（必填）', catalysts: '潜在催化剂', risks: '主要风险', kpis: '需要跟踪的关键指标', invalidation: '逻辑失效条件（必填）' };

export function ResearchCenter({ stocks, theses, onChange, onSelectStock }: Props) {
  const [symbol, setSymbol] = useState(stocks[0]?.symbol ?? '');
  const [form, setForm] = useState<ThesisForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const effectiveSymbol = symbol || stocks[0]?.symbol || '';
  const selected = useMemo(() => stocks.find((stock) => stock.symbol === effectiveSymbol), [stocks, effectiveSymbol]);

  const reset = () => { setEditingId(null); setForm(emptyForm); };
  const save = () => {
    if (!selected || !form.coreThesis.trim() || !form.invalidation.trim()) {
      window.alert('请选择公司，并填写核心逻辑与失效条件。');
      return;
    }
    const now = Date.now();
    if (editingId) {
      onChange(theses.map((thesis) => thesis.id === editingId ? { ...thesis, ...form, symbol: selected.symbol, name: selected.name, sectorName: selected.sectorName, updatedAt: now } : thesis));
    } else {
      onChange([{ id: `thesis_${now}`, symbol: selected.symbol, name: selected.name, sectorName: selected.sectorName, ...form, status: 'ACTIVE', createdAt: now, updatedAt: now, reviewHistory: [] }, ...theses]);
    }
    reset();
  };

  const startEdit = (thesis: InvestmentThesis) => {
    setEditingId(thesis.id);
    setSymbol(thesis.symbol);
    setForm({ coreThesis: thesis.coreThesis, catalysts: thesis.catalysts, risks: thesis.risks, kpis: thesis.kpis, invalidation: thesis.invalidation, horizon: thesis.horizon, conviction: thesis.conviction });
  };

  const addReview = (thesis: InvestmentThesis) => {
    const note = (reviewNotes[thesis.id] || '').trim();
    if (!note) return;
    const now = Date.now();
    onChange(theses.map((item) => item.id === thesis.id ? { ...item, lastReviewedAt: now, updatedAt: now, reviewHistory: [{ reviewedAt: now, status: item.status, note }, ...(item.reviewHistory || [])] } : item));
    setReviewNotes((current) => ({ ...current, [thesis.id]: '' }));
  };

  return <div className="flex-1 overflow-auto p-6 bg-[var(--color-stock-bg)]">
    <div className="mb-5"><h2 className="text-2xl font-bold">公司研究与投资逻辑</h2><p className="text-xs text-gray-500 mt-1">策略实验室的“联网逻辑体检”会回写关联卡片；个股AI投资分析需在详情页点击“同步到公司研究”，只追加复核证据，不自动覆盖长期逻辑。</p></div>
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3 self-start">
        <div className="flex justify-between"><b>{editingId ? '编辑研究卡片' : '新建研究卡片'}</b>{editingId && <button onClick={reset} className="text-xs text-gray-500 hover:text-white">取消编辑</button>}</div>
        <select value={effectiveSymbol} onChange={(e) => setSymbol(e.target.value)} className="w-full bg-black border border-gray-700 rounded px-3 py-2"><option value="">选择自选公司</option>{stocks.map((stock) => <option key={stock.symbol} value={stock.symbol}>{stock.name} · {stock.code}</option>)}</select>
        {(['coreThesis', 'catalysts', 'risks', 'kpis', 'invalidation'] as const).map((field) => <textarea key={field} value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} placeholder={labels[field]} className="w-full h-20 bg-black border border-gray-700 rounded px-3 py-2 text-xs resize-y" />)}
        <div className="grid grid-cols-2 gap-3"><select value={form.horizon} onChange={(e) => setForm({ ...form, horizon: e.target.value as InvestmentThesis['horizon'] })} className="bg-black border border-gray-700 rounded px-3 py-2"><option value="1Y">1 年</option><option value="3Y">3 年</option><option value="5Y">5 年</option></select><select value={form.conviction} onChange={(e) => setForm({ ...form, conviction: Number(e.target.value) as InvestmentThesis['conviction'] })} className="bg-black border border-gray-700 rounded px-3 py-2">{[1,2,3,4,5].map((n) => <option key={n} value={n}>信念 {n}/5</option>)}</select></div>
        <button onClick={save} className="w-full bg-blue-600 hover:bg-blue-500 rounded py-2 font-bold">{editingId ? '保存修改' : '保存研究卡片'}</button>
      </div>
      <div className="xl:col-span-2 space-y-3">
        {theses.length === 0 ? <div className="text-center text-gray-500 border border-dashed border-gray-800 rounded-xl py-20">尚未建立投资逻辑。先回答“为什么长期持有、什么情况下证明自己错了”。</div> : theses.map((thesis) => <div key={thesis.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex flex-wrap justify-between gap-3"><button onClick={() => { const stock = stocks.find((item) => item.symbol === thesis.symbol); if (stock) onSelectStock(stock); }} className="font-bold text-lg hover:text-blue-400">{thesis.name} <span className="text-xs text-gray-500">{thesis.symbol}</span></button><div className="flex flex-wrap gap-2"><span className="text-xs bg-blue-950 text-blue-300 px-2 py-1 rounded">{thesis.horizon} · 信念 {thesis.conviction}/5</span><select value={thesis.status} onChange={(e) => onChange(theses.map((item) => item.id === thesis.id ? { ...item, status: e.target.value as InvestmentThesis['status'], updatedAt: Date.now() } : item))} className="text-xs bg-black border border-gray-700 rounded"><option value="WATCH">观察</option><option value="ACTIVE">有效</option><option value="WARNING">预警</option><option value="INVALIDATED">失效</option></select><button onClick={() => startEdit(thesis)} className="text-xs text-blue-400">编辑</button><button onClick={() => { if (window.confirm('确认删除此研究卡片？')) onChange(theses.filter((item) => item.id !== thesis.id)); }} className="text-xs text-gray-600 hover:text-red-400">删除</button></div></div>
          <div className="grid md:grid-cols-2 gap-3 mt-3 text-xs"><div className="bg-black/40 p-3 rounded"><b className="text-blue-400">核心逻辑</b><p className="mt-1 whitespace-pre-wrap text-gray-300">{thesis.coreThesis}</p></div><div className="bg-black/40 p-3 rounded"><b className="text-red-400">失效条件</b><p className="mt-1 whitespace-pre-wrap text-gray-300">{thesis.invalidation}</p></div><div><b className="text-gray-400">催化剂：</b>{thesis.catalysts || '未记录'}</div><div><b className="text-gray-400">风险：</b>{thesis.risks || '未记录'}</div><div className="md:col-span-2"><b className="text-gray-400">跟踪指标：</b>{thesis.kpis || '未记录'}</div></div>
          <div className="mt-3 border-t border-gray-800 pt-3"><div className="flex gap-2"><input value={reviewNotes[thesis.id] || ''} onChange={(e) => setReviewNotes((current) => ({ ...current, [thesis.id]: e.target.value }))} placeholder="记录本次复核的新事实、KPI变化或反方证据" className="flex-1 bg-black border border-gray-700 rounded px-3 py-2 text-xs"/><button onClick={() => addReview(thesis)} className="px-3 bg-gray-800 hover:bg-gray-700 rounded text-xs">添加复核</button></div>{(thesis.reviewHistory?.length || 0) > 0 && <div className="mt-2 space-y-1 max-h-24 overflow-auto">{thesis.reviewHistory!.slice(0, 5).map((review) => <div key={review.reviewedAt} className="text-[11px] text-gray-500"><span className="font-mono">{new Date(review.reviewedAt).toLocaleDateString()}</span> · {review.note}</div>)}</div>}</div>
        </div>)}
      </div>
    </div>
  </div>;
}
