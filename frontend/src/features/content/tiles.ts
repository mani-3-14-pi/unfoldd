import { Film, Image, Images, RectangleHorizontal, Smartphone, type LucideIcon } from 'lucide-react'
import type { Format, Platform } from './api'

/** The icon on a content tile. No thumbnails come with the list, so the format stands in for the creative. */
export const formatIcon: Record<Format, LucideIcon> = {
  feed_4x5: Image,
  square_1x1: Image,
  story_9x16: Smartphone,
  landscape_16x9: RectangleHorizontal,
  carousel: Images,
  video: Film,
  reel: Film,
  linkedin: Image,
  other: Image,
}

/** A soft gradient per platform, so a row of tiles can be told apart at a glance. Use with `bg-gradient-to-br`. */
export const platformTint: Record<Platform, string> = {
  instagram: 'from-[#fbe9ef] to-[#f6e6f6] text-[#a23b6b]',
  facebook: 'from-[#e8eefb] to-[#e4ebf8] text-[#3a5bb0]',
  linkedin: 'from-[#e5eef6] to-[#e1ebf3] text-[#285e8e]',
  youtube: 'from-[#fbeaea] to-[#f8e6e2] text-[#b13a3a]',
  tiktok: 'from-[#ebebef] to-[#e3e6ea] text-[#2d2f37]',
  x: 'from-[#ececee] to-[#e6e6e9] text-[#303138]',
  pinterest: 'from-[#fbe8e8] to-[#f8e5e9] text-[#b02a3a]',
  website: 'from-[#e6f0eb] to-[#e2ede6] text-[#2f5c4c]',
  other: 'from-[#efeff1] to-[#ebebee] text-[#55565e]',
}
