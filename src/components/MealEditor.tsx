import { useEffect, useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import type { AnalysisResult, Meal } from '../types';
import { getHealthScore, getHealthScoreColor, getHealthScoreExplanation, getMealEmoji, uid } from '../lib';

const fields: Array<{ key: keyof Pick<AnalysisResult, 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'sugar' | 'sodium'>; label: string; unit: string }> = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'fiber', label: 'Fiber', unit: 'g' },
  { key: 'sugar', label: 'Sugar', unit: 'g' },
  { key: 'sodium', label: 'Sodium', unit: 'mg' },
];

export function MealEditor({ result, initialMeal, image, currentDate, onClose, onSave, onSavePreset }: {
  result: AnalysisResult;
  initialMeal?: Meal;
  image?: string;
  currentDate?: Date;
  onClose: () => void;
  onSave: (meal: Meal) => void;
  onSavePreset?: (meal: Meal) => void;
}) {
  const [draft, setDraft] = useState(initialMeal || result);
  const [mealTime, setMealTime] = useState(() => {
    const time = initialMeal ? new Date(initialMeal.eatenAt) : new Date();
    return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  });
  const showHealthScore = Boolean(initialMeal || typeof draft.healthScore === 'number');
  const healthScore = getHealthScore(draft);
  const healthScoreStyle = getHealthScoreColor(healthScore);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    if (!draft.name.trim()) return;
    const [hours, minutes] = mealTime.split(':').map(Number);
    const eatenAt = initialMeal ? new Date(initialMeal.eatenAt) : new Date(currentDate || new Date());
    eatenAt.setHours(hours, minutes, 0, 0);
    onSave({ ...draft, id: initialMeal?.id || uid(), name: draft.name.trim(), emoji: draft.emoji || getMealEmoji(draft.name, draft.ingredients), eatenAt: eatenAt.toISOString(), image: initialMeal?.image || image } as Meal);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="meal-editor" role="dialog" aria-modal="true" aria-label="Review meal">
        <div className="sheet-grabber" />
        <div className="editor-head">
          <div>
            <span className="eyebrow"><Sparkles size={13} /> Review estimate</span>
            <h2>Does this look right?</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <p className="editor-note">AI can make mistakes. Adjust the portion or values before saving.</p>

        <div className="editor-main">
          {image && <img className="editor-image" src={image} alt="Meal preview" />}
          <div className="editor-title-fields">
            <label className="field full"><span>Meal name</span><input value={draft.name} autoFocus={!image} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <div className="field-row">
              <label className="field"><span>Portion</span><input value={draft.portion} onChange={(e) => setDraft({ ...draft, portion: e.target.value })} /></label>
              <label className="field time-field"><span>Time</span><input type="time" value={mealTime} onChange={(e) => setMealTime(e.target.value)} /></label>
            </div>
          </div>
        </div>

        <div className="nutrition-grid">
          {fields.map(({ key, label, unit }) => (
            <label className={`nutrition-input ${key === 'calories' ? 'primary' : ''}`} key={key}>
              <span>{label}</span>
              <div><input type="number" min="0" inputMode="decimal" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: Math.max(0, Number(e.target.value)) })} /><small>{unit}</small></div>
            </label>
          ))}
        </div>

        {showHealthScore && (
          <section className="health-score-explanation" style={healthScoreStyle} aria-label={`Health score ${healthScore} out of 10`}>
            <div className="health-score-value"><strong>{healthScore}</strong><span>/10</span></div>
            <div>
              <span>Why this health score?</span>
              <p>{getHealthScoreExplanation(draft)}</p>
            </div>
          </section>
        )}

        {!!draft.ingredients.length && (
          <div className="detected-foods">
            <span>Detected foods</span>
            <div>{draft.ingredients.map((ingredient) => <span key={ingredient}>{ingredient}</span>)}</div>
          </div>
        )}
        {draft.notes && <p className="confidence-note">{draft.notes}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 17 }}>
          <button className="primary-button" style={{ flex: 1 }} disabled={!draft.name.trim()} onClick={save}><Check size={19} /> {initialMeal ? 'Save changes' : 'Add to today'}</button>
          {onSavePreset && (
            <button className="secondary-button" style={{ width: 130, padding: 0 }} disabled={!draft.name.trim()} onClick={() => onSavePreset({ ...draft, id: initialMeal?.id || uid(), name: draft.name.trim(), emoji: draft.emoji || getMealEmoji(draft.name, draft.ingredients), eatenAt: new Date().toISOString(), image: initialMeal?.image || image } as Meal)}>Save preset</button>
          )}
        </div>
      </section>
    </div>
  );
}
