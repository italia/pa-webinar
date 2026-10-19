'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';

interface CopyButtonProps {
  text: string;
  /** Il testo del pulsante al posto di «Copia link» (es. quale link). */
  label?: string;
  /** Il nome per chi usa un lettore di schermo, quando in pagina ci sono
   *  piu' pulsanti di copia: deve contenere il testo visibile. */
  accessibleName?: string;
}

export default function CopyButton({ text, label, accessibleName }: CopyButtonProps) {
  const t = useTranslations('admin.links');
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <Button
      color={copied ? 'success' : 'primary'}
      outline
      size="sm"
      onClick={handleCopy}
      aria-label={accessibleName ?? label ?? t('copyLink')}
    >
      <Icon icon={copied ? 'it-check' : 'it-copy'} size="sm" className="me-1" />
      {copied ? t('copied') : (label ?? t('copyLink'))}
    </Button>
  );
}
