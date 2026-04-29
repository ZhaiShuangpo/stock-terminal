import { useEffect, useRef } from 'react';
import { createChart, ColorType, AreaSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import type { ISeriesApi } from 'lightweight-charts';

interface ChartProps {
  data: any[];
  vwapData?: any[];
  markers?: any[];
  prevClose?: number;
  colors?: {
    backgroundColor?: string;
    lineColor?: string;
    textColor?: string;
    areaTopColor?: string;
    areaBottomColor?: string;
  };
}

export const Chart = ({
  data,
  vwapData,
  markers,
  prevClose,
  colors: {
    backgroundColor = 'transparent',
    lineColor = '#2962FF',
    textColor = '#D9D9D9',
    areaTopColor = 'rgba(41, 98, 255, 0.4)',
    areaBottomColor = 'rgba(41, 98, 255, 0)',
  } = {},
}: ChartProps) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
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
        timeVisible: true,
        secondsVisible: false,
        borderColor: 'rgba(43, 43, 67, 0.5)',
        tickMarkFormatter: (time: number) => {
          const d = new Date(time * 1000);
          return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
        },
      },
      localization: {
        timeFormatter: (time: number) => {
          const d = new Date(time * 1000);
          return `${d.getUTCFullYear()}-${(d.getUTCMonth()+1).toString().padStart(2, '0')}-${d.getUTCDate().toString().padStart(2, '0')} ${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
        }
      },
      rightPriceScale: {
        borderColor: 'rgba(43, 43, 67, 0.5)',
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    });
    chartRef.current = chart;

    const lineSeries = chart.addSeries(AreaSeries, {
      lineColor,
      topColor: areaTopColor,
      bottomColor: areaBottomColor,
      lineWidth: 2,
    });
    seriesRef.current = lineSeries;

    const vwapSeries = chart.addSeries(LineSeries, {
      color: '#F59E0B', // Yellow color for VWAP
      lineWidth: 2,
      lineStyle: 0,
      crosshairMarkerVisible: false,
    });
    vwapSeriesRef.current = vwapSeries;

    if (data && data.length > 0) {
      lineSeries.setData(data);
      if (markers && markers.length > 0) {
        markersPrimitiveRef.current = createSeriesMarkers(lineSeries as any, markers);
      }
      chart.timeScale().fitContent();
    }
    if (vwapData && vwapData.length > 0) {
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
        const dataPoint = param.seriesData.get(lineSeries) as any;
        if (dataPoint) {
          const price = dataPoint.value;
          const timeObj = new Date((param.time as number) * 1000);
          const timeStr = `${timeObj.getUTCHours().toString().padStart(2, '0')}:${timeObj.getUTCMinutes().toString().padStart(2, '0')}`;
          
          let changeStr = '';
          if (prevClose) {
            const change = price - prevClose;
            const changePercent = (change / prevClose) * 100;
            const color = change > 0 ? '#ff3b30' : change < 0 ? '#34c759' : '#8e8e93';
            const sign = change > 0 ? '+' : '';
            changeStr = `<div style="color: ${color}; font-family: monospace; font-size: 11px;">${sign}${changePercent.toFixed(2)}%</div>`;
          }

          tooltip.innerHTML = `
            <div style="font-family: monospace; color: #9ca3af; margin-bottom: 2px;">${timeStr}</div>
            <div style="font-size: 14px; font-weight: bold; font-family: monospace; color: ${textColor};">${price.toFixed(2)}</div>
            ${changeStr}
          `;

          const toolTipWidth = 80;
          const toolTipHeight = 60;
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
  }, [backgroundColor, lineColor, textColor, areaTopColor, areaBottomColor, prevClose]);

  // Update data when data prop changes without recreating chart
  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      seriesRef.current.setData(data);
      if (markers) {
        if (!markersPrimitiveRef.current) {
          markersPrimitiveRef.current = createSeriesMarkers(seriesRef.current as any, markers);
        } else {
          markersPrimitiveRef.current.setMarkers(markers);
        }
      }
    }
    if (vwapSeriesRef.current && vwapData && vwapData.length > 0) {
      vwapSeriesRef.current.setData(vwapData);
    }
  }, [data, vwapData, markers]);

  return <div ref={chartContainerRef} className="w-full h-full relative" />;
};
