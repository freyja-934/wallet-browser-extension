import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import toast from 'react-hot-toast';
import { getWordSuggestions, isValidWord, validateSeedPhrase } from '../../lib/wallet';
import { Banner, StepHeader, StepScreen } from '../ui/EmptyState';
import { GhostButton, PrimaryButton } from '../ui/Button';
import { SegmentedControl, TextArea, TextField } from '../ui/Input';

export function SeedPhraseImport({
  onImport,
  onBack,
}: {
  onImport: (seedPhrase: string) => void;
  onBack: () => void;
}) {
  const [inputMode, setInputMode] = useState<'paste' | 'manual'>('paste');
  const [pastedPhrase, setPastedPhrase] = useState('');
  const [words, setWords] = useState<string[]>(Array(12).fill(''));
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [suggestions, setSuggestions] = useState<{ [key: number]: string[] }>({});
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (wordCount !== words.length) setWords(Array(wordCount).fill(''));
  }, [wordCount, words.length]);

  /**
   * What a real paste looks like: wrapped in quotes by a password manager, split
   * over lines by a PDF, double-spaced, or Title Cased by a phone keyboard. BIP39
   * words are lowercase and single-spaced, so normalise before validating rather
   * than telling the user their correct phrase is invalid.
   */
  const normalizePhrase = (input: string): string =>
    input
      .trim()
      .replace(/^["'\u201c\u201d\u2018\u2019]/, '')
      .replace(/["'\u201c\u201d\u2018\u2019]$/, '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .join(' ');

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
    const phrase = normalizePhrase(pastedPhrase);
    if (!phrase) {
      setErrors(['Paste your seed phrase']);
      return;
    }
    if (validatePhrase(phrase)) onImport(phrase);
  };

  const handleManualSubmit = () => {
    const phrase = words.join(' ').trim();
    const filledWords = words.filter((w) => w.trim() !== '');
    if (filledWords.length !== wordCount) {
      setErrors([`Enter all ${wordCount} words`]);
      return;
    }
    const invalidWords: number[] = [];
    words.forEach((word, index) => {
      if (word && !isValidWord(word)) invalidWords.push(index + 1);
    });
    if (invalidWords.length > 0) {
      setErrors([`Invalid words at positions: ${invalidWords.join(', ')}`]);
      return;
    }
    if (validatePhrase(phrase)) onImport(phrase);
  };

  const handleWordChange = (index: number, value: string) => {
    const next = [...words];
    next[index] = value.toLowerCase().trim();
    setWords(next);
    setErrors([]);
    if (value.length >= 2) {
      setSuggestions({ ...suggestions, [index]: getWordSuggestions(value, 5) });
    } else {
      const nextSuggestions = { ...suggestions };
      delete nextSuggestions[index];
      setSuggestions(nextSuggestions);
    }
  };

  const handleWordSelect = (index: number, word: string) => {
    handleWordChange(index, word);
    const nextSuggestions = { ...suggestions };
    delete nextSuggestions[index];
    setSuggestions(nextSuggestions);
    if (index < words.length - 1) inputRefs.current[index + 1]?.focus();
  };

  const handlePaste = (e: ClipboardEvent, index: number) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const pastedWords = pastedText.trim().split(/\s+/);
    if (pastedWords.length === 1) {
      handleWordChange(index, pastedWords[0]);
    } else if (pastedWords.length === wordCount) {
      setWords(pastedWords.map((w) => w.toLowerCase().trim()));
      setInputMode('manual');
      toast.success('Seed phrase pasted');
    }
  };

  return (
    <StepScreen
      footer={
        <>
          <GhostButton type="button" onClick={onBack} className="px-0">
            Back
          </GhostButton>
          <PrimaryButton
            onClick={inputMode === 'paste' ? handlePasteSubmit : handleManualSubmit}
            className="min-w-[140px]"
            data-testid="seed-import-submit"
          >
            Import
          </PrimaryButton>
        </>
      }
    >
      <StepHeader
        title="Import wallet"
        subtitle="Enter the recovery phrase for an existing Solana wallet."
        step={2}
        total={3}
        onBack={onBack}
      />

      <SegmentedControl
        value={inputMode}
        onChange={setInputMode}
        options={[
          { value: 'paste', label: 'Paste' },
          { value: 'manual', label: 'Manual' },
        ]}
      />

      <div className="mt-4">
        {inputMode === 'paste' ? (
          <TextArea
            value={pastedPhrase}
            onChange={(e) => {
              setPastedPhrase(e.target.value);
              setErrors([]);
            }}
            placeholder="Paste your entire seed phrase"
            className="h-32"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-testid="seed-paste"
          />
        ) : (
          <div className="space-y-3">
            <SegmentedControl
              value={String(wordCount)}
              onChange={(value) => setWordCount(Number(value) as 12 | 24)}
              options={[
                { value: '12', label: '12 words' },
                { value: '24', label: '24 words' },
              ]}
            />
            <div className="grid grid-cols-3 gap-2">
              {words.map((word, index) => (
                <div key={index} className="relative">
                  <span className="absolute left-3 top-3 text-[10px] text-fg-3">{index + 1}</span>
                  <TextField
                    ref={(el) => {
                      inputRefs.current[index] = el;
                    }}
                    type="text"
                    value={word}
                    onChange={(e) => handleWordChange(index, e.target.value)}
                    onPaste={(e) => handlePaste(e, index)}
                    onFocus={() => setFocusedIndex(index)}
                    onBlur={() => setTimeout(() => setFocusedIndex(null), 200)}
                    className="h-10 rounded-xl pl-7 pr-2 text-xs"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  {focusedIndex === index && suggestions[index]?.length > 0 && (
                    <div className="absolute top-full z-10 mt-1 w-full rounded-xl border border-white/10 bg-bg-1 py-1 shadow-card">
                      {suggestions[index].map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => handleWordSelect(index, suggestion)}
                          className="w-full px-3 py-1.5 text-left text-xs hover:bg-white/5"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div className="mt-4">
          <Banner tone="danger">{errors[0]}</Banner>
        </div>
      )}
    </StepScreen>
  );
}
