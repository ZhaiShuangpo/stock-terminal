import { useEffect, useRef } from 'react';
import { createChart, ColorType, AreaSeries, LineSeries, CandlestickSeries, HistogramSeries, createSeriesMarkers } from 'lightweight-charts';
import type { ISeriesApi } from 'lightweight-charts';

interface ChartProps {
  data: any[];
  vwapData?: any[];
  markers?: any[];
  prevClose?: number;
  type?: 'area' | 'candlestick';
  volumeData?: any[];
  ma5Data?: any[];
  ma10Data?: any[];
  ma20Data?: any[];
  macdData?: { dif: any[]; dea: any[]; histogram: any[] };
  colors?: {
    backgroundColor?: string;
    lineColor?: string;
    textColor?: string;
    areaTopColor?: string;
    areaBottomColor?: string;
    upColor?: string;
    downColor?: string;
  };
}

export const Chart = ({
  data,
  vwapData,
  markers,
  prevClose,
  type = 'area',
  volumeData,
  ma5Data,
  ma10Data,
  ma20Data,
  macdData,
  colors: {
    backgroundColor = 'transparent',
    lineColor = '#2962FF',
    textColor = '#D9D9D9',
    areaTopColor = 'rgba(41, 98, 255, 0.4)',
    areaBottomColor = 'rgba(41, 98, 255, 0)',
    upColor = '#ff3b30', // A-share red for up
    downColor = '#34c759', // A-share green for down
  } = {},
}: ChartProps) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | ISeriesApi<"Candlestick"> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma5SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma10SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdDifRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdDeaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersPrimitiveRef = useRef<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: backgroundColor },
        textColor,
      },
      grid: {
        vertLines: { color: 'rgba(43, 43, 67, 0.3)' },
        horzLines: { color: 'rgba(43, 43, 67, 0.3)' },
      },
      timeScale: {
        timeVisible: type === 'area',
        secondsVisible: false,
        borderColor: 'rgba(43, 43, 67, 0.5)',
        tickMarkFormatter: (time: any) => {
          if (typeof time === 'string') return time;
          if (typeof time === 'object' && time !== null && 'year' in time) {
            return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
          }
          const d = new Date(time * 1000);
          if (type === 'area') {
            return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
          }
          return `${d.getUTCFullYear()}-${(d.getUTCMonth()+1).toString().padStart(2, '0')}-${d.getUTCDate().toString().padStart(2, '0')}`;
        },
      },
      localization: {
        timeFormatter: (time: any) => {
          if (typeof time === 'string') return time;
          if (typeof time === 'object' && time !== null && 'year' in time) {
            return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
          }
          const d = new Date(time * 1000);
          if (type === 'area') {
            return `${d.getUTCFullYear()}-${(d.getUTCMonth()+1).toString().padStart(2, '0')}-${d.getUTCDate().toString().padStart(2, '0')} ${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
          }
          return `${d.getUTCFullYear()}-${(d.getUTCMonth()+1).toString().padStart(2, '0')}-${d.getUTCDate().toString().padStart(2, '0')}`;
        }
      },
      rightPriceScale: {
        borderColor: 'rgba(43, 43, 67, 0.5)',
        scaleMargins: type === 'candlestick' ? { top: 0.05, bottom: 0.35 } : { top: 0.1, bottom: 0.1 },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    });

    chartRef.current = chart;

    let mainSeries;
    if (type === 'area') {
      mainSeries = chart.addSeries(AreaSeries, {
        lineColor,
        topColor: areaTopColor,
        bottomColor: areaBottomColor,
        lineWidth: 2,
      });
    } else {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor,
        downColor,
        borderVisible: false,
        wickUpColor: upColor,
        wickDownColor: downColor,
      });
      
      // Initialize MAs
      ma5SeriesRef.current = chart.addSeries(LineSeries, { color: '#E1BEE7', lineWidth: 1, crosshairMarkerVisible: false });
      ma10SeriesRef.current = chart.addSeries(LineSeries, { color: '#FFB74D', lineWidth: 1, crosshairMarkerVisible: false });
      ma20SeriesRef.current = chart.addSeries(LineSeries, { color: '#81D4FA', lineWidth: 1, crosshairMarkerVisible: false });
      
      // Initialize Volume
      volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
        color: '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      
      // Initialize MACD
      macdDifRef.current = chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 1, priceScaleId: 'macd', crosshairMarkerVisible: false });
      macdDeaRef.current = chart.addSeries(LineSeries, { color: '#FF6D00', lineWidth: 1, priceScaleId: 'macd', crosshairMarkerVisible: false });
      macdHistRef.current = chart.addSeries(HistogramSeries, { priceScaleId: 'macd' });

      // Apply price scale margins AFTER series creation
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.65, bottom: 0.2 },
      });
      chart.priceScale('macd').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
    }
    seriesRef.current = mainSeries;

    let vwapSeries = null;
    if (type === 'area') {
      vwapSeries = chart.addSeries(LineSeries, {
        color: '#F59E0B',
        lineWidth: 2,
        lineStyle: 0,
        crosshairMarkerVisible: false,
      });
      vwapSeriesRef.current = vwapSeries;
    }

    if (data && data.length > 0) {
      mainSeries.setData(data);
      if (markers && markers.length > 0 && type === 'area') {
        markersPrimitiveRef.current = createSeriesMarkers(mainSeries as any, markers);
      }
      chart.timeScale().fitContent();
    }
    if (vwapSeries && vwapData && vwapData.length > 0) {
      vwapSeries.setData(vwapData);
    }

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    const tooltip = document.createElement('div');
    tooltip.style.position = 'absolute';
    tooltip.style.display = 'none';
    tooltip.style.padding = '8px';
    tooltip.style.boxSizing = 'border-box';
    tooltip.style.fontSize = '12px';
    tooltip.style.textAlign = 'left';
    tooltip.style.zIndex = '1000';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    tooltip.style.borderRadius = '6px';
    tooltip.style.backgroundColor = 'rgba(17, 24, 39, 0.9)';
    tooltip.style.color = '#fff';
    tooltip.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.5)';
    chartContainerRef.current.appendChild(tooltip);

    chart.subscribeCrosshairMove((param) => {
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > chartContainerRef.current!.clientWidth ||
        param.point.y < 0 ||
        param.point.y > chartContainerRef.current!.clientHeight
      ) {
        tooltip.style.display = 'none';
      } else {
        tooltip.style.display = 'block';
        const dataPoint = param.seriesData.get(mainSeries) as any;
        if (dataPoint) {
          let timeStr = String(param.time);
          if (typeof param.time === 'number') {
            const timeObj = new Date(param.time * 1000);
            if (type === 'area') {
               timeStr = `${timeObj.getUTCHours().toString().padStart(2, '0')}:${timeObj.getUTCMinutes().toString().padStart(2, '0')}`;
            } else {
               timeStr = `${timeObj.getUTCFullYear()}-${(timeObj.getUTCMonth()+1).toString().padStart(2, '0')}-${timeObj.getUTCDate().toString().padStart(2, '0')}`;
            }
          } else if (typeof param.time === 'object' && param.time !== null && 'year' in param.time) {
            const bt = param.time as any;
            timeStr = `${bt.year}-${String(bt.month).padStart(2, '0')}-${String(bt.day).padStart(2, '0')}`;
          }

          let content = '';
          if (type === 'area') {
            const price = dataPoint.value;
            let changeStr = '';
            if (prevClose) {
              const change = price - prevClose;
              const changePercent = (change / prevClose) * 100;
              const color = change > 0 ? upColor : change < 0 ? downColor : '#8e8e93';
              const sign = change > 0 ? '+' : '';
              changeStr = `<div style="color: ${color}; font-family: monospace; font-size: 11px;">${sign}${changePercent.toFixed(2)}%</div>`;
            }
            content = `
              <div style="font-family: monospace; color: #9ca3af; margin-bottom: 2px;">${timeStr}</div>
              <div style="font-size: 14px; font-weight: bold; font-family: monospace; color: ${textColor};">${price.toFixed(2)}</div>
              ${changeStr}
            `;
          } else {
            // Candlestick tooltip
            const { open, high, low, close } = dataPoint;
            const change = close - open;
            const changePercent = (change / open) * 100;
            const color = change > 0 ? upColor : change < 0 ? downColor : '#8e8e93';
            const sign = change > 0 ? '+' : '';
            content = `
              <div style="font-family: monospace; color: #9ca3af; margin-bottom: 4px; border-bottom: 1px solid #374151; padding-bottom: 2px;">${timeStr}</div>
              <div style="display: grid; grid-template-columns: auto auto; gap: 2px 8px; font-family: monospace;">
                <span style="color: #9ca3af;">开盘</span><span style="color: ${textColor}; text-align: right;">${open.toFixed(2)}</span>
                <span style="color: #9ca3af;">最高</span><span style="color: ${textColor}; text-align: right;">${high.toFixed(2)}</span>
                <span style="color: #9ca3af;">最低</span><span style="color: ${textColor}; text-align: right;">${low.toFixed(2)}</span>
                <span style="color: #9ca3af;">收盘</span><span style="color: ${color}; font-weight: bold; text-align: right;">${close.toFixed(2)}</span>
              </div>
              <div style="color: ${color}; font-family: monospace; font-size: 11px; margin-top: 4px; text-align: right;">
                ${sign}${changePercent.toFixed(2)}%
              </div>
            `;
          }

          tooltip.innerHTML = content;

          const toolTipWidth = type === 'area' ? 80 : 120;
          const toolTipHeight = type === 'area' ? 60 : 100;
          const margin = 12;
          let left = param.point.x + margin;
          if (left > chartContainerRef.current!.clientWidth - toolTipWidth) {
            left = param.point.x - toolTipWidth - margin;
          }
          let top = param.point.y + margin;
          if (top > chartContainerRef.current!.clientHeight - toolTipHeight) {
            top = param.point.y - toolTipHeight - margin;
          }

          tooltip.style.left = left + 'px';
          tooltip.style.top = top + 'px';
        } else {
          tooltip.style.display = 'none';
        }
      }
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      tooltip.remove();
    };
  }, [backgroundColor, lineColor, textColor, areaTopColor, areaBottomColor, prevClose, type, upColor, downColor]);

  // Update data when data prop changes without recreating chart
  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      seriesRef.current.setData(data);
      if (markers && type === 'area') {
        if (!markersPrimitiveRef.current) {
          markersPrimitiveRef.current = createSeriesMarkers(seriesRef.current as any, markers);
        } else {
          markersPrimitiveRef.current.setMarkers(markers);
        }
      }
    }
    if (type === 'area' && vwapSeriesRef.current && vwapData && vwapData.length > 0) {
      vwapSeriesRef.current.setData(vwapData);
    }
    if (type === 'candlestick') {
      if (ma5SeriesRef.current && ma5Data) ma5SeriesRef.current.setData(ma5Data);
      if (ma10SeriesRef.current && ma10Data) ma10SeriesRef.current.setData(ma10Data);
      if (ma20SeriesRef.current && ma20Data) ma20SeriesRef.current.setData(ma20Data);
      if (volumeSeriesRef.current && volumeData) volumeSeriesRef.current.setData(volumeData);
      if (macdData && macdData.dif && macdData.dea && macdData.histogram) {
        if (macdDifRef.current) macdDifRef.current.setData(macdData.dif);
        if (macdDeaRef.current) macdDeaRef.current.setData(macdData.dea);
        if (macdHistRef.current) macdHistRef.current.setData(macdData.histogram);
      }
    }
  }, [data, vwapData, markers, type, ma5Data, ma10Data, ma20Data, volumeData, macdData]);

  return <div ref={chartContainerRef} className="w-full h-full relative" />;
};
