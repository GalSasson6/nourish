export function ProgressRing({ value, goal }: { value: number; goal: number }) {
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(value / Math.max(goal, 1), 1);
  const isOver = value > goal;
  const remaining = Math.max(goal - value, 0);
  const extra = Math.max(value - goal, 0);
  return (
    <div className="ring-wrap">
      <svg className="progress-ring" viewBox="0 0 140 140" aria-label={isOver ? `${Math.round(extra)} calories over goal` : `${Math.round(remaining)} calories left`}>
        <circle className="ring-track" cx="70" cy="70" r={radius} />
        <circle className={`ring-value ${isOver ? 'over' : ''}`} cx="70" cy="70" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} />
      </svg>
      <div className={`ring-label ${isOver ? 'over' : ''}`}>
        <strong>{Math.round(isOver ? extra : remaining).toLocaleString()}</strong>
        <span>{isOver ? 'kcal over' : 'kcal left'}</span>
      </div>
    </div>
  );
}
