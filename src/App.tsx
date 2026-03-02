import { useEffect } from 'react';
import { LeftSidebar } from './components/LeftSidebar';
import { RightSidebar } from './components/RightSidebar';
import { CanvasRenderer } from './components/CanvasRenderer';
import { AboutModal } from './components/AboutModal';
import { PrivacyModal } from './components/PrivacyModal';
import { initializeGenerators } from './generators';
import { getAllGenerators } from './core/registry';
import { useStore } from './store';

// Initialize generators at app start
initializeGenerators();

function App() {
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
      {/* Main three-panel row */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Sidebar */}
        <div className="w-64 flex-shrink-0 overflow-hidden">
          <LeftSidebar />
        </div>

        {/* Center Canvas — square based on viewport height */}
        <div className="flex-shrink-0 h-full aspect-square flex items-center justify-center py-3 pl-3 pr-[50px]">
          <CanvasRenderer showFPS={showFPS} />
        </div>

        {/* Right Sidebar — fills remaining horizontal space */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
          <RightSidebar />
        </div>
      </div>

      {/* Footer — own frame, full width across all panels */}
      <div className="flex-shrink-0 px-6 py-2 border-t border-gray-700 bg-gray-800 dark:bg-gray-900 flex items-center justify-center gap-6">
        <p className="text-sm font-bold text-white">
          &copy; 2026 ArtMondo. All rights reserved. &mdash; Algomodo is open-source, licensed under MIT.
        </p>
        <p className="text-sm font-bold text-white">v1.0.0</p>
      </div>

      {/* Modals */}
      {openModal === 'about' && <AboutModal />}
      {openModal === 'privacy' && <PrivacyModal />}
    </div>
  );
}

export default App;
