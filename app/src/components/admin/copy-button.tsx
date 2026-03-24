'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Icon } from 'design-react-kit';

interface CopyButtonProps {
  text: string;
}

export default function CopyButton({ text }: CopyButtonProps) {
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
      aria-label={t('copyLink')}
    >
      <Icon icon={copied ? 'it-check' : 'it-copy'} size="sm" className="me-1" />
      {copied ? t('copied') : t('copyLink')}
    </Button>
  );
}
