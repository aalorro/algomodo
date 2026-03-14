import React from 'react';
import { useStore } from '../store';

export const RoadmapModal: React.FC = () => {
  const { setOpenModal } = useStore();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Roadmap</h2>
          <button
            onClick={() => setOpenModal(null)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 text-sm text-gray-700 dark:text-gray-300">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Planned enhancements for Algomodo, organized by priority. Current version: <strong>1.8.0</strong>
          </p>

          {/* Near-Term */}
          <div>
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-3">Near-Term</h3>

            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Rendering Performance</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li><strong>WebGL2 rendering backend</strong> — GPU-accelerated rendering for noise, Voronoi, and fractal generators</li>
                  <li><strong>WebGPU compute shaders</strong> — massively parallel rendering for Reaction Diffusion, Turing Patterns, Flow Fields</li>
                  <li><strong>Performance mode</strong> — auto-reduce resolution and skip PostFX during parameter scrubbing</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Generators</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li><strong>New families</strong> — Physics simulations, Audio-reactive visualization, Aperiodic tiling</li>
                  <li><strong>More generators</strong> — Langton's Ant, Wireworld, Sierpinski, Dragon Curve, Burning Ship, Penrose tiling</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Export &amp; Output</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li><strong>WEBP export</strong> — smaller file size with near-lossless quality</li>
                  <li><strong>Batch export</strong> — render N random seeds and save all outputs at once</li>
                  <li><strong>Export resolution selector</strong> — custom output dimensions beyond fixed 1080×1080</li>
                  <li><strong>GIF optimization</strong> — palette quantization and frame deduplication</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Mid-Term */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-3">Mid-Term</h3>

            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Collaboration &amp; Sharing</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li><strong>Community preset gallery</strong> — browse, share, and download presets from other users</li>
                  <li><strong>Shareable URL state</strong> — encode seed + generator + params in a URL for one-click sharing</li>
                  <li><strong>Social image cards</strong> — auto-generate Open Graph previews for shared links</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-1">User Experience</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li><strong>Parameter keyframing</strong> — animate parameters between start and end values</li>
                  <li><strong>Favourites / pinned generators</strong> — star generators for quick access</li>
                  <li><strong>Comparison view</strong> — side-by-side preview of two seeds or parameter sets</li>
                  <li><strong>Search</strong> — filter generators by name, family, or keyword</li>
                  <li><strong>Keyboard shortcuts</strong> — hotkeys for randomize, export, toggle animation</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Rendering &amp; Quality</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li><strong>Anti-aliased rendering</strong> — supersampling for smoother edges</li>
                  <li><strong>HDR / wide-gamut colour</strong> — Display P3 and Rec.2020 support</li>
                  <li><strong>PostFX expansion</strong> — bloom, chromatic aberration, colour grading LUTs</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Long-Term */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-3">Long-Term</h3>

            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Platform</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li><strong>Programmatic API</strong> — JS/TS SDK for headless generation in Node.js and browser</li>
                  <li><strong>Plugin system</strong> — load third-party generators at runtime</li>
                  <li><strong>PWA offline install</strong> — full Progressive Web App with service worker</li>
                  <li><strong>Desktop app</strong> — Electron or Tauri wrapper for native access</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Advanced Features</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li><strong>Layer compositing</strong> — stack generators with blend modes and per-layer opacity</li>
                  <li><strong>Mask / region system</strong> — apply different generators to different canvas regions</li>
                  <li><strong>Animation timeline</strong> — keyframe-based parameter animation with easing curves</li>
                  <li><strong>Audio-reactive mode</strong> — drive parameters from microphone or audio file</li>
                  <li><strong>3D export</strong> — height maps and mesh geometry for 3D printing</li>
                </ul>
              </div>
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
