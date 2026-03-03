import React from 'react';
import { useStore } from '../store';

export const AboutModal: React.FC = () => {
  const { setOpenModal } = useStore();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">About Algomodo</h2>
          <button
            onClick={() => setOpenModal(null)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm text-gray-700 dark:text-gray-300">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">What is Algomodo?</h3>
            <p>
              Algomodo is an algorithmic art generator that creates stunning visual patterns and designs through computational processes. It combines mathematics, computer science, and art to produce unique, deterministic images.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Key Features</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>Deterministic: Results are reproducible with the same seed</li>
              <li>Offline: Works entirely in your browser</li>
              <li>Open Source: Available under the MIT license</li>
              <li>Multiple Generators: Cellular automata, noise, geometry, voronoi, and more</li>
              <li>High Quality: Export at various resolutions</li>
              <li>Customizable: Adjust parameters to fine-tune your artwork</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Version</h3>
            <p>v1.1.0</p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Credits</h3>
            <p>
              Created and maintained by ArtMondo. Built with React, TypeScript, Tailwind CSS, and Vite.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Learn More</h3>
            <p>
              Visit the{' '}
              <a
                href="https://github.com/aalorro/algomodo"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                GitHub repository
              </a>{' '}
              to explore the source code, report issues, or contribute.
            </p>
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
