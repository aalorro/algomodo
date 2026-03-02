import { useEffect, useState } from 'react';
import { LeftSidebar } from './components/LeftSidebar';
import { RightSidebar } from './components/RightSidebar';
import { CanvasRenderer } from './components/CanvasRenderer';
import { AboutModal } from './components/AboutModal';
import { PrivacyModal } from './components/PrivacyModal';
import { ChangelogModal } from './components/ChangelogModal';
import { DonationModal } from './components/DonationModal';
import { initializeGenerators } from './generators';
import { getAllGenerators } from './core/registry';
import { useStore } from './store';

// Initialize generators at app start
initializeGenerators();

function App() {
  const [mobileTab, setMobileTab] = useState<'generators' | 'canvas' | 'controls'>('canvas');
  const { showFPS, theme, undo, redo, selectGenerator, openModal } = useStore();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Randomize to a non-image generator on every page load
  useEffect(() => {
    const nonImageGens = getAllGenerators().filter(g => g.family !== 'image');
    if (nonImageGens.length > 0) {
      const pick = nonImageGens[Math.floor(Math.random() * nonImageGens.length)];
      selectGenerator(pick.id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const inputType = (document.activeElement as HTMLInputElement)?.type;
      // Don't intercept in text inputs — let native undo work there
      if (tag === 'INPUT' && !['range', 'checkbox', 'color', 'radio'].includes(inputType)) return;
      if (tag === 'TEXTAREA') return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-white overflow-hidden">
      {/* Desktop: Three-panel layout */}
      <div className="hidden lg:flex flex-1 min-h-0 overflow-hidden">
        {/* Left Sidebar */}
        <div className="w-64 flex-shrink-0 overflow-hidden border-r border-gray-200 dark:border-gray-700">
          <LeftSidebar />
        </div>

        {/* Center Canvas */}
        <div className="flex-shrink-0 h-full aspect-square flex items-center justify-center py-3 pl-3 pr-3">
          <CanvasRenderer showFPS={showFPS} />
        </div>

        {/* Right Sidebar */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col border-l border-gray-200 dark:border-gray-700">
          <RightSidebar />
        </div>
      </div>

      {/* Mobile: Tabbed layout */}
      <div className="lg:hidden flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <button
            onClick={() => setMobileTab('generators')}
            className={`flex-1 px-4 py-3 text-sm font-semibold transition ${
              mobileTab === 'generators'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            Generators
          </button>
          <button
            onClick={() => setMobileTab('canvas')}
            className={`flex-1 px-4 py-3 text-sm font-semibold transition ${
              mobileTab === 'canvas'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            Canvas
          </button>
          <button
            onClick={() => setMobileTab('controls')}
            className={`flex-1 px-4 py-3 text-sm font-semibold transition ${
              mobileTab === 'controls'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            Controls
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'generators' && (
            <div className="h-full overflow-hidden">
              <LeftSidebar />
            </div>
          )}
          {mobileTab === 'canvas' && (
            <div className="h-full flex items-center justify-center p-3 bg-black">
              <div className="w-full max-w-md aspect-square">
                <CanvasRenderer showFPS={showFPS} />
              </div>
            </div>
          )}
          {mobileTab === 'controls' && (
            <div className="h-full overflow-y-auto">
              <RightSidebar />
            </div>
          )}
        </div>
      </div>

      {/* Footer — responsive */}
      <div className="flex-shrink-0 px-3 md:px-6 py-2 border-t border-gray-300 dark:border-gray-700 bg-gray-800 dark:bg-gray-900 flex flex-col md:flex-row items-center justify-center gap-2 md:gap-6 text-center md:text-left">
        <p className="text-xs md:text-sm font-bold text-white">
          &copy; 2026 ArtMondo &mdash; MIT License
        </p>
        <p className="text-xs md:text-sm font-bold text-gray-400">v1.0.0</p>
      </div>

      {/* Modals */}
      {openModal === 'about' && <AboutModal />}
      {openModal === 'privacy' && <PrivacyModal />}
      {openModal === 'changelog' && <ChangelogModal />}
      {openModal === 'donation' && <DonationModal />}
    </div>
  );
}

export default App;
