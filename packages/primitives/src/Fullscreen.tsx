import { Frame, Toggle } from './FullscreenParts.js';

// The parts live in FullscreenParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Fullscreen.Frame`: a property of an object exported from a client module is not reachable there.
export * from './FullscreenParts.js';
export const Fullscreen = { Frame, Toggle };
