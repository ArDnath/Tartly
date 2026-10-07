'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { useVariableProximity } from '@/components/shared/motion/use-variable-proximity';

import './ScrollFloat.css';

gsap.registerPlugin(ScrollTrigger);

const ScrollFloat = ({
  children,
  scrollContainerRef = null,
  containerClassName = '',
  textClassName = '',
  animationDuration = 1,
  ease = 'back.inOut(2)',
  scrollStart = 'center bottom+=50%',
  scrollEnd = 'bottom bottom-=40%',
  stagger = 0.03,
  // Variable Proximity, layered on once the scroll reveal has finished.
  proximity = false,
  proximityRadius = 90,
  proximityFrom = "'wght' 600, 'opsz' 9",
  proximityTo = "'wght' 1000, 'opsz' 40",
  proximityFalloff = 'linear'
}) => {
  const containerRef = useRef(null);
  const [proximitySettled, setProximitySettled] = useState(false);

  const charRefs = useVariableProximity({
    containerRef,
    active: proximity && proximitySettled,
    fromFontVariationSettings: proximityFrom,
    toFontVariationSettings: proximityTo,
    radius: proximityRadius,
    falloff: proximityFalloff
  });

  const splitText = useMemo(() => {
    const text = typeof children === 'string' ? children : '';
    let letterIndex = 0;
    return text.split('').map((char, index) => {
      const isSpace = char === ' ';
      const currentLetterIndex = isSpace ? -1 : letterIndex++;
      return (
        <span
          className="char"
          key={index}
          ref={
            currentLetterIndex >= 0
              ? (el) => {
                  charRefs.current[currentLetterIndex] = el;
                }
              : undefined
          }
        >
          {isSpace ? '\u00A0' : char}
        </span>
      );
    });
  }, [children, charRefs]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const scroller = scrollContainerRef && scrollContainerRef.current ? scrollContainerRef.current : window;

    const charElements = el.querySelectorAll('.char');

    gsap.fromTo(
      charElements,
      {
        willChange: 'opacity, transform',
        opacity: 0,
        yPercent: 120,
        scaleY: 2.3,
        scaleX: 0.7,
        transformOrigin: '50% 0%'
      },
      {
        duration: animationDuration,
        ease: ease,
        opacity: 1,
        yPercent: 0,
        scaleY: 1,
        scaleX: 1,
        stagger: stagger,
        // Hand control to the proximity effect only after the letters have
        // finished their scroll reveal.
        onComplete: () => {
          if (proximity) setProximitySettled(true);
        },
        scrollTrigger: {
          trigger: el,
          scroller,
          start: scrollStart,
          end: scrollEnd,
          // Play the reveal once as the text enters view, then leave it
          // settled. No scrub, so the reader doesn't have to keep scrolling
          // to drive the animation to completion.
          toggleActions: 'play none none none'
        }
      }
    );
  }, [scrollContainerRef, animationDuration, ease, scrollStart, scrollEnd, stagger, proximity]);

  return (
    <h2
      ref={containerRef}
      className={`scroll-float ${proximity ? 'variable-proximity' : ''} ${containerClassName}`}
      style={proximity ? { fontVariationSettings: proximityFrom } : undefined}
    >
      <span className={`scroll-float-text ${textClassName}`}>{splitText}</span>
    </h2>
  );
};

export default ScrollFloat;
