'use client';

import { useId } from 'react';

interface ToggleSwitchProps {
  label?: string;
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}

export default function ToggleSwitch({
  label,
  checked,
  onChange,
  disabled,
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
        />
        <span className="lever" />
      </label>
    </div>
  );
}
