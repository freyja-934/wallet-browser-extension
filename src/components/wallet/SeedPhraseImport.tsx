import { motion } from 'framer-motion';
import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { getWordSuggestions, isValidWord, validateSeedPhrase } from '../../lib/wallet';

interface SeedPhraseImportProps {
  onImport: (seedPhrase: string) => void;
  onBack: () => void;
}

export const SeedPhraseImport: React.FC<SeedPhraseImportProps> = ({
  onImport,
  onBack
}) => {
  const [inputMode, setInputMode] = useState<'paste' | 'manual'>('paste');
  const [pastedPhrase, setPastedPhrase] = useState('');
  const [words, setWords] = useState<string[]>(Array(12).fill(''));
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [suggestions, setSuggestions] = useState<{ [key: number]: string[] }>({});
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  
  useEffect(() => {
    if (wordCount !== words.length) {
      setWords(Array(wordCount).fill(''));
    }
  }, [wordCount, words.length]);
  
  const validatePhrase = (phrase: string): boolean => {
    const validation = validateSeedPhrase(phrase);
    
    if (!validation.isValid) {
      setErrors(['Invalid seed phrase. Please check and try again.']);
      return false;
    }
    
    setErrors([]);
    return true;
  };
  
  const handlePasteSubmit = () => {
    const trimmed = pastedPhrase.trim();
    if (!trimmed) {
      setErrors(['Please paste your seed phrase']);
      return;
    }
    
    if (validatePhrase(trimmed)) {
      onImport(trimmed);
    }
  };
  
  const handleManualSubmit = () => {
    const phrase = words.join(' ').trim();
    const filledWords = words.filter(w => w.trim() !== '');
    
    if (filledWords.length !== wordCount) {
      setErrors([`Please enter all ${wordCount} words`]);
      return;
    }
    
    // Check for invalid words
    const invalidWords: number[] = [];
    words.forEach((word, index) => {
      if (word && !isValidWord(word)) {
        invalidWords.push(index + 1);
      }
    });
    
    if (invalidWords.length > 0) {
      setErrors([`Invalid words at positions: ${invalidWords.join(', ')}`]);
      return;
    }
    
    if (validatePhrase(phrase)) {
      onImport(phrase);
    }
  };
  
  const handleWordChange = (index: number, value: string) => {
    const newWords = [...words];
    newWords[index] = value.toLowerCase().trim();
    setWords(newWords);
    setErrors([]);
    
    // Get suggestions
    if (value.length >= 2) {
      const wordSuggestions = getWordSuggestions(value, 5);
      setSuggestions({ ...suggestions, [index]: wordSuggestions });
    } else {
      const newSuggestions = { ...suggestions };
      delete newSuggestions[index];
      setSuggestions(newSuggestions);
    }
  };
  
  const handleWordSelect = (index: number, word: string) => {
    handleWordChange(index, word);
    const newSuggestions = { ...suggestions };
    delete newSuggestions[index];
    setSuggestions(newSuggestions);
    
    // Move to next input
    if (index < words.length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };
  
  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && !e.shiftKey && suggestions[index]?.length > 0) {
      e.preventDefault();
      handleWordSelect(index, suggestions[index][0]);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (suggestions[index]?.length > 0) {
        handleWordSelect(index, suggestions[index][0]);
      } else if (index < words.length - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    }
  };
  
  const handlePaste = (e: React.ClipboardEvent, index: number) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const pastedWords = pastedText.trim().split(/\s+/);
    
    if (pastedWords.length === 1) {
      handleWordChange(index, pastedWords[0]);
    } else if (pastedWords.length === wordCount) {
      setWords(pastedWords.map(w => w.toLowerCase().trim()));
      setInputMode('manual');
      toast.success('Seed phrase pasted successfully');
    }
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Import Existing Wallet
        </h2>
        <p className="text-gray-600">
          Enter your seed phrase to restore your wallet.
        </p>
      </div>
      
      <div className="flex space-x-4 mb-6">
        <button
          onClick={() => setInputMode('paste')}
          className={`
            flex-1 py-2 px-4 rounded-lg font-medium transition-colors
            ${inputMode === 'paste'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }
          `}
        >
          Paste Phrase
        </button>
        <button
          onClick={() => setInputMode('manual')}
          className={`
            flex-1 py-2 px-4 rounded-lg font-medium transition-colors
            ${inputMode === 'manual'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }
          `}
        >
          Enter Manually
        </button>
      </div>
      
      {inputMode === 'paste' ? (
        <div className="space-y-4">
          <textarea
            value={pastedPhrase}
            onChange={(e) => {
              setPastedPhrase(e.target.value);
              setErrors([]);
            }}
            placeholder="Paste your entire seed phrase here..."
            className="w-full h-32 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center space-x-4 mb-4">
            <span className="text-sm text-gray-600">Number of words:</span>
            <button
              onClick={() => setWordCount(12)}
              className={`
                px-3 py-1 rounded-md text-sm font-medium transition-colors
                ${wordCount === 12
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
            >
              12 words
            </button>
            <button
              onClick={() => setWordCount(24)}
              className={`
                px-3 py-1 rounded-md text-sm font-medium transition-colors
                ${wordCount === 24
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
            >
              24 words
            </button>
          </div>
          
          <div className="grid grid-cols-3 gap-3">
            {words.map((word, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02 }}
                className="relative"
              >
                <div className="relative">
                  <span className="absolute left-3 top-3 text-xs text-gray-500">
                    {index + 1}
                  </span>
                  <input
                    ref={el => inputRefs.current[index] = el}
                    type="text"
                    value={word}
                    onChange={(e) => handleWordChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onPaste={(e) => handlePaste(e, index)}
                    onFocus={() => setFocusedIndex(index)}
                    onBlur={() => setTimeout(() => setFocusedIndex(null), 200)}
                    className="w-full pl-8 pr-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                  />
                </div>
                
                {focusedIndex === index && suggestions[index]?.length > 0 && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                    {suggestions[index].map((suggestion, i) => (
                      <button
                        key={suggestion}
                        onClick={() => handleWordSelect(index, suggestion)}
                        className="w-full px-3 py-2 text-left hover:bg-gray-50 text-sm first:rounded-t-lg last:rounded-b-lg"
                      >
                        {suggestion}
                        {i === 0 && (
                          <span className="text-xs text-gray-500 ml-2">Tab</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}
      
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          {errors.map((error, index) => (
            <p key={index} className="text-sm text-red-600">
              {error}
            </p>
          ))}
        </div>
      )}
      
      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-3 text-gray-700 hover:text-gray-900 font-medium"
        >
          Back
        </button>
        
        <button
          onClick={inputMode === 'paste' ? handlePasteSubmit : handleManualSubmit}
          className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors"
        >
          Import Wallet
        </button>
      </div>
    </div>
  );
};
