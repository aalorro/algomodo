import React from 'react';
import { useStore } from '../store';

export const InstructionsModal: React.FC = () => {
  const { setOpenModal } = useStore();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">How to Use Algomodo</h2>
          <button
            onClick={() => setOpenModal(null)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-sm text-gray-700 dark:text-gray-300">

          {/* Overview */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">What is Algomodo?</h3>
            <p className="mb-2">
              Algomodo is an algorithmic art generator that runs entirely in your browser. Nothing is uploaded &mdash; all processing happens locally on your device.
            </p>
            <p>
              Choose a <strong>family</strong> from the left panel, then pick a <strong>style</strong> to generate art. There are <strong>93 generators</strong> across 10 families: Cellular, Geometry, Noise, Plotter, Voronoi, Animation, Image, Fractals, Text, and Graphs.
            </p>
          </div>

          {/* What is a Seed */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">What is a Seed?</h3>
            <p className="mb-2">
              A <strong>seed</strong> is a number that controls the randomness in your artwork. Think of it as a recipe number &mdash; the same seed with the same parameters and palette will always produce the exact same result, every time.
            </p>
            <p className="mb-2">
              This means you can share a seed number with someone else and they will see the identical artwork. It also means you can safely experiment &mdash; write down a seed you like and you can always get back to it.
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>The seed is shown at the top of the Params tab.</li>
              <li><strong>Lock the seed</strong> (click the lock icon) to keep the same seed while randomizing other settings. This lets you explore different parameter combinations on the same underlying pattern.</li>
              <li><strong>Randomize Seed</strong> generates a new seed, giving you a completely fresh starting point.</li>
            </ul>
          </div>

          {/* Three Canvas Buttons */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">SURPRISE ME vs RAND vs RELOAD</h3>
            <p className="mb-3">These three buttons serve different purposes:</p>
            <ul className="space-y-3">
              <li>
                <strong className="text-purple-500">SURPRISE ME</strong> (canvas button)
                <br />
                <span className="text-gray-500 dark:text-gray-400">Picks a completely random generator from any family, with random parameters, a random palette, and a new seed. Use this when you want to discover something entirely new.</span>
              </li>
              <li>
                <strong className="text-purple-500">RAND</strong> (Params tab button)
                <br />
                <span className="text-gray-500 dark:text-gray-400">Keeps the current generator but randomizes all unlocked parameters and generates a new seed. Use this to explore different variations of the same style. Any parameters you have locked will stay the same.</span>
              </li>
              <li>
                <strong className="text-blue-500">RELOAD</strong> (canvas button)
                <br />
                <span className="text-gray-500 dark:text-gray-400">Re-renders the artwork from scratch with the exact same settings &mdash; same generator, same seed, same parameters, same palette. Nothing changes. Use this to replay an animation that has reached a stop state (e.g. Game of Life ending in a still pattern) or to force a fresh redraw.</span>
              </li>
            </ul>
          </div>

          {/* The Four Tabs */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">The Four Tabs</h3>
            <ul className="space-y-3">
              <li>
                <strong>Params</strong>
                <br />
                <span className="text-gray-500 dark:text-gray-400">The main control panel. Every generator has its own set of parameters &mdash; sliders for numbers, dropdowns for modes, checkboxes for toggles, and text fields for custom input. Adjust these to fine-tune your artwork. Use the <strong>Animate</strong> button to toggle animation on/off, and <strong>Rand</strong> to randomize. Lock individual parameters with the lock icon to keep them fixed during randomization.</span>
              </li>
              <li>
                <strong>Presets</strong>
                <br />
                <span className="text-gray-500 dark:text-gray-400">Save your favorite creations as named presets. Click any preset to instantly restore its generator, parameters, palette, and seed. Export presets as files to share with others, or import preset files you have received. You can also export individual presets.</span>
              </li>
              <li>
                <strong>Export</strong>
                <br />
                <span className="text-gray-500 dark:text-gray-400">Download your artwork in multiple formats. Static formats (PNG, JPG, SVG) are always available. Animation formats (GIF, WebM) require animation to be enabled first. You can also export a JSON recipe file that saves every setting so the artwork can be recreated exactly.</span>
              </li>
              <li>
                <strong>Settings</strong>
                <br />
                <span className="text-gray-500 dark:text-gray-400">Controls for theme (light/dark), canvas dimensions, animation FPS, mouse/touch interaction, and PostFX. PostFX are pixel-level effects (Grain, Vignette, Dither, Posterize) applied on top of any generator to add texture and atmosphere.</span>
              </li>
            </ul>
          </div>

          {/* Why Upload Images */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Why Upload Images?</h3>
            <p className="mb-2">
              The <strong>Image</strong> family of generators transforms your photos and images into algorithmic art. Unlike other families that generate patterns from scratch, Image generators need a source image to work with.
            </p>
            <p className="mb-2">
              To load an image:
            </p>
            <ul className="list-disc list-inside space-y-1 mb-2">
              <li><strong>Drag &amp; drop</strong> an image file onto the canvas.</li>
              <li><strong>Paste</strong> an image from your clipboard (Ctrl+V).</li>
              <li><strong>Paste a URL</strong> to load an image from the web.</li>
            </ul>
            <p>
              Once loaded, the image feeds into generators like Pixel Sort, Mosaic, Halftone, ASCII Art, Dither, Lino Cut, Edge Detect, and more. Each transforms your image in a different way. Your image stays in your browser &mdash; it is never uploaded anywhere.
            </p>
          </div>

          {/* Text Generators */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Text Generators</h3>
            <p>
              The Text family creates typographic art from characters and words. Each generator has an optional <strong>custom text</strong> field &mdash; type your own characters, words, or sentences. Leave it empty to use the default random content. In the Poem Layout generator, separate lines with the <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">|</code> character.
            </p>
          </div>

          {/* Animation */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Animation</h3>
            <p className="mb-2">
              Many generators support animation &mdash; particles flow, cells evolve, fractals morph, and patterns transform over time. Toggle animation with the <strong>Animate</strong> button in the Params tab or in Settings. Adjust the FPS slider to control speed.
            </p>
            <p>
              Some generators (especially Cellular like Game of Life, Reaction Diffusion, and Forest Fire) are designed to be viewed as animations. If a static render looks sparse, try enabling animation to see the full effect.
            </p>
          </div>

          {/* GIF Export */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">GIF &amp; Video Export</h3>
            <p className="mb-2">Enable animation first, then go to the Export tab. Choose a duration (3, 5, or 8 seconds).</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>GIF</strong> &mdash; Records an animated GIF. May take 1-2 minutes for longer durations.</li>
              <li><strong>WebM</strong> &mdash; Records a video file (smaller, higher quality than GIF).</li>
            </ul>
            <p className="mt-2 font-medium text-gray-900 dark:text-white">GIF loop options:</p>
            <ul className="list-disc list-inside space-y-1 mt-1">
              <li><strong>Boomerang loop</strong> &mdash; Plays forward then backward, creating a seamless ping-pong effect that repeats forever.</li>
              <li><strong>Endless loop</strong> &mdash; Replays the same clip from start to finish, repeating forever.</li>
              <li>Leave both unchecked for a single playthrough that stops at the end.</li>
            </ul>
          </div>

          {/* Undo / Redo */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Undo &amp; Redo</h3>
            <p>
              Made a change you don't like? Press <strong>Ctrl+Z</strong> to undo or <strong>Ctrl+Shift+Z</strong> to redo. Algomodo tracks up to 50 steps of your parameter, palette, seed, and generator changes.
            </p>
          </div>

          {/* Palette */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Color Palettes</h3>
            <p>
              Every generator uses the active color palette. You can pick from curated palettes in the Params tab, edit individual colors, or lock the palette to keep it while randomizing other settings. A good trick: find a palette you love, lock it, then hit <strong>Rand</strong> repeatedly to see the same colors across different parameter variations.
            </p>
          </div>

          {/* Tips */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Tips</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>Everything is saved locally &mdash; your settings and presets persist across browser sessions.</li>
              <li>The SAVE button on the canvas exports at 1080x1080. For custom sizes, use the Export tab.</li>
              <li>Lock a palette, then use SURPRISE ME to see random generators in your favorite colors.</li>
              <li>Use JSON recipes to save and share exact artwork configurations.</li>
              <li>PostFX (Grain, Vignette, Dither, Posterize) work with every generator &mdash; try stacking them.</li>
              <li>SVG export is available for vector-compatible generators (Plotter, Geometry, some others).</li>
            </ul>
          </div>

        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-6">
          <button
            onClick={() => setOpenModal(null)}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md font-semibold hover:bg-blue-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
