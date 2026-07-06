'use client';

import { useId } from 'react';

interface ToggleSwitchProps {
  label?: string;
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  /** Accessible name for the input when the visible label lives in a sibling
   *  element (callers passing label=""). Screen readers otherwise announce an
   *  unnamed checkbox. */
  ariaLabel?: string;
}

export default function ToggleSwitch({
  label,
  checked,
  onChange,
  disabled,
  ariaLabel,
}: ToggleSwitchProps) {
  const id = useId();

  return (
    <div className="toggles">
      <label htmlFor={id}>
        {label}
        <input
          type="checkbox"
          id={id}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          aria-label={ariaLabel}
        />
        <span className="lever" />
      </label>
    </div>
  );
}
