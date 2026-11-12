import type { LucideIcon } from 'lucide-react';

export function NutrientBar({ label, value, goal, unit, color, Icon }: {
  label: string; value: number; goal: number; unit: string; color: string; Icon: LucideIcon;
}) {
  const percentage = Math.min((value / Math.max(goal, 1)) * 100, 100);
  const isOver = value > goal;
  const barColor = isOver ? '#d95d4d' : color;
  return (
    <div className={`nutrient ${isOver ? 'over' : ''}`}>
      <div className="nutrient-head">
        <span className="nutrient-icon" style={{ background: `${barColor}18`, color: barColor }}><Icon size={16} /></span>
        <span>{label}</span>
        <strong>{Math.round(value)}<small> / {goal}{unit}</small></strong>
      </div>
      <div className="bar"><span style={{ width: `${percentage}%`, background: barColor }} /></div>
    </div>
  );
}
