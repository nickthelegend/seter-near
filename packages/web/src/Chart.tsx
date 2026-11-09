import { useEffect, useRef } from 'react';
import { CandlestickSeries, type SeriesMarker, ColorType, CrosshairMode, HistogramSeries, LineStyle, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type IPriceLine, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { Candle } from './market';

export type ChartMark = { time: number; label: string; tone: 'fire' | 'check' };
const UP = '#16875a', DOWN = '#c23b3b';

/** Coinbase NEAR/USD candles with the enclave's last read price as a line and fires/checks as markers. */
export default function Chart({ data, enclavePrice, marks, compact = false }: { data: Candle[]; enclavePrice: number | null; marks: ChartMark[]; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vol = useRef<ISeriesApi<'Histogram'> | null>(null);
  const line = useRef<IPriceLine | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#6a6575', fontFamily: 'Space Mono, ui-monospace, monospace', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(23,19,33,0.04)' }, horzLines: { color: 'rgba(23,19,33,0.06)' } },
      rightPriceScale: { borderColor: 'rgba(23,19,33,0.1)', scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: 'rgba(23,19,33,0.1)', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(23,19,33,0.3)', labelBackgroundColor: '#16131e' }, horzLine: { color: 'rgba(23,19,33,0.3)', labelBackgroundColor: '#16131e' } },
      handleScroll: !compact, handleScale: !compact,
    });
    const s = c.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } });
    const v = c.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    chart.current = c; series.current = s; vol.current = v; markers.current = createSeriesMarkers(s, []);
    return () => { c.remove(); chart.current = null; series.current = null; vol.current = null; line.current = null; markers.current = null; };
  }, [compact]);

  useEffect(() => {
    if (!series.current || !vol.current) return;
    series.current.setData(data.map((d) => ({ time: d.time as UTCTimestamp, open: d.open, high: d.high, low: d.low, close: d.close })));
    vol.current.setData(data.map((d) => ({ time: d.time as UTCTimestamp, value: d.volume, color: d.close >= d.open ? 'rgba(22,135,90,0.18)' : 'rgba(194,59,59,0.18)' })));
    const first = data[0]?.time ?? 0, last = data[data.length - 1]?.time ?? 0;
    const step = data.length > 1 ? data[1].time - data[0].time : 900;
    markers.current?.setMarkers(marks.filter((m) => m.time >= first && m.time <= last + step).map((m): SeriesMarker<Time> => ({
      time: (m.time - ((m.time - first) % step)) as UTCTimestamp, position: m.tone === 'fire' ? 'aboveBar' as const : 'belowBar' as const, color: m.tone === 'fire' ? '#9a6f1f' : '#5a46d4', shape: m.tone === 'fire' ? 'arrowDown' as const : 'circle' as const, text: m.label,
    })).sort((a, b) => (a.time as number) - (b.time as number)));
  }, [data, marks]);

  useEffect(() => {
    if (!series.current) return;
    if (line.current) { series.current.removePriceLine(line.current); line.current = null; }
    if (enclavePrice) line.current = series.current.createPriceLine({ price: enclavePrice, color: '#5a46d4', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'enclave read' });
  }, [enclavePrice]);

  return <div className="chart" ref={box} />;
}
