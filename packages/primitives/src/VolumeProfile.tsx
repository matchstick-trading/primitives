import { Histogram, Table } from './VolumeProfileParts.js';

// The parts live in VolumeProfileParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `VolumeProfile.Root`: a property of an object exported from a client module is not reachable there.
export * from './VolumeProfileParts.js';
export const VolumeProfile = { Histogram, Table };
