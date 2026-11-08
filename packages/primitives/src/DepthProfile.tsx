import { Root, Plot, Bids, Asks, Axis, Crosshair, Readout, Table } from './DepthProfileParts.js';

// The parts live in DepthProfileParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `DepthProfile.Root`: a property of an object exported from a client module is not reachable there.
export * from './DepthProfileParts.js';
export const DepthProfile = { Root, Plot, Bids, Asks, Axis, Crosshair, Readout, Table };
