import { useEffect, useMemo, useRef, useState } from 'react';
import { Beef, Camera, Candy, ChevronLeft, ChevronRight, CircleUserRound, Droplets, Flame, ImagePlus, LoaderCircle, Plus, Salad, TestTube, Trash2, Utensils, Wheat, X } from 'lucide-react';
import type { AnalysisResult, Goals, Meal, Nutrients, UserSettings } from '../types';
import { compressImage, dateKey, getHealthScore, getHealthScoreColor, getHealthScoreExplanation, getMealEmoji, makeThumbnail, sameDay, sumNutrients, uid } from '../lib';
import { ProgressRing } from '../components/ProgressRing';
import { NutrientBar } from '../components/NutrientBar';
import { MealEditor } from '../components/MealEditor';

const blankMeal: AnalysisResult = {
  name: '', emoji: '', portion: '1 serving', calories: 0, protein: 0, carbs: 0, fat: 0,
  fiber: 0, sugar: 0, sodium: 0, ingredients: [], confidence: 'high', notes: '',
};

const getDayVerdict = (score: number, mealCount: number) => {
  if (!mealCount) return 'Log a meal to start your summary.';
  if (score >= 8) return 'Excellent choices so far.';
  if (score >= 6) return 'A fairly balanced day so far.';
  if (score >= 4) return 'A mixed day with room to rebalance.';
  return 'Your next choice can help turn the day around.';
};

const getNextMealSuggestion = (totals: Nutrients, goals: Goals, mealCount: number, hour: number) => {
  if (!mealCount) return hour < 11
    ? 'Start with a protein-rich breakfast such as eggs or yogurt with fruit and oats.'
    : 'Start with a balanced plate: lean protein, vegetables, and a whole-grain carbohydrate.';

  const caloriesLeft = goals.calories - totals.calories;
  const needsProtein = totals.protein < goals.protein * 0.75;
  const needsFiber = totals.fiber < goals.fiber * 0.75;
  const limitSugar = totals.sugar >= goals.sugar * 0.8;
  const limitSodium = totals.sodium >= goals.sodium * 0.8;

  if (caloriesLeft <= 200) return 'You are close to your calorie target. If hungry, choose something light such as vegetables, fruit, or plain yogurt.';
  if (needsProtein && needsFiber) return 'Aim for lean protein with plenty of fiber—chicken, fish, tofu, or lentils with vegetables is a strong next choice.';
  if (needsProtein) return 'Protein is the main gap. Consider eggs, Greek yogurt, chicken, fish, tofu, or a lower-sugar protein shake.';
  if (needsFiber) return 'Fiber is the main gap. Add vegetables, beans, lentils, fruit, or a whole grain to your next meal.';
  if (limitSugar || limitSodium) return `Keep the next meal ${limitSugar ? 'low in added sugar' : ''}${limitSugar && limitSodium ? ' and ' : ''}${limitSodium ? 'lower in salt' : ''}, with vegetables and a simple protein.`;
  return 'You are well balanced so far. Keep the next meal moderate and include a protein plus vegetables.';
};

type TomorrowMeal = { emoji: string; title: string; description: string; why: string };
type TomorrowPlan = { focus: string; lunch: TomorrowMeal; dinner: TomorrowMeal };

const getTomorrowMealPlan = (averages: Nutrients, goals: Goals, mealCount: number): TomorrowPlan => {
  if (!mealCount) return {
    focus: 'A balanced starting plan with protein, vegetables, and slow-digesting carbohydrates.',
    lunch: { emoji: '🥗', title: 'Chicken or tofu quinoa bowl', description: 'Quinoa, mixed vegetables, greens, and a lemon-yogurt dressing.', why: 'A balanced midday meal with protein and fiber.' },
    dinner: { emoji: '🐟', title: 'Salmon with lentils and vegetables', description: 'Baked salmon or tofu, seasoned lentils, and roasted vegetables.', why: 'A filling dinner with protein, fiber, and healthy fats.' },
  };

  const needsProtein = averages.protein < goals.protein * 0.8;
  const needsFiber = averages.fiber < goals.fiber * 0.8;
  const limitSugar = averages.sugar > goals.sugar * 0.9;
  const limitSodium = averages.sodium > goals.sodium * 0.9;

  if (needsProtein && needsFiber) return {
    focus: 'Your recent meals could use more protein and fiber, so both suggestions emphasize them.',
    lunch: { emoji: '🥗', title: 'Chicken or tofu quinoa power bowl', description: 'Lean protein, quinoa, chickpeas, leafy greens, tomato, and cucumber.', why: 'Combines a strong protein serving with two useful sources of fiber.' },
    dinner: { emoji: '🍲', title: 'Salmon and lentil vegetable plate', description: 'Salmon or tofu with lentils, broccoli, peppers, and a small baked potato.', why: 'Closes both gaps without relying on a heavy sauce or added sugar.' },
  };
  if (needsProtein) return {
    focus: 'Protein has been the main recent gap, so tomorrow’s meals spread it across lunch and dinner.',
    lunch: { emoji: '🌯', title: 'High-protein chicken or tofu wrap', description: 'Whole-grain wrap, lean protein, crunchy vegetables, and Greek-yogurt sauce.', why: 'A practical protein-forward lunch that still includes vegetables.' },
    dinner: { emoji: '🍛', title: 'Lean stir-fry with rice', description: 'Chicken, shrimp, or tofu stir-fried with mixed vegetables and brown rice.', why: 'Adds another substantial protein serving while staying balanced.' },
  };
  if (needsFiber) return {
    focus: 'Fiber has been the main recent gap, so tomorrow’s plan adds legumes, vegetables, and whole grains.',
    lunch: { emoji: '🥙', title: 'Lentil and roasted vegetable bowl', description: 'Lentils, roasted vegetables, greens, tahini, and a small whole-grain pita.', why: 'Lentils and vegetables make this a high-fiber lunch.' },
    dinner: { emoji: '🍲', title: 'Bean chili with avocado', description: 'Mixed-bean vegetable chili topped with avocado and plain yogurt.', why: 'Beans help raise fiber while keeping dinner satisfying.' },
  };
  if (limitSugar || limitSodium) return {
    focus: `Keep tomorrow ${limitSugar ? 'lower in added sugar' : ''}${limitSugar && limitSodium ? ' and ' : ''}${limitSodium ? 'lighter on sodium' : ''}.`,
    lunch: { emoji: '🥗', title: 'Homemade chicken or tofu salad', description: 'Greens, cucumber, tomato, avocado, lean protein, and olive oil with lemon.', why: 'Simple ingredients make added sugar and salt easier to control.' },
    dinner: { emoji: '🐟', title: 'Baked salmon with vegetables', description: 'Herb-baked salmon or tofu with roasted vegetables and quinoa.', why: 'A minimally processed dinner with no sugary sauce required.' },
  };
  return {
    focus: 'Your recent intake looks fairly balanced, so tomorrow focuses on variety and consistency.',
    lunch: { emoji: '🥙', title: 'Mediterranean chicken or tofu pita', description: 'Whole-grain pita, grilled protein, chopped salad, hummus, and yogurt sauce.', why: 'A balanced mix of protein, vegetables, carbohydrates, and fat.' },
    dinner: { emoji: '🐟', title: 'Salmon, brown rice, and greens', description: 'Baked salmon or tofu with brown rice and sautéed green vegetables.', why: 'A moderate, well-rounded dinner that complements lunch.' },
  };
};

export function TodayPage({ meals, pendingMeals, settings, onAddMeal, onQueueMeal, onMarkMealUploaded, onSetPendingMealImage, onFailMealAnalysis, onRemovePendingMeal, onUpdateMeal, onDeleteMeal, onWater, onSavePreset, onRemovePreset }: {
  meals: Meal[];
  pendingMeals: Meal[];
  settings: UserSettings;
  onAddMeal: (meal: Meal) => void;
  onQueueMeal: (meal: Meal) => void;
  onMarkMealUploaded: (pendingId: string, jobId: string) => void;
  onSetPendingMealImage: (pendingId: string, image: string) => void;
  onFailMealAnalysis: (pendingId: string, message: string) => void;
  onRemovePendingMeal: (id: string) => void;
  onUpdateMeal: (meal: Meal) => void;
  onDeleteMeal: (id: string) => void;
  onWater: (amount: number, date?: Date) => void;
  onSavePreset: (preset: Meal) => void;
  onRemovePreset: (id: string) => void;
}) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const todayMeals = meals.filter((meal) => sameDay(meal.eatenAt, currentDate)).sort((a, b) => b.eatenAt.localeCompare(a.eatenAt));
  const totals = sumNutrients(todayMeals);
  const isToday = sameDay(currentDate.toISOString(), new Date());
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [result, setResult] = useState<AnalysisResult>();
  const [error, setError] = useState('');
  const [textInput, setTextInput] = useState('');
  const [editingMeal, setEditingMeal] = useState<Meal>();
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const submissionLocked = useRef(false);
  const water = settings.waterByDate[dateKey(currentDate)] || 0;
  const visiblePendingMeals = pendingMeals.filter((meal) => sameDay(meal.eatenAt, currentDate));
  const displayedMeals = [...todayMeals, ...visiblePendingMeals].sort((a, b) => b.eatenAt.localeCompare(a.eatenAt));
  const [expandedMeals, setExpandedMeals] = useState<Set<string>>(new Set());
  const rankedPresets = useMemo(() => {
    const usageByName = meals.reduce<Map<string, number>>((counts, meal) => {
      const name = meal.name.trim().toLocaleLowerCase();
      counts.set(name, (counts.get(name) || 0) + 1);
      return counts;
    }, new Map());

    return (settings.presets || [])
      .map((preset, index) => ({
        preset,
        index,
        useCount: usageByName.get(preset.name.trim().toLocaleLowerCase()) || 0,
      }))
      .sort((a, b) => b.useCount - a.useCount || a.index - b.index);
  }, [meals, settings.presets]);
  const dayScore = todayMeals.length
    ? Math.round(todayMeals.reduce((sum, meal) => sum + getHealthScore(meal), 0) / todayMeals.length)
    : 0;
  const goodMeals = todayMeals.filter((meal) => getHealthScore(meal) >= 7);
  const lessHealthyMeals = todayMeals.filter((meal) => getHealthScore(meal) <= 5);
  const dayScoreStyle = todayMeals.length ? getHealthScoreColor(dayScore) : { color: '#667b8c', background: '#edf2f5' };
  const currentHour = new Date().getHours();
  const recentCutoff = new Date();
  recentCutoff.setHours(0, 0, 0, 0);
  recentCutoff.setDate(recentCutoff.getDate() - 6);
  const recentMeals = meals.filter((meal) => new Date(meal.eatenAt) >= recentCutoff);
  const recentTotals = sumNutrients(recentMeals);
  const recentDays = new Set(recentMeals.map((meal) => dateKey(meal.eatenAt))).size || 1;
  const recentAverages: Nutrients = {
    calories: recentTotals.calories / recentDays,
    protein: recentTotals.protein / recentDays,
    carbs: recentTotals.carbs / recentDays,
    fat: recentTotals.fat / recentDays,
    fiber: recentTotals.fiber / recentDays,
    sugar: recentTotals.sugar / recentDays,
    sodium: recentTotals.sodium / recentDays,
  };
  const tomorrowPlan = getTomorrowMealPlan(recentAverages, settings.goals, recentMeals.length);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  
  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedMeals(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => () => { if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    if (!presetsOpen && !summaryOpen && !suggestionsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPresetsOpen(false);
        setSummaryOpen(false);
        setSuggestionsOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [presetsOpen, summaryOpen, suggestionsOpen]);

  const addPreset = (preset: Meal, closeMenu = false) => {
    const now = new Date();
    const mealDate = new Date(currentDate);
    mealDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
    onAddMeal({ ...preset, id: uid(), eatenAt: mealDate.toISOString() });
    if (closeMenu) setPresetsOpen(false);
  };

  const chooseFile = async (selected?: File) => {
    if (!selected) return;
    setError('');
    try {
      let compressed: File;
      try {
        compressed = await compressImage(selected);
      } catch {
        if (selected.size > 8 * 1024 * 1024) throw new Error('That photo is too large. Choose one under 8 MB.');
        compressed = selected;
      }
      if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
      setFile(compressed);
      setPreview(URL.createObjectURL(compressed));
      submissionLocked.current = false;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open that image.');
    }
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const pastedFile = items[i].getAsFile();
          if (pastedFile) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            chooseFile(pastedFile);
            e.preventDefault();
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste as EventListener);
    return () => window.removeEventListener('paste', handlePaste as EventListener);
  }, [preview]);

  const analyze = async (isTextOnly?: boolean) => {
    if (submissionLocked.current || (!file && (!isTextOnly || !textInput.trim()))) return;
    submissionLocked.current = true;
    setError('');

    const submittedFile = file;
    const submittedText = textInput.trim();
    const submittedPreview = preview;
    const now = new Date();
    const mealDate = new Date(currentDate);
    mealDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    const pendingMeal: Meal = {
      ...blankMeal,
      id: uid(),
      name: submittedText || 'Photo meal',
      emoji: submittedFile ? '📷' : getMealEmoji(submittedText),
      eatenAt: mealDate.toISOString(),
      confidence: 'low',
      notes: 'The meal is being uploaded.',
      analysisStatus: 'uploading',
      analysisJobId: '',
      analysisQueuedAt: new Date().toISOString(),
    };
    pendingMeal.analysisJobId = pendingMeal.id;

    onQueueMeal(pendingMeal);
    setFile(undefined);
    setTextInput('');
    setPreview(undefined);
    if (galleryInput.current) galleryInput.current.value = '';
    if (cameraInput.current) cameraInput.current.value = '';

    const thumbnailPromise: Promise<string | undefined> = submittedFile
      ? makeThumbnail(submittedFile).catch(() => undefined)
      : Promise.resolve(undefined);

    try {
      const body = new FormData();
      if (submittedFile) body.append('image', submittedFile);
      if (submittedText) body.append('text', submittedText);
      body.append('jobId', pendingMeal.id);
      body.append('eatenAt', pendingMeal.eatenAt);
      const response = await fetch('/api/analyze-jobs', { method: 'POST', body });
      const data = await response.json() as { id?: string; status?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'The meal could not be analyzed.');
      if (!data.id) throw new Error('The server did not confirm the upload.');
      onMarkMealUploaded(pendingMeal.id, data.id);
      const image = await thumbnailPromise;
      if (image) onSetPendingMealImage(pendingMeal.id, image);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The meal could not be analyzed.';
      onFailMealAnalysis(pendingMeal.id, message);
    }

    if (submittedPreview?.startsWith('blob:')) URL.revokeObjectURL(submittedPreview);
  };

  return (
    <main className="page today-page">
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() - 1); setCurrentDate(d); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}><ChevronLeft size={24} /></button>
          <div>
            <span className="date-label">{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(currentDate)}</span>
            <h1>{isToday ? `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}` : 'Past Meals'}</h1>
          </div>
          <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() + 1); setCurrentDate(d); }} disabled={isToday} style={{ background: 'transparent', border: 'none', cursor: isToday ? 'default' : 'pointer', padding: 4, opacity: isToday ? 0.3 : 1, display: 'flex' }}><ChevronRight size={24} /></button>
        </div>
        <div className="avatar" aria-label="Profile"><CircleUserRound size={20} /></div>
      </header>

      <section className="daily-card">
        <div className="daily-copy">
          <span className="section-kicker"><Flame size={14} /> Daily energy</span>
          <h2>{Math.round(totals.calories).toLocaleString()} <small>of {settings.goals.calories.toLocaleString()} kcal</small></h2>
          <p>{todayMeals.length ? `${todayMeals.length} meal${todayMeals.length === 1 ? '' : 's'} logged ${isToday ? 'today' : 'on this day'}` : 'A fresh start. Log your first meal.'}</p>
          <div className="daily-card-actions">
            <button className="daily-summary-card-button" onClick={() => setSummaryOpen(true)} aria-haspopup="dialog">
              <span>{isToday ? 'Daily summary' : 'Day summary'}</span>
              <span className="daily-summary-card-score" style={dayScoreStyle}><strong>{todayMeals.length ? dayScore : '—'}</strong><small>/10</small></span>
              <ChevronRight size={16} />
            </button>
            <button className="meal-suggestions-card-button" onClick={() => setSuggestionsOpen(true)} aria-haspopup="dialog">
              <span>Tomorrow meals</span>
              <span className="meal-suggestions-card-badge">2 meals</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <ProgressRing value={totals.calories} goal={settings.goals.calories} />
      </section>

      <section className="macro-card">
        <NutrientBar label="Protein" value={totals.protein} goal={settings.goals.protein} unit="g" color="#ec765e" Icon={Beef} />
        <NutrientBar label="Carbs" value={totals.carbs} goal={settings.goals.carbs} unit="g" color="#d5a93c" Icon={Salad} />
        <NutrientBar label="Fat" value={totals.fat} goal={settings.goals.fat} unit="g" color="#759678" Icon={Droplets} />
        <NutrientBar label="Fiber" value={totals.fiber} goal={settings.goals.fiber} unit="g" color="#b89365" Icon={Wheat} />
        <NutrientBar label="Sugar" value={totals.sugar} goal={settings.goals.sugar} unit="g" color="#c96f9f" Icon={Candy} />
        <NutrientBar label="Sodium" value={totals.sodium} goal={settings.goals.sodium} unit="mg" color="#8ea6b4" Icon={TestTube} />
      </section>


      <section className="section-block add-section">
        <div className="section-title">
          <div><span className="eyebrow">AI meal scan</span><h2>What are you eating?</h2></div>
          <button className="text-button" onClick={() => setResult(blankMeal)}><Plus size={16} /> Manual</button>
        </div>

        {!preview ? (
          <>
            <div className="scan-card">
              <div className="scan-art"><Utensils size={28} /><span className="spark spark-one">✦</span><span className="spark spark-two">✦</span></div>
              <h3>Snap your meal</h3>
              <p>We’ll identify the food and estimate its nutrition in seconds.</p>
              <div className="scan-actions">
                <button className="primary-button" onClick={() => cameraInput.current?.click()}><Camera size={19} /> Take photo</button>
                <button className="secondary-button" onClick={() => galleryInput.current?.click()}><ImagePlus size={18} /> Choose photo</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input type="text" style={{ flex: 1, height: 47, borderRadius: 15, padding: '0 16px', border: '1px solid #bfd9eb', fontSize: 13, background: 'white' }} placeholder="Or describe your meal..." value={textInput} onChange={(e) => { setTextInput(e.target.value); submissionLocked.current = false; }} />
                <button className="secondary-button" style={{ width: 80, flex: 'none', background: '#e2f1fc' }} onClick={() => void analyze(true)} disabled={!textInput.trim()}>Add</button>
              </div>
            </div>
            {!!settings.presets?.length && (
              <div className="preset-shortcuts">
                <div className="preset-shortcuts-head">
                  <div>
                    <strong>Food presets</strong>
                    <span>Most used first</span>
                  </div>
                  <button className="preset-menu-button" onClick={() => setPresetsOpen(true)} aria-haspopup="dialog">
                    All presets <span>{rankedPresets.length}</span><ChevronRight size={16} />
                  </button>
                </div>
                <div className="preset-quick-grid">
                  {rankedPresets.slice(0, 3).map(({ preset }) => (
                    <button key={preset.id} className="preset-quick-button" onClick={() => addPreset(preset)}>
                      <span>{preset.emoji || getMealEmoji(preset.name, preset.ingredients)}</span>
                      <strong>{preset.name}</strong>
                      <small>{Math.round(preset.calories)} kcal</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="preview-card" style={{ height: 'auto', background: 'transparent', boxShadow: 'none' }}>
            <div style={{ position: 'relative', height: 230, borderRadius: 25, overflow: 'hidden' }}>
              <img src={preview} alt="Selected meal" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <button className="replace-button" style={{ position: 'absolute', bottom: 14, left: 14, zIndex: 10 }} onClick={() => galleryInput.current?.click()}>Replace</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input type="text" style={{ flex: 1, height: 47, borderRadius: 15, padding: '0 16px', border: '1px solid #bfd9eb', fontSize: 13, background: 'white' }} placeholder="Add extra notes or describe the meal..." value={textInput} onChange={(e) => { setTextInput(e.target.value); submissionLocked.current = false; }} />
              <button className="primary-button" style={{ width: 100, flex: 'none' }} onClick={() => void analyze(false)}>Add meal</button>
            </div>
          </div>
        )}
        <input ref={galleryInput} hidden type="file" accept="image/*" onChange={(e) => void chooseFile(e.target.files?.[0])} />
        <input ref={cameraInput} hidden type="file" accept="image/*" capture="environment" onChange={(e) => void chooseFile(e.target.files?.[0])} />
        {error && <p className="error-message">{error}</p>}
        {visiblePendingMeals.some((meal) => meal.analysisStatus === 'uploading') ? (
          <div className="upload-safety uploading" role="status">
            <LoaderCircle className="spin" size={19} />
            <div><strong>Uploading — keep the app open</strong><span>Wait here until this changes to “Safe to close”.</span></div>
          </div>
        ) : visiblePendingMeals.some((meal) => meal.analysisStatus === 'analyzing') ? (
          <div className="upload-safety safe" role="status">
            <span className="upload-safe-check">✓</span>
            <div><strong>Uploaded — safe to close</strong><span>Calculations will continue in the background.</span></div>
          </div>
        ) : null}
      </section>

      <section className="water-card">
        <div><span className="water-icon"><Droplets size={20} /></span><div><strong>Water</strong><span>{water} of {settings.goals.water} bottles</span></div></div>
        <div className="water-controls"><button onClick={() => onWater(-1, currentDate)} disabled={water <= 0}>−</button><div className="water-dots">{Array.from({ length: Math.min(settings.goals.water, 10) }, (_, i) => <i key={i} className={i < water ? 'filled' : ''} />)}</div><button onClick={() => onWater(1, currentDate)}>+</button></div>
      </section>

      <section className="section-block meals-section">
        <div className="section-title"><h2>{isToday ? 'Today’s meals' : 'Meals'}</h2><span>{Math.round(totals.protein)}g protein</span></div>
        {displayedMeals.length ? <div className="meal-list">{displayedMeals.map((meal) => meal.analysisStatus ? (
          <article className={`meal-row meal-row-${meal.analysisStatus}`} key={meal.id}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div className="meal-placeholder">
                {meal.analysisStatus === 'failed' ? <span style={{ fontSize: 22 }}>!</span> : <LoaderCircle className="spin" size={22} />}
              </div>
              <span style={{ fontSize: 10, color: '#8da0ae', fontWeight: 700, whiteSpace: 'nowrap' }}>{new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(meal.eatenAt))}</span>
            </div>
            <div className="meal-info">
              <strong>{meal.name}</strong>
              <span className="analysis-status">{meal.analysisStatus === 'uploading'
                ? 'Uploading meal… Keep the app open.'
                : meal.analysisStatus === 'analyzing'
                  ? 'Uploaded. Calculating nutrition… Safe to close the app.'
                  : meal.analysisError || 'Analysis failed.'}</span>
            </div>
            <div className="meal-calories"><span className={meal.analysisStatus === 'failed' ? 'analysis-failed-label' : meal.analysisStatus === 'analyzing' ? 'analysis-safe-label' : 'analysis-uploading-label'}>{meal.analysisStatus === 'uploading' ? 'Keep open' : meal.analysisStatus === 'analyzing' ? 'Safe to close' : 'Failed'}</span></div>
            <button className="delete-meal" onClick={() => onRemovePendingMeal(meal.id)} aria-label={`Delete ${meal.name}`}><Trash2 size={17} /></button>
          </article>
        ) : (
          <article className="meal-row" key={meal.id} style={{ cursor: 'pointer' }} onClick={() => setEditingMeal(meal)}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              {meal.image ? <img src={meal.image} alt="" /> : <div className="meal-placeholder" style={{ fontSize: 24 }}>{meal.emoji || getMealEmoji(meal.name, meal.ingredients)}</div>}
              <span style={{ fontSize: 10, color: '#8da0ae', fontWeight: 700, whiteSpace: 'nowrap' }}>{new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(meal.eatenAt))}</span>
            </div>
            <div className="meal-info">
              <strong>{meal.name} <span style={{ color: '#8da0ae', fontWeight: 500, fontSize: 12, marginLeft: 4 }}>{meal.portion}</span></strong>
              <div style={{ display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                <span style={{ background: '#fcebe8', color: '#c44830', padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>Protein: {Math.round(meal.protein)}g</span>
                <span style={{ background: '#fdf6e6', color: '#a67d1c', padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>Carbs: {Math.round(meal.carbs)}g</span>
                <span style={{ background: '#eef3ef', color: '#4a6b4d', padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>Fat: {Math.round(meal.fat)}g</span>
              </div>
              {expandedMeals.has(meal.id) && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #dbe8f1', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ background: '#f5f0e6', color: '#7a5a30', padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>Fiber: {Math.round(meal.fiber)}g</span>
                    <span style={{ background: '#faeaf2', color: '#913f6b', padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>Sugar: {Math.round(meal.sugar)}g</span>
                    <span style={{ background: '#e9f1f5', color: '#4c6470', padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>Sodium: {Math.round(meal.sodium)}mg</span>
                  </div>
                  {meal.ingredients && meal.ingredients.length > 0 && (
                    <div style={{ fontSize: 11, color: '#68747a', whiteSpace: 'normal' }}><strong>Detected:</strong> {meal.ingredients.join(', ')}</div>
                  )}
                  {meal.notes && (
                    <div style={{ fontSize: 11, color: '#866438', background: '#f5ecdc', padding: '6px 8px', borderRadius: 6, whiteSpace: 'normal', lineHeight: 1.4 }}>{meal.notes}</div>
                  )}
                  <div className="meal-score-reason" style={getHealthScoreColor(getHealthScore(meal))}>
                    <strong>Why {getHealthScore(meal)}/10?</strong>
                    <span>{getHealthScoreExplanation(meal)}</span>
                  </div>
                </div>
              )}
              <button onClick={(e) => toggleExpand(meal.id, e)} style={{ background: 'transparent', border: 'none', padding: '4px 0', color: '#0a69ba', fontSize: 11, fontWeight: 700, cursor: 'pointer', textAlign: 'left', marginTop: 2, display: 'inline-block' }}>
                {expandedMeals.has(meal.id) ? 'Hide details' : 'View more details'}
              </button>
            </div>
            <div className="meal-calories">
              <strong>{Math.round(meal.calories)}</strong><span>kcal</span>
              <div onClick={(e) => { e.stopPropagation(); setEditingMeal(meal); }} style={{ cursor: 'pointer', marginTop: 6, fontSize: 10, ...getHealthScoreColor(getHealthScore(meal)), padding: '3px 5px', borderRadius: 6, fontWeight: 700, whiteSpace: 'nowrap' }} title="Click to see why">{getHealthScore(meal)}/10 Health</div>
            </div>
            <button className="delete-meal" onClick={(e) => { e.stopPropagation(); onDeleteMeal(meal.id); }} aria-label={`Delete ${meal.name}`}><Trash2 size={17} /></button>
          </article>
        ))}</div> : <div className="empty-meals"><Utensils size={22} /><p>Your meals will appear here.</p></div>}
      </section>

      {editingMeal && <MealEditor result={editingMeal} initialMeal={editingMeal} image={editingMeal.image} currentDate={currentDate} onClose={() => setEditingMeal(undefined)} onSave={(meal) => { onUpdateMeal(meal); setEditingMeal(undefined); }} onSavePreset={onSavePreset} />}
      {result && <MealEditor result={result} currentDate={currentDate} onClose={() => setResult(undefined)} onSave={(meal) => { onAddMeal(meal); setResult(undefined); }} onSavePreset={onSavePreset} />}
      {summaryOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSummaryOpen(false)}>
          <section className="daily-summary-sheet" role="dialog" aria-modal="true" aria-labelledby="daily-summary-title">
            <div className="sheet-grabber" />
            <div className="summary-head">
              <div>
                <span className="eyebrow">{isToday ? 'Today so far' : 'Completed day'}</span>
                <h2 id="daily-summary-title">{isToday ? 'Daily summary' : 'Day summary'}</h2>
              </div>
              <button className="icon-button" onClick={() => setSummaryOpen(false)} aria-label="Close daily summary"><X size={20} /></button>
            </div>

            <div className="summary-hero" style={dayScoreStyle}>
              <div className="summary-score">
                <strong>{todayMeals.length ? dayScore : '—'}</strong>
                <span>/10</span>
              </div>
              <div className="summary-hero-copy">
                <span>Day score</span>
                <h3>{getDayVerdict(dayScore, todayMeals.length)}</h3>
                <p>Based on the quality of everything logged {isToday ? 'up to this moment' : 'on this day'}.</p>
              </div>
            </div>

            <div className="summary-stats">
              <article><span>Meals</span><strong>{todayMeals.length}</strong></article>
              <article><span>Calories</span><strong>{Math.round(totals.calories)} <small>/ {settings.goals.calories}</small></strong></article>
              <article><span>Protein</span><strong>{Math.round(totals.protein)}g <small>/ {settings.goals.protein}g</small></strong></article>
            </div>

            <div className="summary-food-columns">
              <section className="summary-food-card good">
                <h3><span>✓</span> Good choices</h3>
                {goodMeals.length ? (
                  <div className="summary-food-list">
                    {goodMeals.map((meal) => (
                      <div className="summary-food-row" key={meal.id}>
                        <span>{meal.emoji || getMealEmoji(meal.name, meal.ingredients)}</span>
                        <strong>{meal.name}</strong>
                        <small style={getHealthScoreColor(getHealthScore(meal))}>{getHealthScore(meal)}/10</small>
                      </div>
                    ))}
                  </div>
                ) : <p>No foods scoring 7 or higher yet.</p>}
              </section>

              <section className="summary-food-card improve">
                <h3><span>!</span> Needs improvement</h3>
                {lessHealthyMeals.length ? (
                  <div className="summary-food-list">
                    {lessHealthyMeals.map((meal) => (
                      <div className="summary-food-row" key={meal.id}>
                        <span>{meal.emoji || getMealEmoji(meal.name, meal.ingredients)}</span>
                        <strong>{meal.name}</strong>
                        <small style={getHealthScoreColor(getHealthScore(meal))}>{getHealthScore(meal)}/10</small>
                      </div>
                    ))}
                  </div>
                ) : <p>No foods scoring 5 or lower. Nice work.</p>}
              </section>
            </div>

            <section className={`summary-next ${isToday && currentHour >= 21 ? 'late' : ''}`}>
              <div className="summary-section-title"><span>{isToday && currentHour >= 21 ? '☾' : '→'}</span><h3>What to eat next</h3></div>
              {!isToday
                ? <p>Next-meal guidance is only shown for the current day.</p>
                : currentHour >= 21
                  ? <p>It is late in the day, so there is no full-meal recommendation. If you are genuinely hungry, keep it light and easy to digest.</p>
                  : <p>{getNextMealSuggestion(totals, settings.goals, todayMeals.length, currentHour)}</p>}
            </section>
          </section>
        </div>
      )}
      {suggestionsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSuggestionsOpen(false)}>
          <section className="meal-suggestions-sheet" role="dialog" aria-modal="true" aria-labelledby="meal-suggestions-title">
            <div className="sheet-grabber" />
            <div className="suggestions-head">
              <div>
                <span className="eyebrow">Plan ahead</span>
                <h2 id="meal-suggestions-title">Tomorrow's meals</h2>
              </div>
              <button className="icon-button" onClick={() => setSuggestionsOpen(false)} aria-label="Close meal suggestions"><X size={20} /></button>
            </div>
            <p className="suggestions-date">{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(tomorrow)}</p>
            <div className="suggestions-focus">
              <span>Based on your last 7 days</span>
              <p>{tomorrowPlan.focus}</p>
            </div>
            {(['lunch', 'dinner'] as const).map((mealType, index) => {
              const suggestion = tomorrowPlan[mealType];
              const mealShare = index === 0 ? 0.3 : 0.35;
              const calorieTarget = Math.round(settings.goals.calories * mealShare);
              const proteinTarget = Math.round(settings.goals.protein * mealShare);
              return (
                <article className={`tomorrow-meal-card ${mealType}`} key={mealType}>
                  <div className="tomorrow-meal-heading">
                    <span className="tomorrow-meal-emoji">{suggestion.emoji}</span>
                    <div><small>{mealType}</small><h3>{suggestion.title}</h3></div>
                  </div>
                  <p>{suggestion.description}</p>
                  <div className="tomorrow-meal-targets">
                    <span>Target ~{calorieTarget} kcal</span>
                    <span>~{proteinTarget}g protein</span>
                  </div>
                  <small className="tomorrow-meal-reason"><strong>Why:</strong> {suggestion.why}</small>
                </article>
              );
            })}
            <p className="suggestions-note">Targets are approximate. Adjust portions to your appetite and actual ingredients.</p>
          </section>
        </div>
      )}
      {presetsOpen && (
        <div className="preset-menu-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPresetsOpen(false)}>
          <section className="preset-menu-sheet" role="dialog" aria-modal="true" aria-labelledby="preset-menu-title">
            <div className="sheet-grabber" />
            <div className="preset-menu-head">
              <div>
                <span className="eyebrow">Quick add</span>
                <h2 id="preset-menu-title">Food presets</h2>
              </div>
              <button className="icon-button" onClick={() => setPresetsOpen(false)} aria-label="Close presets"><X size={20} /></button>
            </div>
            <p className="preset-menu-note">Your most-used foods are always shown first.</p>
            <div className="preset-menu-list">
              {rankedPresets.map(({ preset, useCount }) => (
                <div className="preset-menu-row" key={preset.id}>
                  <button className="preset-menu-add" onClick={() => addPreset(preset, true)}>
                    <span className="preset-menu-emoji">{preset.emoji || getMealEmoji(preset.name, preset.ingredients)}</span>
                    <span className="preset-menu-copy">
                      <strong>{preset.name}</strong>
                      <small>{Math.round(preset.calories)} kcal · {useCount === 1 ? 'Used once' : `Used ${useCount} times`}</small>
                    </span>
                    <Plus size={18} />
                  </button>
                  <button className="preset-menu-remove" onClick={() => onRemovePreset(preset.id)} aria-label={`Remove ${preset.name} preset`}><Trash2 size={17} /></button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
