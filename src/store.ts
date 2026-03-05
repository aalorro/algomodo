import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppState, Palette, CanvasSettings, ParameterSchema, Preset, HistorySnapshot } from './types';
import { getGenerator } from './core/registry';
import { CURATED_PALETTES } from './data/palettes';

function captureSnapshot(state: any): HistorySnapshot {
  return {
    params: { ...state.params },
    palette: { name: state.palette.name, colors: [...state.palette.colors] },
    seed: state.seed,
    selectedGeneratorId: state.selectedGeneratorId,
    selectedFamilyId: state.selectedFamilyId,
    postFX: { ...state.postFX },
  };
}

const defaultPalette: Palette = {
  name: 'Vibrant',
  colors: ['#FF006E', '#FB5607', '#FFBE0B', '#8338EC', '#3A86FF'],
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Canvas & Viewport
      canvasSettings: {
        width: 1080,
        height: 1080,
        aspect: 'square',
        background: '#000000',
        transparency: false,
        devicePixelRatio: 2,
        quality: 'balanced',
      },
      seed: Math.floor(Math.random() * 1000000),
      seedLocked: false,

      // Generator selection
      selectedFamilyId: 'noise',
      selectedGeneratorId: 'fbm-terrain',
      selectedPresetId: undefined,

      // Parameters
      params: {},
      lockedParams: [] as string[],
      palette: defaultPalette,

      // Source image (not persisted — too large for localStorage)
      sourceImage: null,

      // History (not persisted)
      historyPast: [] as HistorySnapshot[],
      historyFuture: [] as HistorySnapshot[],

      // Presets
      presets: [],

      // UI state
      theme: 'dark' as const,
      quality: 'balanced',
      performanceMode: false,
      useWebGPU: false,
      useWebGL: false,
      showFPS: false,
      interactionEnabled: false,
      isAnimating: false,
      animationFps: 24,
      recordingDuration: 5,
      openModal: null as 'about' | 'privacy' | 'changelog' | 'donation' | null,

      // PostFX
      postFX: {
        grain: 0,
        vignette: 0,
        dither: 0,
        posterize: 0,
        outline: 0,
      },

      // Actions
      setCanvasSettings: (settings) =>
        set((state) => ({
          canvasSettings: { ...state.canvasSettings, ...settings },
        })),

      setSeed: (seed) => set({ seed }),

      setSeedLocked: (locked) => set({ seedLocked: locked }),

      randomizeSeed: () => {
        const state = get();
        if (state.seedLocked) return;
        set({
          seed: Math.floor(Math.random() * 1000000),
          historyPast: [...state.historyPast.slice(-49), captureSnapshot(state)],
          historyFuture: [],
        });
      },

      selectFamily: (familyId) =>
        set({
          selectedFamilyId: familyId,
          selectedPresetId: undefined,
        }),

      selectGenerator: (generatorId) => {
        const state = get();
        const gen = getGenerator(generatorId);

        // Randomize all params from the new generator's schema
        const randomized: Record<string, any> = {};
        if (gen?.parameterSchema) {
          for (const [key, param] of Object.entries(gen.parameterSchema)) {
            if (param.type === 'number') {
              const min = param.min ?? 0, max = param.max ?? 1, step = param.step ?? 1;
              const steps = Math.round((max - min) / step);
              randomized[key] = min + Math.floor(Math.random() * (steps + 1)) * step;
            } else if (param.type === 'boolean') {
              randomized[key] = Math.random() > 0.5;
            } else if (param.type === 'select' && param.options?.length) {
              randomized[key] = param.options[Math.floor(Math.random() * param.options.length)];
            }
          }
        }

        const randomPalette = CURATED_PALETTES[Math.floor(Math.random() * CURATED_PALETTES.length)];

        set({
          selectedGeneratorId: generatorId,
          selectedPresetId: undefined,
          params: randomized,
          palette: randomPalette,
          lockedParams: [],
          ...(state.seedLocked ? {} : { seed: Math.floor(Math.random() * 1000000) }),
          historyPast: [...state.historyPast.slice(-49), captureSnapshot(state)],
          historyFuture: [],
        });
      },

      selectPreset: (presetId) => {
        const state = get();
        set({
          selectedPresetId: presetId,
        });
      },

      updateParam: (key, value) =>
        set((state) => ({
          params: { ...state.params, [key]: value },
        })),

      resetParams: () => {
        const state = get();
        set({
          params: {},
          historyPast: [...state.historyPast.slice(-49), captureSnapshot(state)],
          historyFuture: [],
        });
      },

      toggleLockedParam: (key: string) => {
        const state = get();
        const arr = Array.isArray(state.lockedParams) ? state.lockedParams : [];
        const has = arr.includes(key);
        set({ lockedParams: has ? arr.filter(k => k !== key) : [...arr, key] });
      },

      clearLockedParams: () => set({ lockedParams: [] }),

      randomizeParams: (schema: ParameterSchema) => {
        const state = get();
        const locked = Array.isArray(state.lockedParams) ? state.lockedParams : [];
        const randomized: Record<string, any> = {};
        for (const [key, param] of Object.entries(schema)) {
          if (locked.includes(key)) {
            // Preserve current value for locked params
            randomized[key] = state.params[key] ?? param.default;
            continue;
          }
          if (param.type === 'number') {
            const min = param.min ?? 0, max = param.max ?? 1, step = param.step ?? 1;
            const steps = Math.round((max - min) / step);
            randomized[key] = min + Math.floor(Math.random() * (steps + 1)) * step;
          } else if (param.type === 'boolean') {
            randomized[key] = Math.random() > 0.5;
          } else if (param.type === 'select' && param.options?.length) {
            randomized[key] = param.options[Math.floor(Math.random() * param.options.length)];
          }
        }
        set({
          params: randomized,
          seed: Math.floor(Math.random() * 1000000),
          historyPast: [...state.historyPast.slice(-49), captureSnapshot(state)],
          historyFuture: [],
        });
      },

      setSourceImage: (dataUrl) => set({ sourceImage: dataUrl }),

      savePreset: (name: string) => {
        const s = get();
        const gen = getGenerator(s.selectedGeneratorId);
        const preset: Preset = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name,
          generatorId: s.selectedGeneratorId,
          params: { ...(gen?.defaultParams ?? {}), ...s.params },
          palette: s.palette,
          seed: s.seed,
        };
        set(state => ({ presets: [...state.presets, preset] }));
      },

      loadPreset: (id: string) => {
        const preset = get().presets.find(p => p.id === id);
        if (!preset) return;
        const gen = getGenerator(preset.generatorId);
        set({
          selectedGeneratorId: preset.generatorId,
          selectedFamilyId: gen?.family ?? get().selectedFamilyId,
          selectedPresetId: id,
          params: preset.params,
          palette: preset.palette,
          ...(preset.seed !== undefined ? { seed: preset.seed } : {}),
        });
      },

      deletePreset: (id: string) =>
        set(state => ({ presets: state.presets.filter(p => p.id !== id) })),

      importPresets: (incoming) => {
        set(state => {
          const existingIds = new Set(state.presets.map(p => p.id));
          const newPresets = incoming.filter(p => !existingIds.has(p.id));
          return { presets: [...state.presets, ...newPresets] };
        });
      },

      setPalette: (palette) => {
        const state = get();
        set({
          palette,
          historyPast: [...state.historyPast.slice(-49), captureSnapshot(state)],
          historyFuture: [],
        });
      },

      setTheme: (theme) => set({ theme }),

      setInteractionEnabled: (enabled) => set({ interactionEnabled: enabled }),

      setQuality: (quality) => set({ quality }),

      setPerformanceMode: (enabled) => set({ performanceMode: enabled }),

      setUseWebGPU: (enabled) => set({ useWebGPU: enabled }),

      setUseWebGL: (enabled) => set({ useWebGL: enabled }),

      setShowFPS: (show) => set({ showFPS: show }),

      setAnimating: (animating) => set({ isAnimating: animating }),

      setAnimationFps: (fps) => set({ animationFps: fps }),

      setRecordingDuration: (duration) => set({ recordingDuration: duration }),

      updatePostFX: (key, value) =>
        set((state) => ({
          postFX: { ...state.postFX, [key]: value },
        })),

      setOpenModal: (modal) => set({ openModal: modal }),

      pushToHistory: () => {
        const state = get();
        set({
          historyPast: [...state.historyPast.slice(-49), captureSnapshot(state)],
          historyFuture: [],
        });
      },

      undo: () => {
        const state = get();
        if (state.historyPast.length === 0) return;
        const prev = state.historyPast[state.historyPast.length - 1];
        const current = captureSnapshot(state);
        set({
          ...prev,
          historyPast: state.historyPast.slice(0, -1),
          historyFuture: [current, ...state.historyFuture.slice(0, 49)],
        });
      },

      redo: () => {
        const state = get();
        if (state.historyFuture.length === 0) return;
        const next = state.historyFuture[0];
        const current = captureSnapshot(state);
        set({
          ...next,
          historyPast: [...state.historyPast.slice(-49), current],
          historyFuture: state.historyFuture.slice(1),
        });
      },
    }),
    {
      name: 'algomodo-store',
      partialize: (state) => ({
        canvasSettings: state.canvasSettings,
        theme: state.theme,
        performanceMode: state.performanceMode,
        useWebGPU: state.useWebGPU,
        showFPS: state.showFPS,
        seedLocked: state.seedLocked,
        presets: state.presets,
      }),
    }
  )
);
