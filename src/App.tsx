import { useEffect, useRef, useState } from 'react';
import type { AnalysisResult, Meal, UserSettings } from './types';
import { dateKey, defaultSettings } from './lib';
import { useLocalStorage } from './useLocalStorage';
import { Nav, type Page } from './components/Nav';
import { TodayPage } from './pages/TodayPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProgressPage } from './pages/ProgressPage';

function mealsForLocalStorage(meals: Meal[]) {
  return meals.map(({ image: _image, ...meal }) => meal);
}

function settingsForLocalStorage(settings: UserSettings) {
  return {
    ...settings,
    presets: mealsForLocalStorage(settings.presets || []),
  };
}

function App() {
  const [page, setPage] = useState<Page>('today');
  const [meals, setMeals] = useLocalStorage<Meal[]>('nourish-meals-v2', [], mealsForLocalStorage);
  const [pendingMeals, setPendingMeals] = useLocalStorage<Meal[]>('nourish-pending-meals-v1', [], mealsForLocalStorage);
  const pendingMealIds = useRef(new Set(pendingMeals.map((meal) => meal.id)));
  const pendingMealsRef = useRef(pendingMeals);
  const activeUploadIds = useRef(new Set<string>());
  const [settings, setSettings] = useLocalStorage<UserSettings>('nourish-settings-v2', defaultSettings, settingsForLocalStorage);
  const [toast, setToast] = useState('');
  const [loaded, setLoaded] = useState(false);

  const savePendingMeals = (next: Meal[]) => {
    pendingMealsRef.current = next;
    try { localStorage.setItem('nourish-pending-meals-v1', JSON.stringify(mealsForLocalStorage(next))); } catch {}
    setPendingMeals(next);
  };

  useEffect(() => {
    const loadFromServer = () => {
      fetch('/api/sync?t=' + Date.now(), { cache: 'no-store' })
        .then((res) => res.json())
        .then((data: { meals?: Meal[], settings?: UserSettings }) => {
          if (data.meals) {
            setMeals(data.meals);
            const savedIds = new Set(data.meals.map((meal) => meal.id));
            for (const id of savedIds) {
              pendingMealIds.current.delete(id);
              activeUploadIds.current.delete(id);
            }
            savePendingMeals(pendingMealsRef.current.filter((pending) => !savedIds.has(pending.id)));
          }
          if (data.settings && Object.keys(data.settings).length) setSettings(data.settings);
        })
        .catch(console.error)
        .finally(() => setLoaded(true));
    };

    loadFromServer();
    window.addEventListener('focus', loadFromServer);
    return () => window.removeEventListener('focus', loadFromServer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timeout = setTimeout(() => {
      fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meals, settings }),
      }).catch(console.error);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [meals, settings, loaded]);

  useEffect(() => {
    localStorage.removeItem('nourish-meals-v1');
    localStorage.removeItem('nourish-settings-v1');
  }, []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  };

  const addMeal = (meal: Meal) => {
    setMeals((current) => [meal, ...current]);
    notify('Meal added to today');
  };

  const queueMeal = (meal: Meal) => {
    pendingMealIds.current.add(meal.id);
    if (meal.analysisStatus === 'uploading') activeUploadIds.current.add(meal.id);
    savePendingMeals([meal, ...pendingMealsRef.current]);
    notify('Uploading meal — keep the app open');
  };

  const markMealUploaded = (pendingId: string, jobId: string) => {
    if (!pendingMealIds.current.has(pendingId)) return;
    activeUploadIds.current.delete(pendingId);
    savePendingMeals(pendingMealsRef.current.map((pending) => pending.id === pendingId
      ? { ...pending, analysisStatus: 'analyzing', analysisJobId: jobId, analysisQueuedAt: new Date().toISOString() }
      : pending));
    notify('Upload complete — safe to close');
  };

  const completeMealAnalysis = (pendingId: string, meal: Meal) => {
    if (!pendingMealIds.current.delete(pendingId)) return;
    activeUploadIds.current.delete(pendingId);
    savePendingMeals(pendingMealsRef.current.filter((pending) => pending.id !== pendingId));
    setMeals((current) => current.some((existing) => existing.id === meal.id)
      ? current.map((existing) => existing.id === meal.id ? { ...existing, ...meal } : existing)
      : [meal, ...current]);
  };

  const failMealAnalysis = (pendingId: string, message: string) => {
    if (!pendingMealIds.current.has(pendingId)) return;
    activeUploadIds.current.delete(pendingId);
    savePendingMeals(pendingMealsRef.current.map((pending) => pending.id === pendingId
      ? { ...pending, analysisStatus: 'failed', analysisError: message }
      : pending));
  };

  const removePendingMeal = (id: string) => {
    pendingMealIds.current.delete(id);
    activeUploadIds.current.delete(id);
    savePendingMeals(pendingMealsRef.current.filter((meal) => meal.id !== id));
    void fetch(`/api/analyze-jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
  };

  const setPendingMealImage = (id: string, image: string) => {
    if (!pendingMealIds.current.has(id)) return;
    savePendingMeals(pendingMealsRef.current.map((meal) => meal.id === id ? { ...meal, image } : meal));
  };

  useEffect(() => {
    if (!loaded || !pendingMeals.some((meal) => meal.analysisJobId && (meal.analysisStatus === 'analyzing' || (meal.analysisStatus === 'uploading' && !activeUploadIds.current.has(meal.id))))) return;
    let stopped = false;

    const poll = async () => {
      const queued = pendingMeals.filter((meal) => meal.analysisJobId && (meal.analysisStatus === 'analyzing' || (meal.analysisStatus === 'uploading' && !activeUploadIds.current.has(meal.id))));
      await Promise.all(queued.map(async (pending) => {
        try {
          const response = await fetch(`/api/analyze-jobs/${encodeURIComponent(pending.analysisJobId!)}`, { cache: 'no-store' });
          if (stopped || !pendingMealIds.current.has(pending.id)) return;
          if (response.status === 404) {
            if (pending.analysisStatus === 'uploading') {
              failMealAnalysis(pending.id, 'The upload was interrupted before the server received it. Please add this food again and keep the app open until it says “Safe to close”.');
            } else {
              const queuedAt = new Date(pending.analysisQueuedAt || pending.eatenAt).getTime();
              if (Date.now() - queuedAt > 60_000) failMealAnalysis(pending.id, 'The server no longer has this analysis job. Please add this food again.');
            }
            return;
          }
          const data = await response.json() as { status?: 'analyzing' | 'complete' | 'failed'; result?: AnalysisResult; error?: string };
          if (!response.ok) throw new Error(data.error || 'Could not check the meal analysis.');
          if (data.status === 'analyzing' && pending.analysisStatus === 'uploading') {
            markMealUploaded(pending.id, pending.analysisJobId!);
          } else if (data.status === 'complete' && data.result) {
            completeMealAnalysis(pending.id, {
              ...data.result,
              id: pending.id,
              eatenAt: pending.eatenAt,
              emoji: data.result.emoji || pending.emoji,
              ...(pending.image ? { image: pending.image } : {}),
            });
          } else if (data.status === 'failed') {
            failMealAnalysis(pending.id, data.error || 'The meal could not be analyzed.');
          }
        } catch {
          // A temporary network failure should leave the job queued for the next poll.
        }
      }));
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 1500);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [loaded, pendingMeals]);

  const updateWater = (amount: number, date?: Date) => {
    const targetDate = dateKey(date || new Date());
    setSettings((current) => ({
      ...current,
      waterByDate: { ...current.waterByDate, [targetDate]: Math.max(0, (current.waterByDate[targetDate] || 0) + amount) },
    }));
  };

  const updateMeal = (updated: Meal) => {
    setMeals((current) => current.map((meal) => meal.id === updated.id ? updated : meal));
  };

  const savePreset = (preset: Meal) => {
    setSettings((current) => ({
      ...current,
      presets: [preset, ...(current.presets || []).filter((p) => p.id !== preset.id)],
    }));
    notify('Saved to presets');
  };

  const removePreset = (id: string) => {
    setSettings((current) => ({
      ...current,
      presets: (current.presets || []).filter((p) => p.id !== id),
    }));
    notify('Removed from presets');
  };

  return (
    <div className="site-shell">
      <div className="app-frame">
        {page === 'today' && <TodayPage meals={meals} pendingMeals={pendingMeals} settings={settings} onAddMeal={addMeal} onQueueMeal={queueMeal} onMarkMealUploaded={markMealUploaded} onSetPendingMealImage={setPendingMealImage} onFailMealAnalysis={failMealAnalysis} onRemovePendingMeal={removePendingMeal} onUpdateMeal={updateMeal} onDeleteMeal={(id) => setMeals((current) => current.filter((meal) => meal.id !== id))} onWater={updateWater} onSavePreset={savePreset} onRemovePreset={removePreset} />}
        {page === 'history' && <HistoryPage meals={meals} settings={settings} />}
        {page === 'progress' && <ProgressPage notify={notify} />}
        {page === 'settings' && <SettingsPage settings={settings} onSave={(value) => { setSettings(value); notify('Settings saved'); }} onClear={() => { setMeals([]); notify('Meal history cleared'); }} />}
        <Nav page={page} onChange={setPage} />
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
      <aside className="desktop-note"><span>nourish</span><h2>Eat with a little more clarity.</h2><p>AI-assisted nutrition estimates, thoughtful goals, and a simple view of your progress.</p><div className="desktop-feature"><i /> Photo meal analysis</div><div className="desktop-feature"><i /> Daily nutrition goals</div><div className="desktop-feature"><i /> Day, week & month trends</div></aside>
    </div>
  );
}

export default App;
