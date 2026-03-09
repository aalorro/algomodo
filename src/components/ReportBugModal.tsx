import React, { useState } from 'react';
import { useStore } from '../store';

export const ReportBugModal: React.FC = () => {
  const { setOpenModal } = useStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('https://formspree.io/f/xwvrvboe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        setError('Failed to send report. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Report a Bug</h2>
          <button
            onClick={() => setOpenModal(null)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {submitted ? (
            <div className="text-center py-6">
              <p className="text-green-600 dark:text-green-400 font-semibold text-lg mb-2">Thank you!</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Your bug report has been submitted.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded text-sm border border-gray-300 dark:border-gray-600 focus:outline-none focus:border-blue-500"
                  placeholder="Your name"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-1">
                  Email <span className="normal-case font-normal">(optional)</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded text-sm border border-gray-300 dark:border-gray-600 focus:outline-none focus:border-blue-500"
                  placeholder="your@email.com"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-1">
                  Bug Description
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  rows={4}
                  className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded text-sm border border-gray-300 dark:border-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                  placeholder="Describe the bug you encountered..."
                />
              </div>

              {error && (
                <p className="text-red-500 text-sm">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Sending...' : 'Submit Report'}
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">
          <button
            onClick={() => setOpenModal(null)}
            className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-white rounded text-sm font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
