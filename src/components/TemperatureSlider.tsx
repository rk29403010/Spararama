import React from 'react';

interface TemperatureSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  scale: 'C' | 'F';
  onChange: (value: number) => void;
  disabled?: boolean;
  detail?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function temperatureColour(value: number, min: number, max: number) {
  const fraction = max === min ? 0 : clamp((value - min) / (max - min), 0, 1);
  const hue = Math.round(215 - (fraction * 210));
  return `hsl(${hue} 78% 47%)`;
}

export function TemperatureSlider({ label, value, min, max, scale, onChange, disabled = false, detail }: TemperatureSliderProps) {
  const colour = temperatureColour(value, min, max);
  const sliderStyle = { '--temperature-thumb': colour } as React.CSSProperties;
  const unitName = scale === 'C' ? 'Celsius' : 'Fahrenheit';
  const upperMid = Math.round(min + ((max - min) * 2 / 3));
  const lowerMid = Math.round(min + ((max - min) / 3));

  return (
    <div className={`rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ${disabled ? 'opacity-60' : ''}`}>
      <div className="text-center min-h-24">
        <div className="text-xs font-black uppercase tracking-widest text-slate-400">{label}</div>
        <div className="mt-2 inline-flex min-w-24 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white shadow-sm">
          <span className="h-3 w-3 rounded-full ring-2 ring-white/70" style={{ backgroundColor: colour }} aria-hidden="true" />
          <span className="text-2xl font-black tabular-nums">{value}°{scale}</span>
        </div>
        {detail && <div className="mt-2 text-[10px] font-bold leading-tight text-slate-500">{detail}</div>}
      </div>

      <div className="mt-3 flex h-64 items-stretch justify-center gap-3">
        <div className="flex flex-col justify-between py-1 text-right text-xs font-bold tabular-nums text-slate-400" aria-hidden="true">
          <span>{max}</span>
          <span>{upperMid}</span>
          <span>{lowerMid}</span>
          <span>{min}</span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          onInput={event => onChange(Number(event.currentTarget.value))}
          onChange={event => onChange(Number(event.currentTarget.value))}
          aria-label={`${label} temperature`}
          aria-orientation="vertical"
          aria-valuetext={`${value} degrees ${unitName}`}
          className="temperature-slider"
          style={sliderStyle}
        />
      </div>
    </div>
  );
}
