import type { Goals, Meal, Nutrients, UserSettings } from './types';

export const defaultGoals: Goals = {
  calories: 2200,
  protein: 140,
  carbs: 240,
  fat: 75,
  fiber: 30,
  sugar: 50,
  sodium: 2300,
  water: 8,
};

export const defaultSettings: UserSettings = {
  name: '',
  goals: defaultGoals,
  waterByDate: {},
  presets: [],
};

export const nutrientKeys: (keyof Nutrients)[] = [
  'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium',
];

export const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

export const dateKey = (date: Date | string) => {
  const value = typeof date === 'string' ? new Date(date) : date;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

export const sameDay = (a: Date | string, b: Date | string) => dateKey(a) === dateKey(b);

export const sumNutrients = (meals: Meal[]): Nutrients => meals.reduce<Nutrients>((sum, meal) => {
  nutrientKeys.forEach((key) => { sum[key] += meal[key] || 0; });
  return sum;
}, { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 });

export const formatCompact = (value: number) => value >= 1000
  ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  : Math.round(value).toString();

export const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function getMealEmoji(name: string, ingredients: string[] = []) {
  const food = `${name} ${ingredients.join(' ')}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/\b(water|sparkling water|seltzer)\b/, '💧'],
    [/\b(coffee|espresso|latte|cappuccino|americano|mocha)\b/, '☕'],
    [/\b(tea|chai|matcha)\b/, '🍵'],
    [/\b(wine|champagne)\b/, '🍷'],
    [/\b(beer|ale|lager)\b/, '🍺'],
    [/\b(cocktail|martini|margarita)\b/, '🍹'],
    [/\b(juice|smoothie|shake|soda|cola|lemonade|drink|beverage)\b/, '🥤'],
    [/\b(ice cream|gelato|sundae)\b/, '🍨'],
    [/\b(cake|cheesecake|cupcake|dessert|pastry|tart)\b/, '🍰'],
    [/\b(cookie|biscuit|brownie)\b/, '🍪'],
    [/\b(chocolate|candy|sweet)\b/, '🍫'],
    [/\b(pancake|waffle|crepe)\b/, '🥞'],
    [/\b(egg|omelet|omelette|shakshuka)\b/, '🍳'],
    [/\b(cereal|oatmeal|porridge|granola|yogurt)\b/, '🥣'],
    [/\b(salad|greens)\b/, '🥗'],
    [/\b(soup|stew|ramen)\b/, '🍲'],
    [/\b(pasta|spaghetti|lasagna|noodle)\b/, '🍝'],
    [/\b(pizza)\b/, '🍕'],
    [/\b(burger|hamburger)\b/, '🍔'],
    [/\b(taco)\b/, '🌮'],
    [/\b(burrito|wrap|falafel)\b/, '🌯'],
    [/\b(sandwich|toast|panini)\b/, '🥪'],
    [/\b(sushi|sashimi)\b/, '🍣'],
    [/\b(salmon|tuna|fish|seafood|shrimp|prawn)\b/, '🐟'],
    [/\b(chicken|turkey|drumstick)\b/, '🍗'],
    [/\b(steak|beef|meat|lamb)\b/, '🥩'],
    [/\b(curry|rice|grain bowl|bowl)\b/, '🍛'],
    [/\b(apple|banana|orange|berries|fruit)\b/, '🍎'],
    [/\b(nuts|almond|peanut|cashew)\b/, '🥜'],
    [/\b(popcorn|snack|chips|crisps)\b/, '🍿'],
  ];
  return rules.find(([pattern]) => pattern.test(food))?.[1] || '🍽️';
}

export function getHealthScore(meal: Pick<Meal, 'healthScore' | 'protein' | 'fiber' | 'sugar' | 'sodium' | 'calories'>) {
  if (typeof meal.healthScore === 'number') return meal.healthScore;
  let score = 7;
  if (meal.protein > 15) score += 1;
  if (meal.fiber > 5) score += 1;
  if (meal.sugar > 15) score -= 1;
  if (meal.sodium > 800) score -= 1;
  if (meal.calories > 800) score -= 1;
  return Math.max(1, Math.min(10, score));
}

export function getHealthScoreColor(score: number) {
  if (score >= 7) return { color: '#557358', background: '#eef3ef' }; // Green
  if (score >= 4) return { color: '#856404', background: '#fff3cd' }; // Yellow
  return { color: '#721c24', background: '#f8d7da' }; // Red
}

export function getHealthScoreExplanation(meal: Pick<Meal, 'healthScore' | 'healthScoreReason' | 'protein' | 'fiber' | 'sugar' | 'sodium' | 'calories'>) {
  if (meal.healthScoreReason?.trim()) return meal.healthScoreReason.trim();

  const score = getHealthScore(meal);
  const positives: string[] = [];
  const cautions: string[] = [];
  if (meal.protein >= 20) positives.push('a strong amount of protein');
  else if (meal.protein >= 10) positives.push('some useful protein');
  else cautions.push('relatively little protein');
  if (meal.fiber >= 5) positives.push('good fiber');
  else if (meal.fiber < 3) cautions.push('low fiber');
  if (meal.sugar <= 10) positives.push('moderate sugar');
  else if (meal.sugar > 20) cautions.push('high sugar');
  if (meal.sodium <= 600) positives.push('moderate sodium');
  else if (meal.sodium > 800) cautions.push('high sodium');
  if (meal.calories > 800) cautions.push('a calorie-dense serving');

  const join = (items: string[]) => items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
    : items[0];
  const signals = positives.length && cautions.length
    ? `${join(positives)}, balanced against ${join(cautions)}`
    : positives.length
      ? join(positives)
      : cautions.length
        ? join(cautions)
        : 'a fairly typical nutrition profile';
  return `This ${score}/10 score is based on the estimated serving having ${signals}.`;
}

export async function compressImage(file: File, maxDimension = 1400, quality = 0.82): Promise<File> {
  const source = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error('Could not process the photo.')),
    'image/jpeg', quality,
  ));
  return new File([blob], 'meal.jpg', { type: 'image/jpeg' });
}

export async function makeThumbnail(file: File): Promise<string> {
  const small = await compressImage(file, 420, 0.7);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not save the photo preview.'));
    reader.readAsDataURL(small);
  });
}
