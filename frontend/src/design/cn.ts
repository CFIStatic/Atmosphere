import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class names, letting later Tailwind utilities win over
 * earlier ones of the same family. Without this, a `className` prop passed into
 * a component silently loses to the component's own defaults.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
