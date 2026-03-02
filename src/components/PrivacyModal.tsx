import React from 'react';
import { useStore } from '../store';

export const PrivacyModal: React.FC = () => {
  const { setOpenModal } = useStore();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Privacy Notice</h2>
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
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Data Privacy & Storage</h3>
            <p>
              Algomodo is designed with your privacy in mind. All data processing happens entirely in your browser—no information is sent to external servers.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Local Storage</h3>
            <p>
              Your settings, presets, and UI preferences are stored locally using browser storage (localStorage). This data never leaves your device and is only used to enhance your user experience.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Source Images</h3>
            <p>
              If you upload images for processing, they are loaded into your browser's memory and processed locally. Images are not stored permanently and are discarded when you close the application.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">No Tracking</h3>
            <p>
              We do not use analytics, cookies, or tracking scripts. Your usage patterns and artwork are completely private.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Third-Party Libraries</h3>
            <p>
              Algomodo uses open-source libraries such as React, TypeScript, and Tailwind CSS. These libraries are included locally within the application and do not communicate with external services.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Questions?</h3>
            <p>
              For more information about our privacy practices, please visit our{' '}
              <a
                href="https://github.com/aalorro/algomodo"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                GitHub repository
              </a>
              .
            </p>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-200 dark:border-gray-700">
            Last updated: March 2026
          </p>
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
