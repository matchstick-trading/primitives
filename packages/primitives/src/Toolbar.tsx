import { Root, Button, Separator } from './ToolbarParts.js';

// The parts live in ToolbarParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Toolbar.Root`: a property of an object exported from a client module is not reachable there.
export * from './ToolbarParts.js';
export const Toolbar = { Root, Button, Separator };
