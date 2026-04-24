import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * cn — the canonical className composer for the design system.
 * Merges conditional classes via clsx, then resolves Tailwind conflicts
 * via tailwind-merge so component consumers can override anything safely.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
