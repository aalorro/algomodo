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
          {/* Version 1.1.0 */}
          <div>
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-2">
              [1.1.0] - 2026-03-03
            </h3>
            
            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Added</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Mobile responsive drawer panels with swipe and arrow button controls</li>
                  <li>Canvas centered with floating toggle buttons for sidebars</li>
                  <li>ANIMATE and RANDOM buttons directly on canvas</li>
                  <li>Generator highlighting in sidebar with star indicator</li>
                  <li>Optional WebGL rendering toggle in settings (unchecked by default)</li>
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
                  <li>Initial release of Algomodo</li>
                  <li>Generator families: Cellular Automata, Noise, Geometry, Image Processing, Animation, Plotter, and Voronoi</li>
                  <li>50+ algorithmic art generators</li>
                  <li>Deterministic seeded randomness with xorshift128+ RNG</li>
                  <li>Beautiful 3-panel UI with generator browser, parameter controls, and canvas preview</li>
                  <li>Seed locking for reproducible results</li>
                  <li>5-color palette customization with curated palette presets</li>
                  <li>Canvas settings (resolution, background color, transparency, DPR, quality levels)</li>
                  <li>Post-effects (grain, vignette, dither, posterize, outline)</li>
                  <li>SVG vector export support for selected generators</li>
                  <li>GIF animation recording with configurable FPS</li>
                  <li>Preset saving and loading system</li>
                  <li>Undo/redo with 50-step history</li>
                  <li>Dark mode support</li>
                  <li>Fully offline, works entirely in browser</li>
                  <li>localStorage persistence for settings and presets</li>
                  <li>Responsive design with keyboard shortcuts (Ctrl+Z/Ctrl+Y for undo/redo)</li>
                  <li>About page with app information</li>
                  <li>Privacy notice explaining offline-only operation</li>
                  <li>Changelog with version history</li>
                  <li>Open source under MIT license</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Technical Features</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Built with React 19 + TypeScript</li>
                  <li>State management with Zustand</li>
                  <li>Canvas2D rendering with PostFX pipeline</li>
                  <li>SVG export via builder utilities</li>
                  <li>Web Worker support for GIF encoding</li>
                  <li>Responsive UI built with Tailwind CSS v4</li>
                  <li>Vite 7 for fast builds</li>
                  <li>ESLint configuration for code quality</li>
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
                <li>More advanced image processing generators</li>
                <li>Extended animation capabilities</li>
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
