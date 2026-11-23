import React from 'react';
import type { CostBreakdownItem, DerivedMetrics, Language } from '../types/ipds';
import { getTranslations } from '../i18n/translations';
import { formatCompactMoney } from '../utils/financialModel';

interface FinancialInfographicsProps {
  language: Language;
  metrics: DerivedMetrics;
  costStructure: CostBreakdownItem[];
  currencySymbol: string;
  theme?: 'dark' | 'light';
}

export const FinancialInfographics: React.FC<FinancialInfographicsProps> = ({
  language,
  metrics,
  costStructure,
  currencySymbol,
  theme = 'dark',
}) => {
  const t = getTranslations(language);
  const isLight = theme === 'light';
  const series = metrics.cashflowSeries.slice(0, 24);

  const width = 640;
  const height = 240;
  const padLeft = 64;
  const padRight = 22;
  const padTop = 22;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const values = series.map((p) => p.cumulativeCashflow);
  const minVal = Math.min(0, ...values);
  const maxVal = Math.max(1, ...values);
  const range = Math.max(1, maxVal - minVal);

  const xForIndex = (idx: number) =>
    padLeft + (series.length > 1 ? (idx / (series.length - 1)) * plotW : 0);
  const yForValue = (val: number) =>
    padTop + ((maxVal - val) / range) * plotH;

  const zeroY = yForValue(0);

  const linePoints = series
    .map((pt, idx) => `${xForIndex(idx).toFixed(1)},${yForValue(pt.cumulativeCashflow).toFixed(1)}`)
    .join(' ');

  const areaPath =
    series.length > 1
      ? `M ${xForIndex(0).toFixed(1)},${zeroY.toFixed(1)} L ${series
          .map((pt, idx) => `${xForIndex(idx).toFixed(1)},${yForValue(pt.cumulativeCashflow).toFixed(1)}`)
          .join(' L ')} L ${xForIndex(series.length - 1).toFixed(1)},${zeroY.toFixed(1)} Z`
      : '';

  const paybackIdx = series.findIndex((p) => p.month === metrics.paybackMonths);

  const gridLineColor = isLight ? '#E5E0D5' : 'rgba(255,255,255,0.08)';
  const zeroLineColor = isLight ? '#7A7E85' : 'rgba(245,158,11,0.45)';
  const labelColor = isLight ? '#5C6066' : '#94A3B8';
  const lineColor = isLight ? '#B88B4A' : '#F59E0B';
  const areaFill = isLight ? 'rgba(184,139,74,0.14)' : 'rgba(245,158,11,0.16)';
  const launchMarkerColor = isLight ? '#1E2022' : '#CBD5E1';
  const positiveColor = isLight ? '#15803D' : '#34D399';

  // Ежемесячная экономика (Выручка vs OPEX vs Прибыль)
  const maxBar = Math.max(1, metrics.monthlyRevenue, metrics.monthlyOpex);
  const revPct = Math.min(100, Math.round((metrics.monthlyRevenue / maxBar) * 100));
  const opexPct = Math.min(100, Math.round((metrics.monthlyOpex / maxBar) * 100));
  const profitPct = Math.min(100, Math.round((Math.max(0, metrics.monthlyProfit) / maxBar) * 100));

  const capexPalette = isLight
    ? ['#B88B4A', '#1F2124', '#4B6B82', '#7E786B', '#ACA596']
    : ['#F59E0B', '#D97706', '#38BDF8', '#94A3B8', '#64748B'];

  const totalShare = Math.max(
    1,
    costStructure.reduce((acc, c) => acc + (c.sharePct || 0), 0)
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      {/* График 1: Накопленный денежный поток и окупаемость */}
      <div
        className={`xl:col-span-7 rounded-xl p-5 border ${
          isLight
            ? 'bg-[#FAF8F3] border-[#E5E0D5] text-[#1E2022] shadow-[0_2px_10px_rgba(22,24,26,0.03)]'
            : 'bg-[#0E131D] border-white/[0.08] text-slate-100'
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            <h4 className="text-sm font-semibold">{t.charts.cashflowTitle}</h4>
            <p className={`text-xs mt-0.5 ${isLight ? 'text-[#5C6066]' : 'text-slate-400'}`}>
              {t.charts.launchLabel}: {metrics.launchMonths} {t.common.monthsShort} ·{' '}
              {t.charts.paybackPointLabel}:{' '}
              <span className="font-mono-tabular font-semibold">
                {metrics.paybackMonths
                  ? `${metrics.paybackMonths} ${t.common.monthsShort}`
                  : t.common.moreThan60Months}
              </span>
            </p>
          </div>
          <div className="text-xs font-mono-tabular">
            <span className={isLight ? 'text-[#5C6066]' : 'text-slate-400'}>
              {t.charts.m24TotalLabel}:{' '}
            </span>
            <span
              className="font-semibold"
              style={{
                color:
                  (series[series.length - 1]?.cumulativeCashflow ?? 0) >= 0
                    ? positiveColor
                    : lineColor,
              }}
            >
              {formatCompactMoney(
                series[series.length - 1]?.cumulativeCashflow ?? 0,
                currencySymbol,
                language
              )}
            </span>
          </div>
        </div>

        <div className="w-full overflow-hidden">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto block"
            role="img"
            aria-label={t.charts.cashflowAria}
          >
            {/* Горизонтальная сетка */}
            {[0, 0.25, 0.5, 0.75, 1].map((tVal) => {
              const val = maxVal - tVal * range;
              const y = padTop + tVal * plotH;
              return (
                <g key={tVal}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke={gridLineColor}
                    strokeWidth="1"
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 4}
                    textAnchor="end"
                    fill={labelColor}
                    fontSize="10"
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {formatCompactMoney(val, '', language).trim()}
                  </text>
                </g>
              );
            })}

            {/* Линия нуля (точка безубыточности) */}
            <line
              x1={padLeft}
              y1={zeroY}
              x2={width - padRight}
              y2={zeroY}
              stroke={zeroLineColor}
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />

            {/* Маркер месяца запуска */}
            {metrics.launchMonths >= 1 && metrics.launchMonths <= series.length && (
              <g>
                <line
                  x1={xForIndex(metrics.launchMonths - 1)}
                  y1={padTop}
                  x2={xForIndex(metrics.launchMonths - 1)}
                  y2={padTop + plotH}
                  stroke={launchMarkerColor}
                  strokeOpacity="0.35"
                  strokeDasharray="3 3"
                />
                <text
                  x={xForIndex(metrics.launchMonths - 1)}
                  y={padTop - 6}
                  textAnchor="middle"
                  fill={labelColor}
                  fontSize="10"
                >
                  {t.charts.launchMarker} ({t.common.monthPrefix}
                  {metrics.launchMonths})
                </text>
              </g>
            )}

            {/* Заливка и линия графика */}
            {areaPath && <path d={areaPath} fill={areaFill} />}
            {linePoints && (
              <polyline
                fill="none"
                stroke={lineColor}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={linePoints}
              />
            )}

            {/* Точка окупаемости */}
            {paybackIdx >= 0 && (
              <g>
                <circle
                  cx={xForIndex(paybackIdx)}
                  cy={yForValue(series[paybackIdx].cumulativeCashflow)}
                  r="5"
                  fill={positiveColor}
                  stroke={isLight ? '#FFFFFF' : '#0E131D'}
                  strokeWidth="2"
                />
                <text
                  x={Math.min(width - 80, xForIndex(paybackIdx) + 8)}
                  y={Math.max(padTop + 14, yForValue(series[paybackIdx].cumulativeCashflow) - 8)}
                  fill={positiveColor}
                  fontSize="10.5"
                  fontWeight="600"
                >
                  {t.charts.paybackPointLabel}: {t.common.monthPrefix}
                  {metrics.paybackMonths}
                </text>
              </g>
            )}

            {/* Подписи оси X */}
            {series
              .filter((_, i) => i === 0 || (i + 1) % 4 === 0 || i === series.length - 1)
              .map((pt) => {
                const idx = series.indexOf(pt);
                return (
                  <text
                    key={pt.month}
                    x={xForIndex(idx)}
                    y={height - 10}
                    textAnchor="middle"
                    fill={labelColor}
                    fontSize="10"
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {pt.label}
                  </text>
                );
              })}
          </svg>
        </div>
      </div>

      {/* График 2: Ежемесячная экономика и структура инвестиций */}
      <div
        className={`xl:col-span-5 rounded-xl p-5 border flex flex-col justify-between gap-5 ${
          isLight
            ? 'bg-[#FAF8F3] border-[#E5E0D5] text-[#1E2022] shadow-[0_2px_10px_rgba(22,24,26,0.03)]'
            : 'bg-[#0E131D] border-white/[0.08] text-slate-100'
        }`}
      >
        <div>
          <h4 className="text-sm font-semibold">{t.charts.balanceTitle}</h4>
          <div className="mt-3 space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className={isLight ? 'text-[#5C6066]' : 'text-slate-300'}>
                  {t.charts.monthlyRevenue}
                </span>
                <span className="font-mono-tabular font-semibold">
                  {formatCompactMoney(metrics.monthlyRevenue, currencySymbol, language)}
                </span>
              </div>
              <div
                className={`h-2.5 rounded-sm overflow-hidden ${
                  isLight ? 'bg-[#E5E0D5]' : 'bg-white/[0.06]'
                }`}
              >
                <div
                  className="h-full bg-[#B88B4A] transition-all duration-200"
                  style={{ width: `${revPct}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className={isLight ? 'text-[#5C6066]' : 'text-slate-300'}>
                  {t.charts.monthlyOpex.replace('{count}', String(metrics.headcount))}
                </span>
                <span className="font-mono-tabular font-semibold">
                  {formatCompactMoney(metrics.monthlyOpex, currencySymbol, language)}
                </span>
              </div>
              <div
                className={`h-2.5 rounded-sm overflow-hidden ${
                  isLight ? 'bg-[#E5E0D5]' : 'bg-white/[0.06]'
                }`}
              >
                <div
                  className="h-full bg-[#1F2124] transition-all duration-200"
                  style={{ width: `${opexPct}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className={isLight ? 'text-[#5C6066]' : 'text-slate-300'}>
                  {t.charts.monthlyProfit}
                </span>
                <span
                  className={`font-mono-tabular font-semibold ${
                    metrics.monthlyProfit >= 0
                      ? isLight
                        ? 'text-emerald-700'
                        : 'text-emerald-400'
                      : isLight
                      ? 'text-rose-700'
                      : 'text-rose-400'
                  }`}
                >
                  {formatCompactMoney(metrics.monthlyProfit, currencySymbol, language)} (
                  {metrics.ebitdaMarginPct}%)
                </span>
              </div>
              <div
                className={`h-2.5 rounded-sm overflow-hidden ${
                  isLight ? 'bg-[#E5E0D5]' : 'bg-white/[0.06]'
                }`}
              >
                <div
                  className={`h-full transition-all duration-200 ${
                    metrics.monthlyProfit >= 0 ? 'bg-emerald-600' : 'bg-rose-600'
                  }`}
                  style={{ width: `${Math.max(4, profitPct)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Сегментированная структура инвестиций */}
        <div className={`pt-4 border-t ${isLight ? 'border-[#E5E0D5]' : 'border-white/[0.07]'}`}>
          <h4 className="text-sm font-semibold mb-2">{t.charts.capexStructure}</h4>
          <div className="h-3 rounded-sm overflow-hidden flex gap-0.5">
            {costStructure.slice(0, 5).map((item, idx) => (
              <div
                key={item.category}
                style={{
                  width: `${(item.sharePct / totalShare) * 100}%`,
                  backgroundColor: capexPalette[idx % capexPalette.length],
                }}
                title={`${item.category}: ${item.sharePct}%`}
              />
            ))}
          </div>
          <div className="mt-2.5 space-y-1.5">
            {costStructure.slice(0, 5).map((item, idx) => (
              <div
                key={item.category}
                className="flex items-center justify-between text-xs gap-2"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: capexPalette[idx % capexPalette.length] }}
                  />
                  <span className={`truncate ${isLight ? 'text-[#3A3D42]' : 'text-slate-300'}`}>
                    {item.category}
                  </span>
                </span>
                <span className="font-mono-tabular shrink-0 font-medium">
                  {item.sharePct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
