// Core type definitions for Algomodo

export interface Parameter {
  name: string;
  type: 'number' | 'boolean' | 'select' | 'color' | 'text';
  min?: number;
  max?: number;
  step?: number;
  default: any;
  help?: string;
  options?: string[];
  group?: string;
  maxLength?: number;
  placeholder?: string;
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
  supportsAudio?: boolean;
  
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
  ): void | boolean;
  
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

export interface OverlaySettings {
  opacity: number;
  angle: number;
  blendMode: GlobalCompositeOperation;
}

export const OVERLAY_EXCLUDED_FAMILIES = new Set(['image', 'noise', 'procedural', 'fractals']);

export interface HistorySnapshot {
  params: Record<string, any>;
  palette: Palette;
  seed: number;
  selectedGeneratorId: string | null;
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
  selectedGeneratorId: string | null;
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
  pausedTime: number | null;
  animationFps: number;
  recordingDuration: number;
  boomerangGif: boolean;
  endlessGif: boolean;
  renderKey: number;
  openModal: 'about' | 'privacy' | 'changelog' | 'donation' | 'instructions' | 'roadmap' | 'use-cases' | 'report-bug' | null;

  // PostFX
  postFX: Record<string, any>;
  
  // Source image (data URL, not persisted)
  sourceImage: string | null;
  setSourceImage: (dataUrl: string | null) => void;

  // Overlay image (data URL, not persisted)
  overlayImage: string | null;
  overlaySettings: OverlaySettings;
  setOverlayImage: (dataUrl: string | null) => void;
  updateOverlaySetting: (key: keyof OverlaySettings, value: any) => void;

  // Audio source (not persisted)
  audioFile: File | null;
  audioFileName: string | null;
  audioProgress: number;    // 0-1 normalized playback position
  audioDuration: number;    // seconds
  audioSeekTo: number | null; // set by UI, consumed by renderer
  setAudioFile: (file: File | null) => void;
  setAudioFileName: (name: string | null) => void;
  setAudioProgress: (p: number) => void;
  setAudioDuration: (d: number) => void;
  setAudioSeekTo: (t: number | null) => void;

  // Presets
  presets: Preset[];
  savePreset: (name: string) => void;
  loadPreset: (id: string) => void;
  deletePreset: (id: string) => void;
  importPresets: (incoming: Preset[]) => void;
  loadRecipe: (recipe: Recipe) => void;

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
  setPausedTime: (time: number | null) => void;
  setAnimationFps: (fps: number) => void;
  setRecordingDuration: (duration: number) => void;
  setBoomerangGif: (on: boolean) => void;
  setEndlessGif: (on: boolean) => void;
  forceReload: () => void;
  clearCanvas: () => void;
  updatePostFX: (key: string, value: any) => void;
  setOpenModal: (modal: 'about' | 'privacy' | 'changelog' | 'donation' | 'instructions' | 'roadmap' | 'use-cases' | 'report-bug' | null) => void;

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
