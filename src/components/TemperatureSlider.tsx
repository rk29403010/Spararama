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
  liveReading?: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function temperatureAccent(value: number, min: number, max: number) {
  const fraction = max === min ? 0 : clamp((value - min) / (max - min), 0, 1);
  const cool = { r: 37, g: 99, b: 235 };
  const hot = { r: 220, g: 38, b: 38 };
  const r = Math.round(cool.r + ((hot.r - cool.r) * fraction));
  const g = Math.round(cool.g + ((hot.g - cool.g) * fraction));
  const b = Math.round(cool.b + ((hot.b - cool.b) * fraction));
  return `rgb(${r} ${g} ${b})`;
}

function scaleMarks(scale: 'C' | 'F', min: number, max: number) {
  if (scale === 'C') {
    return [40, 30, 20, 10].filter(mark => mark >= min && mark <= max);
  }

  const step = 20;
  const highest = Math.floor(max / step) * step;
  const marks: number[] = [];
  for (let mark = highest; mark >= min; mark -= step) marks.push(mark);
  return marks;
}

export function TemperatureSlider({ label, value, min, max, scale, onChange, disabled = false, detail, liveReading = false }: TemperatureSliderProps) {
  const accent = temperatureAccent(value, min, max);
  const unitName = scale === 'C' ? 'Celsius' : 'Fahrenheit';
  const marks = scaleMarks(scale, min, max);

  return (
    <div className={`rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ${disabled ? 'opacity-70' : ''}`}>
      <div className="text-center">
        <div className="text-lg font-black uppercase tracking-wider text-slate-600">{label}</div>
        <div
          className="mt-2 inline-flex min-w-32 items-center justify-center rounded-2xl border-[3px] bg-slate-950 px-4 py-2.5 text-white shadow-sm"
          style={{ borderColor: accent }}
        >
          <span className="text-4xl font-black leading-none tabular-nums tracking-tight">{value}°{scale}</span>
        </div>
        {detail && <div className="mt-2 text-sm font-bold leading-tight text-slate-600">{detail}</div>}
      </div>

      <div className="relative mt-5 h-64" aria-hidden={false}>
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
          className={`temperature-slider absolute left-1/2 top-0 -translate-x-1/2 ${liveReading ? 'temperature-slider-live' : ''}`}
        />

        <div className="pointer-events-none absolute inset-y-2 left-[calc(50%+2.55rem)] w-11" aria-hidden="true">
          {marks.map(mark => {
            const position = max === min ? 0 : ((mark - min) / (max - min)) * 100;
            return (
              <span
                key={mark}
                className="absolute left-0 -translate-y-1/2 text-xl font-black leading-none tabular-nums text-slate-500"
                style={{ top: `${100 - position}%` }}
              >
                {mark}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
