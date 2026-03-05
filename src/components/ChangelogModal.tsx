import React from 'react';
import { useStore } from '../store';

export const ChangelogModal: React.FC = () => {
  const { setOpenModal } = useStore();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Changelog</h2>
          <button
            onClick={() => setOpenModal(null)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 text-sm text-gray-700 dark:text-gray-300 font-mono">
          {/* Version 1.4.1 */}
          <div>
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-2">
              [1.4.1] - 2026-03-05
            </h3>

            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Added</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Preset export/import — save presets as human-readable .txt files, import them back</li>
                  <li>JSON recipe import — load recipe files to restore full canvas state</li>
                  <li>Configurable filenames for preset and recipe exports</li>
                  <li>Individual preset export button on each preset card</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Changed</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Preset format uses .txt instead of JSON to differentiate from recipes</li>
                  <li>Simplified preset save UI to inline input with Save button</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Version 1.4.0 */}
          <div>
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-2">
              [1.4.0] - 2026-03-04
            </h3>

            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Added</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>SURPRISE ME button — randomizes generator, seed, parameters, and palette in one click</li>
                  <li>Canvas SAVE button — exports static PNG or animated WebM at 1080x1080</li>
                  <li>Undo / Redo toolbar buttons with Ctrl+Z / Ctrl+Y</li>
                  <li>Style name overlay on the canvas</li>
                  <li>Animation duration selector (3 / 5 / 8 seconds) in Export tab</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Improved — 15 generators</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>FBM Terrain — domain warping, style modes (smooth / ridged / terraced)</li>
                  <li>Domain Warped Marble — vein sharpness control, turbulence toggle</li>
                  <li>Simplex Field — style modes (smooth / ridged / turbulent), domain warping</li>
                  <li>FBM, Turbulence, Ridged Multifractal, Domain Warp — algorithm refinements</li>
                  <li>Hatching &amp; Stippling — stroke quality and density improvements</li>
                  <li>Guilloché — 4 curve types, multi-line moiré, wave modulation</li>
                  <li>Halftone Dots — grid types, dot shapes, rotation, animation support</li>
                  <li>Phyllotaxis — angle offset, size modes, shapes, connecting lines</li>
                  <li>Meander / Maze — 4 algorithms, wall styles, solution path, heatmap fill</li>
                  <li>Scribble Shading — stroke styles, density styles, variable width, animation</li>
                  <li>Bézier Ribbon Weaves — weave patterns (basket / twill / satin), ribbon styles</li>
                  <li>Ridges — spatial hash grid, distance metrics (euclidean / manhattan / chebyshev)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Fixed</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>DLA line-bottom seed mode not rendering</li>
                  <li>Age Trails Maze rule not animating (stasis detection added)</li>
                  <li>Voronoi Ridges rendering blank or blurred</li>
                  <li>GIF export cropping to top-left quarter</li>
                  <li>Parameter lock feature broken (serialization fix)</li>
                  <li>Gray-Scott model rendering fix</li>
                  <li>Mobile image render compatibility</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Version 1.2.0 */}
          <div>
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-2">
              [1.2.0] - 2026-03-03
            </h3>

            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Changed — 6 generators improved</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Game of Life — 5 additional rule sets, perturbation rate, entropy colour mode</li>
                  <li>Spirograph — epitrochoid mode, gradient colours, auto-scaling</li>
                  <li>Lissajous — harmonograph decay, multi-layer phase offsets</li>
                  <li>L-System — 7 presets, stochastic jitter, tapered branches, depth colour mode</li>
                  <li>MST Web — edge pruning, fibonacci distribution, radial colour mode</li>
                  <li>Brian's Brain — stabilised density cap and simplified logic</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Version 1.1.0 */}
          <div>
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-2">
              [1.1.0] - 2026-03-02
            </h3>

            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Added — 14 new generators</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Age Trails, Turing Patterns, Crystal Growth (Cellular)</li>
                  <li>Simplex Field, FBM, Turbulence, Ridged Multifractal, Domain Warp (Noise)</li>
                  <li>Rosettes, Superformula, Moiré, Islamic Patterns, Truchet Tiles (Geometry)</li>
                  <li>Contour Lines (Plotter)</li>
                  <li>Animation support for all Noise generators</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Version 1.0.0 */}
          <div>
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-2">
              [1.0.0] - 2026-03-02
            </h3>

            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Added</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Initial release — 50+ generators across 7 families</li>
                  <li>Seeded RNG, curated palettes, PostFX pipeline</li>
                  <li>SVG export, GIF recording, presets, undo/redo</li>
                  <li>Dark mode, localStorage persistence, keyboard shortcuts</li>
                  <li>React 19 + TypeScript + Zustand + Tailwind CSS v4 + Vite 7</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Unreleased */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-2">
              [Unreleased]
            </h3>

            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Planned</h4>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>WebGL2 rendering optimization</li>
                <li>WebGPU support for next-gen graphics</li>
                <li>Community preset sharing</li>
                <li>API for programmatic generator access</li>
              </ul>
            </div>
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
