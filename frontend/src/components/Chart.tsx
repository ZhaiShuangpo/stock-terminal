import { useEffect, useRef } from 'react';
import { createChart, ColorType, AreaSeries, LineSeries, CandlestickSeries, HistogramSeries, createSeriesMarkers } from 'lightweight-charts';
import type {
  AreaData, BusinessDay, CandlestickData, IChartApi, IPriceLine,
  ISeriesApi, ISeriesMarkersPluginApi, SeriesMarker, Time,
} from 'lightweight-charts';
import type { ChartMarker, HistoryPoint, IntradayPoint, LinePoint } from '../types/domain';

interface ChartProps {
  data: Array<IntradayPoint | HistoryPoint>;
  vwapData?: LinePoint[];
  markers?: ChartMarker[];
  prevClose?: number;
  type?: 'area' | 'candlestick';
  volumeData?: LinePoint[];
  ma5Data?: LinePoint[];
  ma10Data?: LinePoint[];
  ma20Data?: LinePoint[];
  ma60Data?: LinePoint[];
  ma120Data?: LinePoint[];
  macdData?: { dif: LinePoint[]; dea: LinePoint[]; histogram: LinePoint[] };
  supportPrice?: number;
  resistancePrice?: number;
  visibleIndicators?: {
    ma: boolean;
    macd: boolean;
    volume: boolean;
    vp: boolean;
  };
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
  ma60Data,
  ma120Data,
  macdData,
  supportPrice,
  resistancePrice,
  visibleIndicators = { ma: true, macd: true, volume: true, vp: true },
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
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | ISeriesApi<"Candlestick"> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma5SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma10SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma60SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma120SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdDifRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdDeaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersPrimitiveRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const supportLineRef = useRef<IPriceLine | null>(null);
  const resistanceLineRef = useRef<IPriceLine | null>(null);
  const vpContainerRef = useRef<HTMLDivElement | null>(null);
  const updateVpRef = useRef<() => void>(() => {});
  const dataRef = useRef(data);
  const volumeDataRef = useRef(volumeData);
  const vwapDataRef = useRef(vwapData);
  const markersRef = useRef(markers);

  const visibleIndicatorsRef = useRef(visibleIndicators);

  useEffect(() => {
    dataRef.current = data;
    volumeDataRef.current = volumeData;
    vwapDataRef.current = vwapData;
    markersRef.current = markers;
  }, [data, volumeData, vwapData, markers]);

  useEffect(() => {
    visibleIndicatorsRef.current = visibleIndicators;
  }, [visibleIndicators]);

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
        tickMarkFormatter: (time: Time) => {
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
        timeFormatter: (time: Time) => {
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
      
      // Initialize MAs without horizontal Y-axis lines
      ma5SeriesRef.current = chart.addSeries(LineSeries, { color: '#E1BEE7', lineWidth: 1, crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false });
      ma10SeriesRef.current = chart.addSeries(LineSeries, { color: '#FFB74D', lineWidth: 1, crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false });
      ma20SeriesRef.current = chart.addSeries(LineSeries, { color: '#81D4FA', lineWidth: 1, crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false });
      ma60SeriesRef.current = chart.addSeries(LineSeries, { color: '#BCAAA4', lineWidth: 1, crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false });
      ma120SeriesRef.current = chart.addSeries(LineSeries, { color: '#80CBC4', lineWidth: 1, crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false });

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

    const initialData = dataRef.current;
    const initialMarkers = markersRef.current;
    const initialVwapData = vwapDataRef.current;
    if (initialData.length > 0) {
      if (type === 'area') {
        (mainSeries as ISeriesApi<'Area'>).setData(initialData as AreaData<Time>[]);
      } else {
        (mainSeries as ISeriesApi<'Candlestick'>).setData(initialData as CandlestickData<Time>[]);
      }
      if (initialMarkers && initialMarkers.length > 0) {
        markersPrimitiveRef.current = createSeriesMarkers(mainSeries, initialMarkers as unknown as SeriesMarker<Time>[]);
      }
      chart.timeScale().fitContent();
    }
    if (vwapSeries && initialVwapData && initialVwapData.length > 0) {
      vwapSeries.setData(initialVwapData);
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

    const vpContainer = document.createElement('div');
    vpContainer.style.position = 'absolute';
    vpContainer.style.top = '0';
    vpContainer.style.bottom = '0';
    vpContainer.style.right = '0';
    vpContainer.style.width = '100%';
    vpContainer.style.pointerEvents = 'none';
    vpContainer.style.zIndex = '5';
    vpContainer.style.overflow = 'hidden';
    chartContainerRef.current.appendChild(vpContainer);
    vpContainerRef.current = vpContainer;

    const updateVolumeProfile = () => {
      if (!visibleIndicatorsRef.current.vp || type !== 'candlestick' || !seriesRef.current || !dataRef.current || !volumeDataRef.current || dataRef.current.length === 0) {
        vpContainer.style.display = 'none';
        return;
      }
      vpContainer.style.display = 'block';

      const visibleLogicalRange = chart.timeScale().getVisibleLogicalRange();
      if (!visibleLogicalRange) return;

      const startIndex = Math.max(0, Math.floor(visibleLogicalRange.from));
      const endIndex = Math.min(dataRef.current.length - 1, Math.ceil(visibleLogicalRange.to));
      
      if (startIndex >= endIndex) return;

      let minP = Infinity;
      let maxP = -Infinity;
      for (let i = startIndex; i <= endIndex; i++) {
         const d = dataRef.current[i];
         if (!('low' in d)) continue;
         if (d.low < minP) minP = d.low;
         if (d.high > maxP) maxP = d.high;
      }

      if (minP === Infinity || maxP === -Infinity) return;

      const BINS = 50;
      const binSize = (maxP - minP) / BINS;
      if (binSize === 0) return;

      const bins = new Array(BINS).fill(0);
      for (let i = startIndex; i <= endIndex; i++) {
        const d = dataRef.current[i];
        if (!('low' in d)) continue;
        const v = volumeDataRef.current[i]?.value || 0;
        const typPrice = (d.high + d.low + d.close) / 3;
        let binIdx = Math.floor((typPrice - minP) / binSize);
        if (binIdx >= BINS) binIdx = BINS - 1;
        if (binIdx < 0) binIdx = 0;
        bins[binIdx] += v;
      }

      let maxBinVol = Math.max(...bins);
      if (maxBinVol === 0) maxBinVol = 1;

      let html = '';
      const priceScaleW = 55; // right price scale width
      
      for (let i = 0; i < BINS; i++) {
        const binVol = bins[i];
        if (binVol === 0) continue;
        const priceCenter = minP + (i + 0.5) * binSize;
        
        // Lightweight charts coordinate calculation
        const yTop = seriesRef.current.priceToCoordinate(priceCenter + binSize/2);
        const yBottom = seriesRef.current.priceToCoordinate(priceCenter - binSize/2);
        
        if (yTop === null || yBottom === null) continue;
        
        const h = Math.abs(yBottom - yTop);
        const w = (binVol / maxBinVol) * 120; // max width 120px
        
        // Ensure volume profile stays above the MACD/Volume panes
        // Those panes take up the bottom ~35% of the chart based on scaleMargins
        if (yTop > chartContainerRef.current!.clientHeight * 0.65) continue;

        html += `<div style="
          position: absolute;
          right: ${priceScaleW}px;
          top: ${Math.min(yTop, yBottom)}px;
          height: ${Math.max(1, h)}px;
          width: ${w}px;
          background-color: rgba(41, 98, 255, 0.15);
          border-right: 2px solid rgba(41, 98, 255, 0.8);
          border-top: 1px solid rgba(41, 98, 255, 0.1);
          border-bottom: 1px solid rgba(41, 98, 255, 0.1);
          box-sizing: border-box;
          z-index: 5;
        "></div>`;
      }
      vpContainer.innerHTML = html;
    };

    let lastVpTime = 0;
    let vpTimeout: ReturnType<typeof setTimeout> | null = null;
    const updateVolumeProfileThrottled = () => {
      const now = Date.now();
      const throttleMs = 100;
      if (now - lastVpTime >= throttleMs) {
        if (vpTimeout) {
          clearTimeout(vpTimeout);
          vpTimeout = null;
        }
        updateVolumeProfile();
        lastVpTime = now;
      } else {
        if (!vpTimeout) {
          vpTimeout = setTimeout(() => {
            updateVolumeProfile();
            lastVpTime = Date.now();
            vpTimeout = null;
          }, throttleMs - (now - lastVpTime));
        }
      }
    };
    updateVpRef.current = updateVolumeProfileThrottled;

    chart.timeScale().subscribeVisibleLogicalRangeChange(updateVolumeProfileThrottled);

    chart.subscribeCrosshairMove((param) => {
      updateVolumeProfileThrottled();
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
        const dataPoint = param.seriesData.get(mainSeries) as AreaData<Time> | CandlestickData<Time> | undefined;
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
            const bt = param.time as BusinessDay;
            timeStr = `${bt.year}-${String(bt.month).padStart(2, '0')}-${String(bt.day).padStart(2, '0')}`;
          }

          let content = '';
          if (type === 'area') {
            const price = 'value' in dataPoint ? dataPoint.value : dataPoint.close;
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
            if (!('open' in dataPoint)) return;
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
      vpContainer.remove();
      if (vpTimeout) clearTimeout(vpTimeout);
      supportLineRef.current = null;
      resistanceLineRef.current = null;
      markersPrimitiveRef.current = null;
    };
  }, [backgroundColor, lineColor, textColor, areaTopColor, areaBottomColor, prevClose, type, upColor, downColor]);

  // Update data when data prop changes without recreating chart
  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      if (type === 'area') {
        (seriesRef.current as ISeriesApi<'Area'>).setData(data as AreaData<Time>[]);
      } else {
        (seriesRef.current as ISeriesApi<'Candlestick'>).setData(data as CandlestickData<Time>[]);
      }
      if (markers && type === 'area') {
        if (!markersPrimitiveRef.current) {
          markersPrimitiveRef.current = createSeriesMarkers(seriesRef.current, markers as unknown as SeriesMarker<Time>[]);
        } else {
          markersPrimitiveRef.current.setMarkers(markers as unknown as SeriesMarker<Time>[]);
        }
      }

      // Handle Support Line
      if (supportPrice !== undefined && supportPrice !== null) {
        if (!supportLineRef.current) {
          supportLineRef.current = seriesRef.current.createPriceLine({
            price: supportPrice,
            color: '#ff3b30',
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: '支撑',
          });
        } else {
          supportLineRef.current.applyOptions({ price: supportPrice });
        }
      } else if (supportLineRef.current) {
        seriesRef.current.removePriceLine(supportLineRef.current);
        supportLineRef.current = null;
      }

      // Handle Resistance Line
      if (resistancePrice !== undefined && resistancePrice !== null) {
        if (!resistanceLineRef.current) {
          resistanceLineRef.current = seriesRef.current.createPriceLine({
            price: resistancePrice,
            color: '#34c759',
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: '压力',
          });
        } else {
          resistanceLineRef.current.applyOptions({ price: resistancePrice });
        }
      } else if (resistanceLineRef.current) {
        seriesRef.current.removePriceLine(resistanceLineRef.current);
        resistanceLineRef.current = null;
      }
    }
    if (type === 'area' && vwapSeriesRef.current && vwapData && vwapData.length > 0) {
      vwapSeriesRef.current.setData(vwapData);
    }
    if (type === 'candlestick') {
      if (ma5SeriesRef.current && ma5Data) ma5SeriesRef.current.setData(ma5Data);
      if (ma10SeriesRef.current && ma10Data) ma10SeriesRef.current.setData(ma10Data);
      if (ma20SeriesRef.current && ma20Data) ma20SeriesRef.current.setData(ma20Data);
      if (ma60SeriesRef.current && ma60Data) ma60SeriesRef.current.setData(ma60Data);
      if (ma120SeriesRef.current && ma120Data) ma120SeriesRef.current.setData(ma120Data);
      if (volumeSeriesRef.current && volumeData) volumeSeriesRef.current.setData(volumeData);
      if (macdData && macdData.dif && macdData.dea && macdData.histogram) {
        if (macdDifRef.current) macdDifRef.current.setData(macdData.dif);
        if (macdDeaRef.current) macdDeaRef.current.setData(macdData.dea);
        if (macdHistRef.current) macdHistRef.current.setData(macdData.histogram);
      }
      setTimeout(() => updateVpRef.current(), 50);
    }
  }, [data, vwapData, markers, type, ma5Data, ma10Data, ma20Data, ma60Data, ma120Data, volumeData, macdData, supportPrice, resistancePrice]);

  useEffect(() => {
    if (type === 'candlestick') {
      if (ma5SeriesRef.current) ma5SeriesRef.current.applyOptions({ visible: visibleIndicators.ma });
      if (ma10SeriesRef.current) ma10SeriesRef.current.applyOptions({ visible: visibleIndicators.ma });
      if (ma20SeriesRef.current) ma20SeriesRef.current.applyOptions({ visible: visibleIndicators.ma });
      if (ma60SeriesRef.current) ma60SeriesRef.current.applyOptions({ visible: visibleIndicators.ma });
      if (ma120SeriesRef.current) ma120SeriesRef.current.applyOptions({ visible: visibleIndicators.ma });
      
      if (volumeSeriesRef.current) volumeSeriesRef.current.applyOptions({ visible: visibleIndicators.volume });
      
      if (macdDifRef.current) macdDifRef.current.applyOptions({ visible: visibleIndicators.macd });
      if (macdDeaRef.current) macdDeaRef.current.applyOptions({ visible: visibleIndicators.macd });
      if (macdHistRef.current) macdHistRef.current.applyOptions({ visible: visibleIndicators.macd });
      
      if (updateVpRef.current) {
        updateVpRef.current();
      }
    }
  }, [type, visibleIndicators.ma, visibleIndicators.volume, visibleIndicators.macd, visibleIndicators.vp]);


  return <div ref={chartContainerRef} className="w-full h-full relative" />;
};
