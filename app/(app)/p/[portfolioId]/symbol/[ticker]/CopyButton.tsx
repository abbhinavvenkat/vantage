'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';

type Props = {
  text: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
};

export function CopyButton({ text, label = 'Copy', size = 'sm' }: Props) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}
