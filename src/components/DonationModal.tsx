import React, { useState } from 'react';
import { useStore } from '../store';

export const DonationModal: React.FC = () => {
  const { setOpenModal } = useStore();
  const [customAmount, setCustomAmount] = useState('');
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [donationType, setDonationType] = useState<'one-time' | 'monthly'>('one-time');

  const presets = [5, 10, 15, 20];

  const handleDonate = (amount: number) => {
    const isRecurring = donationType === 'monthly' ? '1' : '0';
    const paypalUrl = `https://www.paypal.com/donate?business=armando@alorro.com&amount=${amount}&no_recurring=${isRecurring}&currency_code=USD`;
    window.open(paypalUrl, '_blank', 'noopener,noreferrer');
    setOpenModal(null);
  };

  const handleCustomDonate = () => {
    const amount = parseFloat(customAmount);
    if (amount && amount > 0) {
      handleDonate(amount);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-sm w-full">
        {/* Header */}
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Support Development</h2>
          <button
            onClick={() => setOpenModal(null)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <div className="text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Your support helps us continue developing Algomodo and adding new features.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Every donation makes a difference!
            </p>
          </div>

          {/* Donation Type Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Donation type:
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setDonationType('one-time')}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold text-sm transition ${
                  donationType === 'one-time'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                One-Time
              </button>
              <button
                onClick={() => setDonationType('monthly')}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold text-sm transition ${
                  donationType === 'monthly'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Monthly
              </button>
            </div>
          </div>

          {/* Preset Amounts */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Choose an amount {donationType === 'monthly' && <span className="text-gray-500 dark:text-gray-400">(per month)</span>}:
            </label>
            <div className="grid grid-cols-2 gap-2">
              {presets.map((amount) => (
                <button
                  key={amount}
                  onClick={() => {
                    setSelectedAmount(amount);
                    setCustomAmount('');
                  }}
                  className={`px-4 py-3 rounded-lg font-semibold text-sm transition ${
                    selectedAmount === amount
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  ${amount}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Amount */}
          <div className="space-y-2">
            <label htmlFor="customAmount" className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              Or enter a custom amount (USD{donationType === 'monthly' && ' per month'}):
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
                  $
                </span>
                <input
                  id="customAmount"
                  type="number"
                  min="0.50"
                  step="0.01"
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value);
                    setSelectedAmount(null);
                  }}
                  placeholder="5.00"
                  className="w-full pl-6 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Info */}
          <div className="bg-blue-50 dark:bg-blue-900 dark:bg-opacity-20 rounded-lg p-3">
            <p className="text-xs text-blue-900 dark:text-blue-200">
              💡 You'll be securely redirected to PayPal to complete your {donationType === 'monthly' ? 'recurring ' : ''}donation.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-6 space-y-3">
          <button
            onClick={() => {
              const amount = selectedAmount || parseFloat(customAmount);
              if (amount && amount > 0) {
                handleDonate(amount);
              }
            }}
            disabled={!selectedAmount && !customAmount}
            className={`w-full px-4 py-2 rounded-lg font-semibold transition ${
              selectedAmount || customAmount
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
            }`}
          >
            💙 Donate Now
          </button>
          <button
            onClick={() => setOpenModal(null)}
            className="w-full px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg font-semibold transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
