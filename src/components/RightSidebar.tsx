import React, { useState, useRef } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { getGenerator } from '../core/registry';
import { ParameterControls } from './ParameterControls';
import { createRecipe, downloadRecipe, downloadJSON } from '../core/recipe';
import { generateSVG, downloadSVG } from '../renderers/svg/builder';
import { CanvasRecorder } from '../utils/recorder';
import { CURATED_PALETTES } from '../data/palettes';

export const RightSidebar: React.FC = () => {
  const {
    selectedGeneratorId,
    selectedPresetId,
    seed,
    seedLocked,
    setSeed,
    setSeedLocked,
    randomizeSeed,
    canvasSettings,
    params,
    palette,
    setPalette,
    postFX,
    updatePostFX,
    quality,
    setQuality,
    showFPS,
    setShowFPS,
    performanceMode,
    setPerformanceMode,
    useWebGL,
    setUseWebGL,
    isAnimating,
    setAnimating,
    animationFps,
    setAnimationFps,
    theme,
    setTheme,
    interactionEnabled,
    setInteractionEnabled,
    presets,
    savePreset,
    loadPreset,
    deletePreset,
    importPresets,
    sourceImage,
    setSourceImage,
    recordingDuration,
    setRecordingDuration,
  } = useStore(useShallow(s => ({
    selectedGeneratorId: s.selectedGeneratorId,
    selectedPresetId: s.selectedPresetId,
    seed: s.seed,
    seedLocked: s.seedLocked,
    setSeed: s.setSeed,
    setSeedLocked: s.setSeedLocked,
    randomizeSeed: s.randomizeSeed,
    canvasSettings: s.canvasSettings,
    params: s.params,
    palette: s.palette,
    setPalette: s.setPalette,
    postFX: s.postFX,
    updatePostFX: s.updatePostFX,
    quality: s.quality,
    setQuality: s.setQuality,
    showFPS: s.showFPS,
    setShowFPS: s.setShowFPS,
    performanceMode: s.performanceMode,
    setPerformanceMode: s.setPerformanceMode,
    useWebGL: s.useWebGL,
    setUseWebGL: s.setUseWebGL,
    isAnimating: s.isAnimating,
    setAnimating: s.setAnimating,
    animationFps: s.animationFps,
    setAnimationFps: s.setAnimationFps,
    theme: s.theme,
    setTheme: s.setTheme,
    interactionEnabled: s.interactionEnabled,
    setInteractionEnabled: s.setInteractionEnabled,
    presets: s.presets,
    savePreset: s.savePreset,
    loadPreset: s.loadPreset,
    deletePreset: s.deletePreset,
    importPresets: s.importPresets,
    sourceImage: s.sourceImage,
    setSourceImage: s.setSourceImage,
    recordingDuration: s.recordingDuration,
    setRecordingDuration: s.setRecordingDuration,
  })));

  const generator = getGenerator(selectedGeneratorId);
  const [activeTab, setActiveTab] = useState<'params' | 'presets' | 'export' | 'settings'>('params');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState('');
  const recorderRef = useRef<CanvasRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [imageFileName, setImageFileName] = useState('');
  const [filePrefix, setFilePrefix] = useState('');
  const [presetPrefix, setPresetPrefix] = useState('');
  const [recipePrefix, setRecipePrefix] = useState('');
  const [importError, setImportError] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

  const buildFilename = (ext: string): string => {
    if (filePrefix.trim()) return `${filePrefix.trim()}.${ext}`;
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    return `algomodo-${date}-${time}.${ext}`;
  };

  const buildPresetFilename = (): string => {
    if (presetPrefix.trim()) return `${presetPrefix.trim()}.json`;
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    return `algomodo-preset-${date}-${time}.json`;
  };

  const buildRecipeFilename = (): string => {
    if (recipePrefix.trim()) return `${recipePrefix.trim()}.json`;
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    return `algomodo-json-${date}-${time}.json`;
  };

  const loadFromUrl = async (url: string) => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Not an image');
      const reader = new FileReader();
      reader.onload = (e) => setSourceImage(e.target?.result as string);
      reader.readAsDataURL(blob);
      return;
    } catch { /* fall through */ }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d')!.drawImage(img, 0, 0);
        setSourceImage(c.toDataURL());
      } catch {
        alert('Could not read image — the server may block cross-origin access.');
      }
    };
    img.onerror = () => alert('Failed to load image from URL.');
    img.src = url;
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setSourceImage(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleExportPNG = async () => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) return;

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = buildFilename('png');
    link.click();
  };

  const handleExportJPG = async () => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) return;

    // JPEG has no alpha — composite onto white first
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const offCtx = offscreen.getContext('2d')!;
    offCtx.fillStyle = '#ffffff';
    offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
    offCtx.drawImage(canvas, 0, 0);

    const link = document.createElement('a');
    link.href = offscreen.toDataURL('image/jpeg', 0.92);
    link.download = buildFilename('jpg');
    link.click();
  };

  const handleExportGIF = async () => {
    if (!isAnimating) {
      alert('Animation must be enabled to record GIF');
      return;
    }

    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) {
      alert('Canvas not found');
      return;
    }

    try {
      setIsRecording(true);
      console.log(`Starting GIF recording for ${recordingDuration} seconds...`);

      const gifSize = 600;
      const recorder = new CanvasRecorder({
        duration: recordingDuration,
        fps: 24,
        width: gifSize,
        height: gifSize,
      });

      recorderRef.current = recorder;
      recorder.startRecording(canvas, recordingDuration);

      await new Promise((resolve) => {
        setTimeout(() => {
          recorder.stopRecording();
          console.log(`Recording complete. Captured ${recorder.getFrameCount()} frames`);
          resolve(null);
        }, recordingDuration * 1000 + 500);
      });

      if (recorder.getFrameCount() === 0) {
        throw new Error('No frames were recorded. Make sure animation is playing.');
      }

      console.log('Starting GIF encoding...');
      const blob = await recorder.exportGIF(gifSize, gifSize, 24);

      if (!blob || blob.size === 0) {
        throw new Error('Generated GIF is empty');
      }

      console.log(`GIF encoded successfully: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = buildFilename('gif');
      link.click();
      URL.revokeObjectURL(url);

      setIsRecording(false);
    } catch (error: any) {
      console.error('GIF export error:', error);
      alert(`Failed to export GIF: ${error?.message || 'Unknown error'}`);
      setIsRecording(false);
    }
  };

  const handleExportWebM = async () => {
    if (!isAnimating) {
      alert('Animation must be enabled to record video');
      return;
    }

    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) {
      alert('Canvas not found');
      return;
    }

    try {
      setIsRecording(true);
      console.log(`Starting WebM recording for ${recordingDuration} seconds...`);

      const recorder = new CanvasRecorder({
        duration: recordingDuration,
        fps: 30,
        width: canvas.width,
        height: canvas.height,
      });

      recorderRef.current = recorder;
      recorder.startRecording(canvas, recordingDuration);

      await new Promise((resolve) => {
        setTimeout(() => {
          recorder.stopRecording();
          console.log(`Recording complete. Captured ${recorder.getFrameCount()} frames`);
          resolve(null);
        }, recordingDuration * 1000 + 500);
      });

      if (recorder.getFrameCount() === 0) {
        throw new Error('No frames were recorded. Make sure animation is playing.');
      }

      console.log('Starting WebM encoding...');
      const blob = await recorder.exportWebM(canvas.width, canvas.height, 30);

      if (!blob || blob.size === 0) {
        throw new Error('Generated WebM is empty');
      }

      console.log(`WebM encoded successfully: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = buildFilename('webm');
      link.click();
      URL.revokeObjectURL(url);

      setIsRecording(false);
    } catch (error: any) {
      console.error('WebM export error:', error);
      alert(`Failed to export video: ${error?.message || 'Unknown error'}`);
      setIsRecording(false);
    }
  };

  const handleExportSVG = () => {
    if (!generator?.supportsVector) {
      alert('This generator does not support SVG export');
      return;
    }

    if (!generator.renderVector) return;
    const paths = generator.renderVector(params, seed, palette);
    const svg = generateSVG(paths, canvasSettings.width, canvasSettings.height, canvasSettings.background);
    downloadSVG(svg, buildFilename('svg'));
  };

  const handleExportRecipe = () => {
    const recipe = createRecipe(
      selectedGeneratorId,
      seed,
      params,
      palette,
      canvasSettings,
      postFX
    );
    downloadRecipe(recipe, buildRecipeFilename());
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 overflow-hidden px-2 sm:px-4 md:px-6 lg:px-12">
      {/* Source Image */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-2">Source Image</label>
        {sourceImage ? (
          <div className="flex items-center gap-2">
            <img src={sourceImage} alt="source" className="w-12 h-12 object-cover rounded flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-600 dark:text-gray-300 truncate">{imageFileName}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Used by Image generators</p>
              <button
                onClick={() => { setSourceImage(null); setImageFileName(''); }}
                className="text-xs text-red-500 dark:text-red-400 hover:text-red-400 dark:hover:text-red-300"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <>
            <input
              id="sidebar-image-upload"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
            />
            <button
              onClick={() => document.getElementById('sidebar-image-upload')?.click()}
              className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-white rounded text-center"
            >
              Upload Image
            </button>

            {!showUrlInput ? (
              <button
                onClick={() => setShowUrlInput(true)}
                className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-white rounded text-center mt-1"
              >
                Load from URL
              </button>
            ) : (
              <div className="mt-1 space-y-1">
                <input
                  autoFocus
                  type="url"
                  value={urlInputValue}
                  onChange={e => setUrlInputValue(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  className="w-full px-2 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded text-sm border border-gray-300 dark:border-gray-600 focus:outline-none focus:border-blue-500"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && urlInputValue.trim()) {
                      loadFromUrl(urlInputValue.trim());
                      setShowUrlInput(false);
                      setUrlInputValue('');
                    } else if (e.key === 'Escape') {
                      setShowUrlInput(false);
                      setUrlInputValue('');
                    }
                  }}
                />
                <div className="flex gap-1">
                  <button
                    onClick={() => { loadFromUrl(urlInputValue.trim()); setShowUrlInput(false); setUrlInputValue(''); }}
                    disabled={!urlInputValue.trim()}
                    className="flex-1 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:text-gray-400 text-white rounded"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => { setShowUrlInput(false); setUrlInputValue(''); }}
                    className="flex-1 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-white rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-center">or drag / paste onto canvas</p>
          </>
        )}
      </div>

      {/* Seed Control */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 space-y-3">
        <div>
          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-2">Seed</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
              className="flex-1 px-2 py-2 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded text-sm font-mono border border-gray-200 dark:border-transparent"
            />
            <button
              onClick={() => setSeedLocked(!seedLocked)}
              className={`px-3 py-2 rounded text-sm ${
                seedLocked ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}
              title={seedLocked ? 'Seed locked' : 'Seed unlocked'}
            >
              🔒
            </button>
          </div>
        </div>
        <button
          onClick={randomizeSeed}
          className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm"
        >
          Randomize Seed
        </button>
      </div>

      {/* Palette Picker */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-2">Palette</label>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {CURATED_PALETTES.map((p) => (
            <button
              key={p.name}
              onClick={() => setPalette(p)}
              className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs transition ${
                palette.name === p.name
                  ? 'ring-1 ring-blue-400 bg-gray-100 dark:bg-gray-800'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <span className="text-gray-600 dark:text-gray-300 w-20 text-left shrink-0">{p.name}</span>
              <div className="flex gap-0.5 flex-1">
                {p.colors.map((color) => (
                  <div
                    key={color}
                    className="flex-1 h-4 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {(['params', 'presets', 'export', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-1 text-xs font-semibold transition ${
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
            style={{ paddingTop: 14, paddingBottom: 14 }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'params' && <ParameterControls generator={generator} />}

        {activeTab === 'presets' && (
          <div className="flex flex-col h-full">
            <div className="px-4 py-4 space-y-3 overflow-y-auto pb-[30px] flex-1">
            {/* Save section */}
            {!showSaveForm ? (
              <button
                onClick={() => setShowSaveForm(true)}
                className="w-full px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                Save as Preset
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  autoFocus
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  placeholder="Preset name..."
                  className="w-full px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded text-sm border border-gray-300 dark:border-gray-600 focus:outline-none focus:border-blue-500"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && presetName.trim()) {
                      savePreset(presetName.trim());
                      setShowSaveForm(false);
                      setPresetName('');
                    } else if (e.key === 'Escape') {
                      setShowSaveForm(false);
                      setPresetName('');
                    }
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { savePreset(presetName.trim()); setShowSaveForm(false); setPresetName(''); }}
                    disabled={!presetName.trim()}
                    className="flex-1 px-3 py-1 text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:text-gray-400 text-white rounded"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setShowSaveForm(false); setPresetName(''); }}
                    className="flex-1 px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-white rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Export / Import */}
            {presets.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-1">Preset Filename</label>
                <input
                  type="text"
                  value={presetPrefix}
                  onChange={(e) => setPresetPrefix(e.target.value)}
                  placeholder="algomodo-preset-YYYYMMDD-HHMMSS"
                  className="w-full px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded text-sm border border-gray-200 dark:border-transparent placeholder-gray-400 dark:placeholder-gray-600"
                />
              </div>
            )}
            <div className="flex gap-2">
              {presets.length > 0 && (
                <button
                  onClick={() => downloadJSON(presets, buildPresetFilename())}
                  className="flex-1 px-3 py-2 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-white rounded"
                >
                  Export All
                </button>
              )}
              <button
                onClick={() => importInputRef.current?.click()}
                className="flex-1 px-3 py-2 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-white rounded"
              >
                Import
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const parsed = JSON.parse(text);
                    if (!Array.isArray(parsed) || !parsed.every((p: any) => p.id && p.name && p.generatorId && p.params && p.palette)) {
                      throw new Error('Invalid preset format');
                    }
                    importPresets(parsed);
                    setImportError('');
                  } catch {
                    setImportError('Invalid preset file');
                    setTimeout(() => setImportError(''), 3000);
                  }
                  e.target.value = '';
                }}
              />
            </div>
            {importError && (
              <p className="text-xs text-red-500 dark:text-red-400">{importError}</p>
            )}

            {/* Preset list */}
            {presets.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">No presets saved yet</p>
            ) : (
              <div className="space-y-2">
                {presets.map(p => (
                  <div
                    key={p.id}
                    className={`p-2 rounded border ${selectedPresetId === p.id ? 'border-blue-500' : 'border-gray-200 dark:border-gray-700'} bg-gray-50 dark:bg-gray-800`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 dark:text-white font-medium truncate">{p.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{getGenerator(p.generatorId)?.styleName ?? p.generatorId}</p>
                      </div>
                      <button
                        onClick={() => deletePreset(p.id)}
                        className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 px-1 text-lg leading-none"
                        title="Delete preset"
                      >
                        ×
                      </button>
                    </div>
                    <div className="flex gap-0.5 mt-1 mb-2">
                      {p.palette.colors.map(c => (
                        <div key={c} className="flex-1 h-2 rounded-sm" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <button
                      onClick={() => loadPreset(p.id)}
                      className="w-full text-xs py-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-white rounded"
                    >
                      Load
                    </button>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        )}

        {activeTab === 'export' && (
          <div className="flex flex-col h-full">
            <div className="px-4 py-4 space-y-3 overflow-y-auto pb-[30px] flex-1">
            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-1">Filename Prefix</label>
              <input
                type="text"
                value={filePrefix}
                onChange={(e) => setFilePrefix(e.target.value)}
                placeholder={`algomodo-${new Date().toISOString().slice(0,10).replace(/-/g,'')}…`}
                className="w-full px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded text-sm border border-gray-200 dark:border-transparent placeholder-gray-400 dark:placeholder-gray-600"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Leave blank for <span className="font-mono">algomodo-date-time</span>
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Still Image</h3>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={handleExportPNG}
                  className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                >
                  PNG
                </button>
                <button
                  onClick={handleExportJPG}
                  className="flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm"
                >
                  JPG
                </button>
              </div>
              {generator?.supportsVector && (
                <button
                  onClick={handleExportSVG}
                  className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm mb-2"
                >
                  SVG
                </button>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Animation</h3>
              {!isAnimating && (
                <p className="text-xs text-yellow-600 dark:text-yellow-400 mb-2">Enable animation in Settings first</p>
              )}
              <div className="mb-2">
                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Duration</label>
                <div className="flex gap-1">
                  {[3, 5, 8].map((sec) => (
                    <button
                      key={sec}
                      onClick={() => setRecordingDuration(sec)}
                      disabled={isRecording || !isAnimating}
                      className={`flex-1 py-1 rounded text-sm font-medium transition-colors ${
                        recordingDuration === sec
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleExportGIF}
                className={`w-full px-3 py-2 rounded text-sm mb-2 ${
                  isRecording || !isAnimating
                    ? 'bg-gray-200 dark:bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-yellow-600 hover:bg-yellow-700 text-white'
                }`}
                disabled={isRecording || !isAnimating}
              >
                {isRecording ? `Recording... (${recordingProgress}%)` : 'GIF (may take 1-2 min)'}
              </button>
              <button
                onClick={handleExportWebM}
                className={`w-full px-3 py-2 rounded text-sm ${
                  isRecording || !isAnimating
                    ? 'bg-gray-200 dark:bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-orange-600 hover:bg-orange-700 text-white'
                }`}
                disabled={isRecording || !isAnimating}
              >
                {isRecording ? `Recording... (${recordingProgress}%)` : 'WebM Video'}
              </button>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Data</h3>
              <button
                onClick={handleExportRecipe}
                className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm"
              >
                JSON Recipe
              </button>
              <input
                type="text"
                value={recipePrefix}
                onChange={(e) => setRecipePrefix(e.target.value)}
                placeholder="algomodo-json-YYYYMMDD-HHMMSS"
                className="w-full mt-1 px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded text-sm border border-gray-200 dark:border-transparent placeholder-gray-400 dark:placeholder-gray-600"
              />
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Canvas</h3>
              <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
                <p>Width: {canvasSettings.width}px</p>
                <p>Height: {canvasSettings.height}px</p>
                <p>DPR: {canvasSettings.devicePixelRatio}x</p>
              </div>
            </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="flex flex-col h-full">
            <div className="px-4 py-4 space-y-4 overflow-y-auto pb-[30px] flex-1">
            {/* Theme toggle */}
            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-2">
                Theme
              </label>
              <div className="flex gap-1">
                {(['light', 'dark'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`flex-1 py-1 text-xs rounded transition capitalize ${
                      theme === t
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-2">
                <input
                  type="checkbox"
                  checked={interactionEnabled}
                  onChange={(e) => setInteractionEnabled(e.target.checked)}
                  className="w-4 h-4"
                />
                Mouse / Touch Interaction
              </label>
              <p className="text-xs text-gray-400 dark:text-gray-500">Spotlight vignette and ripple on click</p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-2">
                <input
                  type="checkbox"
                  checked={showFPS}
                  onChange={(e) => setShowFPS(e.target.checked)}
                  className="w-4 h-4"
                />
                Show FPS
              </label>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-2">
                <input
                  type="checkbox"
                  checked={performanceMode}
                  onChange={(e) => setPerformanceMode(e.target.checked)}
                  className="w-4 h-4"
                />
                Performance Mode
              </label>
              <p className="text-xs text-gray-400 dark:text-gray-500">Reduces quality while interacting</p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-2">
                <input
                  type="checkbox"
                  checked={useWebGL}
                  onChange={(e) => setUseWebGL(e.target.checked)}
                  className="w-4 h-4"
                />
                Use WebGL Rendering
              </label>
              <p className="text-xs text-gray-400 dark:text-gray-500">Optional WebGL2 acceleration (if supported)</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-2">
                Quality
              </label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as any)}
                className="w-full px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded text-sm border border-gray-200 dark:border-transparent"
              >
                <option value="draft">Draft</option>
                <option value="balanced">Balanced</option>
                <option value="ultra">Ultra</option>
              </select>
            </div>

            {generator?.supportsAnimation && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={isAnimating}
                    onChange={(e) => setAnimating(e.target.checked)}
                    className="w-4 h-4"
                  />
                  Animate
                </label>
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-1">FPS</label>
                  <div className="flex gap-1">
                    {[12, 24, 30, 60].map(fps => (
                      <button
                        key={fps}
                        onClick={() => setAnimationFps(fps)}
                        className={`flex-1 py-1 text-xs rounded transition ${
                          animationFps === fps
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                        }`}
                      >
                        {fps}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-2">
                Post FX
              </label>
              <div className="space-y-2">
                {[
                  { key: 'grain', label: 'Grain', min: 0, max: 0.5, step: 0.01 },
                  { key: 'vignette', label: 'Vignette', min: 0, max: 2, step: 0.1 },
                  { key: 'dither', label: 'Dither Levels', min: 0, max: 16, step: 1 },
                  { key: 'posterize', label: 'Posterize Bits', min: 0, max: 8, step: 1 },
                ].map(({ key, label, min, max, step }) => (
                  <div key={key}>
                    <label className="flex justify-between text-xs text-gray-600 dark:text-gray-300 mb-1">
                      <span>{label}</span>
                      <span className="text-gray-400 dark:text-gray-500 font-mono">{postFX[key]}</span>
                    </label>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={postFX[key] ?? 0}
                      onChange={(e) => updatePostFX(key, parseFloat(e.target.value))}
                      className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded cursor-pointer"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-2">
                Version
              </label>
              <p className="text-xs text-gray-400 dark:text-gray-500">Algomodo v1.4.0</p>
            </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
