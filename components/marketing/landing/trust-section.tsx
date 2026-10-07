'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

import { Check } from '@/components/marketing/landing/icons';
import { ProximityHeading } from '@/components/shared/motion/proximity-heading';
import { Reveal } from '@/components/shared/motion/reveal';
import { StaggeredText } from '@/components/shared/motion/staggered-text';

import './trust-section.css';

/**
 * React Bits "MorphSlider" — the GPU displacement carousel ported into
 * `components/MorphSlider`. Loaded lazily with `ssr: false` like the hero's
 * dither fields: it is a WebGL surface, so it has nothing to draw on the
 * server, and deferring the ogl/gsap bundle keeps it out of the initial
 * payload.
 */
const MorphSlider = dynamic(() => import('@/components/shared/motion/MorphSlider'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#0c0c0e]" />,
});

/**
 * Each slide advances the trust story one short step — control, visibility,
 * earned autonomy, compounding trust. Every piece of copy on the section
 * (eyebrow, supporting line, caption, description, guarantees) is driven from
 * the active slide, so everything but the fixed headline changes in the same
 * beat as the morph.
 */
const TRUST_SLIDES = [
  {
    image:
      'https://images.unsplash.com/photo-1782977389500-dd7adad33ebe?q=80&w=1600&auto=format&fit=crop',
    eyebrow: 'Trust & safety · Control',
    support:
      'Giving AI access to email is a trust decision. Tartly starts with drafts, so nothing leaves without your say-so.',
    caption: 'You stay in control.',
    description:
      'Drafts first, approvals when you want them, and one-click pause on any workflow.',
    points: [
      'Sender and recipients shown before anything sends',
      'Drafted, scheduled, or sent is always visible',
      'One-click pause and stop',
      'Human approval made easy',
    ],
  },
  {
    image:
      'https://images.unsplash.com/photo-1781499455083-6ccc3beb20cd?q=80&w=1600&auto=format&fit=crop',
    eyebrow: 'Trust & safety · Visibility',
    support:
      'You see every draft, decision, and action. Nothing happens in a black box.',
    caption: 'Every action is visible.',
    description:
      'See exactly what Tartly drafted, scheduled, or sent — with a full activity history.',
    points: [
      'Full activity history',
      'Every draft and send is logged',
      'What changed, and when, is always visible',
      'Nothing runs in a black box',
    ],
  },
  {
    image:
      'https://images.unsplash.com/photo-1776394254711-4a0d7345269a?q=80&w=1600&auto=format&fit=crop',
    eyebrow: 'Trust & safety · Earned access',
    support:
      'Autonomy is granted, not assumed. You decide exactly how far Tartly can go.',
    caption: 'Access is earned, not assumed.',
    description:
      'Per-workflow permissions let autonomy grow only as far as you allow it.',
    points: [
      'Per-workflow permissions you control',
      'Scoped access, never blanket access',
      'Expand permissions only when ready',
      'Revoke access instantly',
    ],
  },
  {
    image:
      'https://images.unsplash.com/photo-1781242629922-6f39cc3671cd?q=80&w=1600&auto=format&fit=crop',
    eyebrow: 'Trust & safety · Compounding trust',
    support:
      'Start cautious, watch it prove itself, and expand when the results earn it.',
    caption: 'That is how trust compounds.',
    description:
      'Start cautious, watch it prove itself, then expand when you are ready.',
    points: [
      'Start with the workflows you trust most',
      'Expand scope as results prove out',
      'Your team stays in the loop',
      'Trust that compounds over time',
    ],
  },
];

/** The glass panel of guarantees that floats over the morphing imagery. */
function TrustChecklist({
  points,
  className = '',
}: {
  points: readonly string[];
  className?: string;
}) {
  return (
    <div
      className={`trust-swap rounded-2xl border border-white/10 bg-[#0c0c0e]/55 p-6 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl ${className}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/50">
        What stays true
      </p>
      <ul className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-1">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-3 text-sm font-light text-white/85">
            <Check className="mt-0.5 h-4 w-4 shrink-0 fill-[#8B5CF6]" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Trust & safety, rebuilt around the React Bits <MorphSlider/>.
 *
 * The morphing imagery is the section's full-bleed backdrop. Only the headline
 * is fixed; the eyebrow, supporting line, caption, description, and the
 * "what stays true" guarantees are all driven by the active slide, so the
 * reassurance builds with every transition.
 */
export function TrustSection() {
  const [index, setIndex] = useState(0);
  const slide = TRUST_SLIDES[index] ?? TRUST_SLIDES[0];

  return (
    <section
      id="trust"
      className="relative mx-auto mt-24 w-full max-w-[1250px] scroll-mt-[120px] px-6"
    >
      <Reveal duration={1.2} blur>
        <div className="trust-morph relative overflow-hidden rounded-[28px] border border-[#252525] bg-[#0c0c0e] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
          <div className="relative h-[660px] sm:h-[660px] lg:h-[640px]">
            <MorphSlider
              items={TRUST_SLIDES}
              transition="melt"
              duration={0.62}
              intensity={0.55}
              scale={2.4}
              aberration={0.35}
              drift={0.42}
              autoplay
              autoplayDelay={3}
              loop
              radius={28}
              overlayColor="#0c0c0e"
              showCaptions
              showControls={false}
              showIndicators
              onIndexChange={setIndex}
            />

            {/* No scrim over the imagery — the morphing backdrop is meant to
                stay vibrant. Copy legibility is carried by the glass panels
                and the text colours instead of a darkening gradient. */}

            <div className="pointer-events-none absolute inset-0 z-10 grid lg:grid-cols-[1.1fr_0.9fr]">
              <div className="flex flex-col justify-start p-7 pb-64 sm:p-9 sm:pb-64 md:p-12 md:pb-64 lg:justify-center lg:pb-12">
                <span
                  key={slide.eyebrow}
                  className="trust-swap inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white/70 backdrop-blur-md"
                >
                  {slide.eyebrow}
                </span>
                <ProximityHeading
                  as="h2"
                  label="Autonomy should be earned, not assumed"
                  radius={140}
                  duration={0.7}
                  className="mt-5 max-w-[620px] text-[clamp(30px,5vw,54px)] font-semibold leading-[1.02] tracking-[-0.03em] text-white"
                />
                <StaggeredText
                  key={slide.support}
                  as="p"
                  text={slide.support}
                  segmentBy="words"
                  direction="bottom"
                  delay={30}
                  className="mt-4 max-w-xl text-sm font-light leading-relaxed text-white/70 md:text-base"
                />
              </div>

              <div className="hidden items-center p-10 lg:flex">
                <TrustChecklist key={slide.eyebrow} points={slide.points} className="w-full" />
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      {/* Below the fold on narrow screens the guarantees move under the panel. */}
      <TrustChecklist key={slide.eyebrow} points={slide.points} className="mt-5 lg:hidden" />
    </section>
  );
}

export default TrustSection;
