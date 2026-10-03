/**
 * Dealer label colors. Palettes are muted and visually distinct; the same
 * dealer always maps to the same slot via hashString().
 */

export const DEALER_COLORS = [
  { bg: '#e8eef4', border: '#5a7a9a', text: '#4a6a8a' },  // Muted Blue
  { bg: '#ece8f0', border: '#7a6a8a', text: '#6a5a7a' },  // Muted Purple
  { bg: '#e8f0e8', border: '#5a7a5a', text: '#4a6a4a' },  // Muted Green
  { bg: '#f0ebe5', border: '#9a7a5a', text: '#8a6a4a' },  // Muted Orange
  { bg: '#f0e8ec', border: '#8a5a6a', text: '#7a4a5a' },  // Muted Pink
  { bg: '#e5efed', border: '#5a7a75', text: '#4a6a65' },  // Muted Teal
  { bg: '#f0ede5', border: '#9a8a5a', text: '#8a7a4a' },  // Muted Amber
  { bg: '#eaf0e8', border: '#6a8a5a', text: '#5a7a4a' },  // Muted Light Green
  { bg: '#e8e9f0', border: '#5a5a8a', text: '#4a4a7a' },  // Muted Indigo
  { bg: '#ece9e6', border: '#6a5a50', text: '#5a4a40' },  // Muted Brown
  { bg: '#e5f0f0', border: '#5a8a8a', text: '#4a7a7a' },  // Muted Cyan
  { bg: '#f0e8e5', border: '#9a6a5a', text: '#8a5a4a' },  // Muted Deep Orange
];

export const DEALER_COLORS_DARK = [
  { bg: '#2a3a4a', border: '#7a9ab0', text: '#9ab0c0' },  // Muted Blue
  { bg: '#3a3040', border: '#9a8aaa', text: '#b0a0c0' },  // Muted Purple
  { bg: '#2a3a2a', border: '#7a9a7a', text: '#9ab09a' },  // Muted Green
  { bg: '#3a3025', border: '#a09070', text: '#b0a080' },  // Muted Orange
  { bg: '#3a2a30', border: '#a07a8a', text: '#b09aa0' },  // Muted Pink
  { bg: '#253a38', border: '#7a9a95', text: '#9ab0aa' },  // Muted Teal
  { bg: '#3a3525', border: '#a09a70', text: '#b0aa80' },  // Muted Amber
  { bg: '#2a3a25', border: '#8a9a7a', text: '#a0b090' },  // Muted Light Green
  { bg: '#30304a', border: '#8a8aaa', text: '#a0a0c0' },  // Muted Indigo
  { bg: '#352d28', border: '#8a7a70', text: '#a09a90' },  // Muted Brown
  { bg: '#253a3a', border: '#7a9a9a', text: '#9ab0b0' },  // Muted Cyan
  { bg: '#3a2a25', border: '#a08070', text: '#b09a8a' },  // Muted Deep Orange
];

// Simple hash function for consistent color assignment
function hashString(str) {
  let hash = 0;
  const normalizedStr = str.toLowerCase().trim();
  for (let i = 0; i < normalizedStr.length; i++) {
    const char = normalizedStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export function getDealerColor(dealerName, theme = "light") {
  if (!dealerName) return null;
  const colors = theme === "dark" ? DEALER_COLORS_DARK : DEALER_COLORS;
  return colors[hashString(dealerName) % colors.length];
}

export function getDealerStyle(dealerName, theme = "light") {
  const color = getDealerColor(dealerName, theme);
  if (!color) return {};
  return {
    backgroundColor: color.bg,
    borderColor: color.border,
    color: color.text,
  };
}
