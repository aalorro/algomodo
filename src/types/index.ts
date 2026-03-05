// Core type definitions for Algomodo

export interface Parameter {
  name: string;
  type: 'number' | 'boolean' | 'select' | 'color';
  min?: number;
  max?: number;
  step?: number;
  default: any;
  help?: string;
  options?: string[];
  group?: string;
}

export interface ParameterSchema {
  [key: string]: Parameter;
}

export interface Palette {
  name: string;
  colors: string[];
}

export interface CanvasSettings {
  width: number;
  height: number;
  aspect?: 'square' | '4:5' | '3:4' | '16:9' | 'custom';
  background: string;
  transparency: boolean;
  devicePixelRatio: number;
  quality: 'draft' | 'balanced' | 'ultra';
}

export interface Recipe {
  generatorId: string;
  seed: number;
  params: Record<string, any>;
  palette: Palette;
  canvasSettings: CanvasSettings;
  postFX?: Record<string, any>;
  version: string;
}

export interface Preset {
  id: string;
  name: string;
  generatorId: string;
  params: Record<string, any>;
  palette: Palette;
  seed?: number;
  thumbnail?: string;
  description?: string;
}

export interface GeneratorFamily {
  id: string;
  name: string;
  description: string;
}

export interface Generator {
  id: string;
  family: string;
  styleName: string;
  definition: string;
  algorithmNotes: string;
  parameterSchema: ParameterSchema;
  defaultParams: Record<string, any>;
  supportsVector: boolean;
  supportsWebGPU: boolean;
  supportsAnimation: boolean;
  
  renderWebGL2?(
    gl: WebGL2RenderingContext,
    params: Record<string, any>,
    seed: number,
    palette: Palette,
    quality: 'draft' | 'balanced' | 'ultra',
    time?: number
  ): void;
  
  renderVector?(
    params: Record<string, any>,
    seed: number,
    palette: Palette
  ): SVGPath[];
  
  renderCanvas2D?(
    ctx: CanvasRenderingContext2D,
    params: Record<string, any>,
    seed: number,
    palette: Palette,
    quality: 'draft' | 'balanced' | 'ultra',
    time?: number
  ): void;
  
  renderWebGPU?(
    device: any,
    params: Record<string, any>,
    seed: number,
    palette: Palette,
    quality: 'draft' | 'balanced' | 'ultra',
    time?: number
  ): Promise<void>;
  
  estimateCost(params: Record<string, any>): number;
}

export interface SVGPath {
  d: string;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  opacity?: number;
}

export interface HistorySnapshot {
  params: Record<string, any>;
  palette: Palette;
  seed: number;
  selectedGeneratorId: string;
  selectedFamilyId: string;
  postFX: Record<string, any>;
}

export interface AppState {
  // Canvas & Viewport
  canvasSettings: CanvasSettings;
  seed: number;
  seedLocked: boolean;
  
  // Generator selection
  selectedFamilyId: string;
  selectedGeneratorId: string;
  selectedPresetId?: string;
  
  // Parameters
  params: Record<string, any>;
  lockedParams: string[];
  palette: Palette;
  
  // UI state
  theme: 'dark' | 'light';
  quality: 'draft' | 'balanced' | 'ultra';
  performanceMode: boolean;
  useWebGPU: boolean;
  useWebGL: boolean;
  showFPS: boolean;
  interactionEnabled: boolean;
  isAnimating: boolean;
  animationFps: number;
  recordingDuration: number;
  openModal: 'about' | 'privacy' | 'changelog' | 'donation' | null;

  // PostFX
  postFX: Record<string, any>;
  
  // Source image (data URL, not persisted)
  sourceImage: string | null;
  setSourceImage: (dataUrl: string | null) => void;

  // Presets
  presets: Preset[];
  savePreset: (name: string) => void;
  loadPreset: (id: string) => void;
  deletePreset: (id: string) => void;
  importPresets: (incoming: Preset[]) => void;

  // Actions
  setCanvasSettings: (settings: Partial<CanvasSettings>) => void;
  setSeed: (seed: number) => void;
  setSeedLocked: (locked: boolean) => void;
  randomizeSeed: () => void;
  selectFamily: (familyId: string) => void;
  selectGenerator: (generatorId: string) => void;
  selectPreset: (presetId: string) => void;
  updateParam: (key: string, value: any) => void;
  resetParams: () => void;
  toggleLockedParam: (key: string) => void;
  clearLockedParams: () => void;
  randomizeParams: (schema: ParameterSchema) => void;
  setPalette: (palette: Palette) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setInteractionEnabled: (enabled: boolean) => void;
  setQuality: (quality: 'draft' | 'balanced' | 'ultra') => void;
  setPerformanceMode: (enabled: boolean) => void;
  setUseWebGPU: (enabled: boolean) => void;
  setUseWebGL: (enabled: boolean) => void;
  setShowFPS: (show: boolean) => void;
  setAnimating: (animating: boolean) => void;
  setAnimationFps: (fps: number) => void;
  setRecordingDuration: (duration: number) => void;
  updatePostFX: (key: string, value: any) => void;
  setOpenModal: (modal: 'about' | 'privacy' | 'changelog' | 'donation' | null) => void;

  // History (undo/redo)
  historyPast: HistorySnapshot[];
  historyFuture: HistorySnapshot[];
  pushToHistory: () => void;
  undo: () => void;
  redo: () => void;
}

export interface WebGPUCapabilities {
  supported: boolean;
  device?: any;
  adapter?: any;
  errorMessage?: string;
}
