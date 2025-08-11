import { motion } from 'framer-motion';
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

interface SeedPhraseVerificationProps {
  seedPhrase: string;
  onVerified: () => void;
  onBack: () => void;
}

export const SeedPhraseVerification: React.FC<SeedPhraseVerificationProps> = ({
  seedPhrase,
  onVerified,
  onBack
}) => {
  const words = seedPhrase.split(' ');
  const [verificationIndices, setVerificationIndices] = useState<number[]>([]);
  const [userInputs, setUserInputs] = useState<{ [key: number]: string }>({});
  const [errors, setErrors] = useState<{ [key: number]: boolean }>({});
  const [isComplete, setIsComplete] = useState(false);
  
  useEffect(() => {
    // Select 3-4 random words to verify
    const indices: number[] = [];
    const count = words.length === 12 ? 3 : 4;
    
    while (indices.length < count) {
      const index = Math.floor(Math.random() * words.length);
      if (!indices.includes(index)) {
        indices.push(index);
      }
    }
    
    setVerificationIndices(indices.sort((a, b) => a - b));
  }, [words.length]);
  
  const handleInputChange = (index: number, value: string) => {
    setUserInputs({ ...userInputs, [index]: value.toLowerCase() });
    setErrors({ ...errors, [index]: false });
    
    // Check if all inputs are filled
    const allFilled = verificationIndices.every(
      idx => userInputs[idx]?.trim() || (idx === index && value.trim())
    );
    
    if (allFilled) {
      checkCompletion({ ...userInputs, [index]: value.toLowerCase() });
    }
  };
  
  const checkCompletion = (inputs: { [key: number]: string }) => {
    const newErrors: { [key: number]: boolean } = {};
    let hasErrors = false;
    
    verificationIndices.forEach(index => {
      const isCorrect = inputs[index]?.trim() === words[index];
      newErrors[index] = !isCorrect;
      if (!isCorrect) hasErrors = true;
    });
    
    setErrors(newErrors);
    setIsComplete(!hasErrors);
    
    if (hasErrors) {
      toast.error('Some words are incorrect. Please try again.');
    }
  };
  
  const handleVerify = () => {
    if (isComplete) {
      onVerified();
    }
  };
  
  const handlePaste = (e: React.ClipboardEvent, index: number) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const pastedWords = pastedText.trim().split(/\s+/);
    
    if (pastedWords.length === 1) {
      // Single word paste
      handleInputChange(index, pastedWords[0]);
    } else if (pastedWords.length === words.length) {
      // Full seed phrase paste - extract verification words
      const newInputs: { [key: number]: string } = {};
      verificationIndices.forEach(idx => {
        newInputs[idx] = pastedWords[idx].toLowerCase();
      });
      setUserInputs(newInputs);
      checkCompletion(newInputs);
    }
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Verify Your Seed Phrase
        </h2>
        <p className="text-gray-600">
          Please enter the following words from your seed phrase to confirm you've saved it correctly.
        </p>
      </div>
      
      <div className="space-y-4">
        {verificationIndices.map((wordIndex, i) => (
          <motion.div
            key={wordIndex}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="space-y-2"
          >
            <label className="block text-sm font-medium text-gray-700">
              Word #{wordIndex + 1}
            </label>
            <input
              type="text"
              value={userInputs[wordIndex] || ''}
              onChange={(e) => handleInputChange(wordIndex, e.target.value)}
              onPaste={(e) => handlePaste(e, wordIndex)}
              placeholder={`Enter word #${wordIndex + 1}`}
              className={`
                w-full px-4 py-3 rounded-lg border transition-colors
                ${errors[wordIndex]
                  ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500'
                  : userInputs[wordIndex] && !errors[wordIndex]
                  ? 'border-green-300 bg-green-50 focus:border-green-500 focus:ring-green-500'
                  : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-500'
                }
                focus:outline-none focus:ring-2 focus:ring-opacity-50
              `}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
            {errors[wordIndex] && (
              <p className="text-sm text-red-600">
                This word doesn't match. Please check and try again.
              </p>
            )}
          </motion.div>
        ))}
      </div>
      
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          💡 Tip: You can paste your entire seed phrase, and we'll automatically extract the required words.
        </p>
      </div>
      
      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-3 text-gray-700 hover:text-gray-900 font-medium"
        >
          Back
        </button>
        
        <button
          onClick={handleVerify}
          disabled={!isComplete}
          className={`
            px-6 py-3 rounded-lg font-medium transition-all
            ${isComplete
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }
          `}
        >
          Verify & Continue
        </button>
      </div>
    </div>
  );
};
