import React from 'react';
import { useStore } from '../store';
import type { Generator, Parameter } from '../types';

interface ParameterControlsProps {
  generator: Generator | undefined;
}

export const ParameterControls: React.FC<ParameterControlsProps> = ({ generator }) => {
  const { params, updateParam, resetParams, randomizeParams, pushToHistory, historyPast, historyFuture, undo, redo, isAnimating, setAnimating } = useStore();
  const canUndo = historyPast.length > 0;
  const canRedo = historyFuture.length > 0;
  const supportsAnim = generator?.supportsAnimation ?? false;

  if (!generator) {
    return <div className="p-4 text-gray-400 dark:text-gray-500">Select a generator</div>;
  }

  const groupedParams = Object.entries(generator.parameterSchema).reduce(
    (acc, [key, param]) => {
      const group = param.group || 'Other';
      if (!acc[group]) acc[group] = [];
      acc[group].push({ key, ...param });
      return acc;
    },
    {} as Record<string, Array<Parameter & { key: string }>>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Sticky button row */}
      <div className="flex gap-2 px-4 py-2 flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <button
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="flex-1 px-3 py-2 text-sm bg-gray-500 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded"
        >
          ↩ Undo
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
          className="flex-1 px-3 py-2 text-sm bg-gray-500 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded"
        >
          ↪ Redo
        </button>
        <button
          onClick={() => supportsAnim && setAnimating(!isAnimating)}
          disabled={!supportsAnim}
          title={supportsAnim ? (isAnimating ? 'Animation: on' : 'Animation: off') : 'This generator does not support animation'}
          className={`flex-1 px-3 py-2 text-sm text-white rounded transition-colors ${
            !supportsAnim
              ? 'bg-gray-400 dark:bg-gray-600 opacity-40 cursor-not-allowed'
              : isAnimating
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-gray-500 hover:bg-gray-600'
          }`}
        >
          Animate
        </button>
        <button
          onClick={() => randomizeParams(generator.parameterSchema)}
          className="flex-1 px-3 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded"
        >
          Rand
        </button>
      </div>

      {/* Scrollable params */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {Object.entries(groupedParams).map(([group, groupParams]) => (
        <div key={group}>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">{group}</h4>
          <div className="space-y-3">
            {groupParams.map((param) => (
              <div key={param.key}>
                <label className="flex justify-between text-sm mb-1">
                  <span className="text-gray-700 dark:text-gray-200">{param.name}</span>
                  <span className="text-gray-500 dark:text-gray-400 font-mono text-xs">
                    {typeof params[param.key] === 'number'
                      ? params[param.key]?.toFixed?.(2) || param.default
                      : params[param.key] || param.default}
                  </span>
                </label>

                {param.type === 'number' && (
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={params[param.key] ?? param.default}
                    onPointerDown={() => pushToHistory()}
                    onChange={(e) => updateParam(param.key, parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded cursor-pointer"
                  />
                )}

                {param.type === 'boolean' && (
                  <input
                    type="checkbox"
                    checked={params[param.key] ?? param.default}
                    onPointerDown={() => pushToHistory()}
                    onChange={(e) => updateParam(param.key, e.target.checked)}
                    className="w-4 h-4"
                  />
                )}

                {param.type === 'select' && (
                  <select
                    value={params[param.key] ?? param.default}
                    onMouseDown={() => pushToHistory()}
                    onChange={(e) => updateParam(param.key, e.target.value)}
                    className="w-full px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded text-sm border border-gray-300 dark:border-transparent"
                  >
                    {param.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}

                {param.type === 'color' && (
                  <input
                    type="color"
                    value={params[param.key] ?? param.default}
                    onPointerDown={() => pushToHistory()}
                    onChange={(e) => updateParam(param.key, e.target.value)}
                    className="w-full h-10 cursor-pointer rounded"
                  />
                )}

                {param.help && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{param.help}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
};
