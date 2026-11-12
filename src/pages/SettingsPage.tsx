import { useState } from 'react';
import { Activity, CircleUserRound, Info, RotateCcw, Save, ShieldCheck, Target } from 'lucide-react';
import type { UserSettings } from '../types';

const goalFields = [
  ['calories', 'Calories', 'kcal'], ['protein', 'Protein', 'g'], ['carbs', 'Carbs', 'g'],
  ['fat', 'Fat', 'g'], ['fiber', 'Fiber', 'g'], ['sugar', 'Sugar', 'g'],
  ['sodium', 'Sodium', 'mg'], ['water', 'Water', 'bottles'],
] as const;

export function SettingsPage({ settings, onSave, onClear }: {
  settings: UserSettings;
  onSave: (settings: UserSettings) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const save = () => {
    onSave(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };
  const clear = () => {
    if (window.confirm('Clear every saved meal? Your goals will stay unchanged.')) onClear();
  };
  return (
    <main className="page settings-page">
      <header className="simple-header"><div><span className="eyebrow">Make it yours</span><h1>Settings</h1></div><span className="header-icon"><Activity size={23} /></span></header>

      <section className="settings-card profile-card">
        <span className="settings-leading"><CircleUserRound size={22} /></span>
        <label className="field"><span>Your name (optional)</span><input value={draft.name} placeholder="Add your name" maxLength={24} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      </section>

      <div className="settings-heading"><div><Target size={19} /><div><h2>Daily goals</h2><p>Set the targets that matter to you.</p></div></div></div>
      <section className="settings-card goals-grid">
        {goalFields.map(([key, label, unit]) => (
          <label className="goal-input" key={key}>
            <span>{label}</span>
            <div><input type="number" min="0" inputMode="decimal" value={draft.goals[key]} onChange={(e) => setDraft({ ...draft, goals: { ...draft.goals, [key]: Math.max(0, Number(e.target.value)) } })} /><small>{unit}</small></div>
          </label>
        ))}
      </section>

      <button className={`primary-button settings-save ${saved ? 'saved' : ''}`} onClick={save}><Save size={18} /> {saved ? 'Goals saved' : 'Save changes'}</button>

      <section className="settings-card privacy-card">
        <span className="settings-leading"><ShieldCheck size={22} /></span>
        <div><strong>Private by design</strong><p>Progress originals stay on this server. Selected meal and progress photos are sent to Gemini only when you ask the app to analyze or sort them.</p></div>
      </section>

      <section className="settings-card info-card">
        <span className="settings-leading"><Info size={21} /></span>
        <div><strong>About estimates</strong><p>Photo-based nutrition is approximate. Portion size, hidden oils, and recipes can change the result. Review each estimate before saving.</p></div>
      </section>

      <button className="danger-button" onClick={clear}><RotateCcw size={17} /> Clear meal history</button>
      <p className="version">Nourish · Gemini 3.6 Flash</p>
    </main>
  );
}
