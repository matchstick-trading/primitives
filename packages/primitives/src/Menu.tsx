import { Root, Trigger, List, Item, RadioItem, Separator } from './MenuParts.js';

// The parts live in MenuParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Menu.Root`: a property of an object exported from a client module is not reachable there.
export * from './MenuParts.js';
export const Menu = { Root, Trigger, List, Item, RadioItem, Separator };
