import { Root } from './CursorParts.js';

// The parts live in CursorParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Cursor.Root`: a property of an object exported from a client module is not reachable there.
export * from './CursorParts.js';
export const Cursor = { Root };
