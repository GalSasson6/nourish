import { useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Meal, Nutrients, UserSettings } from '../types';
import { formatCompact, getHealthScore, getHealthScoreColor, getHealthScoreExplanation, getMealEmoji, startOfDay, sumNutrients } from '../lib';

type Range = 'day' | 'week' | 'month';
type Metric = keyof Nutrients | 'score';

const averageHealthScore = (meals: Meal[]) => meals.length
  ? meals.reduce((sum, meal) => sum + getHealthScore(meal), 0) / meals.length
  : 0;

function rangeDates(range: Range, offset: number) {
  const now = startOfDay(new Date());
  if (range === 'day') {
    const start = new Date(now); start.setDate(start.getDate() + offset);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (range === 'week') {
    const start = new Date(now);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return { start, end };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { start, end };
}

function labelRange(range: Range, start: Date, end: Date) {
  if (range === 'day') return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(start);
  if (range === 'month') return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(start);
  const inclusiveEnd = new Date(end); inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  return `${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(start)} – ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(inclusiveEnd)}`;
}

export function HistoryPage({ meals, settings }: { meals: Meal[]; settings: UserSettings }) {
  const [range, setRange] = useState<Range>('week');
  const [metric, setMetric] = useState<Metric>('score');
  const [offset, setOffset] = useState(0);
  const [expandedMeals, setExpandedMeals] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedMeals(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const dates = rangeDates(range, offset);
  const visible = meals.filter((meal) => {
    const date = new Date(meal.eatenAt);
    return date >= dates.start && date < dates.end;
  });
  const totals = sumNutrients(visible);

  const chartData = useMemo(() => {
    if (range === 'day') {
      return Array.from({ length: 6 }, (_, index) => {
        const bucketMeals = visible.filter((meal) => Math.floor(new Date(meal.eatenAt).getHours() / 4) === index);
        const label = index === 0 ? '12a' : index < 3 ? `${index * 4}a` : index === 3 ? '12p' : `${index * 4 - 12}p`;
        return { id: label, label, value: metric === 'score' ? (bucketMeals.length ? averageHealthScore(bucketMeals) : null) : sumNutrients(bucketMeals)[metric] };
      });
    }
    const dayCount = Math.round((dates.end.getTime() - dates.start.getTime()) / 86_400_000);
    return Array.from({ length: dayCount }, (_, index) => {
      const dayStart = new Date(dates.start); dayStart.setDate(dayStart.getDate() + index);
      const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
      const dayMeals = visible.filter((meal) => new Date(meal.eatenAt) >= dayStart && new Date(meal.eatenAt) < dayEnd);
      return {
        id: String(dayStart.getTime()),
        label: range === 'week'
          ? new Intl.DateTimeFormat('en', { weekday: 'narrow' }).format(dayStart)
          : String(dayStart.getDate()),
        value: metric === 'score' ? (dayMeals.length ? averageHealthScore(dayMeals) : null) : sumNutrients(dayMeals)[metric],
      };
    });
  }, [range, visible, dates.start.getTime(), dates.end.getTime(), metric]);

  const loggedDays = new Set(visible.map((meal) => new Date(meal.eatenAt).toDateString())).size || 1;
  const dailyAvg = metric === 'score' ? averageHealthScore(visible) : Math.round(totals[metric] / loggedDays);
  const metricLabel = metric === 'calories' ? 'Calories' : metric.charAt(0).toUpperCase() + metric.slice(1);
  const metricUnit = metric === 'score' ? '/10' : metric === 'calories' ? 'kcal' : metric === 'sodium' ? 'mg' : 'g';
  const metricGoal = metric === 'score' ? 7 : settings.goals[metric];
  const metricStatus = metric === 'score' ? (!visible.length ? 'No data' : dailyAvg >= 7 ? 'Good' : dailyAvg >= 5 ? 'Fair' : 'Needs work') : dailyAvg <= metricGoal ? 'On track' : 'Above goal';
  const metricStatusStyle = metric === 'score' ? (visible.length ? getHealthScoreColor(Math.round(dailyAvg)) : { color: '#667b8c', background: '#edf2f5' }) : undefined;
  const chartColor = metric === 'score' ? '#759678' : '#0a69ba';
  const sortedMeals = [...visible].sort((a, b) => b.eatenAt.localeCompare(a.eatenAt));

  return (
    <main className="page history-page">
      <header className="simple-header"><div><span className="eyebrow">Your progress</span><h1>History</h1></div><span className="header-icon"><BarChart3 size={23} /></span></header>

      <div className="segment-control" aria-label="History range">
        {(['day', 'week', 'month'] as const).map((item) => <button key={item} className={range === item ? 'active' : ''} onClick={() => { setRange(item); setOffset(0); }}>{item[0].toUpperCase() + item.slice(1)}</button>)}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '16px 0 0', flexWrap: 'wrap' }}>
        {(['score', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium'] as const).map((m) => (
          <button key={m} onClick={() => setMetric(m)} style={{ padding: '6px 12px', borderRadius: 12, background: metric === m ? '#075694' : '#e1ebf2', color: metric === m ? '#fff' : '#54748c', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}>{m === 'calories' ? 'Kcal' : m === 'sodium' ? 'Sodium' : m.charAt(0).toUpperCase() + m.slice(1)}</button>
        ))}
      </div>

      <div className="range-nav">
        <button onClick={() => setOffset(offset - 1)} aria-label="Previous period"><ChevronLeft size={19} /></button>
        <strong>{labelRange(range, dates.start, dates.end)}</strong>
        <button onClick={() => setOffset(offset + 1)} disabled={offset >= 0} aria-label="Next period"><ChevronRight size={19} /></button>
      </div>

      <section className="chart-card">
        <div className="chart-heading"><div><span>Average {metric}</span><strong>{metric === 'score' ? (visible.length ? dailyAvg.toFixed(1) : '—') : formatCompact(dailyAvg)} {metric === 'score' ? <small>/ 10 across logged meals</small> : <>/ {formatCompact(metricGoal)} <small>{metricUnit} / logged day</small></>}</strong></div><span style={metricStatusStyle} className={metric === 'score' ? '' : dailyAvg <= metricGoal ? 'on-track' : 'over-track'}>{metricStatus}</span></div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 14, right: 2, left: -25, bottom: 0 }}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColor} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#0a69ba" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#e1ebf2" strokeDasharray="4 5" />
              <XAxis dataKey="id" axisLine={false} tickLine={false} tick={{ fontSize: range === 'month' ? 9 : 11, fill: '#718798' }} tickFormatter={(val) => chartData.find(d => d.id === val)?.label || val} interval={range === 'month' ? 4 : 0} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8da0ae' }} tickFormatter={formatCompact} domain={metric === 'score' ? [0, 10] : [0, (dataMax: number) => Math.max(dataMax, metricGoal * 1.1)]} />
              <Tooltip cursor={{ stroke: chartColor, strokeWidth: 1, strokeDasharray: '4 4', fill: 'transparent' }} contentStyle={{ border: 0, borderRadius: 12, boxShadow: '0 8px 30px #07569418', fontSize: 12 }} labelFormatter={(val) => chartData.find(d => d.id === val)?.label || val} formatter={(value) => [metric === 'score' ? `${Number(value).toFixed(1)}/10` : `${Math.round(Number(value))} ${metricUnit}`, metricLabel]} />
              <ReferenceLine y={metricGoal} stroke={metric === 'score' ? '#759678' : '#ec765e'} strokeDasharray="5 5" />
              <Area type="monotoneX" dataKey="value" stroke={chartColor} strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="goal-legend"><i style={{ borderColor: metric === 'score' ? '#759678' : '#ec765e' }} /> {metric === 'score' ? 'Good score: 7/10 or higher' : `Daily goal: ${metricGoal.toLocaleString()} ${metricUnit}`}</div>
      </section>

      <section className="history-stats">
        <article><span>Calories</span><strong>{Math.round(totals.calories / loggedDays)}</strong><small>daily avg</small></article>
        <article><span>Protein</span><strong>{Math.round(totals.protein / loggedDays)}g</strong><small>daily avg</small></article>
        <article><span>Carbs</span><strong>{Math.round(totals.carbs / loggedDays)}g</strong><small>daily avg</small></article>
        <article><span>Fat</span><strong>{Math.round(totals.fat / loggedDays)}g</strong><small>daily avg</small></article>
        <article><span>Fiber</span><strong>{Math.round(totals.fiber / loggedDays)}g</strong><small>daily avg</small></article>
        <article><span>Sugar</span><strong>{Math.round(totals.sugar / loggedDays)}g</strong><small>daily avg</small></article>
        <article><span>Sodium</span><strong>{Math.round(totals.sodium / loggedDays)}mg</strong><small>avg</small></article>
        <article><span>Meals</span><strong>{visible.length}</strong><small>this {range}</small></article>
      </section>

      <section className="section-block history-list">
        <div className="section-title"><h2>Meal log</h2><span>{visible.length} entries</span></div>
        {sortedMeals.length ? sortedMeals.map((meal, index) => {
          const previous = sortedMeals[index - 1];
          const showDate = !previous || new Date(previous.eatenAt).toDateString() !== new Date(meal.eatenAt).toDateString();
          return (
            <div key={meal.id}>
              {showDate && <h3 className="meal-date">{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(meal.eatenAt))}</h3>}
              <article
                className="history-meal"
                style={{ alignItems: 'flex-start', cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                aria-expanded={expandedMeals.has(meal.id)}
                onClick={() => toggleExpand(meal.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleExpand(meal.id);
                  }
                }}
              >
                <span className="tiny-meal-icon">{meal.emoji || getMealEmoji(meal.name, meal.ingredients)}</span>
                <div>
                  <strong>{meal.name}</strong>
                  <span style={{ display: 'block', marginBottom: 2 }}>{new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(meal.eatenAt))}</span>
                  <span style={{ display: 'block', color: '#54748c' }}>P {Math.round(meal.protein)}g · C {Math.round(meal.carbs)}g · F {Math.round(meal.fat)}g</span>
                  
                  {expandedMeals.has(meal.id) && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ display: 'block', color: '#54748c' }}>Fiber: {Math.round(meal.fiber)}g · Sugar: {Math.round(meal.sugar)}g · Sodium: {Math.round(meal.sodium)}mg</span>
                      {meal.ingredients && meal.ingredients.length > 0 && (
                        <span style={{ display: 'block', whiteSpace: 'normal', lineHeight: 1.4, color: '#68747a' }}><strong>Detected:</strong> {meal.ingredients.join(', ')}</span>
                      )}
                      {meal.notes && (
                        <span style={{ display: 'block', whiteSpace: 'normal', lineHeight: 1.4, color: '#866438', background: '#f5ecdc', padding: '6px 8px', borderRadius: 6, marginTop: 4 }}>{meal.notes}</span>
                      )}
                      <span className="meal-score-reason" style={getHealthScoreColor(getHealthScore(meal))}>
                        <strong>Why {getHealthScore(meal)}/10?</strong>
                        <span>{getHealthScoreExplanation(meal)}</span>
                      </span>
                    </div>
                  )}
                  <button onClick={(event) => { event.stopPropagation(); toggleExpand(meal.id); }} style={{ background: 'transparent', border: 'none', padding: '4px 0 0', color: '#0a69ba', fontSize: 11, fontWeight: 700, cursor: 'pointer', textAlign: 'left', marginTop: 4, display: 'inline-block' }}>
                    {expandedMeals.has(meal.id) ? 'Hide details' : 'View more details'}
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <strong>{Math.round(meal.calories)} <small>kcal</small></strong>
                  <span style={{ fontSize: 10, ...getHealthScoreColor(getHealthScore(meal)), padding: '2px 5px', borderRadius: 4, fontWeight: 700 }} title="Click the meal to see why">{getHealthScore(meal)}/10 Health</span>
                </div>
              </article>
            </div>
          );
        }) : <div className="empty-history"><BarChart3 size={28} /><strong>No meals in this period</strong><span>Try another date or add a meal from Today.</span></div>}
      </section>
    </main>
  );
}
