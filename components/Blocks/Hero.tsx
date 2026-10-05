"use client"

import { Badge } from '@/components/ui/badge'
import { HeroVideoDialog } from "@/components/ui/hero-video-dialog"
import { ShimmerButton } from "@/components/ui/shimmer-button"
import { motion, type Variants } from "motion/react"
import { useRouter } from "next/navigation"

// Animation variants for staggered children
const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.15,
            delayChildren: 0.1,
        },
    },
}

const fadeUpVariants: Variants = {
    hidden: {
        opacity: 0,
        y: 20,
    },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.5,
            ease: "easeOut",  // Using named easing instead of custom bezier
        },
    },
}

const scaleInVariants: Variants = {
    hidden: {
        opacity: 0,
        scale: 0.95,
    },
    visible: {
        opacity: 1,
        scale: 1,
        transition: {
            duration: 0.5,
            ease: "easeOut",
        },
    },
}

// TODO(imagekit): once the landing media is uploaded, fill in the media-library
// paths below (e.g. "/tartly-hero-light.png" and "/tartly-demo.mp4"). They are
// only requested when NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT is set; until then the
// placeholder sources keep the page intact.
const heroMedia = {
  videoPath: "",
  thumbnailLightPath: "",
  thumbnailDarkPath: "",
  // Zero-config fallbacks (used while ImageKit is unconfigured).
  videoSrc: "https://www.youtube.com/embed/VIDEO_ID",
  thumbnailLight: "https://startup-template-sage.vercel.app/hero-light.png",
  thumbnailDark: "https://startup-template-sage.vercel.app/hero-dark.png",
};

const Hero = () => {
    const router = useRouter()
    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
        >
            {/* Introducing Tartly */}
            <motion.div
                className="flex items-center justify-center"
                variants={fadeUpVariants}
            >
                <Badge className="h-auto text-sm font-medium px-4 py-2 " variant={'outline'}>
                    AI email operator for Gmail + Calendar
                </Badge>
            </motion.div>

            {/* Hero Text */}
            <div className="text-center mt-8">
                <motion.h1
                    className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-6xl"
                    variants={fadeUpVariants}
                >
                    Your inbox, handled by AI.
                </motion.h1>
                <motion.p
                    className="mt-6 text-lg leading-8 text-gray-600 dark:text-gray-400 max-w-3xl mx-auto"
                    variants={fadeUpVariants}
                >
                    Tartly connects to Gmail and Google Calendar — only with the permissions you approve — to triage your inbox, draft replies, schedule meetings, and chase every follow-up.
                </motion.p>
            </div>

            {/* Hero Actions */}
            <motion.div
                className="my-6 mb-12 flex items-center justify-center gap-x-4"
                variants={fadeUpVariants}
            >
                <ShimmerButton onClick={() => router.push('/auth')}>Get started free</ShimmerButton>
            </motion.div>

            {/* Hero Video */}
            <motion.div
                className="relative"
                variants={scaleInVariants}
            >
                <HeroVideoDialog
                    className="block dark:hidden"
                    animationStyle="top-in-bottom-out"
                    videoSrc={heroMedia.videoSrc}
                    videoPath={heroMedia.videoPath}
                    thumbnailPath={heroMedia.thumbnailLightPath}
                    thumbnailSrc={heroMedia.thumbnailLight}
                    thumbnailAlt="Tartly demo video"
                />
                <HeroVideoDialog
                    className="hidden dark:block"
                    animationStyle="top-in-bottom-out"
                    videoSrc={heroMedia.videoSrc}
                    videoPath={heroMedia.videoPath}
                    thumbnailPath={heroMedia.thumbnailDarkPath}
                    thumbnailSrc={heroMedia.thumbnailDark}
                    thumbnailAlt="Tartly demo video"
                />
            </motion.div>

        </motion.div>
    )
}

export default Hero
