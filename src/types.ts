export type Nutrients = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
};

export type Meal = Nutrients & {
  id: string;
  name: string;
  emoji: string;
  portion: string;
  ingredients: string[];
  confidence: 'low' | 'medium' | 'high';
  notes: string;
  eatenAt: string;
  image?: string;
  healthScore?: number;
  healthScoreReason?: string;
  analysisStatus?: 'uploading' | 'analyzing' | 'failed';
  analysisError?: string;
  analysisJobId?: string;
  analysisQueuedAt?: string;
};

export type Goals = Nutrients & {
  water: number;
};

export type UserSettings = {
  name: string;
  goals: Goals;
  waterByDate: Record<string, number>;
  presets: Meal[];
};

export type AnalysisResult = Nutrients & {
  name: string;
  emoji: string;
  portion: string;
  ingredients: string[];
  confidence: 'low' | 'medium' | 'high';
  notes: string;
  healthScore?: number;
  healthScoreReason?: string;
};

export type ProgressCategory = 'front-relaxed' | 'front-open' | 'side';

export type ProgressSymmetry = {
  measurementVersion?: number;
  imageLeftShoulder: { x: number; y: number };
  imageRightShoulder: { x: number; y: number };
  imageLeftHip?: { x: number; y: number };
  imageRightHip?: { x: number; y: number };
  imageLeftEar?: { x: number; y: number };
  imageRightEar?: { x: number; y: number };
  chin?: { x: number; y: number };
  headCenter: { x: number; y: number };
  neckCenter: { x: number; y: number };
  torsoCenter: { x: number; y: number };
  manualBodyLine?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
};

export type ProgressSideAlignment = {
  facing: 'image-left' | 'image-right';
  ear: { x: number; y: number };
  shoulder: { x: number; y: number };
  hip: { x: number; y: number };
  knee: { x: number; y: number };
  ankle: { x: number; y: number };
};

export type ProgressPhoto = {
  id: string;
  category: ProgressCategory;
  capturedAt: string;
  uploadedAt: string;
  url: string;
  confidence: 'low' | 'medium' | 'high';
  reason: string;
  symmetry?: ProgressSymmetry;
  sideAlignment?: ProgressSideAlignment;
  alignment?: {
    top: number;
    left: number;
    bottom: number;
    right: number;
    headTop?: { x: number; y: number };
    waistCenter?: { x: number; y: number };
    torsoCenterX?: number;
  };
};
