/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const shortAsciiLogo = `
████████ ██████  ██████   ██████ ██   ██     ██████  ██ ██       ██████  ████████ 
   ██    ██    █ ██   ██ ██      ██   ██     ██   ██ ██ ██      ██    ██    ██    
   ██    ██    █ ██████  ██      ███████     ██████  ██ ██      ██    ██    ██    
   ██    ██    █ ██   ██ ██      ██   ██     ██      ██ ██      ██    ██    ██    
   ██    ██████  ██   ██  ██████ ██   ██     ██      ██ ███████  ██████     ██    
`;

export const longAsciiLogo = `
████████  ██████  ██████   ██████ ██   ██     ██████  ██ ██       ██████  ████████ 
   ██    ██    ██ ██   ██ ██      ██   ██     ██   ██ ██ ██      ██    ██    ██    
   ██    ██    ██ ██████  ██      ███████     ██████  ██ ██      ██    ██    ██    
   ██    ██    ██ ██   ██ ██      ██   ██     ██      ██ ██      ██    ██    ██    
   ██     ██████  ██   ██  ██████ ██   ██     ██      ██ ███████  ██████     ██    
`;

/**
 * Get the width of the ASCII art by finding the longest line
 */
export function getAsciiArtWidth(asciiArt: string): number {
  const lines = asciiArt.split('\n');
  return Math.max(...lines.map((line) => line.length));
}
