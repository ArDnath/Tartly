'use client';

/* eslint-disable @next/next/no-img-element -- decorative gradient banner. */

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

import { TartlyLogo } from '@/components/shared/brand/tartly-logo';
import { ClickSpark } from '@/components/shared/motion/click-spark';
import { Magnet } from '@/components/shared/motion/magnet';
import { Reveal } from '@/components/shared/motion/reveal';
import { StaggeredText } from '@/components/shared/motion/staggered-text';

/**
 * React Bits "FaultyTerminal" — the glitching glyph field, ported into
 * `components/motion/faulty-terminal`. WebGL has nothing to paint on the
 * server, and deferring its ogl bundle keeps it out of the landing page's
 * initial payload, so it is client-only and lazy like the hero's dithers.
 */
const FaultyTerminal = dynamic(
  () => import('@/components/shared/motion/faulty-terminal'),
  { ssr: false },
);

/**
 * The terminal texture that backs the closing CTA.
 *
 * It is deliberately a *background*: `aria-hidden`, `pointer-events-none`, and
 * confined to the upper CTA zone by a vertical mask that fades to nothing well
 * before the link columns start, so small text and legal copy never sit on
 * moving glyphs. It mounts only once the footer approaches the viewport (so the
 * fade-in plays on arrival rather than off-screen at page load) and the effect
 * idles itself while scrolled away. `prefers-reduced-motion` freezes it to a
 * still frame while keeping the opacity reveal.
 */
function FooterTerminalBackdrop() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Full-bleed and pinned to the very bottom of the page, rising to half the
  // footer section's height. It fades upward so the top edge never hard-stops.
  // Deliberately no horizontal fade: the band spans the whole viewport width.
  const fade = 'linear-gradient(to top, black 0%, black 60%, transparent 100%)';

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-1/2"
      style={{
        opacity: 0.6,
        maskImage: fade,
        WebkitMaskImage: fade,
      }}
    >
      {active ? (
        <FaultyTerminal
          scale={1.35}
          gridMul={[2, 1]}
          digitSize={1.05}
          timeScale={0.45}
          pause={!!reduce}
          scanlineIntensity={0.4}
          glitchAmount={0.7}
          flickerAmount={0.7}
          noiseAmp={0.85}
          chromaticAberration={0.6}
          dither={0.3}
          curvature={0.12}
          tint="#ffffff"
          mouseReact={false}
          mouseStrength={0}
          pageLoadAnimation
          brightness={0.6}
        />
      ) : null}
    </div>
  );
}

const FOOTER_COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'AI Inbox', href: '/#features' },
      { label: 'Trust & safety', href: '/#trust' },
      { label: 'FAQ', href: '/#faq' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    title: 'Use cases',
    links: [
      { label: 'Founders & solo operators', href: '/#features' },
      { label: 'Sales teams', href: '/#features' },
      { label: 'Agencies & services', href: '/#features' },
      { label: 'Recruiters', href: '/#features' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Contact', href: 'mailto:support@tartly.in' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative w-full px-4 pb-8">
      <FooterTerminalBackdrop />
      <div className="relative z-10 mx-auto max-w-[1200px] overflow-hidden rounded-3xl border border-white/10 bg-[#141414]">
        {/* Gradient banner behind the closing CTA. */}
        <img
          src="/gradient.svg"
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="pointer-events-none absolute inset-x-0 top-0 h-72 w-full object-cover opacity-70"
        />

        <div className="relative z-10 flex flex-col items-center px-6 pt-20 text-center">
          <h2 className="font-heading max-w-3xl text-3xl font-medium text-white sm:text-4xl md:text-6xl">
            <StaggeredText
              as="span"
              className="block"
              text="Your inbox is full."
              segmentBy="words"
              direction="bottom"
              delay={70}
              duration={0.7}
              proximity
              proximityRadius={150}
              proximityFrom="'wght' 500, 'opsz' 9"
            />
            <StaggeredText
              as="span"
              className="block"
              text="Your time isn’t."
              segmentBy="words"
              direction="bottom"
              delay={70}
              startDelay={0.18}
              duration={0.7}
              proximity
              proximityRadius={150}
              proximityFrom="'wght' 500, 'opsz' 9"
            />
          </h2>
          <StaggeredText
            as="p"
            text="Let Tartly handle the email work that keeps piling up."
            segmentBy="words"
            direction="bottom"
            delay={35}
            startDelay={0.15}
            className="mt-5 max-w-xl text-base font-light text-[#B7B7B7] md:text-lg"
          />
          <Reveal delay={0.25} className="mt-7">
            <ClickSpark color="#a78bfa" radius={20} size={10}>
              <Magnet strength={9} padding={70}>
                <Link
                  href="/auth"
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90"
                >
                  Start using Tartly →
                </Link>
              </Magnet>
            </ClickSpark>
          </Reveal>
        </div>

        <div className="relative z-10 px-6 pb-10 pt-24 md:px-10">
          <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
            <div className="max-w-xs">
              <Link href="/" aria-label="Tartly home">
                <TartlyLogo size={40} className="rounded-lg" />
              </Link>
              <StaggeredText
                as="p"
                text="The 24/7 AI email operator. Stop managing email — put it to work."
                segmentBy="words"
                direction="bottom"
                delay={24}
                className="mt-4 text-sm leading-relaxed text-white/60"
              />
            </div>

            <div className="grid flex-1 grid-cols-2 gap-10 sm:grid-cols-3">
              {FOOTER_COLUMNS.map((column) => (
                <div key={column.title} className="flex flex-col gap-4">
                  <StaggeredText
                    as="div"
                    text={column.title}
                    segmentBy="words"
                    direction="bottom"
                    delay={40}
                    className="text-sm font-normal text-white/40"
                  />
                  <div className="flex flex-col gap-3">
                    {column.links.map((link) => (
                      <Link
                        key={link.label}
                        href={link.href}
                        className="w-fit text-sm leading-none text-white/80 transition-opacity hover:opacity-100"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/*
            Google OAuth homepage requirement: explain, on the public homepage,
            why Google user data is requested. Kept server-rendered (not inside
            a Reveal) so reviewers see it without executing the entrance
            animations.
          */}
          <p className="mt-10 max-w-3xl text-xs leading-relaxed text-white/60">
            Tartly connects to Gmail and Google Calendar only to read and triage
            your inbox, draft and send replies you approve, and schedule
            meetings on your behalf. We do not sell Google user data, use it for
            advertising, or train AI models on it. You can revoke access at any
            time. See our{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-2 transition-colors hover:text-white/70"
            >
              Privacy Policy
            </Link>{" "}
            and the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 transition-colors hover:text-white/70"
            >
              Google API Services User Data Policy
            </a>
            .
          </p>

          <div className="mt-12 h-px w-full bg-white/10" />

          <div className="mt-6 flex flex-col gap-4 text-sm text-white/60 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} Tartly. All rights reserved.</p>
            <a href="mailto:support@tartly.in" className="transition-colors hover:text-white">
              support@tartly.in
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
