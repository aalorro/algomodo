import React, { useState } from 'react';
import { useStore } from '../store';
import { getAllFamilies, getGeneratorsByFamily } from '../core/registry';
import logoImage from '../assets/algomodo-logo.png';

export const LeftSidebar: React.FC = () => {
  const [expandedFamily, setExpandedFamily] = useState<string | null>('noise');
  const { selectedFamilyId, selectedGeneratorId, selectFamily, selectGenerator, setOpenModal } = useStore();

  const families = getAllFamilies();

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 overflow-hidden pr-[30px]">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <img src={logoImage} alt="Algomodo" className="h-[126px] w-auto max-w-full object-contain" />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Algorithmic Art Generator</p>
      </div>

      {/* Families and Generators */}
      <div className="flex-1 overflow-hidden">
        {families.map((family) => {
          const generators = getGeneratorsByFamily(family.id);
          const isExpanded = expandedFamily === family.id;

          return (
            <div key={family.id} className="border-b border-gray-200 dark:border-gray-800">
              {/* Family Header */}
              <button
                onClick={() => setExpandedFamily(isExpanded ? null : family.id)}
                className={`w-full px-4 py-3 text-left text-sm font-semibold transition ${
                  isExpanded
                    ? 'bg-gray-100 dark:bg-gray-800 text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <span className="inline-block mr-2">{isExpanded ? '▼' : '▶'}</span>
                {family.name}
              </button>

              {/* Generators */}
              {isExpanded && (
                <div className="bg-gray-50 dark:bg-gray-950">
                  {generators.map((gen) => (
                    <button
                      key={gen.id}
                      onClick={() => {
                        selectFamily(family.id);
                        selectGenerator(gen.id);
                      }}
                      className={`w-full px-6 py-2 text-left text-xs transition ${
                        selectedGeneratorId === gen.id
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                      }`}
                    >
                      {gen.styleName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
        <div className="text-xs text-gray-400 dark:text-gray-500 space-y-1">
          <p>Deterministic</p>
          <p>Offline</p>
          <p>Open Source</p>
        </div>
        
        {/* Support Development Button */}
        <button
          onClick={() => setOpenModal('donation')}
          className="w-full px-3 py-2 text-xs font-semibold bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded hover:from-blue-700 hover:to-blue-800 transition text-center"
        >
          💙 Support Development
        </button>
        
        {/* About, Changelog and Privacy Links */}
        <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setOpenModal('about')}
            className="flex-1 px-2 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition"
          >
            About
          </button>
          <button
            onClick={() => setOpenModal('changelog')}
            className="flex-1 px-2 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition"
          >
            Changelog
          </button>
          <button
            onClick={() => setOpenModal('privacy')}
            className="flex-1 px-2 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition"
          >
            Privacy
          </button>
        </div>
      </div>
    </div>
  );
};
