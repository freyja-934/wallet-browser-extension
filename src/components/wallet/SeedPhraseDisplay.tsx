import { motion } from 'framer-motion';
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

interface SeedPhraseDisplayProps {
  seedPhrase: string;
  isNewWallet?: boolean;
  onContinue?: () => void;
  onBack?: () => void;
}

export const SeedPhraseDisplay: React.FC<SeedPhraseDisplayProps> = ({
  seedPhrase,
  isNewWallet = true,
  onContinue,
  onBack
}) => {
  const [isBlurred, setIsBlurred] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [hasViewed, setHasViewed] = useState(false);
  
  const words = seedPhrase.split(' ');
  
  useEffect(() => {
    if (!isBlurred) {
      setHasViewed(true);
    }
  }, [isBlurred]);
  
  const handleCopyWord = (word: string, index: number) => {
    navigator.clipboard.writeText(word);
    setCopiedIndex(index);
    toast.success(`Word ${index + 1} copied`);
    
    setTimeout(() => {
      setCopiedIndex(null);
    }, 2000);
  };
  
  const handleCopyAll = () => {
    navigator.clipboard.writeText(seedPhrase);
    toast.success('Seed phrase copied to clipboard');
  };
  
  return (
    <div className="space-y-6">
      {isNewWallet && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <h3 className="text-orange-800 font-semibold mb-2 flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            Important Security Notice
          </h3>
          <ul className="text-sm text-orange-700 space-y-1">
            <li>• Never share your seed phrase with anyone</li>
            <li>• Store it in a secure location offline</li>
            <li>• Anyone with this phrase can access your wallet</li>
            <li>• We cannot recover it if you lose it</li>
          </ul>
        </div>
      )}
      
      <div className="relative">
        {isBlurred && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-lg z-10 flex items-center justify-center">
            <button
              onClick={() => setIsBlurred(false)}
              className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
            >
              Reveal Seed Phrase
            </button>
          </div>
        )}
        
        <div className={`grid grid-cols-3 gap-3 p-6 bg-gray-50 rounded-lg ${isBlurred ? 'select-none' : ''}`}>
          {words.map((word, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="relative group"
            >
              <button
                onClick={() => !isBlurred && handleCopyWord(word, index)}
                disabled={isBlurred}
                className={`
                  w-full px-4 py-3 rounded-lg text-left transition-all
                  ${isBlurred 
                    ? 'bg-gray-200 cursor-not-allowed' 
                    : 'bg-white hover:bg-gray-50 cursor-pointer border border-gray-200'
                  }
                `}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 font-medium">
                    {index + 1}
                  </span>
                  {!isBlurred && (
                    <span className={`
                      text-xs transition-opacity
                      ${copiedIndex === index ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                    `}>
                      {copiedIndex === index ? '✓' : 'Copy'}
                    </span>
                  )}
                </div>
                <div className={`font-mono text-sm mt-1 ${isBlurred ? 'text-transparent' : 'text-gray-900'}`}>
                  {word}
                </div>
              </button>
            </motion.div>
          ))}
        </div>
      </div>
      
      {!isBlurred && (
        <div className="flex justify-center">
          <button
            onClick={handleCopyAll}
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            Copy All Words
          </button>
        </div>
      )}
      
      {isNewWallet && (
        <div className="bg-gray-100 rounded-lg p-4">
          <label className="flex items-start space-x-3">
            <input
              type="checkbox"
              checked={hasViewed}
              readOnly
              className="mt-1 h-4 w-4 text-indigo-600 border-gray-300 rounded"
            />
            <span className="text-sm text-gray-700">
              I have safely stored my seed phrase and understand that I will need it to recover my wallet
            </span>
          </label>
        </div>
      )}
      
      <div className="flex justify-between">
        {onBack && (
          <button
            onClick={onBack}
            className="px-6 py-3 text-gray-700 hover:text-gray-900 font-medium"
          >
            Back
          </button>
        )}
        
        {onContinue && (
          <button
            onClick={onContinue}
            disabled={isNewWallet && (!hasViewed || isBlurred)}
            className={`
              px-6 py-3 rounded-lg font-medium transition-all ml-auto
              ${(isNewWallet && (!hasViewed || isBlurred))
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }
            `}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
};
