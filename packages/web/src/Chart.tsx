import { useEffect, useRef } from 'react';
import { CandlestickSeries, type SeriesMarker, ColorType, CrosshairMode, HistogramSeries, LineStyle, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type IPriceLine, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { Candle } from './market';

export type ChartMark = { time: number; label: string; tone: 'fire' | 'check' };
const UP = '#5effc4', DOWN = '#ff6b8b';

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
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8f8ca8', fontFamily: 'Space Mono, ui-monospace, monospace', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(170,160,255,0.05)' }, horzLines: { color: 'rgba(170,160,255,0.06)' } },
      rightPriceScale: { borderColor: 'rgba(170,160,255,0.12)', scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: 'rgba(170,160,255,0.12)', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(169,157,255,0.5)', labelBackgroundColor: '#3a2e91' }, horzLine: { color: 'rgba(169,157,255,0.5)', labelBackgroundColor: '#3a2e91' } },
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
    vol.current.setData(data.map((d) => ({ time: d.time as UTCTimestamp, value: d.volume, color: d.close >= d.open ? 'rgba(94,255,196,0.22)' : 'rgba(255,107,139,0.22)' })));
    const first = data[0]?.time ?? 0, last = data[data.length - 1]?.time ?? 0;
    const step = data.length > 1 ? data[1].time - data[0].time : 900;
    markers.current?.setMarkers(marks.filter((m) => m.time >= first && m.time <= last + step).map((m): SeriesMarker<Time> => ({
      time: (m.time - ((m.time - first) % step)) as UTCTimestamp, position: m.tone === 'fire' ? 'aboveBar' as const : 'belowBar' as const, color: m.tone === 'fire' ? UP : '#a99dff', shape: m.tone === 'fire' ? 'arrowDown' as const : 'circle' as const, text: m.label,
    })).sort((a, b) => (a.time as number) - (b.time as number)));
  }, [data, marks]);

  useEffect(() => {
    if (!series.current) return;
    if (line.current) { series.current.removePriceLine(line.current); line.current = null; }
    if (enclavePrice) line.current = series.current.createPriceLine({ price: enclavePrice, color: '#a99dff', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'enclave read' });
  }, [enclavePrice]);

  return <div className="chart" ref={box} />;
}
