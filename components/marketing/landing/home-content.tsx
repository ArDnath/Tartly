'use client';

/* eslint-disable @next/next/no-img-element -- product mock-ups use fixed-size
   decorative images where next/image adds no value. */

import React from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion, useReducedMotion, type Variants } from 'motion/react';

import { TartlyAgentLogo } from '@/components/shared/brand/tartly-logo';
import { BrutalButton } from '@/components/shared/evil-buttons/brutal-button';
import { BlurHighlight } from '@/components/shared/motion/blur-highlight';
import { BlurText } from '@/components/shared/motion/blur-text';
import { ClickSpark } from '@/components/shared/motion/click-spark';
import { LogoLoop, type LogoItem } from '@/components/shared/motion/logo-loop';
import { ProximityHeading } from '@/components/shared/motion/proximity-heading';
import { StaggeredText } from '@/components/shared/motion/staggered-text';
import ScrollFloat from '@/components/shared/motion/ScrollFloat';
import { StarBorder } from '@/components/shared/motion/star-border';
import { Marquee } from '@/components/ui/marquee';
import {
  ChevronDown,
  CurvedArrow,
  GitHub,
  Plus,
  PanelLeftOpen,
  Check,
  Filter,
  Search,
  User,
  Lightning,
  ExclamationTriangle,
  Bell,
  Tag,
  GroupPeople,
  X,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Figma,
  Docx,
  ImageFile,
  Expand,
} from '@/components/marketing/landing/icons';
import { GmailMark, OutlookMark } from '@/components/marketing/landing/hero-brand-marks';
import Footer from '@/components/marketing/landing/footer';
import { PricingSection } from '@/components/marketing/landing/pricing-section';
import { TrustSection } from '@/components/marketing/landing/trust-section';

/**
 * Hero product demo — the Tartly walkthrough embedded from YouTube.
 *
 * Muted autoplay and looping are the only way browsers permit unattended
 * playback, so the demo runs itself: `controls=0` hides the player chrome and
 * `disablekb=1` blocks keyboard toggling. It is paired with
 * `pointer-events-none` on the iframe (see `HeroDemo`) so a click can never
 * pause or scrub it.
 */
const DEMO_VIDEO_ID = 'nKzEIpDvZ3s';

/** Share token + start offset from the video's canonical share link. */
const DEMO_VIDEO_SHARE = 'zD0Puq7X89PPXdRB';
const DEMO_VIDEO_START = 1;

const DEMO_VIDEO_URL =
  `https://www.youtube.com/embed/${DEMO_VIDEO_ID}` +
  `?si=${DEMO_VIDEO_SHARE}&start=${DEMO_VIDEO_START}` +
  `&autoplay=1&mute=1&loop=1&playlist=${DEMO_VIDEO_ID}` +
  `&controls=0&disablekb=1&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3` +
  // Lets the IFrame Player API drive playback from our page.
  `&enablejsapi=1`;

/**
 * Minimal surface of the YouTube IFrame Player API that we use. Avoids pulling
 * in a types package for one component.
 */
type YouTubePlayer = {
  mute: () => void;
  playVideo: () => void;
  setVolume: (volume: number) => void;
};

type YouTubePlayerEvent = { data: number; target: YouTubePlayer };

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          events?: {
            onReady?: (event: YouTubePlayerEvent) => void;
            onStateChange?: (event: YouTubePlayerEvent) => void;
          };
        },
      ) => YouTubePlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** Loads https://www.youtube.com/iframe_api exactly once per page. */
let youTubeApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (youTubeApiPromise) return youTubeApiPromise;

  youTubeApiPromise = new Promise<void>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  });

  return youTubeApiPromise;
}

/** Player states, per the IFrame API. */
const YT_PAUSED = 2;
const YT_ENDED = 0;

/** Intrinsic aspect of the old hero still (6000×4267) — kept so the demo's
 *  container occupies exactly the same space it used to. The 16:9 video is
 *  letterboxed inside it with `object-contain`. */
const HERO_FRAME_RATIO = '6000 / 4267';

/** Each hero side panel runs from the video frame all the way out to the
 *  viewport edge — i.e. the space left beside the centred 80rem
 *  (`xl:max-w-7xl`) frame. The extra pixel tucks it under the frame border. */
const HERO_PANEL_WIDTH = 'max(0px, calc((100vw - 80rem) / 2 + 1px))';

/**
 * How far (px) the YouTube iframe is pushed past the 16:9 screen on the top
 * and bottom. YouTube pins its own chrome — the title / channel bar at the top,
 * the logo and controls at the bottom — to the *player's* edges, so this
 * clipped margin swallows them while the 16:9 video fills the visible screen
 * exactly (none of the picture is cropped).
 */
const YT_CHROME_CROP = 72;

/**
 * Hero media frame. The outer box keeps the exact aspect ratio the old hero
 * still used. Its leftover area — the bars the crop leaves above and below the
 * centred 16:9 screen — is painted the landing page's base colour, and a
 * border runs along the top and bottom of the container.
 *
 * Playback is driven through the YouTube IFrame Player API rather than the
 * declarative iframe alone: `onReady` mutes and force-plays it, and
 * `onStateChange` replays it if YouTube ever pauses or ends it. That keeps the
 * big centre play button from lingering — the last piece of YouTube chrome a
 * bare autoplay embed can't guarantee away.
 */
function HeroDemo({ className }: { className?: string }) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const playerRef = React.useRef<YouTubePlayer | null>(null);
  const [active, setActive] = React.useState(false);

  /*
   * The page renders two HeroDemo frames — one for `md` and up, one below — and
   * the inactive copy is `display:none`. Both used to mount an iframe and go
   * through the IFrame API, so every visit streamed the same video twice (two
   * embed documents, two `videoplayback` requests, two decoders) with the
   * second running invisibly. Gate mounting/playback on the frame actually
   * having a box: an IntersectionObserver never fires for the hidden copy, and
   * fires for the visible one as soon as it approaches the viewport.
   */
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!active) return;
    let disposed = false;

    const setup = () => {
      const iframe = iframeRef.current;
      if (disposed || !iframe || playerRef.current || !window.YT?.Player) return;

      playerRef.current = new window.YT.Player(iframe, {
        events: {
          onReady: (event) => {
            event.target.mute();
            event.target.setVolume(0);
            event.target.playVideo();
          },
          onStateChange: (event) => {
            // Whatever paused it (or the loop boundary), start it again so no
            // play button is ever left on screen.
            if (event.data === YT_PAUSED || event.data === YT_ENDED) {
              event.target.playVideo();
            }
          },
        },
      });
    };

    void loadYouTubeIframeApi().then(setup);

    return () => {
      disposed = true;
    };
  }, [active]);

  return (
    <div
      ref={rootRef}
      className={`relative overflow-hidden border-b border-white/15 bg-[#0F0F0F] ${className ?? ''}`}
      style={{ aspectRatio: HERO_FRAME_RATIO }}
    >
      {/* 16:9 screen, centred both ways in the frame via absolute positioning
          (so it stays centred whether the caller renders the frame `block` or
          `flex`). The iframe is 2×YT_CHROME_CROP taller and shifted up, so
          YouTube's top title bar and bottom chrome fall outside this clipped
          box; the video itself fills the screen exactly. `pointer-events-none`
          makes the whole player click-through, so nothing can pause or scrub
          it. The frame keeps its exact box while `active` is false, so nothing
          shifts when the player swaps in. */}
      <div
        className="absolute left-0 top-1/2 w-full -translate-y-1/2 overflow-hidden"
        style={{ aspectRatio: '16 / 9' }}
      >
        {active ? (
          <iframe
            ref={iframeRef}
            src={DEMO_VIDEO_URL}
            title="Tartly product demo"
            className="pointer-events-none absolute left-0 w-full border-0"
            style={{
              top: -YT_CHROME_CROP,
              height: `calc(100% + ${YT_CHROME_CROP * 2}px)`,
            }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            tabIndex={-1}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * React Bits "Dither" — the animated ordered-dither wave field, ported into
 * `components/motion/dither`. Loaded lazily with `ssr: false`: the effect is
 * WebGL, so it has nothing to render on the server, and deferring its three.js
 * bundle keeps it out of the landing page's initial payload.
 */
const Dither = dynamic(() => import('@/components/shared/motion/dither'), {
  ssr: false,
});

/**
 * React Bits "PixelBlast" — the Bayer-dithered pixel field. Same lazy-loading
 * treatment as <Dither>: it is WebGL, so it renders only on the client and its
 * three.js bundle stays out of the initial payload.
 */
const PixelBlast = dynamic(() => import('@/components/shared/motion/pixel-blast'), {
  ssr: false,
});

/**
 * One of the two dither panels that flank the hero video — the "side boxes".
 *
 * Rendered with the React Bits demo's exact look and defaults (grey wave,
 * `colorNum` 4, `pixelSize` 2, `mouseRadius` 0.3) and `disableAnimation={false}`
 * so the wave field flows exactly like reactbits.dev's Dither. Each panel spans
 * the video's full height and stretches from the frame out to the viewport
 * edge, filling the whole gutter. A soft mask dissolves only the outermost edge
 * and the top/bottom, so the field bleeds into the page instead of ending on a
 * hard rectangle — the colours are untouched.
 *
 * The effect is confined to these two boxes; nothing else on the page uses it.
 */
function HeroSideDither({ side }: { side: 'left' | 'right' }) {
  const horizontalFade =
    side === 'left'
      ? 'linear-gradient(to left, black 0%, black 62%, rgb(0 0 0 / 0.5) 86%, transparent 100%)'
      : 'linear-gradient(to right, black 0%, black 62%, rgb(0 0 0 / 0.5) 86%, transparent 100%)';
  const verticalFade =
    'linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)';

  return (
    <div
      aria-hidden
      className={`absolute top-0 hidden h-full xl:block ${
        side === 'left' ? 'right-full' : 'left-full'
      }`}
      style={{
        width: HERO_PANEL_WIDTH,
        maskImage: `${horizontalFade}, ${verticalFade}`,
        WebkitMaskImage: `${horizontalFade}, ${verticalFade}`,
        maskComposite: 'intersect',
        WebkitMaskComposite: 'source-in',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
      }}
    >
      <Dither
        waveColor={[0.5, 0.5, 0.5]}
        backgroundColor={[0, 0, 0]}
        colorNum={4}
        waveAmplitude={0.3}
        waveFrequency={3}
        waveSpeed={0.05}
        disableAnimation={false}
        enableMouseInteraction={true}
        mouseRadius={0.3}
      />
    </div>
  );
}

/**
 * Gray PixelBlast dither that washes the hero copy.
 *
 * Full-bleed behind the headline, subcopy, badge and CTAs, so the texture runs
 * under the text as well as the space around it. A muted gray, low
 * `patternDensity` and a reduced opacity keep it quiet enough to sit behind
 * white type; the component's built-in `edgeFade` plus a vertical mask dissolve
 * it into the page instead of ending on a hard rectangle. Ripples and liquid
 * interaction are off so it stays purely decorative.
 */
function HeroTextDither() {
  const reduce = useReducedMotion();
  const fade =
    'linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%)';

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 opacity-70"
      style={{ maskImage: fade, WebkitMaskImage: fade }}
    >
      <PixelBlast
        variant="square"
        pixelSize={4}
        color="#454545"
        patternScale={2.5}
        patternDensity={0.55}
        pixelSizeJitter={0.4}
        enableRipples={false}
        speed={reduce ? 0 : 0.35}
        edgeFade={0.45}
        transparent
      />
    </div>
  );
}

/*
 * Below-the-fold sections reveal on scroll via <Reveal> (motion/react, in
 * components/motion). Above-the-fold hero copy animates on mount instead, so
 * there is no dead frame before the first paint.
 */

/*
 * Social proof above the demo. Monochrome wordmarks of the companies people
 * are already joining from — muted so they read as a quiet trust row rather
 * than competing with the product frame below.
 */
const COMPANY_LOGOS: LogoItem[] = [
  { src: '/logos/accenture.svg', alt: 'Accenture', width: 232, height: 44 },
  { src: '/logos/wellsfargo.svg', alt: 'Wells Fargo', width: 256, height: 40 },
  { src: '/logos/cognizant.svg', alt: 'Cognizant', width: 212, height: 44 },
  { src: '/logos/amazon.svg', alt: 'Amazon', width: 176, height: 52 },
  { src: '/logos/microsoft.svg', alt: 'Microsoft', width: 258, height: 44 },
];

/**
 * Social-proof block for the demo frame: a small, salesy nudge above a looping
 * row of the companies people are joining from. Rendered inside the video
 * container so, on wide screens, it sits between the two side dither squares
 * and directly on top of the player.
 */
function CompanyProof({ className }: { className?: string }) {
  return (
    <div className={`relative flex flex-col items-center px-6 text-center ${className ?? ''}`}>
      <p className="text-sm font-medium tracking-tight text-[#B7B7B7] md:text-[15px]">
        <span className="font-semibold text-white">20+ people</span> joined this week — when will
        you?
      </p>
      <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-white/35">
        Including people at
      </p>
      <div className="mt-6 w-full max-w-4xl">
        <LogoLoop
          logos={COMPANY_LOGOS}
          speed={65}
          direction="left"
          logoHeight={26}
          gap={56}
          pauseOnHover
          fadeOut
          fadeOutColor="#0F0F0F"
          scaleOnHover
          ariaLabel="Companies people are already joining from"
        />
      </div>
    </div>
  );
}

const FAQS = [
  {
    q: 'What exactly does Tartly do?',
    a: 'Tartly is a 24/7 AI email operator. It reads and summarizes your inbox, drafts replies in your voice, follows up with prospects, helps run campaigns, and moves sales conversations forward.',
  },
  {
    q: 'Does Tartly send email without me?',
    a: 'Only if you let it. You choose which actions stay as drafts and which can run automatically, and every workflow can be paused or stopped.',
  },
  {
    q: 'Which email providers are supported?',
    a: 'Tartly connects to both Gmail and Outlook, plus Google Calendar, so it fits the workflow you already use.',
  },
  {
    q: 'How fast can I get value?',
    a: 'Most people connect their inbox, ask for a summary, and generate their first reply in a few minutes — no long setup wizard first.',
  },
];

const firstRowQueries: string[] = [
  'Summarize today’s inbox',
  'Reply to the Stripe lead',
  'Follow up with Sarah',
];

const secondRowQueries: string[] = [
  'Book a meeting with Alex',
  'What needs my attention?',
];

export default function HomeContent() {
  // Which FAQ card is expanded (single-open). Click an open card to close it.
  const [openFaq, setOpenFaq] = React.useState<number | null>(0);
  const reduceMotion = useReducedMotion();

  // "Ask away / Tartly executes" hero mock-up. The dithered backdrop settles
  // first, then the two window cards ease up beneath it — a deliberate,
  // layered fade instead of the whole composition popping in at once. Under
  // reduced motion every layer renders at rest.
  const askGroup: Variants = reduceMotion
    ? { hidden: {}, visible: {} }
    : {
        hidden: {},
        visible: { transition: { staggerChildren: 0.16, delayChildren: 0.12 } },
      };
  const askBackdrop: Variants = reduceMotion
    ? { hidden: { opacity: 1 }, visible: { opacity: 1 } }
    : { hidden: { opacity: 0 }, visible: { opacity: 1 } };
  const askCard: Variants = reduceMotion
    ? { hidden: { opacity: 1, y: 0 }, visible: { opacity: 1, y: 0 } }
    : { hidden: { opacity: 0, y: 18 }, visible: { opacity: 1, y: 0 } };

  return (
    <main className="relative flex h-full flex-1 flex-col overflow-x-hidden bg-[#0F0F0F]">
      <section className="relative z-10 mt-32 flex flex-col items-center px-4">
        {/* Gray PixelBlast wash, full-bleed behind the hero copy. */}
        <HeroTextDither />
        {/* Hero heading — the words blur in from React Bits' <BlurText>; the
            proximity effect is shared by every other heading on the page via
            <ProximityHeading>. */}
        <div className="relative mx-auto mb-3 w-full max-w-[1130px]">
          <BlurText
            as="h1"
            text="Your email should work while you do."
            animateBy="words"
            direction="top"
            delay={150}
            stepDuration={0.35}
            className="justify-center text-center text-4xl font-semibold text-white md:text-6xl"
            proximity
            proximityRadius={120}
            proximityFrom="'wght' 600, 'opsz' 9"
          />
        </div>
        <div className="relative mb-6">
          {/* Feathered page-colour halo so the PixelBlast dots never compete
              behind the subcopy — the headline and the surrounding space keep
              the texture, but this paragraph reads on clean background. */}
          <div
            aria-hidden
            className="absolute -inset-x-10 -inset-y-5 -z-10 bg-[#0F0F0F] blur-lg"
          />
          <BlurHighlight
            inView={false}
            blurAmount={8}
            inactiveOpacity={0.35}
            blurDelay={0.42}
            blurDuration={0.6}
            highlightDelay={0.9}
            highlightDuration={0.6}
            highlightDirection="left"
            highlightedBits={['24/7 AI email operator', 'you approve every send']}
            highlightColor="rgba(139, 92, 246, 0.32)"
            highlightClassName="text-white"
            className="mx-auto max-w-2xl text-center text-base font-medium text-[#B7B7B7] md:text-lg"
          >
            Meet Tartly, your 24/7 AI email operator. It drafts, replies, and follows up for you — and
            you approve every send.
          </BlurHighlight>
        </div>
        {/* Primary CTAs. The primary action is a NeoBrutalist button with no
            cursor or click animation; the secondary keeps its click spark. */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 1.05 }}
          className="mb-6 flex flex-col items-center gap-4 sm:flex-row"
        >
          <BrutalButton
            render={<Link href="/auth" />}
            color="#ffffff"
            textColor="#000000"
            borderColor="#000000"
            shadowColor="#8b5cf6"
            className="text-sm"
          >
            Start using Tartly
          </BrutalButton>
          <ClickSpark color="#a78bfa" radius={18} size={9}>
            <StarBorder
              color="#8b5cf6"
              speed={5}
              radius={10}
              innerClassName="border border-[#2A2A2A] bg-[#1E1E1E] transition-colors hover:bg-[#262626]"
            >
              <Link
                href="#how"
                className="inline-flex h-9 items-center justify-center px-5 text-sm font-medium text-white"
              >
                See how it works
              </Link>
            </StarBorder>
          </ClickSpark>
        </motion.div>

        {/* Static "Works with" row — sits below the CTAs, no entry or hover
            motion. The Gmail and Outlook marks are plain, unanimated SVGs. */}
        <div className="mt-3 mb-1 flex flex-wrap items-center justify-center gap-3 text-sm font-medium text-[#B7B7B7]">
          <span>Works with</span>
          <span className="flex items-center gap-3" aria-label="Gmail and Outlook">
            <GmailMark className="size-7" />
            <OutlookMark className="size-7" />
          </span>
        </div>
      </section>

      {/* `#how` is the target of the hero's "See how it works" CTA. It wraps
          both breakpoints so the anchor lands on the demo at any width (the
          desktop frame is `display:none` on mobile, and an anchor cannot
          scroll to a hidden element). The top margin drops the whole demo
          further down, giving the hero copy above it more breathing room. */}
      <div id="how" className="mt-4 md:mt-8">
        <section className="relative mt-0 hidden flex-col justify-center md:flex">
          <div
            className="relative bottom-2 flex w-full justify-center md:border-t md:border-white/15"
            style={{ clipPath: 'inset(0 0 0 0)', height: '110%' }}
          >
            <div className="container relative -top-1.5 md:border-x md:border-white/15 xl:max-w-7xl">
              <HeroSideDither side="left" />
              <HeroSideDither side="right" />
              {/* Thin rule tucked just under the frame's top border, above the
                  social-proof row. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-4 border-t border-white/15"
              />
              <CompanyProof className="pb-2 pt-10 md:pb-2 md:pt-10" />
              <HeroDemo className="hidden w-full md:block" />
            </div>
          </div>
        </section>

        <div className="flex flex-col items-center justify-center px-4 md:hidden">
          <CompanyProof className="pb-4 pt-10" />
          <HeroDemo className="w-full rounded-xl border border-white/15" />
        </div>
      </div>

      <div className="relative -top-3.5 hidden h-[1px] w-full bg-[#313135] md:block" />

      <div id="features" className="relative mt-52 flex items-center justify-center px-6">
        <div className="mx-auto grid max-w-[1250px] gap-12 md:grid-cols-2 lg:grid-cols-3">
          <motion.div
            initial={{ opacity: 0, y: 28, filter: 'blur(6px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col"
          >
            <div className="relative h-96 w-full overflow-hidden rounded-2xl">
              <div
                className="absolute left-0 top-0 h-96 w-96 rounded-2xl border border-[#252525] bg-neutral-800 bg-cover bg-center"
                style={{ backgroundImage: "url('/assets/images/feature-card-1.webp')" }}
              />
              <div className="outline-tokens-stroke-light/5 bg-[#1A1A1A] absolute left-[39px] top-[34px] inline-flex h-[771px] w-72 flex-col items-start justify-start overflow-hidden rounded-lg">
                <div className="inline-flex h-10 items-center justify-start gap-3 self-stretch overflow-hidden border-b-[0.38px] border-[#252525] px-4 py-5">
                  <div className="flex flex-1 items-center justify-start gap-2">
                    <div className="flex flex-1 items-center justify-start gap-1.5">
                      <PanelLeftOpen className="h-3 w-3 fill-[#8C8C8C]" />
                      <div className="ml-1 justify-start text-xs leading-3 text-white">Inbox</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-start gap-1">
                    <Check className="h-2.5 w-2.5 fill-[#8C8C8C]" />
                    <div className="justify-start text-xs leading-3 text-[#8C8C8C]">Select</div>
                  </div>
                  <div className="relative h-2.5 w-[0.76px] rounded-full bg-[#252525]" />
                  <div className="flex items-center justify-start gap-2">
                    <Filter className="relative h-3 w-3 fill-[#8C8C8C]" />
                  </div>
                </div>
                <div className="flex flex-col items-start justify-start gap-3 self-stretch p-4">
                  <div className="inline-flex h-7 items-center justify-start gap-1 self-stretch overflow-hidden rounded bg-[#141414] pl-1.5 pr-[3.04px]">
                    <Search className="relative mr-1 h-3 w-3 overflow-hidden rounded-[1.14px] fill-[#8C8C8C]" />
                    <div className="flex-1 justify-start text-xs leading-3 text-[#929292]">
                      Search
                    </div>
                    <div className="flex h-5 items-center justify-center gap-2 rounded-sm bg-[#262626] px-1">
                      <div className="justify-start text-xs leading-3 text-[#929292]">⌘K</div>
                    </div>
                  </div>
                  <div className="inline-flex items-start justify-start gap-1.5 self-stretch">
                    <div className="flex h-6 w-6 items-center justify-center gap-[3.04px] overflow-hidden rounded bg-[#313131]">
                      <Lightning className="relative h-3 w-3 overflow-hidden fill-[#989898]" />
                    </div>
                    <div className="flex h-6 w-6 items-center justify-center gap-[3.04px] overflow-hidden rounded bg-[#313131]">
                      <ExclamationTriangle className="relative h-3.5 w-3.5 overflow-hidden fill-[#989898]" />
                    </div>
                    <div className="flex h-6 flex-1 items-center justify-center gap-[3.04px] overflow-hidden rounded bg-[#39AE4A] px-2.5">
                      <User className="relative h-3 w-3 overflow-hidden fill-white" />
                      <div className="flex items-center justify-center gap-2 px-[1.52px]">
                        <div className="justify-start text-xs leading-3 text-white">Personal</div>
                      </div>
                    </div>
                    <div className="flex h-6 w-6 items-center justify-center gap-[3.04px] overflow-hidden rounded bg-[#313131]">
                      <Bell className="relative h-3 w-3 overflow-hidden fill-[#989898]" />
                    </div>
                    <div className="flex h-6 w-6 items-center justify-center gap-[3.04px] overflow-hidden rounded bg-[#313131]">
                      <Tag className="relative h-3 w-3 overflow-hidden fill-[#989898]" />
                    </div>
                  </div>
                  <div className="relative flex flex-col items-start justify-center gap-2.5 self-stretch overflow-hidden rounded-md bg-[#12341D] px-2 py-2.5">
                    <div className="justify-start self-stretch text-xs leading-3 text-[#A3E1B3]">
                      Leads, Customers, and Urgent Requests
                    </div>
                    <div className="justify-start self-stretch text-xs font-normal leading-none text-[#F4FBF6]">
                      New leads, customer questions, <br />
                      and time-sensitive requests.
                    </div>
                    <div className="absolute left-[239.80px] top-[6.07px] h-3 w-3 overflow-hidden opacity-50" />
                  </div>
                </div>
                <div className="inline-flex items-center justify-start gap-1 self-stretch px-4 pb-3 pt-5">
                  <div className="flex flex-1 items-center justify-start gap-1">
                    <div className="justify-start text-xs leading-3 text-[#8C8C8C]">Pinned</div>
                    <div className="justify-start text-xs leading-3 text-[#8C8C8C]">[3]</div>
                  </div>
                </div>
                <div className="flex flex-col items-start justify-start gap-1.5 self-stretch px-1.5">
                  <div className="inline-flex items-center justify-start gap-2.5 self-stretch rounded-md p-2.5">
                    <img
                      alt="Nizzy"
                      height={250}
                      width={250}
                      className="h-6 w-6 rounded-full object-cover"
                      src="/nizzy.svg"
                    />
                    <div className="inline-flex h-7 flex-1 flex-col items-start justify-start gap-2">
                      <div className="inline-flex items-start justify-start gap-2 self-stretch">
                        <div className="flex flex-1 items-center justify-start gap-2.5">
                          <div className="flex items-center justify-start gap-[3.04px]">
                            <div className="text-base-gray-950 justify-start text-xs leading-3">
                              Nizzy
                            </div>
                            <div className="justify-start text-center text-xs leading-3 text-[#8C8C8C]">
                              [9]
                            </div>
                          </div>
                        </div>
                        <div className="text-xs font-normal leading-3 text-[#8C8C8C]">Mar 29</div>
                      </div>
                      <div className="inline-flex items-center justify-start gap-2 self-stretch">
                        <div className="text-xs font-normal leading-3 text-[#8C8C8C]">
                          Re: Annual plan — next steps
                        </div>
                        <div className="flex items-start justify-start gap-[3.04px]">
                          <div className="relative h-3.5 w-3.5 overflow-hidden" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="inline-flex items-center justify-start gap-2.5 self-stretch rounded-lg p-2.5">
                    <div className="inline-flex h-6 w-6 flex-col items-center justify-center gap-2 overflow-hidden rounded-full bg-[#313131] px-1 py-2">
                      <GroupPeople className="relative h-5 w-5 overflow-hidden fill-[#989898]" />
                    </div>
                    <div className="inline-flex flex-1 flex-col items-start justify-start gap-2">
                      <div className="inline-flex items-start justify-start gap-2 self-stretch">
                        <div className="flex flex-1 items-center justify-start gap-2.5">
                          <div className="flex items-center justify-start gap-1">
                            <div className="text-base-gray-950 justify-start text-xs leading-3">
                              Alex, Ali, Sarah
                            </div>
                            <div className="justify-start text-center text-xs leading-3 text-[#8C8C8C]">
                              [6]
                            </div>
                          </div>
                        </div>
                        <div className="text-xs font-normal leading-3 text-[#8C8C8C]">Mar 28</div>
                      </div>
                      <div className="inline-flex items-center justify-start gap-2 self-stretch">
                        <div className="text-xs font-normal leading-3 text-[#8C8C8C]">
                          Re: Contract renewal — Q3
                        </div>
                        <div className="flex items-start justify-start gap-[3.04px]">
                          <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          <div className="relative h-3.5 w-3.5 overflow-hidden" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 gap-4">
              <ScrollFloat
                animationDuration={1}
                ease="back.inOut(2)"
                scrollStart="top 85%"
                stagger={0.03}
                containerClassName="mb-2 text-xl font-semibold leading-loose text-white"
                proximity
                proximityRadius={80}
                proximityFrom="'wght' 600, 'opsz' 9"
              >
                AI Inbox
              </ScrollFloat>
              <StaggeredText
                as="p"
                text="Open your inbox and see the work, not the noise. Tartly summarizes, prioritizes, and categorizes every thread — so you always know what needs attention first."
                segmentBy="words"
                direction="bottom"
                delay={22}
                className="max-w-sm text-sm font-light text-[#979797]"
              />
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 28, filter: 'blur(6px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="relative h-96 w-96 overflow-hidden rounded-2xl">
              <div
                className="absolute left-0 top-0 h-96 w-96 rounded-2xl bg-[#2B2B2B] bg-cover bg-center"
                style={{ backgroundImage: "url('/assets/images/feature-card-2.webp')" }}
              />
              <div className="absolute left-[44px] top-0 h-[720px] w-[610px]">
                <div className="absolute left-[31px] top-[29px] inline-flex h-[720px] w-[547px] flex-col items-start justify-start overflow-hidden rounded-lg bg-[#202020] opacity-20">
                  <div className="border-tokens-stroke-light/5 inline-flex h-9 items-center justify-between self-stretch overflow-hidden border-b-[0.35px] py-3 pl-3.5 pr-2">
                    <div className="flex items-center justify-start gap-3">
                      <X className="relative h-3 w-3 overflow-hidden fill-[#8C8C8C]" />
                      <div className="relative h-2 w-[0.71px] rounded-full bg-[#2B2B2B]" />
                      <div className="flex items-center justify-start gap-2">
                        <ChevronLeft className="relative h-3 w-3 overflow-hidden fill-[#8C8C8C]" />
                        <ChevronRight className="relative h-3 w-3 overflow-hidden fill-[#8C8C8C]" />
                      </div>
                    </div>
                    <div className="flex items-center justify-start gap-2">
                      <div className="bg-tokens-button-surface/10 flex h-5 w-5 items-center justify-center gap-[2.83px] overflow-hidden rounded">
                        <div className="relative h-4 w-4 overflow-hidden">
                          <div className="bg-base-warning-500 absolute left-[5.37px] top-[3.90px] h-2.5 w-1.5" />
                        </div>
                      </div>
                      <div className="bg-tokens-stroke-light/5 relative h-2 w-[0.71px] rounded-full" />
                      <div className="bg-tokens-button-surface/10 flex h-5 items-center justify-center gap-[1.42px] overflow-hidden rounded px-1">
                        <div className="relative h-3 w-3" />
                        <div className="flex items-center justify-center gap-2 pl-[0.71px] pr-[1.42px]">
                          <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                            Reply all
                          </div>
                        </div>
                      </div>
                      <div className="bg-tokens-button-surface/10 flex h-5 w-5 items-center justify-center gap-[2.83px] overflow-hidden rounded">
                        <div className="relative h-3 w-3 overflow-hidden" />
                      </div>
                      <div className="bg-tokens-button-surface/10 flex h-5 w-5 items-center justify-center gap-[2.83px] overflow-hidden rounded">
                        <div className="relative h-3 w-3" />
                      </div>
                      <div className="bg-tokens-button-surface/10 flex h-5 w-5 items-center justify-center gap-[2.83px] overflow-hidden rounded">
                        <div className="relative h-3 w-3 overflow-hidden" />
                      </div>
                      <div className="bg-base-danger-100 outline-base-danger-200 flex h-5 w-5 items-center justify-center gap-[2.83px] overflow-hidden rounded outline outline-[0.35px]">
                        <div className="relative h-3 w-3 overflow-hidden" />
                      </div>
                    </div>
                  </div>
                  <div className="border-tokens-stroke-light/5 flex flex-col items-start justify-start gap-6 self-stretch overflow-hidden border-b-[0.35px] p-3.5">
                    <div className="flex flex-col items-start justify-start gap-4 self-stretch">
                      <div className="flex flex-col items-start justify-start gap-2.5 self-stretch">
                        <div className="inline-flex items-start justify-start gap-[2.83px] self-stretch">
                          <div className="text-base-gray-950 justify-start text-xs leading-3">
                            Re: Contract renewal — Q3
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-center text-xs leading-3">
                            [6]
                          </div>
                        </div>
                        <div className="inline-flex items-start justify-start gap-1 self-stretch">
                          <Calendar className="relative bottom-[1px] h-2.5 w-2.5 overflow-hidden fill-[#8C8C8C]" />
                          <div className="text-base-gray-500/50 flex-1 justify-start text-[9.92px] font-normal leading-[9.92px]">
                            March 25 - March 29
                          </div>
                        </div>
                      </div>
                      <div className="inline-flex items-center justify-start gap-3">
                        <div className="flex items-center justify-start gap-1 overflow-hidden shadow-[0px_0.7086613774299622px_1.4173227548599243px_0px_rgba(255,255,255,0.00)] shadow-[0px_0px_0px_0.3543306887149811px_rgba(255,255,255,0.00)]">
                          <div className="flex items-center justify-start">
                            <div className="bg-base-success-500 outline-tokens-surface-secondary flex h-5 w-5 items-center justify-center gap-[2.83px] rounded px-2 outline outline-1">
                              <div className="relative h-3 w-3 overflow-hidden" />
                            </div>
                            <div className="bg-base-secondary-500 flex h-5 w-5 items-center justify-center gap-[2.83px] rounded px-2">
                              <div className="relative h-3 w-3 overflow-hidden" />
                            </div>
                          </div>
                          <div className="relative h-3 w-3 overflow-hidden" />
                        </div>
                        <div className="bg-tokens-stroke-light/5 relative h-2 w-[0.71px] rounded-full" />
                        <div className="flex items-center justify-start gap-[2.83px]">
                          <div className="outline-tokens-badge-default/10 flex items-center justify-start gap-1 overflow-hidden rounded-full py-[2.83px] pl-[2.83px] pr-2 outline outline-[0.35px] outline-offset-[-0.35px]">
                            <img
                              alt=""
                              aria-hidden="true"
                              className="h-3.5 w-3.5 rounded-full object-cover"
                              src="/adam.svg"
                            />
                            <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                              Ali
                            </div>
                          </div>
                          <div className="outline-tokens-badge-default/10 flex items-center justify-start gap-1 overflow-hidden rounded-full py-[2.83px] pl-[2.83px] pr-2 outline outline-[0.35px] outline-offset-[-0.35px]">
                            <div className="inline-flex h-3.5 w-3.5 flex-col items-center justify-center gap-2 overflow-hidden rounded-full">
                              <img
                                alt=""
                                aria-hidden="true"
                                className="h-4 w-4 rounded-full object-cover"
                                src="/ryan.svg"
                              />
                            </div>
                            <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                              Nick
                            </div>
                          </div>
                          <div className="outline-tokens-badge-default/10 flex items-center justify-start gap-1 overflow-hidden rounded-full py-[2.83px] pl-[2.83px] pr-2 outline outline-[0.35px] outline-offset-[-0.35px]">
                            <img
                              alt=""
                              aria-hidden="true"
                              className="h-3.5 w-3.5 rounded-full object-cover"
                              src="/ahmet.svg"
                            />
                            <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                              Sarah
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="bg-tokens-surface-on-secondary/5 outline-base-secondary-500 flex flex-col items-start justify-start gap-3.5 self-stretch rounded-lg p-3 outline outline-[0.35px] outline-offset-[-0.35px]">
                      <div className="inline-flex items-center justify-start gap-1">
                        <div className="justify-start text-[9.92px] leading-[9.92px] text-[#948CA4]">
                          AI Summary
                        </div>
                      </div>
                      <div className="text-base-gray-950 justify-start self-stretch text-[9.92px] font-normal leading-none">
                        Enterprise plan pricing and rollout. Security review passed; wants a
                        walkthrough before month end.
                      </div>
                    </div>
                    <div className="flex flex-col items-start justify-start gap-2.5 self-stretch">
                      <div className="inline-flex items-center justify-start gap-[2.83px]">
                        <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                          Attachments
                        </div>
                        <div className="text-base-gray-500/50 justify-start text-center text-[9.92px] leading-[9.92px]">
                          [4]
                        </div>
                      </div>
                      <div className="inline-flex flex-wrap content-start items-start justify-start gap-2 self-stretch">
                        <div className="outline-tokens-stroke-element/0 flex h-5 items-center justify-start gap-1 overflow-hidden rounded bg-[#26232C] px-1.5 py-1 shadow">
                          <div className="relative overflow-hidden">
                            <Figma className="relative h-2 w-2 overflow-hidden" />
                          </div>
                          <div className="flex items-center justify-start gap-[2.83px]">
                            <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                              cmd.center.fig
                            </div>
                            <div className="justify-start text-[9.92px] leading-[9.92px] opacity-50">
                              21 MB
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-start gap-1 overflow-hidden rounded bg-[#26232C] py-1 pl-1 pr-1.5 shadow">
                          <Docx className="relative h-2 w-2 overflow-hidden fill-blue-500" />
                          <div className="flex items-center justify-start gap-[2.83px]">
                            <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                              comments.docx
                            </div>
                            <div className="justify-start text-[9.92px] leading-[9.92px] opacity-50">
                              3.7 MB
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-start gap-1 overflow-hidden rounded bg-[#26232C] py-1 pl-1 pr-1.5 shadow">
                          <ImageFile className="relative h-2 w-2 overflow-hidden fill-purple-500" />
                          <div className="flex items-center justify-start gap-[2.83px]">
                            <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                              img.png
                            </div>
                            <div className="justify-start text-[9.92px] leading-[9.92px] opacity-50">
                              2.3 MB
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="border-tokens-stroke-light/5 flex-col items-start justify-start gap-6 self-stretch overflow-hidden border-b-[0.35px] p-3.5">
                    <div className="inline-flex items-center justify-start gap-3 self-stretch">
                      <img
                        alt="Ahmet"
                        height={200}
                        width={200}
                        className="h-6 w-6 rounded-full"
                        src="/ahmet.svg"
                      />
                      <div className="inline-flex flex-1 flex-col items-start justify-start gap-2">
                        <div className="inline-flex items-start justify-start gap-2 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-2">
                            <div className="flex items-center justify-start gap-[2.83px]">
                              <div className="text-base-gray-950 justify-start text-[9.92px] leading-[9.92px]">
                                Ahmet
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-[2.83px] self-stretch opacity-50">
                          <div className="text-base-gray-500/50 justify-start text-[9.92px] font-normal leading-[9.92px]">
                            To:
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-[9.92px] font-normal leading-[9.92px]">
                            Alex, Sarah
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="from-tokens-scroll-overlay-primary to-tokens-scroll-overlay-top/0 absolute left-0 top-[668.98px] h-12 w-[547.09px] bg-gradient-to-l" />
                  <div className="bg-tokens-agent-surface/10 border-tokens-agent-stroke absolute left-[498.90px] top-[674.65px] h-8 w-8 rounded-full border-2 px-1 shadow-[0px_8.503936767578125px_17.00787353515625px_0px_rgba(0,0,0,0.15)] backdrop-blur-lg" />
                </div>
                <div className="absolute left-0 top-[121px] inline-flex w-[650px] flex-col items-start justify-start gap-4 overflow-hidden rounded-3xl border border-[#8B5CF6] bg-[#2A1D48] p-6 outline outline-[#3F325F]">
                  <div className="inline-flex items-center justify-start gap-1.5">
                    <div className="relative h-3.5 w-3.5">
                      <img src="/star.svg" alt="AI Summary" width={16} height={16} />
                    </div>
                    <div className="flex items-center justify-start gap-1 text-xs leading-3 text-[#948CA4]">
                      AI Summary
                      <ChevronDown className="relative h-2 w-2 overflow-hidden fill-[#8C8C8C]" />
                    </div>
                  </div>
                  <div className="justify-start self-stretch text-base font-normal leading-snug text-white">
                    Enterprise plan pricing and rollout.{' '}
                    <span className="text-[#D8C8FC]">
                      Security review passed; wants a walkthrough before month end.
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <ScrollFloat
                animationDuration={1}
                ease="back.inOut(2)"
                scrollStart="top 85%"
                stagger={0.03}
                containerClassName="mb-2 mt-4 text-lg font-semibold leading-loose text-white"
                proximity
                proximityRadius={80}
                proximityFrom="'wght' 600, 'opsz' 9"
              >
                Email Summaries
              </ScrollFloat>
              <StaggeredText
                as="p"
                text="Know what happened in a 30-message thread in 10 seconds. Tartly extracts the decisions, the next steps, and who owes what — before you read a single one."
                segmentBy="words"
                direction="bottom"
                delay={22}
                className="max-w-sm text-sm font-light text-[#979797]"
              />
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 28, filter: 'blur(6px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="relative h-96 w-96 overflow-hidden rounded-2xl">
              <div
                className="absolute left-0 top-0 h-96 w-96 rounded-2xl bg-[#2B2B2B] bg-cover bg-center"
                style={{ backgroundImage: "url('/assets/images/feature-card-3.webp')" }}
              />
              <div className="bg-[#1A1A1A] absolute left-[34px] top-[34px] inline-flex w-[600px] flex-col items-start justify-start overflow-hidden rounded-xl">
                <div className="bg-tokens-surface-secondary border-tokens-stroke-light/5 inline-flex h-12 items-center justify-center gap-3 self-stretch overflow-hidden border-b-[0.50px] px-4 py-3">
                  <div className="flex h-6 items-center justify-center overflow-hidden rounded bg-[#262626] pl-1 pr-1.5">
                    <X className="relative h-3.5 w-3.5 overflow-hidden fill-[#767676]" />
                    <div className="flex items-center justify-center gap-2.5 px-0.5 text-[#767676]">
                      esc
                    </div>
                  </div>
                  <div className="flex flex-1 items-center justify-start gap-1">
                    <div className="relative w-px self-stretch rounded-full bg-[#767676]" />
                    <div className="flex-1 justify-center text-sm font-normal leading-none text-[#767676]">
                      Search by sender, subject, or content...
                    </div>
                  </div>
                </div>
                <div className="bg-tokens-surface-secondary border-tokens-stroke-light/5 flex flex-col items-start justify-start self-stretch overflow-hidden border-b-[0.50px]">
                  <div className="inline-flex items-center justify-start gap-1.5 self-stretch px-5 pb-3 pt-5">
                    <div className="flex-1 justify-start text-sm leading-none text-[#8C8C8C]">
                      Recently interacted
                    </div>
                  </div>
                  <div className="flex flex-col items-start justify-start gap-2 self-stretch p-2">
                    <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-lg p-3">
                      <div className="relative h-8 w-8 rounded-full bg-indigo-500/10">
                        <div className="absolute left-[10.2px] top-[4px] h-7 w-3 overflow-hidden">
                          <img
                            src="/stripe.svg"
                            alt="Stripe"
                            width={12}
                            height={24}
                            className="w-18 absolute h-6"
                          />
                        </div>
                      </div>
                      <div className="inline-flex flex-1 flex-col items-start justify-start gap-2.5">
                        <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-3">
                            <div className="flex items-center justify-start gap-1">
                              <div className="text-base-gray-950 justify-start text-sm leading-none">
                                Stripe
                              </div>
                            </div>
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-sm font-normal leading-none">
                            Mar 29
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                          <div className="flex-1 justify-start text-sm font-normal leading-none text-[#8C8C8C]">
                            Payment confirmation #1234
                          </div>
                          <div className="flex items-start justify-start gap-1">
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-lg p-3">
                      <div className="relative h-8 w-8 rounded-full bg-red-600/10">
                        <div className="absolute left-0 top-0 h-8 w-8 rounded-full" />
                        <div className="absolute left-[11px] top-[4px] h-7 w-2.5">
                          <img
                            src="/netflix.svg"
                            alt="Stripe"
                            width={12}
                            height={24}
                            className="w-18 absolute h-6"
                          />
                        </div>
                      </div>
                      <div className="inline-flex flex-1 flex-col items-start justify-start gap-2.5">
                        <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-3">
                            <div className="flex items-center justify-start gap-1">
                              <div className="text-base-gray-950 justify-start text-sm leading-none">
                                Netflix
                              </div>
                            </div>
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-sm font-normal leading-none">
                            Mar 29
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                          <div className="flex-1 justify-start text-sm font-normal leading-none text-[#8C8C8C]">
                            New shows added to your list
                          </div>
                          <div className="flex items-start justify-start gap-1">
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-[10px] bg-[#202020] p-3">
                      <img
                        className="h-8 w-8 rounded-full"
                        src="/dudu.svg"
                        alt="Dudu"
                        width={32}
                        height={32}
                      />
                      <div className="inline-flex h-9 flex-1 flex-col items-start justify-start gap-2.5">
                        <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-3">
                            <div className="flex items-center justify-start gap-1">
                              <div className="text-base-gray-950 justify-start text-sm leading-none">
                                Dudu
                              </div>
                              <div className="justify-start text-center text-sm leading-none text-[#8C8C8C]">
                                [9]
                              </div>
                            </div>
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-sm font-normal leading-none">
                            Mar 29
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                          <div className="flex-1 justify-start text-sm font-normal leading-none text-[#8C8C8C]">
                            Re: Annual plan — next steps
                          </div>
                          <div className="flex items-start justify-start gap-1">
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-lg p-3">
                      <div className="inline-flex h-8 w-8 flex-col items-center justify-center gap-2.5 overflow-hidden rounded-full bg-[#2B2B2B]">
                        <div className="relative h-8 w-8 overflow-hidden">
                          <div className="absolute left-[10.60px] top-[8px] h-4 w-2.5 overflow-hidden">
                            <Figma className="relative h-4 w-2.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                      <div className="inline-flex flex-1 flex-col items-start justify-start gap-2.5">
                        <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-3">
                            <div className="flex items-center justify-start gap-1">
                              <div className="text-base-gray-950 justify-start text-sm leading-none">
                                Figma
                              </div>
                              <div className="justify-start text-center text-sm leading-none text-[#8C8C8C]">
                                [5]
                              </div>
                            </div>
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-sm font-normal leading-none">
                            Mar 26
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                          <div className="text-base-gray-500/50 flex-1 justify-start text-sm font-normal leading-none">
                            Comments on “Landing Page v2”
                          </div>
                          <div className="flex items-start justify-start gap-1">
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-lg p-3">
                      <div className="inline-flex h-8 w-8 flex-col items-center justify-center gap-2.5 overflow-hidden rounded-full bg-red-500/10 px-1.5 py-2.5">
                        <div className="relative h-8 w-8 overflow-hidden">
                          <div className="absolute left-[7.30px] top-[7px] h-4 w-4 overflow-hidden">
                            <div className="absolute left-0 top-0 h-4 w-4 bg-red-500" />
                          </div>
                        </div>
                      </div>
                      <div className="inline-flex flex-1 flex-col items-start justify-start gap-2.5">
                        <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-3">
                            <div className="flex items-center justify-start gap-1">
                              <div className="text-base-gray-950 justify-start text-sm leading-none">
                                Asana
                              </div>
                            </div>
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-sm font-normal leading-none">
                            Mar 25
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                          <div className="text-base-gray-500/50 flex-1 justify-start text-sm font-normal leading-none">
                            Weekly task summary
                          </div>
                          <div className="flex items-start justify-start gap-1">
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-lg p-3">
                      <div className="relative inline-flex h-8 w-8 flex-col items-center justify-center gap-2.5 rounded-full px-1.5 py-2.5">
                        <div className="bg-base-primary-500 outline-tokens-surface-secondary absolute left-[24px] top-[24px] h-2 w-2 rounded-full outline outline-2" />
                      </div>
                      <div className="inline-flex flex-1 flex-col items-start justify-start gap-2.5">
                        <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                          <div className="flex flex-1 items-center justify-start gap-3">
                            <div className="flex items-center justify-start gap-1">
                              <div className="text-base-gray-950 justify-start text-sm leading-none">
                                Nick
                              </div>
                            </div>
                          </div>
                          <div className="text-base-gray-500/50 justify-start text-sm font-normal leading-none">
                            Mar 28
                          </div>
                        </div>
                        <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                          <div className="text-base-gray-500/50 flex-1 justify-start text-sm font-normal leading-none">
                            Coffee next week?
                          </div>
                          <div className="flex items-start justify-start gap-1">
                            <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="inline-flex items-center justify-between self-stretch overflow-hidden">
                  <div className="border-tokens-stroke-light/5 flex h-12 flex-1 items-center justify-center gap-2 border-r-[0.50px]">
                    <div className="bg-tokens-button-surface/10 flex h-5 items-center justify-center overflow-hidden rounded px-1.5">
                      <div className="bg-base-gray-500/50 h-2 w-3" />
                    </div>
                    <div className="text-base-gray-500/50 justify-start text-sm leading-none">
                      Open
                    </div>
                  </div>
                  <div className="border-tokens-stroke-light/5 flex h-12 flex-1 items-center justify-center gap-2 border-r-[0.50px]">
                    <div className="bg-tokens-button-surface/10 flex h-5 items-center justify-center overflow-hidden rounded px-1">
                      <div className="text-base-gray-500/50 justify-start text-center text-sm leading-none">
                        ⌘R
                      </div>
                    </div>
                    <div className="text-base-gray-500/50 justify-start text-sm leading-none">
                      Reply
                    </div>
                  </div>
                  <div className="border-tokens-stroke-light/5 flex h-12 flex-1 items-center justify-center gap-2 border-r-[0.50px]">
                    <div className="bg-tokens-button-surface/10 flex h-5 items-center justify-center overflow-hidden rounded px-1">
                      <div className="text-base-gray-500/50 justify-start text-center text-sm leading-none">
                        ⌘E
                      </div>
                    </div>
                    <div className="text-base-gray-500/50 justify-start text-sm leading-none">
                      Archive
                    </div>
                  </div>
                  <div className="border-tokens-stroke-light/5 flex h-12 flex-1 items-center justify-center gap-2 border-r-[0.50px]">
                    <div className="bg-tokens-button-surface/10 flex h-5 items-center justify-center overflow-hidden rounded px-1">
                      <div className="text-base-gray-500/50 justify-start text-center text-sm leading-none">
                        ⌘M
                      </div>
                    </div>
                    <div className="text-base-gray-500/50 justify-start text-sm leading-none">
                      Mark read
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <ScrollFloat
                animationDuration={1}
                ease="back.inOut(2)"
                scrollStart="top 85%"
                stagger={0.03}
                containerClassName="mb-2 text-lg font-semibold leading-loose text-white"
                proximity
                proximityRadius={80}
                proximityFrom="'wght' 600, 'opsz' 9"
              >
                Search &amp; context
              </ScrollFloat>
              <StaggeredText
                as="p"
                text="Ask your inbox instead of searching it. Find the exact conversation, attachment, or decision in natural language — with the context you need to act."
                segmentBy="words"
                direction="bottom"
                delay={22}
                className="max-w-sm text-sm font-light text-[#979797]"
              />
            </div>
          </motion.div>
        </div>
      </div>

      <div className="relative mt-52">
        <div className="z-1 relative">
          <StaggeredText
            as="p"
            text="Tell Tartly what you want done"
            segmentBy="words"
            direction="bottom"
            delay={45}
            className="text-center text-lg font-light text-white/40 md:text-xl"
          />
          <div className="mt-2 flex flex-col items-center justify-center md:mt-8">
            <ProximityHeading
              as="h2"
              label="Ask away"
              radius={140}
              duration={0.7}
              className="text-4xl font-semibold text-white md:text-6xl"
            />
            <ProximityHeading
              as="h2"
              label="Tartly executes"
              radius={140}
              startDelay={0.1}
              duration={0.7}
              className="mb-4 text-4xl font-semibold text-white/40 md:text-6xl"
            />
          </div>

          <motion.div
            className="relative flex items-center justify-center"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: false, amount: 0.2, margin: "0px 0px -8% 0px" }}
            variants={askGroup}
          >
            <div className="relative mx-auto flex h-[600px] w-full max-w-[1180px] items-center justify-center rounded-xl">
              {/* Backdrop — the dithered landscape. It sits behind the pinned
                  panel; the compose window's top edge pokes above it while the
                  pinned panel bulges out below its bottom edge. */}
              <motion.div
                aria-hidden
                data-reveal
                className="pointer-events-none absolute left-0 top-[28px] h-[440px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#141414] shadow-[0_40px_120px_-50px_rgba(0,0,0,0.9)]"
                variants={askBackdrop}
                transition={{ duration: 1.1, ease: "easeInOut" }}
              >
                {/* A CSS background-image loads eagerly at parse; as an image
                    element the ~376KB dithered landscape defers until this
                    below-the-fold section approaches the viewport. */}
                <img
                  src="/assets/images/ask-ditherland.webp"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </motion.div>
              <motion.div
                data-reveal
                className="absolute inset-x-0 top-[296px] z-10 mx-auto inline-flex w-full max-w-[894px] flex-col items-start justify-start overflow-hidden rounded-2xl border border-white/10 bg-[#171717]/92 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.9)] backdrop-blur-md"
                variants={askCard}
                transition={{ duration: 1.3, ease: "easeInOut" }}
              >
                <div className="inline-flex items-center justify-start gap-1.5 self-stretch px-5 pb-4 pt-7">
                  <div className="flex flex-1 items-center justify-start gap-1.5">
                    <div className="justify-start text-sm leading-none text-[#8C8C8C]">Pinned</div>
                    <div className="justify-start text-sm leading-none text-[#8C8C8C]">[3]</div>
                  </div>
                </div>
                <div className="flex flex-col items-start justify-start gap-2 self-stretch px-2 pb-2">
                  <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-lg p-3">
                    <img
                      src="/adam.svg"
                      alt="avatar"
                      width={32}
                      height={32}
                      className="rounded-full"
                    />
                    <div className="inline-flex h-9 flex-1 flex-col items-start justify-start gap-2.5">
                      <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                        <div className="flex flex-1 items-center justify-start gap-3">
                          <div className="flex items-center justify-start gap-1">
                            <div className="text-base-gray-950 justify-start text-sm leading-none">
                              Priya from Northwind
                            </div>
                            <div className="justify-start text-center text-sm leading-none text-[#8C8C8C]">
                              [9]
                            </div>
                          </div>
                        </div>
                        <div className="justify-start text-sm font-normal leading-none text-[#8C8C8C]">
                          Mar 29
                        </div>
                      </div>
                      <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                        <div className="flex-1 justify-start text-sm font-normal leading-none text-[#8C8C8C]">
                          Re: Annual plan — next steps
                        </div>
                        <div className="flex items-start justify-start gap-1">
                          <div className="relative h-3.5 w-3.5 overflow-hidden" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-[10px] p-3">
                    <div className="inline-flex h-8 w-8 flex-col items-center justify-center gap-2.5 overflow-hidden rounded-full bg-[#313131] px-1.5 py-2.5 shadow-[0px_0px_0px_0.5px_rgba(255,255,255,0.00)] shadow-[0px_1px_2px_0px_rgba(255,255,255,0.00)]">
                      <GroupPeople className="h-5 w-5 overflow-hidden fill-[#989898]" />
                    </div>
                    <div className="inline-flex flex-1 flex-col items-start justify-start gap-2.5">
                      <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                        <div className="flex flex-1 items-center justify-start gap-3">
                          <div className="flex items-center justify-start gap-1.5">
                            <div className="text-base-gray-950 justify-start text-sm leading-none">
                              Alex, Ali, Sarah
                            </div>
                            <div className="justify-start text-center text-sm leading-none text-[#8C8C8C]">
                              [6]
                            </div>
                          </div>
                        </div>
                        <div className="justify-start text-sm font-normal leading-none text-[#8C8C8C]">
                          Mar 28
                        </div>
                      </div>
                      <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                        <div className="flex-1 justify-start text-sm font-normal leading-none text-[#8C8C8C]">
                          Re: Contract renewal — Q3
                        </div>
                        <div className="flex items-start justify-start gap-1">
                          <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          <div className="relative h-3.5 w-3.5 overflow-hidden" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="inline-flex items-center justify-start gap-3 self-stretch rounded-lg p-3">
                    <div className="bg-tokens-surface-primary inline-flex h-8 w-8 flex-col items-center justify-center gap-2.5 overflow-hidden rounded-full px-1.5 py-2.5">
                      <div className="relative h-fit">
                        <GitHub className="h-[25px] w-[25px] fill-white" />
                      </div>
                    </div>
                    <div className="inline-flex flex-1 flex-col items-start justify-start gap-2.5">
                      <div className="inline-flex items-start justify-start gap-2.5 self-stretch">
                        <div className="flex flex-1 items-center justify-start gap-3">
                          <div className="flex items-center justify-start gap-1">
                            <div className="text-base-gray-950 justify-start text-sm leading-none">
                              GitHub
                            </div>
                            <div className="justify-start text-center text-sm leading-none text-[#8C8C8C]">
                              [8]
                            </div>
                          </div>
                        </div>
                        <div className="justify-start text-sm font-normal leading-none text-[#8C8C8C]">
                          Mar 28
                        </div>
                      </div>
                      <div className="inline-flex items-center justify-start gap-2.5 self-stretch">
                        <div className="flex-1 justify-start text-sm font-normal leading-none text-[#8C8C8C]">
                          Security alert: Critical vulnerability
                        </div>
                        <div className="flex items-start justify-start gap-1">
                          <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          <div className="relative h-3.5 w-3.5 overflow-hidden" />
                          <div className="relative h-3.5 w-3.5 overflow-hidden" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
              <motion.div
                data-reveal
                className="absolute top-0 z-20 inline-flex h-[500px] w-96 flex-col items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#252525] shadow-[0_30px_70px_-32px_rgba(0,0,0,0.9)]"
                variants={askCard}
                transition={{ duration: 1.3, ease: "easeInOut" }}
              >
                <div className="border-tokens-stroke-light/5 inline-flex items-center justify-start gap-2 self-stretch overflow-hidden border-b-[0.50px] py-3.5 pl-5 pr-3.5">
                  <div className="flex flex-1 items-center justify-start gap-3">
                    <div className="text-base-gray-950 flex flex-1 items-center justify-start text-sm leading-none">
                      <X className="mr-2 h-4 w-4 fill-[#8C8C8C]" />
                      New task
                    </div>
                  </div>
                  <div className="flex h-6 items-center justify-center gap-0.5 overflow-hidden rounded-md px-1">
                    <Plus className="h-3 w-3 overflow-hidden fill-[#8C8C8C]" />
                  </div>
                  <div className="flex h-6 items-center justify-center gap-0.5 overflow-hidden rounded-md px-1">
                    <PanelLeftOpen className="h-3 w-3 overflow-hidden fill-[#8C8C8C]" />
                  </div>
                  <div className="flex h-6 items-center justify-center gap-0.5 overflow-hidden rounded-md px-1">
                    <Expand className="h-2.5 w-2.5 overflow-hidden fill-[#8C8C8C]" />
                  </div>
                </div>
                <div className="relative flex flex-1 flex-col items-center justify-center gap-8 self-stretch overflow-hidden px-5 py-4">
                  <TartlyAgentLogo size={28} className="h-7 w-7" />
                  <div className="flex flex-col items-center justify-start gap-3">
                    <div className="text-base-gray-950 justify-start text-sm leading-none">
                      Ask Tartly to run your email
                    </div>
                    <div className="justify-start text-sm font-normal leading-none text-[#929292]">
                      Summarize, reply, follow up, or launch a campaign in natural language
                    </div>
                  </div>
                  <div className="relative inline-flex w-96 flex-col items-start justify-center gap-2">
                    {/* First row — continuous marquee. */}
                    <div className="relative flex w-full justify-center">
                      <Marquee
                        pauseOnHover
                        repeat={4}
                        className="p-0"
                        style={{ '--duration': '22s', '--gap': '0.5rem' } as React.CSSProperties}
                      >
                        {firstRowQueries.map((query) => (
                          <div
                            key={query}
                            className="flex h-7 shrink-0 items-center rounded-md bg-[#303030] px-2 py-1.5 text-sm leading-none text-[#8B8B8B]"
                          >
                            {query}
                          </div>
                        ))}
                      </Marquee>
                      <div className="pointer-events-none absolute left-0 top-0 h-7 w-12 bg-gradient-to-l from-neutral-800/0 to-neutral-800" />
                      <div className="pointer-events-none absolute right-0 top-0 h-7 w-12 bg-gradient-to-l from-neutral-800 to-neutral-800/0" />
                    </div>

                    {/* Second row — same motion, opposite direction. */}
                    <div className="relative flex w-full justify-center">
                      <Marquee
                        pauseOnHover
                        repeat={4}
                        className="p-0 [&>div]:[animation-direction:reverse]"
                        style={{ '--duration': '22s', '--gap': '0.5rem' } as React.CSSProperties}
                      >
                        {secondRowQueries.map((query) => (
                          <div
                            key={query}
                            className="flex h-7 shrink-0 items-center rounded-md bg-[#303030] px-2 py-1.5 text-sm leading-none text-[#8B8B8B]"
                          >
                            {query}
                          </div>
                        ))}
                      </Marquee>
                      <div className="pointer-events-none absolute left-0 top-0 h-7 w-12 bg-gradient-to-l from-neutral-800/0 to-neutral-800" />
                      <div className="pointer-events-none absolute right-0 top-0 h-7 w-12 bg-gradient-to-l from-neutral-800 to-neutral-800/0" />
                    </div>
                  </div>
                  <div className="absolute left-0 top-[384px] inline-flex w-96 items-center justify-start gap-4 overflow-hidden p-4">
                    <div className="flex h-8 flex-1 items-center justify-start gap-1.5 overflow-hidden rounded-md bg-[#141414] pl-2.5 pr-1">
                      <div className="relative h-3 w-px rounded-full bg-white" />
                      <div className="flex-1 justify-start text-sm leading-none text-[#727272]">
                        Ask Tartly to do anything...
                      </div>
                      <div className="flex h-6 items-center justify-center gap-2.5 rounded bg-[#262626] px-1">
                        <CurvedArrow className="relative left-[1px] mt-1 h-4 w-4 fill-black dark:fill-[#929292]" />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative hidden lg:block"
      >
        <div className="mx-auto max-w-[920px] text-center text-4xl font-normal leading-[48px] text-white">
          <span className="text-[#B7B7B7]">Work smarter, not harder.</span>{' '}
          <span className="pr-12 text-white">Automate repetitive</span>{' '}
          <span className="text-[#B7B7B7]">email</span>
          <span className="text-[#B7B7B7]"> tasks with</span>{' '}
          <span className="pr-14 text-white">smart templates, </span>{' '}
          <span className="text-white">scheduled sends</span>
          <span className="text-[#B7B7B7]">
            , follow-up reminders, and batch processing capabilities that
          </span>{' '}
          <br />
          <span className="text-white underline">save hours every week.</span>
        </div>
        <div className="flex items-center justify-center">
          <img
            className="relative bottom-12 right-[162px]"
            src="/verified-home.png"
            alt="tasks"
            width={50}
            height={50}
          />
          <img
            className="relative bottom-[145px] right-[47px]"
            src="/snooze-home.png"
            alt="tasks"
            width={50}
            height={50}
          />
          <img
            className="relative bottom-[195px] left-[210px]"
            src="/star-home.png"
            alt="tasks"
            width={50}
            height={50}
          />
        </div>
      </motion.div> */}

      {/* Trust & objections — the React Bits <MorphSlider/> as the section's
          morphing backdrop, with the guarantees and Q&A layered on top. */}
      <TrustSection />

      {/* Pricing — geometric treatment: the two plans butt-joint into one
          hairline instrument panel rather than floating as rounded cards. */}
      <PricingSection variant="geometric" />

      {/* FAQ — styling mirrors the Topple landing FAQ: a sticky header column
          beside a stack of rounded, expandable question cards. Adapted to the
          app's dark palette. */}
      <section
        id="faq"
        aria-label="Frequently asked questions"
        className="relative mx-auto mt-52 w-full max-w-[1243px] scroll-mt-[120px] px-5 xl:px-0"
      >
        <div className="flex flex-col items-start gap-12 lg:flex-row lg:justify-between lg:gap-8">
          <div className="relative flex w-full flex-col gap-10 lg:sticky lg:top-28 lg:max-w-[580px] lg:flex-1">
            <div className="flex flex-col items-start gap-8">
              <p className="font-heading text-xl font-semibold leading-6 text-white/40">
                FAQ
              </p>
              <ProximityHeading
                as="h2"
                label="Questions, answered"
                radius={140}
                duration={0.7}
                className="font-heading text-[clamp(30px,5vw,48px)] font-semibold leading-none tracking-[-0.031em] text-white"
              />
            </div>
          </div>

          <div className="flex w-full flex-col items-start gap-[21px] lg:max-w-[590px] lg:flex-1">
            {FAQS.map((faq, i) => {
              const open = openFaq === i;
              return (
                <div
                  key={faq.q}
                  className="w-full overflow-clip rounded-[16px] border border-[#2E2E2E] bg-[#161616] shadow-[0_4px_24px_rgba(0,0,0,0.35)]"
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : i)}
                    className={`flex w-full cursor-pointer items-start px-8 pt-8 text-left transition-[padding] duration-300 ease-out ${open ? 'pb-[13px]' : 'pb-8'}`}
                  >
                    <span className="w-full text-[20px] font-bold leading-normal tracking-[-0.6px] text-white">
                      {faq.q}
                    </span>
                  </button>
                  <div
                    className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                  >
                    <div className="overflow-hidden">
                      <p className="w-full px-8 pb-8 text-[16px] font-medium leading-6 text-white/60">
                        {faq.a}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="relative mt-52 flex items-center justify-center">
        <Footer />
      </div>
    </main>
  );
}
