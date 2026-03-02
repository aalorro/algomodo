import { useEffect, useRef, useState } from 'react';
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
  const [leftPanelVisible, setLeftPanelVisible] = useState(false);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const mobileContainerRef = useRef<HTMLDivElement>(null);

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

  // Swipe gesture detection for mobile panels
  useEffect(() => {
    const container = mobileContainerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX.current;
      const deltaY = Math.abs(touchEndY - touchStartY.current);

      // Only detect horizontal swipes (not vertical scrolls)
      if (deltaY > 50) return;

      const swipeThreshold = 50;

      // Swipe right on left side of screen: show left panel
      if (touchStartX.current < 50 && deltaX > swipeThreshold) {
        setLeftPanelVisible(true);
      }
      // Swipe left on left panel: hide left panel
      if (leftPanelVisible && deltaX < -swipeThreshold) {
        setLeftPanelVisible(false);
      }

      // Swipe left on right side of screen: show right panel
      if (touchStartX.current > window.innerWidth - 50 && deltaX < -swipeThreshold) {
        setRightPanelVisible(true);
      }
      // Swipe right on right panel: hide right panel
      if (rightPanelVisible && deltaX > swipeThreshold) {
        setRightPanelVisible(false);
      }
    };

    container.addEventListener('touchstart', handleTouchStart, false);
    container.addEventListener('touchend', handleTouchEnd, false);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [leftPanelVisible, rightPanelVisible]);

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

      {/* Mobile: Drawer-based layout with full-width canvas */}
      <div ref={mobileContainerRef} className="lg:hidden flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {/* Overlay when panels are open */}
        {(leftPanelVisible || rightPanelVisible) && (
          <div
            className="absolute inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => {
              setLeftPanelVisible(false);
              setRightPanelVisible(false);
            }}
          />
        )}

        {/* Left Drawer Panel */}
        <div
          className={`absolute left-0 top-0 h-full w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 z-50 overflow-hidden transition-transform duration-300 ease-out ${
            leftPanelVisible ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <LeftSidebar />
        </div>

        {/* Right Drawer Panel */}
        <div
          className={`absolute right-0 top-0 h-full w-64 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 z-50 overflow-hidden transition-transform duration-300 ease-out ${
            rightPanelVisible ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <RightSidebar />
        </div>

        {/* Center Canvas — full width */}
        <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
          <CanvasRenderer showFPS={showFPS} />
        </div>

        {/* Floating Left Arrow Button */}
        <button
          onClick={() => setLeftPanelVisible(!leftPanelVisible)}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-40 p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg transition-all"
          title={leftPanelVisible ? 'Hide generators' : 'Show generators'}
        >
          {leftPanelVisible ? '←' : '→'}
        </button>

        {/* Floating Right Arrow Button */}
        <button
          onClick={() => setRightPanelVisible(!rightPanelVisible)}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-40 p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg transition-all"
          title={rightPanelVisible ? 'Hide controls' : 'Show controls'}
        >
          {rightPanelVisible ? '→' : '←'}
        </button>
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
