'use client'
import { Brand } from '@/components/marketing/brand'
import { NAV_LINKS } from '@/components/marketing/landing/nav'
import {
    scrollToHash,
    scrollToTop,
    useSmoothScroll,
} from '@/components/marketing/landing/use-smooth-scroll'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import React from 'react'

import RubberSegment from '@/components/shared/motion/RubberSegment'

/**
 * Landing navigation, styled after the React Bits Pro "Navigation 3" block:
 * logo left, the primary routes as a rubber-thumb segmented control in the
 * middle, and the auth actions on the right, with a disclosure sheet on small
 * screens.
 *
 * Centre routes are shared with the rest of the marketing chrome via
 * `NAV_LINKS` and rendered through the React Bits `<RubberSegment>`, which
 * dilates its thumb across the gap between slots and squashes it onto the next
 * one. The control is a radio group of buttons rather than anchors, so its
 * `onChange` routes: in-page sections (`/#features`, …) smooth-scroll on the
 * landing page and `/pricing` navigates normally.
 *
 * `active` names the slot the current page should start on. It is passed by
 * the rendering page instead of being derived from `usePathname()`: on
 * statically prerendered pages served through `proxy.ts`, the server's
 * pathname and the browser's can disagree, which made the control's
 * `aria-checked`/`tabIndex` differ during hydration.
 */
export const Navbar = ({ active = 'Features' }: { active?: string }) => {
    const [menuState, setMenuState] = React.useState(false)
    const [scrolled, setScrolled] = React.useState(false)
    const [contentWidth, setContentWidth] = React.useState<number | null>(null)
    const barRef = React.useRef<HTMLDivElement>(null)
    const scrollTo = useSmoothScroll()
    const pathname = usePathname()
    const router = useRouter()

    const navItems = NAV_LINKS.map((item) => item.label)

    // The segmented control renders buttons, so selection drives routing.
    const handleRoute = React.useCallback(
        (href: string) => {
            if (href.startsWith('#') || (href.startsWith('/#') && pathname === '/')) {
                if (scrollToHash(href)) return
            }
            router.push(href)
        },
        [pathname, router],
    )

    // The bar starts at full width and contracts once the reader leaves the
    // top of the page, then expands again when they return to the top.
    React.useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 24)
        onScroll()
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    // Measure the bar's natural, content-hugging width (children + gaps +
    // padding + border). We can't transition to `w-fit` directly — `fit-content`
    // isn't interpolatable — so we animate `max-width` to this pixel value.
    // Children keep their natural widths in the flex row, so this is stable
    // regardless of how wide the full-width bar currently is.
    React.useEffect(() => {
        const bar = barRef.current
        if (!bar) return

        const measure = () => {
            const style = window.getComputedStyle(bar)
            const gap = parseFloat(style.columnGap) || 0
            const boxX =
                parseFloat(style.paddingLeft) +
                parseFloat(style.paddingRight) +
                parseFloat(style.borderLeftWidth) +
                parseFloat(style.borderRightWidth)
            const children = Array.from(bar.children).filter(
                (child): child is HTMLElement =>
                    child instanceof HTMLElement && child.offsetWidth > 0,
            )
            const content = children.reduce((sum, child) => sum + child.offsetWidth, 0)
            const gaps = gap * Math.max(children.length - 1, 0)
            setContentWidth(Math.ceil(content + gaps + boxX))
        }

        measure()

        const observer = new ResizeObserver(measure)
        observer.observe(bar)
        Array.from(bar.children).forEach((child) => observer.observe(child))
        window.addEventListener('resize', measure)
        document.fonts?.ready.then(measure).catch(() => {})

        return () => {
            observer.disconnect()
            window.removeEventListener('resize', measure)
        }
    }, [])

    // Escape closes the mobile sheet, matching the rest of the marketing chrome.
    React.useEffect(() => {
        if (!menuState) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setMenuState(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [menuState])

    return (
        // Sits above the page grain (z-[100]) and the hero video frame
        // (z-[101]) so content scrolls under the nav rather than over it.
        <nav aria-label="Primary" className="fixed inset-x-0 top-0 z-[102] px-3 pt-3 sm:px-5">
            <div
                className="mx-auto w-full max-w-7xl transition-[max-width] duration-500 ease-out"
                style={scrolled && contentWidth ? { maxWidth: contentWidth } : undefined}>
                <div
                    ref={barRef}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/70 py-2 pr-2 pl-3 shadow-lg shadow-black/20 backdrop-blur-xl sm:gap-4 sm:pl-4">
                    {/* Left — logo + wordmark. On the landing page a click
                        returns the reader to the top rather than re-routing to
                        the current URL. */}
                    <Link
                        href="/"
                        aria-label="Tartly home"
                        onClick={(event) => {
                            if (pathname !== '/') return
                            event.preventDefault()
                            scrollToTop()
                            window.history.replaceState(null, '', '/')
                        }}
                        className="flex shrink-0 items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                        <Brand size={42} wordmarkClassName="text-2xl" />
                    </Link>

                    {/* Centre — the primary routes as the React Bits
                        `<RubberSegment>`: the thumb dilates across the gap on
                        the way to the next section and squashes onto it on
                        landing. The control is a radio group of buttons, so its
                        `onChange` smooth-scrolls in-page sections and routes
                        `/pricing`. The initial slot comes from the page's
                        `active` prop (serialized with the HTML) rather than
                        `usePathname()`, which can differ between the server and
                        the browser on statically prerendered pages reached
                        through `proxy.ts`; keying by it resets the control when
                        the route changes. */}
                    <div className="hidden shrink-0 lg:block">
                        <RubberSegment
                            key={active}
                            items={navItems}
                            defaultValue={active}
                            onChange={(_, index) => {
                                const link = NAV_LINKS[index]
                                if (link) handleRoute(link.href)
                            }}
                            aria-label="Primary routes"
                            trackColor="#27272a"
                            thumbColor="#fafafa"
                            textColor="#fafafa"
                            activeTextColor="#18181b"
                            size="md"
                            radius={10}
                            inset={3}
                            equalSlots
                            stretch={100}
                            squash={3}
                            speed={1}
                            glide={75}
                            draggable
                        />
                    </div>

                    {/* Right — sign in (desktop) + primary CTA + mobile toggle. */}
                    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                        <Link
                            href="/auth"
                            className="hidden rounded-md px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:block">
                            Sign in
                        </Link>

                        <Button
                            size="sm"
                            className="hidden h-9 rounded-lg px-4 text-sm font-semibold lg:inline-flex"
                            render={<Link href="/auth" />}
                            nativeButton={false}>
                            <span>Get started</span>
                        </Button>

                        <button
                            type="button"
                            onClick={() => setMenuState((value) => !value)}
                            aria-label={menuState ? 'Close menu' : 'Open menu'}
                            aria-expanded={menuState}
                            className="relative z-20 block cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden">
                            <Menu
                                className={cn(
                                    'm-auto size-5 transition-all duration-200',
                                    menuState && 'rotate-180 scale-0 opacity-0',
                                )}
                            />
                            <X
                                className={cn(
                                    'absolute inset-0 m-auto size-5 -rotate-180 scale-0 opacity-0 transition-all duration-200',
                                    menuState && 'rotate-0 scale-100 opacity-100',
                                )}
                            />
                        </button>
                    </div>
                </div>

                {/* Mobile sheet — grouped links then the auth actions. */}
                {menuState && (
                    <div className="fixed inset-x-3 top-[4.5rem] rounded-xl border border-border bg-card/95 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl sm:inset-x-5 lg:hidden">
                        <ul className="space-y-1">
                            {NAV_LINKS.map((item) => (
                                <li key={item.href}>
                                    <Link
                                        href={item.href}
                                        onClick={(event) => {
                                            scrollTo(event, item.href)
                                            setMenuState(false)
                                        }}
                                        className="block rounded-lg px-4 py-3 text-base text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                                        <span>{item.label}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                            <Button
                                variant="outline"
                                size="lg"
                                className="w-full rounded-lg font-medium"
                                render={<Link href="/auth" onClick={() => setMenuState(false)} />}
                                nativeButton={false}>
                                <span>Sign in</span>
                            </Button>
                            <Button
                                size="lg"
                                className="w-full rounded-lg font-semibold"
                                render={<Link href="/auth" onClick={() => setMenuState(false)} />}
                                nativeButton={false}>
                                <span>Get started</span>
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </nav>
    )
}
