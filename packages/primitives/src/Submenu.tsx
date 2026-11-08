import { List, SubmenuRoot, SubmenuTrigger } from './MenuParts.js';

// A submenu is a menu inside a menu. Its list and items are the Menu ones (Menu.List, Menu.Item); only the root and the
// trigger differ. Built here, outside the client module, for the same reason as Menu.
export const Submenu = { Root: SubmenuRoot, Trigger: SubmenuTrigger, List };
