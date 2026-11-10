'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { PosScene, RepairScene, StockScene, TrackScene } from './auth-illustrations';
import { cx } from './ui';

interface Slide {
  title: string;
  text: string;
  /** An SVG scene, or a photo placed in /public (e.g. '/auth/counter.jpg') */
  art?: ReactNode;
  image?: string;
}

export const SLIDES: Slide[] = [
  {
    title: 'Sell a phone in seconds',
    text: 'Scan the IMEI, take cash, card or LankaQR, and print the receipt. The exact unit leaves your stock on its own.',
    art: <PosScene />,
  },
  {
    title: 'Every repair, from counter to pickup',
    text: 'Job cards with the passcode kept safe, a clear next step for technicians, and the bill settled at hand-over.',
    art: <RepairScene />,
  },
  {
    title: 'Know where every IMEI is',
    text: 'Receive phones by IMEI, see what has sat on the shelf too long, and trace any unit from supplier to customer.',
    art: <StockScene />,
  },
  {
    title: 'Customers check their repair themselves',
    text: 'They get an SMS with a tracking code when the device is ready, so the shop phone rings less.',
    art: <TrackScene />,
  },
];

const INTERVAL = 6000;

export function AuthCarousel({ slides = SLIDES, compact = false }: { slides?: Slide[]; compact?: boolean }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const go = useCallback((n: number) => setI((n + slides.length) % slides.length), [slides.length]);

  useEffect(() => {
    if (paused || reduced.current) return;
    const t = setTimeout(() => go(i + 1), INTERVAL);
    return () => clearTimeout(t);
  }, [i, paused, go]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="What Shop ERP does"
      className={cx('flex flex-col', compact ? 'h-[9.5rem]' : 'h-full')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="relative flex-1">
        {slides.map((s, n) => (
          <div
            key={s.title}
            role="group"
            aria-roledescription="slide"
            aria-label={`${n + 1} of ${slides.length}: ${s.title}`}
            aria-hidden={n !== i}
            className={cx('slide absolute inset-0 flex flex-col', compact ? 'flex-row items-center gap-4' : 'justify-center', n === i ? 'opacity-100' : 'pointer-events-none translate-y-2 opacity-0')}
          >
            <div className={cx('relative overflow-hidden bg-night-2 ring-1 ring-white/5', compact ? 'aspect-[4/3] w-36 shrink-0 rounded-[14px]' : 'mx-auto aspect-[4/3] w-full max-w-[34rem] rounded-[22px]')}>
              {s.image ? <img src={s.image} alt="" className="h-full w-full object-cover" /> : s.art}
            </div>
            <div className={compact ? 'min-w-0' : 'mx-auto mt-8 w-full max-w-[34rem]'}>
              <h2 className={cx('leading-tight font-bold tracking-tight text-white', compact ? 'text-base' : 'text-[1.65rem]')}>{s.title}</h2>
              {!compact && <p className="mt-3 max-w-[30rem] text-[1.05rem] leading-relaxed text-night-3">{s.text}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className={cx('mx-auto flex w-full items-center justify-between', compact ? 'mt-3' : 'mt-6 max-w-[34rem]')}>
        <div className="flex items-center gap-2" role="tablist" aria-label="Choose a slide">
          {slides.map((s, n) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={n === i}
              aria-label={s.title}
              onClick={() => go(n)}
              className={cx('h-2 rounded-full transition-all duration-300', n === i ? 'w-8 bg-mint' : 'w-2 bg-white/25 hover:bg-white/50')}
            />
          ))}
        </div>
        <div className={cx('flex gap-2', compact && 'hidden')}>
          <button type="button" onClick={() => go(i - 1)} aria-label="Previous slide" className="grid size-10 place-items-center rounded-full border border-white/15 text-white hover:bg-white/10">
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" onClick={() => go(i + 1)} aria-label="Next slide" className="grid size-10 place-items-center rounded-full border border-white/15 text-white hover:bg-white/10">
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>
    </section>
  );
}
