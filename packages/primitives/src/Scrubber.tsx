import { Root, Track, Thumb, Mark } from './ScrubberParts.js';

// The parts live in ScrubberParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Scrubber.Root`: a property of an object exported from a client module is not reachable there.
export * from './ScrubberParts.js';
export const Scrubber = { Root, Track, Thumb, Mark };
